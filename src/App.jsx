import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  POGO_TRANSFER_RESEARCH,
  formatBytes,
  hex,
  hexBytes,
  parseFirmwareInput,
} from "./lib/firmware.js";
import {
  G2CaseSession,
  g2CaseTransportLabel,
  isG2CaseUsbConnectionEvent,
  isG2CaseSerialPort,
  portUsesUsbDevice,
  requestG2CasePort,
  webCaseTransportSupported,
  webSerialSupported,
  webUsbSupported,
} from "./lib/serial.js";
import { RemoteSupportConnection } from "./lib/remoteSupport.js";
import {
  RemoteG2CasePort,
  RemoteSerialDeviceBridge,
} from "./lib/remoteSerial.js";
import {
  buildG2SystemBackupArtifact,
  findMatchingGlassesRecoveryRelease,
  validateGlassesRecoveryBundle,
} from "./lib/backup.js";
import { buildG2DeviceAnalytics } from "./lib/analytics.js";
import { decodeApollo510RecoveryConfig } from "./lib/recoveryConfig.js";
import {
  buildBundleDifferencePlan,
  findStockCfwCounterpartRelease,
} from "./lib/differential.js";
import {
  OPERATION_TOTALS,
  operationProgress,
} from "./lib/operationProgress.js";
import {
  DEFAULT_TEMPLE_FLASH_MODE,
  DEFAULT_TEMPLE_FLASH_ROUTE,
  findLatestCaseFirmwareRelease,
  findLatestOfficialStockRelease,
} from "./lib/recoveryDefaults.js";
import {
  DEFAULT_AUTOMATIC_CASE_UPDATE,
  DEFAULT_AUTOMATIC_INSTALL_MODE,
  DEFAULT_INTERFACE_MODE,
  assessAutomaticTempleContacts,
  executeAutomaticCaseUpdate,
  executeAutomaticApply,
  installedProvenanceStorageKey,
  mergeInstalledProvenance,
  prepareAutomaticTempleUpdate,
  resolveAutomaticCaseUpdatePlan,
  verifyAutomaticCaseReadiness,
} from "./lib/automaticRecovery.js";
import { REVIEWED_CASE_VERSION } from "./lib/pogoFlashBridge.js";
import {
  WEBFLASHER_BUILD_LABEL,
  assertCurrentWebFlasherRelease,
} from "./lib/releaseIntegrity.js";
import {
  IDLE_WAKE_LOCK_STATUS,
  MutationWakeLock,
} from "./lib/wakeLock.js";

const EMPTY_PROGRESS = {
  fraction: 0,
  detail: "Ready",
  visible: false,
  name: null,
  total: 1,
  completed: 0,
  current: 1,
  percent: 0,
};

const OPERATION_LABELS = Object.freeze({
  analyze: "Analyze Case",
  backup: "Preserve recovery backup",
  firmware: "Validate firmware",
  "glasses-analyze": "Analyze Smart Glasses",
  pogo: "Query temple",
  recheck: "Reset and recheck",
  "temple-flash": "Restore Smart Glasses",
  "automatic-apply": "Apply Smart Glasses firmware",
  stage: "Stage Case bank",
  activate: "Activate Case bank",
});

const PERSISTENT_MUTATION_OPERATIONS = new Set([
  "automatic-apply",
  "temple-flash",
  "stage",
  "activate",
]);

function cx(...values) {
  return values.filter(Boolean).join(" ");
}

async function fetchCatalogRelease(release, label = "Firmware archive") {
  const urls = [...new Set([release?.url, release?.sourceUrl].filter(Boolean))];
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return response;
      lastError = new Error(`${url} returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `${label} could not be downloaded${lastError?.message ? `: ${lastError.message}` : "."}`,
  );
}

function Icon({ name }) {
  if (name === "tools") {
    return (
      <span className="icon icon-tools" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M8.7 8.7a4 4 0 0 1-5.5-5.5l2.4 2.4 2-2-2.4-2.4a4 4 0 0 1 5.5 5.5L19 15a2.5 2.5 0 1 1-4 4l-8.3-8.3" />
          <path d="m4 20 3.2-.8L18.4 8l-2.4-2.4L4.8 16.8 4 20Z" />
          <path d="m16 5.6 1.2-1.2 2.4 2.4L18.4 8" />
        </svg>
      </span>
    );
  }

  const glyphs = {
    usb: "⌁",
    scan: "◎",
    backup: "↓",
    firmware: "◇",
    recover: "↻",
    terminal: ">_",
    check: "✓",
    warning: "!",
    case: "▱",
    glasses: "⌐",
    bank: "▥",
    file: "▤",
  };
  return (
    <span className={cx("icon", `icon-${name}`)} aria-hidden="true">
      {glyphs[name] ?? "•"}
    </span>
  );
}

function Button({
  children,
  tone = "primary",
  busy = false,
  className,
  ...props
}) {
  return (
    <button
      className={cx("button", `button-${tone}`, className)}
      disabled={busy || props.disabled}
      {...props}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

function Field({ label, value, detail, status }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-value">
        {status ? <span className={cx("tiny-dot", `tiny-dot-${status}`)} /> : null}
        {value ?? "—"}
      </div>
      {detail ? <div className="field-detail">{detail}</div> : null}
    </div>
  );
}

export const WORKFLOW_STEPS = [
  ["connect", "Connect", "USB Serial"],
  ["analyze", "Analyze", "Status + banks"],
  ["backup", "Preserve", "Case + Glasses backup"],
  ["firmware", "Choose image", "CDN or local file"],
];
export const RECOVERY_STEPS = [
  ["recover", "Recovery Console", "Stage, flash, verify"],
];
export const SECTION_KEYS = [...WORKFLOW_STEPS, ...RECOVERY_STEPS].map(
  ([key]) => key,
);

function StepRail({ complete, active }) {
  const renderGroup = (steps, offset) =>
    steps.map(([key, title, detail], index) => (
      <a
        href={`#${key}`}
        className={cx(
          "step-link",
          complete[key] && "is-complete",
          active === key && "is-current",
        )}
        aria-current={active === key ? "page" : undefined}
        onClick={() => {
          // Clicking the current entry leaves the hash unchanged, so no
          // hashchange fires — return to the top of the pane here.
          if (active === key) {
            document
              .querySelector(".pane-viewport")
              ?.scrollTo({ top: 0, behavior: "instant" });
          }
        }}
        key={key}
      >
        <span className="step-number">
          {complete[key] ? (
            <Icon name="check" />
          ) : key === "recover" ? (
            <Icon name="tools" />
          ) : (
            String(index + offset + 1).padStart(2, "0")
          )}
        </span>
        <span>
          <strong>{title}</strong>
          <small>{detail}</small>
        </span>
      </a>
    ));
  return (
    <div className="step-rails">
      <nav className="step-rail" aria-label="Setup workflow">
        {renderGroup(WORKFLOW_STEPS, 0)}
      </nav>
      <nav className="step-rail step-rail-recovery" aria-label="Recovery">
        {renderGroup(RECOVERY_STEPS, WORKFLOW_STEPS.length)}
      </nav>
    </div>
  );
}

function SectionHeading({ eyebrow, title, copy, action }) {
  return (
    <div className="section-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        {copy ? <p>{copy}</p> : null}
      </div>
      {action}
    </div>
  );
}

function StatusPill({ children, tone = "neutral" }) {
  return <span className={cx("status-pill", `status-pill-${tone}`)}>{children}</span>;
}

function InstallModeSelector({ value, onChange, disabled = false, idPrefix }) {
  return (
    <fieldset className="install-mode-selector">
      <legend>Install method</legend>
      <div className="install-mode-options">
        {[
          [
            "update",
            "Update",
            "Use a full pinned main for version changes; optimize only an exact Stock ↔ CFW pair.",
          ],
          [
            "restore",
            "Restore",
            "Rewrite the complete pinned main firmware on both sides.",
          ],
        ].map(([mode, label, detail]) => (
          <label
            className={cx(value === mode && "is-selected")}
            htmlFor={`${idPrefix}-${mode}`}
            key={mode}
          >
            <input
              id={`${idPrefix}-${mode}`}
              type="radio"
              name={`${idPrefix}-install-mode`}
              value={mode}
              checked={value === mode}
              onChange={() => onChange(mode)}
              disabled={disabled}
            />
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AutomaticCaseUpdateOption({
  checked,
  onChange,
  disabled = false,
  currentVersion,
  targetVersion,
  idPrefix,
}) {
  const detail =
    currentVersion && targetVersion
      ? currentVersion === targetVersion
        ? `Case ${currentVersion} is already current; no Case write will occur.`
        : `Current Case ${currentVersion} · latest verified Case ${targetVersion}.`
      : targetVersion
        ? `If needed, install verified Case ${targetVersion} before flashing the glasses.`
        : "The latest verified official Case image will be selected from the library.";
  return (
    <label
      className={cx("automatic-case-update", checked && "is-selected")}
      htmlFor={`${idPrefix}-case-update`}
    >
      <input
        id={`${idPrefix}-case-update`}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span>
        <strong>Update Charging Case first</strong>
        <small>{detail}</small>
      </span>
    </label>
  );
}

function TempleProbeResult({ side, results }) {
  const status = results?.status;
  const version = results?.version;
  return (
    <div className={cx("pogo-result", (status || version) && "has-result")}>
      <div className="pogo-result-heading">
        <span>{side} temple</span>
        <strong>
          {version
            ? `G2 ${version.decoded.firmwareVersion}`
            : "Version not queried"}
        </strong>
      </div>
      <div className="pogo-result-facts">
        <span>
          HW revision <strong>{version?.decoded.hardwareRevision ?? "—"}</strong>
        </span>
        <span>
          Battery <strong>{status ? `${status.decoded.batteryPercent}%` : "—"}</strong>
        </span>
        <span>
          Voltage <strong>{status ? `${status.decoded.voltageMv} mV` : "—"}</strong>
        </span>
      </div>
      {status || version ? (
        <code>
          {hexBytes((status ?? version).captured)}
        </code>
      ) : (
        <small>No SRAM bridge transaction has been run this session.</small>
      )}
    </div>
  );
}

function RecoveryConfigResult({ report }) {
  if (!report) return null;
  const uart = report.info0?.uart;
  const decision = report.decision;
  return (
    <div className="sbl-result">
      <div className="sbl-facts">
        <div>
          <span>WIRED_CONFIG</span>
          <strong>
            {report.wiredConfiguration
              ? `${report.wiredConfiguration.raw} · UART${report.wiredConfiguration.uartModule}`
              : "INFOC required"}
          </strong>
        </div>
        <div>
          <span>ACTIVE INFO0</span>
          <strong>
            {report.info0Selector
              ? `${report.info0Selector.selectedSpace} · ${report.info0Selector.raw}`
              : "INFOC required"}
          </strong>
        </div>
        <div>
          <span>SBL UART</span>
          <strong>
            {uart
              ? `${uart.baud.toLocaleString()} baud · ${uart.dataBits}${uart.parity === "none" ? "N" : uart.parity[0].toUpperCase()}${uart.stopBits}`
              : "INFO0 required"}
          </strong>
        </div>
        <div>
          <span>CONTACT PINS</span>
          <strong>{uart ? `GPIO${uart.rxPin}/RX · GPIO${uart.txPin}/TX` : "INFO0 required"}</strong>
        </div>
        <div>
          <span>POGO FIELD MATCH</span>
          <strong>
            {report.pogoMatch
              ? report.pogoMatch.allKnownFieldsMatch
                ? "All known fields match"
                : "Does not match the app pogo route"
              : "Both dumps required"}
          </strong>
        </div>
        <div>
          <span>RECEIVE WINDOW</span>
          <strong>
            {report.info0 ? `${report.info0.wiredTimeoutMs} ms` : "INFO0 required"}
          </strong>
        </div>
        <div>
          <span>SBL RESTORE CANDIDATE</span>
          <strong className={decision?.sblUartRestoreCandidate ? "is-positive" : ""}>
            {decision?.sblUartRestoreCandidate ? "Provisioning matches" : "Not proven"}
          </strong>
        </div>
        <div>
          <span>MRAM WIRED RECOVERY</span>
          <strong className={decision?.mramWiredRecoveryCandidate ? "is-positive" : ""}>
            {decision?.mramWiredRecoveryCandidate ? "Provisioning matches" : "Not proven"}
          </strong>
        </div>
      </div>
      <small>
        GPIO override on a known contact:{" "}
        {decision?.forcedEntryContactCandidate ? "candidate" : "not proven"}.
        {" "}Restore evidence only; Ambiq's documented UART host does not provide
        installed-MRAM backup or readback.
      </small>
    </div>
  );
}

function SmartGlassesAnalyticsCard({ analytics, label }) {
  const proof =
    analytics.version?.transportProof ?? analytics.status?.transportProof;
  const applicationBatteryAvailable = analytics.batteryPercent != null;
  const applicationVoltageAvailable = analytics.voltageMv != null;
  const displayedBattery = applicationBatteryAvailable
    ? `${analytics.batteryPercent}%`
    : analytics.caseReportedCharging?.batteryPercent == null
      ? null
      : `Case ${analytics.caseReportedCharging.batteryPercent}%`;
  const displayedVoltage = applicationVoltageAvailable
    ? `${analytics.voltageMv} mV`
    : analytics.caseReportedCharging?.voltageMv == null
      ? null
      : `Case ${analytics.caseReportedCharging.voltageMv} mV`;
  return (
    <article className={cx(
      "glasses-analytics-card",
      analytics.applicationResponsive && "is-responsive",
    )}>
      <div className="glasses-analytics-heading">
        <div>
          <span>{label} temple</span>
          <h3>
            {analytics.firmwareVersion
              ? `G2 ${analytics.firmwareVersion}`
              : analytics.present
                ? "Seated · not yet queried"
                : "Not detected"}
          </h3>
        </div>
        <StatusPill
          tone={
            analytics.applicationResponsive
              ? "success"
              : analytics.present
                ? "warm"
                : "quiet"
          }
        >
          {analytics.applicationResponsive
            ? "Application responsive"
            : analytics.present
              ? "Presence only"
              : "Absent"}
        </StatusPill>
      </div>
      <div className="glasses-analytics-facts">
        <Field
          label="Firmware"
          value={analytics.firmwareVersion}
          detail="Checksum-validated 0x23 version reply"
        />
        <Field
          label="Hardware"
          value={analytics.hardwareRevision}
          detail="Apollo hardware revision"
        />
        <Field
          label="Battery"
          value={displayedBattery}
          detail={
            applicationBatteryAvailable
              ? "0x2C running-app status reply"
              : "Informational Charging Case console estimate; run Glasses analysis for application status"
          }
        />
        <Field
          label="Voltage"
          value={displayedVoltage}
          detail={
            applicationVoltageAvailable
              ? "0x2C running-app status reply"
              : "Informational Charging Case console estimate; run Glasses analysis for application status"
          }
        />
      </div>
      <div className="glasses-route-proof">
        <span>CASE → POGO ROUTE PROOF</span>
        <code>
          {proof
            ? `${proof.baselineMask} → ${proof.selectedMask} → ${proof.restoredMask}`
            : "Run the full Glasses analysis to capture transport proof"}
        </code>
        {proof ? (
          <small>
            {proof.transmittedBytes} bytes sent · {proof.capturedBytes} captured ·
            UART errors {proof.uartErrorMask}
          </small>
        ) : null}
      </div>
      <div className={cx(
        "writer-compatibility",
        analytics.completeMainWriterCompatible && "is-compatible",
      )}>
        <Icon
          name={
            analytics.completeMainWriterCompatible ? "check" : "warning"
          }
        />
        <span>
          {analytics.completeMainWriterCompatible
            ? analytics.differentialSourceCompatible
              ? "Hardware 5 is complete-main compatible and this version is in the reviewed Stock ↔ CFW differential pair"
              : "Running hardware-5 application supports complete pinned-main recovery"
            : "Recovery compatibility has not been proven for this temple"}
        </span>
      </div>
    </article>
  );
}

function ShellEvidenceView({ analytics, onDownload }) {
  const caseShell = analytics.chargingCase.shell;
  const glasses = analytics.smartGlasses;
  const evidence = analytics.validatedRecoveryEvidence;
  return (
    <div className="shell-analysis">
      <div className="shell-analysis-heading">
        <div>
          <div className="eyebrow">Local evidence export</div>
          <h3>Case shell, Glasses frames, and recovery provenance</h3>
          <p>
            Factory-console output belongs to the Charging Case. Temple frames and
            YHM masks belong to the selected Glasses route and were transported
            through the Case’s volatile SRAM bridge.
          </p>
        </div>
        <Button tone="secondary" onClick={onDownload}>
          <Icon name="backup" />
          Download analytics JSON
        </Button>
      </div>
      <div className="shell-analysis-grid">
        <article className="shell-panel">
          <div className="scope-label">CHARGING CASE · FACTORY SHELL</div>
          <div className="shell-command-list">
            {caseShell.allowlistedQueries.map((query) => (
              <div key={query.command}>
                <code>{query.command}</code>
                <span>{query.data}</span>
                <small>{query.scope}</small>
              </div>
            ))}
          </div>
          <details open>
            <summary>Raw Case console output</summary>
            <pre>{caseShell.rawOutput || "No console output captured."}</pre>
          </details>
        </article>
        <article className="shell-panel">
          <div className="scope-label">SMART GLASSES · CASE-TO-POGO FRAMES</div>
          {["left", "right"].map((side) => {
            const temple = glasses[side];
            return (
              <div className="shell-temple" key={side}>
                <strong>{side.toUpperCase()} TEMPLE</strong>
                <span>
                  {temple.applicationResponsive
                    ? `${temple.firmwareVersion} · HW ${temple.hardwareRevision}`
                    : temple.present
                      ? "Seated; no application reply captured"
                      : "Not detected by Case telemetry"}
                </span>
                {["version", "status"].map((kind) => (
                  <code key={kind}>
                    {kind.toUpperCase()} ·
                    {" "}{temple[kind]?.capturedFrameHex ?? "not captured"}
                  </code>
                ))}
              </div>
            );
          })}
          <div className="shell-recovery-proof">
            <span>VALIDATED RECOVERY RECORD</span>
            <strong>
              {evidence.status} · {evidence.attempts} hardware attempts
            </strong>
            <small>
              {Object.values(evidence.successfulTransfers)
                .map((item) =>
                  `${item.route}: ${item.payloadBytes.toLocaleString()} B / ${item.recordsSent.toLocaleString()} records`,
                )
                .join(" · ")}
            </small>
          </div>
        </article>
      </div>
    </div>
  );
}

function OperationError({ error, onDismiss }) {
  if (!error) return null;
  return (
    <div className="error-banner" role="alert">
      <Icon name="warning" />
      <div>
        <strong>Operation stopped safely</strong>
        <span>{error}</span>
      </div>
      <button onClick={onDismiss} aria-label="Dismiss error">
        ×
      </button>
    </div>
  );
}

function Console({ open, entries, onClose, onClear, onDownload }) {
  if (!open) return null;
  return (
    <div className="console-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="console-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="console-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="console-header">
          <div>
            <div className="eyebrow">Live session</div>
            <h2 id="console-title">Recovery console log</h2>
          </div>
          <button className="console-close" onClick={onClose} aria-label="Close console">
            ×
          </button>
        </div>
        <div className="console-output" aria-live="polite">
          {entries.length ? (
            entries.map((entry, index) => (
              <div className={cx("console-line", `console-${entry.tone}`)} key={index}>
                <time>{entry.time}</time>
                <span>{entry.message}</span>
              </div>
            ))
          ) : (
            <div className="console-empty">No session events yet.</div>
          )}
        </div>
        <div className="console-actions">
          <Button tone="ghost" onClick={onClear}>
            Clear
          </Button>
          <Button tone="secondary" onClick={onDownload} disabled={!entries.length}>
            Download log
          </Button>
        </div>
      </section>
    </div>
  );
}

function RemoteSupportDialog({
  open,
  onClose,
  mode,
  onModeChange,
  state,
  supportCode,
  onSupportCodeChange,
  operatorKey,
  onOperatorKeyChange,
  deviceReady,
  transport,
  events,
  onStartDevice,
  onJoinOperator,
  onStop,
  onOpenRemoteCase,
}) {
  if (!open) return null;
  const connected = state.status === "connected";
  const connecting = state.status === "connecting";
  const peerOnline = state.peerOnline === true;
  return (
    <div className="console-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="remote-support-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-support-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="console-header">
          <div>
            <div className="eyebrow">Single-device remote service</div>
            <h2 id="remote-support-title">Remote support</h2>
          </div>
          <button className="console-close" onClick={onClose} aria-label="Close remote support">
            ×
          </button>
        </div>

        {!connected ? (
          <div className="remote-support-mode-switch" aria-label="Remote support role">
            <button
              type="button"
              className={cx(mode === "device" && "is-active")}
              onClick={() => onModeChange("device")}
              disabled={connecting}
            >
              Person with the glasses
            </button>
            <button
              type="button"
              className={cx(mode === "operator" && "is-active")}
              onClick={() => onModeChange("operator")}
              disabled={connecting}
            >
              Technician
            </button>
          </div>
        ) : null}

        {mode === "device" ? (
          <div className="remote-support-body">
            <p>
              The Case stays connected to this browser. After you start the
              session, the authenticated technician can use only this selected
              G2 Case USB serial interface until you end the session. This
              includes diagnostics, backup, resets, and firmware recovery for
              the Case and seated Smart Glasses.
            </p>
            <div className="remote-support-facts">
              <span>
                Local transport
                <strong>{deviceReady ? transport : "Select and analyze the Case first"}</strong>
              </span>
              <span>
                Relay
                <strong>{connected ? "Encrypted · connected" : "Not connected"}</strong>
              </span>
              <span>
                Technician
                <strong>{peerOnline ? "Connected" : "Not connected"}</strong>
              </span>
            </div>
            {connected ? (
              <>
                <div className="remote-support-code">
                  <span>Tell the technician this one-time code</span>
                  <strong>{state.session?.code}</strong>
                  <small>
                    The session expires at{" "}
                    {state.session?.expiresAt
                      ? new Date(state.session.expiresAt).toLocaleTimeString()
                      : "the relay deadline"}
                    . Closing it immediately revokes technician access.
                  </small>
                </div>
                <Button tone="ghost" onClick={onStop}>
                  End remote session
                </Button>
              </>
            ) : (
              <>
                <div className="remote-support-consent">
                  <span>
                    Selecting the button below authorizes the authenticated
                    technician to control this selected G2 Case USB serial
                    interface until you end the session. It does not grant
                    access to files, applications, cameras, microphones, or any
                    other device on this computer.
                  </span>
                </div>
                <Button
                  onClick={onStartDevice}
                  busy={connecting}
                  disabled={!deviceReady}
                >
                  Authorize technician & start support
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="remote-support-body">
            {!connected ? (
              <>
                <p>
                  Join the code shown in the person’s browser. The separate
                  technician key is checked by the relay and is never stored by
                  WebFlasher.
                </p>
                <label className="remote-support-field">
                  <span>Session code</span>
                  <input
                    value={supportCode}
                    onChange={(event) => onSupportCodeChange(event.target.value)}
                    placeholder="ABCD-EFGH"
                    autoComplete="off"
                    spellCheck="false"
                  />
                </label>
                <label className="remote-support-field">
                  <span>Technician access key</span>
                  <input
                    type="password"
                    value={operatorKey}
                    onChange={(event) => onOperatorKeyChange(event.target.value)}
                    autoComplete="current-password"
                  />
                </label>
                <Button
                  onClick={onJoinOperator}
                  busy={connecting}
                  disabled={!supportCode.trim() || !operatorKey}
                >
                  Join support session
                </Button>
              </>
            ) : (
              <>
                <div className="remote-support-code is-operator">
                  <span>Support session</span>
                  <strong>{state.session?.code}</strong>
                  <small>
                    {peerOnline
                      ? "The person’s browser is online. Attach the remote Case to use the complete WebFlasher."
                      : "Waiting for the person’s browser to reconnect."}
                  </small>
                </div>
                <Button
                  onClick={onOpenRemoteCase}
                  disabled={!peerOnline}
                >
                  Open remote Case in WebFlasher
                </Button>
                <div className="remote-support-events" aria-live="polite">
                  {events.length ? (
                    events.slice(-40).map((event, index) => (
                      <div key={index} className={cx(event.ok === false && "is-error")}>
                        <time>{event.time}</time>
                        <strong>{event.label}</strong>
                        {event.detail ? <pre>{event.detail}</pre> : null}
                      </div>
                    ))
                  ) : (
                    <span>No remote service events yet.</span>
                  )}
                </div>
                <Button tone="ghost" onClick={onStop}>
                  Leave support session
                </Button>
              </>
            )}
          </div>
        )}

        {state.error ? (
          <div className="remote-support-error" role="alert">{state.error}</div>
        ) : null}
      </section>
    </div>
  );
}

function TaskProgress({ progress, wakeLockStatus }) {
  if (!progress.visible) return null;
  const wakeLockVisible = wakeLockStatus?.state !== "idle";
  const wakeLockActive = wakeLockStatus?.state === "active";
  const wakeLockPending = wakeLockStatus?.state === "requesting";
  const wakeLockHeading =
    wakeLockStatus?.state === "suspended"
      ? "Computer sleep prevention paused"
      : wakeLockStatus?.state === "released"
        ? "Computer sleep prevention released"
        : wakeLockActive
          ? "Computer sleep prevention active"
          : wakeLockPending
            ? "Enabling computer sleep prevention"
            : "Computer sleep prevention unavailable";
  return (
    <div className="footer-task-progress" role="status" aria-live="polite">
      <div className="footer-task-progress-heading">
        <span>
          {OPERATION_LABELS[progress.name] ?? "Recovery operation"}
        </span>
        <strong>
          Operation {progress.current} of {progress.total} · {progress.percent}%
        </strong>
      </div>
      <div
        className="footer-progress-track"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={progress.percent}
        aria-label={OPERATION_LABELS[progress.name] ?? "Recovery progress"}
      >
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      <div className="footer-current-task">{progress.detail}</div>
      {wakeLockVisible ? (
        <div
          className={cx(
            "footer-wake-lock",
            wakeLockActive && "is-active",
            wakeLockPending && "is-pending",
            !wakeLockActive && !wakeLockPending && "is-warning",
          )}
        >
          <span aria-hidden="true" />
          <strong>{wakeLockHeading}</strong>
          <small>{wakeLockStatus.message}</small>
        </div>
      ) : null}
    </div>
  );
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// The transcript outlives the 300-entry console display so a crash or tab
// close during a recovery cannot destroy the evidence of what was written to
// the device. It is persisted to localStorage and recovered on the next load.
const CONSOLE_TRANSCRIPT_STORAGE_KEY = "g2wf.console-transcript.v1";
const CONSOLE_TRANSCRIPT_ENTRY_LIMIT = 5000;

function readStoredConsoleTranscript() {
  try {
    const raw = window.localStorage.getItem(CONSOLE_TRANSCRIPT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.entries)) return null;
    const entries = parsed.entries.filter(
      (entry) =>
        typeof entry?.time === "string" && typeof entry?.message === "string",
    );
    if (!entries.length) return null;
    return {
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null,
      entries,
    };
  } catch {
    return null;
  }
}

function App() {
  const linkedSupportCode =
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("support") ?? "";
  const [report, setReport] = useState(null);
  const [backup, setBackup] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [catalogState, setCatalogState] = useState("loading");
  const [selectedReleaseId, setSelectedReleaseId] = useState("");
  const [firmware, setFirmware] = useState(null);
  const [staged, setStaged] = useState(null);
  const [progress, setProgress] = useState(EMPTY_PROGRESS);
  const [operation, setOperation] = useState(null);
  const [wakeLockStatus, setWakeLockStatus] = useState(
    IDLE_WAKE_LOCK_STATUS,
  );
  const [error, setError] = useState("");
  const [logs, setLogs] = useState([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(Boolean(linkedSupportCode));
  const [supportMode, setSupportMode] = useState(
    linkedSupportCode ? "operator" : "device",
  );
  const [supportCode, setSupportCode] = useState(linkedSupportCode);
  const [supportOperatorKey, setSupportOperatorKey] = useState("");
  const [supportState, setSupportState] = useState({ status: "idle" });
  const [supportEvents, setSupportEvents] = useState([]);
  const [interfaceMode, setInterfaceMode] = useState(DEFAULT_INTERFACE_MODE);
  const [automaticInstallMode, setAutomaticInstallMode] = useState(
    DEFAULT_AUTOMATIC_INSTALL_MODE,
  );
  const [automaticCaseUpdate, setAutomaticCaseUpdate] = useState(
    DEFAULT_AUTOMATIC_CASE_UPDATE,
  );
  const [automaticStatus, setAutomaticStatus] = useState(
    "Select a Case, choose firmware, and Apply.",
  );
  const [installedProvenance, setInstalledProvenance] = useState({});
  const [activeSection, setActiveSection] = useState(SECTION_KEYS[0]);
  const pendingAnchorRef = useRef(null);
  const [confirmText, setConfirmText] = useState("");
  const [confirmBackup, setConfirmBackup] = useState(false);
  const [recheckReport, setRecheckReport] = useState(null);
  const [analysisView, setAnalysisView] = useState("case");
  const [glassesAnalyzeConfirm, setGlassesAnalyzeConfirm] = useState(false);
  const [pogoResults, setPogoResults] = useState({});
  const [pogoRoute, setPogoRoute] = useState("left");
  const [pogoOperation, setPogoOperation] = useState("version");
  const [pogoConfirm, setPogoConfirm] = useState(false);
  const [templeFlashRoute, setTempleFlashRoute] = useState(
    DEFAULT_TEMPLE_FLASH_ROUTE,
  );
  const [templeFlashSeated, setTempleFlashSeated] = useState(false);
  const [templeFlashRisk, setTempleFlashRisk] = useState(false);
  const [templeFlashText, setTempleFlashText] = useState("");
  const [templeFlashMode, setTempleFlashMode] = useState(
    DEFAULT_TEMPLE_FLASH_MODE,
  );
  const [differenceSourceFirmware, setDifferenceSourceFirmware] = useState(null);
  const [differencePlan, setDifferencePlan] = useState(null);
  const [differenceState, setDifferenceState] = useState("idle");
  const [differenceError, setDifferenceError] = useState("");
  const [differenceSourceConfirmed, setDifferenceSourceConfirmed] =
    useState(false);
  const [templeFlashAudit, setTempleFlashAudit] = useState(null);
  const [recoveryDumps, setRecoveryDumps] = useState({});
  const [recoveryConfig, setRecoveryConfig] = useState(null);
  const [recoveryConfigError, setRecoveryConfigError] = useState("");
  const portRef = useRef(null);
  const sessionRef = useRef(null);
  const activeOperationRef = useRef(null);
  const activeOperationTotalRef = useRef(null);
  const progressLogRef = useRef({ name: null, bucket: -1 });
  const progressRenderRef = useRef({ name: null, updatedAt: 0 });
  const progressHideTimerRef = useRef(null);
  const mutationWakeLockRef = useRef(null);
  const transcriptRef = useRef([]);
  const transcriptPersistTimerRef = useRef(null);
  const transcriptRecoveredRef = useRef(false);
  const supportConnectionRef = useRef(null);
  const remoteDeviceBridgeRef = useRef(null);
  const remoteOperatorPortRef = useRef(null);

  const writeTranscriptNow = useCallback(() => {
    if (transcriptPersistTimerRef.current) {
      clearTimeout(transcriptPersistTimerRef.current);
      transcriptPersistTimerRef.current = null;
    }
    try {
      window.localStorage.setItem(
        CONSOLE_TRANSCRIPT_STORAGE_KEY,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          entries: transcriptRef.current,
        }),
      );
    } catch {
      // Storage may be full or unavailable; the in-memory transcript still
      // serves downloads for this session.
    }
  }, []);

  const persistTranscript = useCallback(() => {
    if (transcriptPersistTimerRef.current) return;
    transcriptPersistTimerRef.current = setTimeout(writeTranscriptNow, 400);
  }, [writeTranscriptNow]);

  const addLog = useCallback(
    (message, tone = "info") => {
      const time = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const entry = { time, message, tone };
      transcriptRef.current = [
        ...transcriptRef.current.slice(-(CONSOLE_TRANSCRIPT_ENTRY_LIMIT - 1)),
        entry,
      ];
      persistTranscript();
      setLogs((current) => [...current.slice(-299), entry]);
      const support = supportConnectionRef.current;
      if (support?.role === "device") {
        try {
          support.sendEvent("log", entry);
        } catch {
          // A dropped relay must never interrupt local hardware handling.
        }
      }
    },
    [persistTranscript],
  );

  const handleWakeLockStatus = useCallback(
    (status) => {
      setWakeLockStatus(status);
      if (status.state === "active") {
        addLog(
          status.reacquired
            ? "Computer sleep prevention restored after the WebFlasher tab became visible."
            : "Computer sleep prevention active for this firmware operation.",
          "success",
        );
      } else if (
        ["unsupported", "failed", "released", "suspended"].includes(
          status.state,
        )
      ) {
        addLog(
          `${status.message}${status.error ? ` ${status.error}` : ""}`,
          "warn",
        );
      }
    },
    [addLog],
  );

  const setSessionProgress = useCallback((fraction, detail) => {
    const name = activeOperationRef.current;
    const normalized = operationProgress(
      name,
      fraction,
      activeOperationTotalRef.current,
    );
    const now = performance.now();
    const previousRender = progressRenderRef.current;
    const shouldRender =
      previousRender.name !== name ||
      normalized.fraction <= 0 ||
      normalized.fraction >= 1 ||
      now - previousRender.updatedAt >= 100;
    if (shouldRender) {
      progressRenderRef.current = { name, updatedAt: now };
      setProgress({
        ...normalized,
        name,
        detail,
        visible: true,
      });
    }
    const bucket = Math.min(20, Math.floor(normalized.fraction * 20));
    if (
      name &&
      (progressLogRef.current.name !== name ||
        progressLogRef.current.bucket !== bucket)
    ) {
      progressLogRef.current = { name, bucket };
      addLog(`[${normalized.percent}%] ${detail}`);
    }
  }, [addLog]);

  const getSession = useCallback(
    (port = portRef.current) => {
      if (!port) throw new Error("Connect the G2 Case first.");
      if (!sessionRef.current || sessionRef.current.port !== port) {
        sessionRef.current = new G2CaseSession(port, {
          log: addLog,
          progress: setSessionProgress,
        });
      }
      return sessionRef.current;
    },
    [addLog, setSessionProgress],
  );

  const recordSupportEvent = useCallback((label, value, ok = true) => {
    const detail =
      value === undefined
        ? ""
        : typeof value === "string"
          ? value
          : JSON.stringify(value, null, 2);
    setSupportEvents((current) => [
      ...current.slice(-199),
      {
        time: new Date().toLocaleTimeString(),
        label,
        detail,
        ok,
      },
    ]);
  }, []);

  const handleSupportState = useCallback((next) => {
    setSupportState((current) => ({
      ...current,
      ...next,
      ...(next.status === "connected"
        ? {
            peerOnline:
              next.role === "operator"
                ? next.session?.deviceOnline === true
                : next.session?.operatorOnline === true,
          }
        : {}),
      error: next.status === "error" ? next.error : "",
    }));
  }, []);

  const handleSupportMessage = useCallback(
    (message) => {
      if (message.type === "peer") {
        setSupportState((current) => ({
          ...current,
          peerOnline: message.online,
        }));
        recordSupportEvent(
          `${message.role === "operator" ? "Technician" : "Person's browser"} ${
            message.online ? "connected" : "disconnected"
          }`,
        );
        if (
          message.role === "operator" &&
          supportConnectionRef.current?.role === "device"
        ) {
          if (message.online) {
            try {
              supportConnectionRef.current.sendState({
                transport: g2CaseTransportLabel(portRef.current),
                caseReport: report,
                templeResults: pogoResults,
              });
            } catch {
              // The peer notification can race a technician disconnect.
            }
          } else {
            void remoteDeviceBridgeRef.current?.close();
          }
        }
        return;
      }
      if (message.type === "serial_request") {
        remoteDeviceBridgeRef.current?.handleMessage(message);
        return;
      }
      if (message.type.startsWith("serial_")) {
        // The operator-side RemoteG2CasePort consumes serial frames through its
        // dedicated listener; do not copy raw bytes into the support event UI.
        return;
      }
      if (message.type === "event") {
        if (message.event === "log") {
          recordSupportEvent(
            "Device console",
            message.value?.message ?? message.value,
            message.value?.tone !== "error",
          );
        } else {
          recordSupportEvent(`Device event · ${message.event}`, message.value);
        }
        return;
      }
      if (message.type === "state") {
        recordSupportEvent("Remote Case snapshot", message.value);
        return;
      }
      if (message.type === "expired") {
        setSupportState((current) => ({
          ...current,
          status: "disconnected",
          error: "This remote-support session expired.",
        }));
      }
    },
    [pogoResults, recordSupportEvent, report],
  );

  const newSupportConnection = useCallback(() => {
    supportConnectionRef.current?.close();
    const connection = new RemoteSupportConnection({
      onMessage: handleSupportMessage,
      onState: handleSupportState,
    });
    supportConnectionRef.current = connection;
    return connection;
  }, [handleSupportMessage, handleSupportState]);

  const startRemoteSupport = useCallback(async () => {
    if (!report || !portRef.current) return;
    const connection = newSupportConnection();
    setSupportEvents([]);
    try {
      await remoteDeviceBridgeRef.current?.close();
      remoteDeviceBridgeRef.current = new RemoteSerialDeviceBridge(
        connection,
        portRef.current,
        { log: addLog },
      );
      const ready = await connection.startDevice();
      setSupportCode(ready.session.code);
      connection.sendState({
        transport: g2CaseTransportLabel(portRef.current),
        caseReport: report,
        templeResults: pogoResults,
      });
      addLog(
        `Remote support started · session ${ready.session.code} · access is restricted to the selected G2 Case USB serial interface.`,
        "success",
      );
    } catch (caught) {
      setSupportState({
        status: "error",
        role: "device",
        error: caught.message,
      });
      await remoteDeviceBridgeRef.current?.close();
      remoteDeviceBridgeRef.current = null;
      supportConnectionRef.current = null;
    }
  }, [
    addLog,
    newSupportConnection,
    pogoResults,
    report,
  ]);

  const joinRemoteSupport = useCallback(async () => {
    try {
      await remoteOperatorPortRef.current?.dispose();
    } catch {
      // A previous relay may already be gone; continue with the new session.
    }
    remoteOperatorPortRef.current = null;
    const connection = newSupportConnection();
    setSupportEvents([]);
    try {
      await connection.joinOperator({
        code: supportCode,
        operatorKey: supportOperatorKey,
      });
      remoteOperatorPortRef.current = new RemoteG2CasePort(connection);
      setSupportOperatorKey("");
      recordSupportEvent(
        "Technician authenticated",
        "The remote G2 Case serial interface is ready to attach.",
      );
    } catch (caught) {
      setSupportState({
        status: "error",
        role: "operator",
        error: caught.message,
      });
      supportConnectionRef.current = null;
    }
  }, [
    newSupportConnection,
    recordSupportEvent,
    supportCode,
    supportOperatorKey,
  ]);

  const stopRemoteSupport = useCallback(() => {
    const remoteOperatorPort = remoteOperatorPortRef.current;
    if (portRef.current === remoteOperatorPort) {
      portRef.current = null;
      sessionRef.current = null;
      setReport(null);
      setRecheckReport(null);
    }
    void remoteOperatorPort?.dispose();
    void remoteDeviceBridgeRef.current?.close();
    remoteOperatorPortRef.current = null;
    remoteDeviceBridgeRef.current = null;
    supportConnectionRef.current?.close();
    supportConnectionRef.current = null;
    setSupportState({ status: "idle" });
  }, []);

  // Panes are addressed by hash so deep links, back/forward, and in-page anchors
  // keep working even though the page no longer scrolls as one document.
  useEffect(() => {
    const applyHash = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;
      if (id === "easy") {
        pendingAnchorRef.current = null;
        setInterfaceMode("easy");
        return;
      }
      if (SECTION_KEYS.includes(id)) {
        setInterfaceMode("advanced");
        pendingAnchorRef.current = null;
        setActiveSection((current) => {
          // Re-selecting the open pane produces no re-render, so reset here.
          if (current === id) {
            document
              .querySelector(".pane-viewport")
              ?.scrollTo({ top: 0, behavior: "instant" });
          }
          return id;
        });
        return;
      }
      // An anchor inside a pane (e.g. #smart-glasses-recovery): open its pane,
      // then bring the target into view within that pane.
      const target = document.getElementById(id);
      const pane = target?.closest("[data-pane]");
      if (!pane) return;
      if (pane.classList.contains("is-active")) {
        // Already showing: no re-render is coming, so scroll now.
        target.scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }
      // Hand off to the post-render effect, which would otherwise reset us to
      // the top of the newly opened pane.
      pendingAnchorRef.current = id;
      setActiveSection(pane.dataset.pane);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  useEffect(() => {
    const key = installedProvenanceStorageKey(
      report?.console?.serialNumber,
      report?.console?.identifier,
    );
    if (!key) {
      setInstalledProvenance({});
      return;
    }
    try {
      const stored = window.localStorage.getItem(key);
      setInstalledProvenance(stored ? JSON.parse(stored) : {});
    } catch {
      setInstalledProvenance({});
      addLog(
        "Saved installed-firmware proof could not be read; Update will fail closed.",
        "warn",
      );
    }
  }, [
    addLog,
    report?.console?.identifier,
    report?.console?.serialNumber,
  ]);

  // Each pane is its own scroll context; entering one starts at its top unless
  // the navigation targeted an anchor inside it.
  useEffect(() => {
    const viewport = document.querySelector(".pane-viewport");
    if (!viewport) return;
    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    if (anchor) {
      // The pane itself just swapped in, so land on the anchor directly rather
      // than animating from a position the user never saw.
      document
        .getElementById(anchor)
        ?.scrollIntoView({ block: "start", behavior: "instant" });
      return;
    }
    viewport.scrollTo({ top: 0, behavior: "instant" });
  }, [activeSection, interfaceMode]);

  useEffect(() => {
    let active = true;
    fetch("/firmware-updates/source-files/index.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((value) => {
        if (!active) return;
        const releases = Array.isArray(value.releases)
          ? value.releases.map((release) => ({
              ...release,
              id: release.id ?? `g2-official-${release.version}`,
              channel: release.channel ?? "official",
              caseRecoveryEligible: release.caseRecoveryEligible ?? true,
            }))
          : [];
        setCatalog(releases);
        const latestStockRelease = findLatestOfficialStockRelease(releases);
        setSelectedReleaseId((latestStockRelease ?? releases[0])?.id ?? "");
        setCatalogState("ready");
      })
      .catch(() => {
        if (active) setCatalogState("offline");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (progressHideTimerRef.current) {
        clearTimeout(progressHideTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const handleError = (event) => {
      addLog(`Browser error: ${event.message || "unknown script error"}`, "error");
    };
    const handleRejection = (event) => {
      const message =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason ?? "unknown rejected promise");
      addLog(`Unhandled browser rejection: ${message}`, "error");
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, [addLog]);

  useEffect(() => {
    if (transcriptRecoveredRef.current) return;
    transcriptRecoveredRef.current = true;
    const stored = readStoredConsoleTranscript();
    if (!stored) return;
    // Prepend the recovered entries so they persist again and appear in
    // downloads; the visible console only announces the recovery.
    transcriptRef.current = [
      ...stored.entries,
      {
        time: "--:--:--",
        message: `———— end of previous session transcript${stored.savedAt ? ` (last saved ${stored.savedAt})` : ""} ————`,
        tone: "info",
      },
      ...transcriptRef.current,
    ].slice(-CONSOLE_TRANSCRIPT_ENTRY_LIMIT);
    addLog(
      `Recovered ${stored.entries.length} console ${stored.entries.length === 1 ? "entry" : "entries"} from the previous session; Download log includes them.`,
    );
    // Recover exactly once per load.
  }, []);

  useEffect(() => {
    if (!webSerialSupported()) return undefined;
    const eventPort = (event) => event.port ?? event.target;
    const handleDisconnect = (event) => {
      const port = eventPort(event);
      if (!portRef.current || port !== portRef.current) return;
      portRef.current = null;
      sessionRef.current = null;
      setReport(null);
      setRecheckReport(null);
      stopRemoteSupport();
      addLog(
        "The Case USB serial device disconnected. Reconnect the Case and run a fresh analysis before any recovery step.",
        "error",
      );
    };
    const handleConnect = (event) => {
      if (!isG2CaseSerialPort(eventPort(event))) return;
      addLog(
        "A G2 Case USB serial interface was connected. Select the Case to analyze it.",
      );
    };
    navigator.serial.addEventListener("disconnect", handleDisconnect);
    navigator.serial.addEventListener("connect", handleConnect);
    return () => {
      navigator.serial.removeEventListener("disconnect", handleDisconnect);
      navigator.serial.removeEventListener("connect", handleConnect);
    };
  }, [addLog, stopRemoteSupport]);

  useEffect(() => {
    if (!webUsbSupported()) return undefined;
    const handleDisconnect = (event) => {
      const device = event.device ?? event.target;
      if (!portRef.current || !portUsesUsbDevice(portRef.current, device)) return;
      portRef.current = null;
      sessionRef.current = null;
      setReport(null);
      setRecheckReport(null);
      stopRemoteSupport();
      addLog(
        "The Case WebUSB device disconnected. Reconnect it and run a fresh analysis before any recovery step.",
        "error",
      );
    };
    const handleConnect = (event) => {
      if (!isG2CaseUsbConnectionEvent(event)) return;
      addLog("A G2 Case WebUSB interface connected. Select it to analyze the Case.");
    };
    navigator.usb.addEventListener("disconnect", handleDisconnect);
    navigator.usb.addEventListener("connect", handleConnect);
    return () => {
      navigator.usb.removeEventListener("disconnect", handleDisconnect);
      navigator.usb.removeEventListener("connect", handleConnect);
    };
  }, [addLog, stopRemoteSupport]);

  useEffect(() => {
    // A debounced write can lose the final entries when the tab closes;
    // pagehide is the last reliable moment to flush them.
    window.addEventListener("pagehide", writeTranscriptNow);
    return () => window.removeEventListener("pagehide", writeTranscriptNow);
  }, [writeTranscriptNow]);

  useEffect(() => {
    if (!PERSISTENT_MUTATION_OPERATIONS.has(operation)) return undefined;
    const preventOperationUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventOperationUnload);
    return () =>
      window.removeEventListener("beforeunload", preventOperationUnload);
  }, [operation]);

  useEffect(
    () => () => {
      void mutationWakeLockRef.current?.stop();
      void remoteOperatorPortRef.current?.dispose();
      void remoteDeviceBridgeRef.current?.close();
      supportConnectionRef.current?.close();
    },
    [],
  );

  const run = useCallback(async (name, task, { total = null } = {}) => {
    let mutationWakeLock = null;
    if (progressHideTimerRef.current) {
      clearTimeout(progressHideTimerRef.current);
      progressHideTimerRef.current = null;
    }
    activeOperationRef.current = name;
    activeOperationTotalRef.current = total ?? OPERATION_TOTALS[name] ?? 1;
    progressLogRef.current = { name, bucket: -1 };
    setOperation(name);
    setError("");
    const starting = operationProgress(
      name,
      0,
      activeOperationTotalRef.current,
    );
    setProgress({
      ...starting,
      name,
      detail: "Starting…",
      visible: true,
    });
    addLog(
      `${OPERATION_LABELS[name] ?? name} started · WebFlasher ${WEBFLASHER_BUILD_LABEL}.`,
    );
    try {
      if (PERSISTENT_MUTATION_OPERATIONS.has(name)) {
        mutationWakeLock = new MutationWakeLock({
          onStatus: handleWakeLockStatus,
        });
        mutationWakeLockRef.current = mutationWakeLock;
        await mutationWakeLock.start();
        const release = await assertCurrentWebFlasherRelease();
        addLog(
          `Release integrity passed · running and deployed WebFlasher ${release.deployedSha.slice(0, 7)} match.`,
          "success",
        );
      }
      const result = await task();
      addLog(`${OPERATION_LABELS[name] ?? name} finished.`, "success");
      return result;
    } catch (caught) {
      const message = caught?.message || String(caught);
      setError(message);
      addLog(message, "error");
      return null;
    } finally {
      if (mutationWakeLock) {
        await mutationWakeLock.stop();
        if (mutationWakeLockRef.current === mutationWakeLock) {
          mutationWakeLockRef.current = null;
        }
      }
      setOperation(null);
      activeOperationRef.current = null;
      activeOperationTotalRef.current = null;
      progressHideTimerRef.current = setTimeout(
        () => setProgress((value) => ({ ...value, visible: false })),
        2200,
      );
    }
  }, [addLog, handleWakeLockStatus]);

  useEffect(() => {
    let active = true;
    if (templeFlashMode !== "differences") {
      setDifferenceSourceFirmware(null);
      setDifferencePlan(null);
      setDifferenceState("idle");
      setDifferenceError("");
      setDifferenceSourceConfirmed(false);
      return () => {
        active = false;
      };
    }
    if (!firmware?.templeFlashEligible || catalogState !== "ready") {
      setDifferenceSourceFirmware(null);
      setDifferencePlan(null);
      setDifferenceState("blocked");
      setDifferenceError(
        "Load the reviewed Stock 2.2.6.10 or CFW 2.2.6.11 bundle before preparing differences.",
      );
      return () => {
        active = false;
      };
    }

    const counterpart = findStockCfwCounterpartRelease(catalog, firmware);
    if (!counterpart) {
      setDifferenceSourceFirmware(null);
      setDifferencePlan(null);
      setDifferenceState("blocked");
      setDifferenceError(
        "Flash differences is available only for the reviewed Stock 2.2.6.10 ↔ CFW 2.2.6.11 pair.",
      );
      return () => {
        active = false;
      };
    }

    setDifferenceSourceConfirmed(false);
    setDifferenceSourceFirmware(null);
    setDifferencePlan(null);
    setDifferenceState("loading");
    setDifferenceError("");
    (async () => {
      const response = await fetchCatalogRelease(
        counterpart,
        "Difference source archive",
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== counterpart.size) {
        throw new Error("The difference source size does not match its catalog.");
      }
      const source = await parseFirmwareInput(bytes, counterpart.fileName);
      if (source.fileSha256 !== counterpart.sha256) {
        throw new Error(
          "The difference source SHA-256 does not match its catalog.",
        );
      }
      const plan = buildBundleDifferencePlan(source, firmware);
      if (!plan.executable) {
        throw new Error(
          "The Stock/CFW comparison is not an executable one-component difference.",
        );
      }
      if (!active) return;
      setDifferenceSourceFirmware(source);
      setDifferencePlan(plan);
      setDifferenceState("ready");
      addLog(
        `Difference plan ready · ${plan.unchangedComponentCount} identical components skipped · ${plan.changedComponentCount} changed component transferred.`,
        "success",
      );
    })().catch((caught) => {
      if (!active) return;
      setDifferenceSourceFirmware(null);
      setDifferencePlan(null);
      setDifferenceState("blocked");
      setDifferenceError(caught.message);
      addLog(`Difference plan stopped: ${caught.message}`, "error");
    });
    return () => {
      active = false;
    };
  }, [
    addLog,
    catalog,
    catalogState,
    firmware,
    templeFlashMode,
  ]);

  const connectAndAnalyze = async (transportOrEvent = "auto") => {
    const transport =
      typeof transportOrEvent === "string" ? transportOrEvent : "auto";
    await run("analyze", async () => {
      addLog(
        `Waiting for a G2 Case ${
          transport === "webusb" ? "WebUSB" : "USB Serial"
        } selection.`,
      );
      const port = await requestG2CasePort({ transport });
      portRef.current = port;
      sessionRef.current = null;
      addLog(`G2 Case ${g2CaseTransportLabel(port)} interface selected.`);
      const result = await getSession(port).analyze();
      setReport(result);
      setBackup(null);
      setStaged(null);
      setPogoResults({});
      setPogoConfirm(false);
      setGlassesAnalyzeConfirm(false);
      setAnalysisView("case");
      setTempleFlashAudit(null);
      addLog("Analysis complete. No device memory was changed.", "success");
    });
  };

  const openRemoteSupportCase = async () => {
    const remotePort = remoteOperatorPortRef.current;
    if (!remotePort || supportConnectionRef.current?.role !== "operator") {
      setSupportState((current) => ({
        ...current,
        error: "Join an active technician session before opening the remote Case.",
      }));
      return;
    }
    portRef.current = remotePort;
    sessionRef.current = null;
    const result = await run("analyze", async () => {
      addLog(
        "Opening the customer's selected G2 Case through the remote serial interface.",
      );
      const remoteReport = await getSession(remotePort).analyze();
      setReport(remoteReport);
      setBackup(null);
      setStaged(null);
      setPogoResults({});
      setPogoConfirm(false);
      setGlassesAnalyzeConfirm(false);
      setAnalysisView("case");
      setTempleFlashAudit(null);
      addLog(
        "Remote Case attached. The complete WebFlasher now operates through the customer's selected USB serial interface.",
        "success",
      );
      return remoteReport;
    });
    if (result) setSupportOpen(false);
  };

  const reanalyze = async () => {
    await run("analyze", async () => {
      const result = await getSession().analyze();
      setReport(result);
      setBackup(null);
      setStaged(null);
      setPogoResults({});
      setPogoConfirm(false);
      setGlassesAnalyzeConfirm(false);
      setTempleFlashAudit(null);
      addLog("Fresh analysis complete.", "success");
    });
  };

  const createBackup = async () => {
    await run("backup", async () => {
      if (
        !report?.console?.telemetry?.leftPresent ||
        !report?.console?.telemetry?.rightPresent
      ) {
        throw new Error(
          "Seat both Smart Glasses temples in the Case, refresh analysis, and try the combined backup again.",
        );
      }
      if (catalogState !== "ready") {
        throw new Error(
          "The firmware archive must be available to include the matching Smart Glasses recovery image.",
        );
      }

      const session = getSession();
      const result = await session.backup({
        progressBase: 0,
        progressSpan: 0.62,
      });
      const templeProbes = {};
      for (const [index, route] of ["left", "right"].entries()) {
        templeProbes[route] = await session.probeRunningTemple(
          "version",
          route,
          {
            progressBase: 0.62 + index * 0.14,
            progressSpan: 0.14,
          },
        );
      }
      const recoveryRelease = findMatchingGlassesRecoveryRelease(
        catalog,
        templeProbes,
      );
      setSessionProgress(0.91, "Loading matching Smart Glasses recovery firmware");
      const response = await fetchCatalogRelease(
        recoveryRelease,
        "Smart Glasses recovery archive",
      );
      const recoveryBundleBytes = new Uint8Array(await response.arrayBuffer());
      await validateGlassesRecoveryBundle(
        recoveryBundleBytes,
        recoveryRelease,
      );
      setSessionProgress(0.97, "Packaging combined recovery backup");

      const artifact = buildG2SystemBackupArtifact({
        caseBackup: result,
        report,
        templeProbes,
        recoveryRelease,
        recoveryBundleBytes,
      });
      const nameVersion =
        artifact.chargingCase.firmwareVersion ?? "unknown";
      downloadBlob(
        new Blob([`${JSON.stringify(artifact, null, 2)}\n`], {
          type: "application/json",
        }),
        `g2-system-${nameVersion}-${new Date().toISOString().slice(0, 10)}.g2-backup.json`,
      );
      setBackup({
        ...result,
        artifact,
        templeProbes,
        recoveryRelease,
      });
      setPogoResults((current) => ({
        ...current,
        left: {
          ...current.left,
          version: {
            ...templeProbes.left,
            observedAt: artifact.createdAt,
          },
        },
        right: {
          ...current.right,
          version: {
            ...templeProbes.right,
            observedAt: artifact.createdAt,
          },
        },
      }));
      setSessionProgress(1, "Case + Smart Glasses backup verified");
      addLog(
        `Combined backup downloaded · full Case + both G2 ${recoveryRelease.version} temple snapshots + validated official recovery bundle.`,
        "success",
      );
    });
  };

  const prepareFirmware = async (bytes, fileName, expected) => {
    const parsed = await parseFirmwareInput(bytes, fileName);
    if (expected) {
      if (parsed.fileSize !== expected.size) {
        throw new Error("The mirrored firmware size does not match its catalog.");
      }
      if (parsed.fileSha256 !== expected.sha256) {
        throw new Error("The mirrored firmware SHA-256 does not match its catalog.");
      }
    }
    return expected
      ? {
          ...parsed,
          provenance: {
            ...parsed.provenance,
            channel: expected.channel,
            trust: expected.trust ?? parsed.provenance.trust,
            label:
              expected.channel === "custom"
                ? `Smart Glasses CFW · stock ${expected.baseVersion} base`
                : `Verified G2 ${expected.version} · archived SHA-256`,
            capabilities:
              expected.capabilities ?? parsed.provenance.capabilities ?? [],
          },
          caseRecoveryEligible:
            expected.caseRecoveryEligible ?? parsed.caseRecoveryEligible,
          catalogRelease: expected,
        }
      : parsed;
  };

  const acceptPreparedFirmware = (accepted) => {
    setFirmware(accepted);
    setStaged(null);
    setTempleFlashAudit(null);
    setTempleFlashText("");
    setTempleFlashSeated(false);
    setTempleFlashRisk(false);
    setDifferenceSourceFirmware(null);
    setDifferencePlan(null);
    setDifferenceState("idle");
    setDifferenceError("");
    setDifferenceSourceConfirmed(false);
    addLog(
      `Validated ${accepted.fileName} · ${accepted.provenance.label} · ${accepted.fileSha256.slice(0, 16)}…`,
      "success",
    );
    return accepted;
  };

  const acceptFirmware = async (bytes, fileName, expected) => {
    return acceptPreparedFirmware(
      await prepareFirmware(bytes, fileName, expected),
    );
  };

  const fetchCatalogFirmware = async (release) => {
    const response = await fetchCatalogRelease(release);
    return prepareFirmware(
      new Uint8Array(await response.arrayBuffer()),
      release.fileName,
      release,
    );
  };

  const loadMirroredFirmware = async () => {
    const release = catalog.find((item) => item.id === selectedReleaseId);
    if (!release) {
      setError("Select an archived firmware release.");
      return;
    }
    await run("firmware", async () => {
      addLog(
        `Loading verified ${release.caseRecoveryEligible ? "Charging Case" : "Smart Glasses"} image ${release.version}.`,
      );
      acceptPreparedFirmware(await fetchCatalogFirmware(release));
      setSessionProgress(1, "Firmware validated");
    });
  };

  const loadLocalFirmware = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await run("firmware", async () => {
      addLog(`Inspecting local firmware file ${file.name}.`);
      await acceptFirmware(new Uint8Array(await file.arrayBuffer()), file.name);
      setSessionProgress(1, "Firmware validated");
    });
  };

  const loadRecoveryDump = async (kind, event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const next = {
      ...recoveryDumps,
      [kind]: {
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
    };
    setRecoveryDumps(next);
    try {
      const decoded = decodeApollo510RecoveryConfig({
        infoc: next.infoc?.bytes,
        info0: next.info0?.bytes,
      });
      setRecoveryConfig(decoded);
      setRecoveryConfigError("");
      addLog(`Decoded read-only Apollo510 ${kind.toUpperCase()} dump ${file.name}.`, "success");
    } catch (caught) {
      setRecoveryConfig(null);
      setRecoveryConfigError(caught.message);
    }
  };

  const clearRecoveryDumps = () => {
    setRecoveryDumps({});
    setRecoveryConfig(null);
    setRecoveryConfigError("");
  };

  const restartAndRecheck = async () => {
    await run("recheck", async () => {
      const result = await getSession().restartAndVerifyBothTemples();
      setRecheckReport(result);
      if (report) {
        setReport({
          ...report,
          console: { ...report.console, ...result, telemetry: result.telemetry },
        });
      }
      setSessionProgress(1, "Recovery check complete");
      setPogoResults({});
      setPogoConfirm(false);
      setGlassesAnalyzeConfirm(false);
      addLog(
        "Both temples were reset; reopened Case telemetry and checksum-valid application liveness were verified without sending firmware.",
        "success",
      );
    });
  };

  const analyzeSmartGlasses = async () => {
    if (!glassesAnalyzeConfirm) return;
    await run("glasses-analyze", async () => {
      if (
        !report?.console?.telemetry?.leftPresent ||
        !report?.console?.telemetry?.rightPresent
      ) {
        throw new Error(
          "Seat both Smart Glasses temples, refresh the Case analysis, and try again.",
        );
      }
      const session = getSession();
      let nextResults = { ...pogoResults };
      const requests = [
        ["left", "version"],
        ["left", "status"],
        ["right", "version"],
        ["right", "status"],
      ];
      for (const [index, [route, request]] of requests.entries()) {
        const result = await session.probeRunningTemple(request, route, {
          progressBase: index / requests.length,
          progressSpan: 1 / requests.length,
        });
        nextResults = {
          ...nextResults,
          [route]: {
            ...nextResults[route],
            [request]: {
              ...result,
              observedAt: new Date().toISOString(),
            },
          },
        };
        setPogoResults(nextResults);
      }
      setGlassesAnalyzeConfirm(false);
      setSessionProgress(1, "Both Smart Glasses temples analyzed");
      addLog(
        "Smart Glasses analysis complete · both version/status frames and route-restoration proofs captured.",
        "success",
      );
    });
  };

  const probeRunningTemple = async () => {
    if (!pogoConfirm) return;
    await run("pogo", async () => {
      const result = await getSession().probeRunningTemple(
        pogoOperation,
        pogoRoute,
      );
      setPogoResults((current) => ({
        ...current,
        [pogoRoute]: {
          ...current[pogoRoute],
          [pogoOperation]: {
            ...result,
            observedAt: new Date().toISOString(),
          },
        },
      }));
      setPogoConfirm(false);
      addLog(
        `${pogoRoute} temple ${pogoOperation} captured through the reviewed read-only SRAM bridge.`,
        "success",
      );
    });
  };

  const recordInstalledProvenance = (
    audit,
    caseSerial,
    factoryIdentifier,
  ) => {
    setInstalledProvenance((current) => {
      const next = mergeInstalledProvenance(current, audit);
      const key = installedProvenanceStorageKey(
        caseSerial ?? report?.console?.serialNumber,
        factoryIdentifier ?? report?.console?.identifier,
      );
      if (key) {
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          addLog(
            "Installed-firmware proof could not be saved; a later Update may require Restore first.",
            "warn",
          );
        }
      }
      return next;
    });
  };

  const flashTempleFirmware = async () => {
    if (
      !firmware?.templeFlashEligible ||
      !templeFlashSeated ||
      !templeFlashRisk ||
      (templeFlashMode === "differences" &&
        (!differencePlan ||
          !differenceSourceFirmware ||
          !differenceSourceConfirmed)) ||
      templeFlashText.trim().toUpperCase() !== "FLASH GLASSES FIRMWARE"
    ) {
      return;
    }
    await run("temple-flash", async () => {
      try {
        const audit = await getSession().flashPinnedTempleMain(
          firmware,
          templeFlashRoute,
          {
            mode: templeFlashMode,
            differenceSourceFirmware,
          },
        );
        setTempleFlashAudit(audit);
        recordInstalledProvenance(audit);
        setTempleFlashText("");
        setTempleFlashSeated(false);
        setTempleFlashRisk(false);
        addLog(
          `${audit.imageLabel} ${templeFlashMode === "differences" ? "bundle-difference restore" : "complete-main restore"} completed on ${audit.routes.join(" + ")}; finish CRC, route restoration, final dual reset, contacts, and post-reset liveness verified.`,
          "success",
        );
      } catch (caught) {
        if (caught?.audit) {
          setTempleFlashAudit(caught.audit);
          recordInstalledProvenance(caught.audit);
        }
        throw caught;
      }
    }, {
      total: templeFlashRoute === "both" ? 14 : 9,
    });
  };

  const automaticApply = async () => {
    const release = catalog.find((item) => item.id === selectedReleaseId);
    const latestCaseFirmwareRelease =
      findLatestCaseFirmwareRelease(catalog);
    if (!report) {
      setError("Select and analyze the G2 Case before applying firmware.");
      setAutomaticStatus("Waiting for a selected and analyzed Case.");
      return;
    }
    if (!release) {
      setError("Choose a firmware release before applying it.");
      return;
    }

    setAutomaticStatus("Running automatic preflight…");
    await run(
      "automatic-apply",
      async () => {
        try {
          const session = getSession();
          addLog(
            `Automatic Apply requested · Smart Glasses ${automaticInstallMode} · Update Charging Case first ${automaticCaseUpdate ? "enabled" : "disabled"}.`,
          );
          setSessionProgress(
            0.02,
            "Re-analyzing Case banks, option bytes, and contacts",
          );
          let fresh = await session.analyze({
            progressBase: 0.01,
            progressSpan: 0.07,
          });
          setReport(fresh);
          let freshTelemetry = fresh.console?.telemetry;
          const caseUpdatePlan = resolveAutomaticCaseUpdatePlan({
            enabled: automaticCaseUpdate,
            currentVersion: fresh.console?.caseVersion,
            targetRelease: latestCaseFirmwareRelease,
          });
          if (!caseUpdatePlan.executable) {
            throw new Error(caseUpdatePlan.reason);
          }
          const contactPreflight =
            assessAutomaticTempleContacts(freshTelemetry);
          if (!contactPreflight.automaticApplyAllowed) {
            throw new Error(contactPreflight.reason);
          }
          addLog(
            `Charging Case preflight · observed ${caseUpdatePlan.currentVersion} · latest ${caseUpdatePlan.targetVersion} · ${caseUpdatePlan.action === "update" ? "update required" : "already current"}.`,
            caseUpdatePlan.action === "update" ? "warn" : "success",
          );
          if (caseUpdatePlan.targetVersion !== REVIEWED_CASE_VERSION) {
            throw new Error(
              `This WebFlasher's glasses writer requires Case ${REVIEWED_CASE_VERSION}, but the latest library Case is ${caseUpdatePlan.targetVersion}. Update the WebFlasher before continuing.`,
            );
          }
          if (contactPreflight.resetRecoveryEligible) {
            addLog(
              `${contactPreflight.reason} Automatic Apply will attempt the traced bilateral reset and require both temples to return before any firmware transfer.`,
              "warn",
            );
          }

          let caseUpdateFirmware = null;
          if (caseUpdatePlan.action === "update") {
            setAutomaticStatus(
              `Updating Charging Case ${caseUpdatePlan.currentVersion} → ${caseUpdatePlan.targetVersion}…`,
            );
            setSessionProgress(
              0.04,
              `Loading verified Case ${caseUpdatePlan.targetVersion}`,
            );
            caseUpdateFirmware = await fetchCatalogFirmware(
              latestCaseFirmwareRelease,
            );
            const caseUpdate = await executeAutomaticCaseUpdate({
              session,
              currentReport: fresh,
              targetFirmware: caseUpdateFirmware,
              onStep: (step) => {
                if (step === "stage") {
                  setSessionProgress(
                    0.05,
                    `Staging Case ${caseUpdatePlan.targetVersion} in the inactive bank`,
                  );
                } else if (step === "activate") {
                  setSessionProgress(
                    0.27,
                    "Activating the verified Case bank",
                  );
                } else if (step === "reanalyze") {
                  setSessionProgress(
                    0.37,
                    "Re-analyzing the updated Charging Case",
                  );
                } else if (step === "verify-bank-switch") {
                  setSessionProgress(
                    0.48,
                    "Verifying the Charging Case physical bank switch",
                  );
                } else if (step === "confirm") {
                  setSessionProgress(
                    0.49,
                    `Confirming Case ${caseUpdatePlan.targetVersion} in a fresh DEA0 session`,
                  );
                }
              },
            });
            fresh = caseUpdate.report;
            setReport(fresh);
            setBackup(null);
            setStaged(null);
            const postUpdateConsole =
              await session.readTempleFlashPreflight([]);
            fresh = {
              ...fresh,
              console: {
                ...fresh.console,
                ...postUpdateConsole,
              },
            };
            setReport(fresh);
            freshTelemetry = fresh.console?.telemetry;
            setAutomaticStatus(
              `Charging Case ${caseUpdate.confirmation.confirmedVersion} confirmed by fresh DEA0; starting Smart Glasses ${automaticInstallMode}…`,
            );
            addLog(
              `Charging Case updated ${caseUpdatePlan.currentVersion} → ${caseUpdatePlan.targetVersion}; physical bank ${caseUpdate.bankSwitch.stagedPhysicalBank} activated (nSWAP_BANK ${Number(caseUpdate.bankSwitch.previousSwapBank)} → ${Number(caseUpdate.bankSwitch.activeSwapBank)}), physical bank ${caseUpdate.bankSwitch.fallbackPhysicalBank} preserved as the ${caseUpdate.bankSwitch.fallbackVersion} fallback, and fresh ${caseUpdate.confirmation.confirmationCommand} attempt ${caseUpdate.confirmation.confirmationAttempt}/${caseUpdate.confirmation.confirmationAttempts} verified.`,
              "success",
            );
          }

          const caseReadiness = verifyAutomaticCaseReadiness(
            fresh,
            caseUpdatePlan.targetVersion,
          );
          addLog(
            `Charging Case write gate passed · active physical bank ${caseReadiness.activePhysicalBank} ${caseReadiness.activeVersion} · fallback physical bank ${caseReadiness.fallbackPhysicalBank} ${caseReadiness.fallbackVersion ?? "version unknown"} · nSWAP_BANK ${Number(caseReadiness.swapBank)}.`,
            "success",
          );
          const caseCharging = fresh.console?.templeCharging;
          if (caseCharging?.left || caseCharging?.right) {
            const summarizeCharging = (side, value) =>
              value
                ? `${side} ${value.batteryPercent}%/${value.voltageMv} mV${value.charging ? " charging" : ""}`
                : `${side} unavailable`;
            addLog(
              `Informational Case charging telemetry · ${summarizeCharging("right", caseCharging.right)} · ${summarizeCharging("left", caseCharging.left)}. Running-app liveness remains separately required before START.`,
            );
          }

          setAutomaticStatus(
            "Checking installed versions before the clean-start reset…",
          );
          const templePreparation =
            await prepareAutomaticTempleUpdate({
              session,
              progressBase:
                caseUpdatePlan.action === "update" ? 0.5 : 0.09,
              progressSpan: 0.06,
              onStep: ({ step, route }) => {
                if (step === "version-check") {
                  setSessionProgress(
                    caseUpdatePlan.action === "update" ? 0.5 : 0.09,
                    `Checking ${route} installed version before reset`,
                  );
                } else if (step === "clean-reset") {
                  setAutomaticStatus(
                    "Resetting both temples into a clean starting state…",
                  );
                  setSessionProgress(
                    caseUpdatePlan.action === "update" ? 0.52 : 0.11,
                    "Resetting both temples before firmware planning",
                  );
                }
              },
            });
          const {
            initialVersions,
            observedTempleVersions,
            changedAcrossReset,
            verifiedTempleReadiness: templeReadiness,
          } = templePreparation;
          const observedAt = new Date().toISOString();
          setRecheckReport(templeReadiness);
          setPogoResults(
            Object.fromEntries(
              ["right", "left"].map((route) => [
                route,
                {
                  version: {
                    operation: "version",
                    route,
                    decoded: {
                      kind: "version",
                      firmwareVersion:
                        observedTempleVersions[route].firmwareVersion,
                      hardwareRevision:
                        observedTempleVersions[route].hardwareRevision,
                    },
                    transportProof: {
                      restoredMask:
                        templeReadiness.versions[route]
                          .yhmRestoreVerified
                          ? 0x3ff
                          : null,
                    },
                    observedAt,
                  },
                },
              ]),
            ),
          );
          fresh = {
            ...fresh,
            console: {
              ...fresh.console,
              ...templeReadiness,
              telemetry: templeReadiness.telemetry,
            },
          };
          setReport(fresh);
          addLog(
            `Smart Glasses read-only version check passed · right ${initialVersions.right.firmwareVersion}/hardware ${initialVersions.right.hardwareRevision} · left ${initialVersions.left.firmwareVersion}/hardware ${initialVersions.left.hardwareRevision}.`,
            "success",
          );
          addLog(
            `Clean-start DEB0 passed · right ${observedTempleVersions.right.firmwareVersion}/hardware ${observedTempleVersions.right.hardwareRevision} · left ${observedTempleVersions.left.firmwareVersion}/hardware ${observedTempleVersions.left.hardwareRevision} · reset attempt ${templeReadiness.resetAttempts.length}/2.`,
            "success",
          );
          if (changedAcrossReset.length > 0) {
            addLog(
              `Temple identity changed across the clean-start reset on ${changedAcrossReset.join(" + ")}; Automatic Apply will plan from the fresh post-reset identity.`,
              "warn",
            );
          }

          setSessionProgress(
            caseUpdatePlan.action === "update" ? 0.57 : 0.16,
            "Loading and validating selected Smart Glasses firmware",
          );
          const targetFirmware = acceptPreparedFirmware(
            caseUpdateFirmware?.catalogRelease?.id === release.id
              ? caseUpdateFirmware
              : await fetchCatalogFirmware(release),
          );
          let sourceFirmware = null;
          let plan = null;

          if (automaticInstallMode === "update") {
            setSessionProgress(
              0.13,
              "Selecting complete or reviewed differential transfer",
            );
            const counterpart = findStockCfwCounterpartRelease(
              catalog,
              targetFirmware,
            );
            if (counterpart) {
              sourceFirmware = await fetchCatalogFirmware(counterpart);
              plan = buildBundleDifferencePlan(
                sourceFirmware,
                targetFirmware,
              );
              setDifferenceSourceFirmware(sourceFirmware);
              setDifferencePlan(plan);
              setDifferenceState(plan.executable ? "ready" : "blocked");
              setDifferenceError(
                plan.executable
                  ? ""
                  : "The selected pair is not an executable component difference.",
              );
            }
          }

          const planInputs = {
            installMode: automaticInstallMode,
            targetFirmware,
            installedProvenance,
            differenceSourceFirmware: sourceFirmware,
            differencePlan: plan,
            initialTempleVersions: initialVersions,
            observedTempleVersions,
            verifiedTempleReadiness: templeReadiness,
          };
          const execution = await executeAutomaticApply({
            session,
            ...planInputs,
            onPlan: (applyPlan) => {
              addLog(
                `Automatic ${automaticInstallMode} plan accepted · ${applyPlan.reason}`,
                "success",
              );
              if (applyPlan.action === "verify-only") {
                setSessionProgress(
                  0.72,
                  "Target already proven; resetting both temples",
                );
              } else {
                if (
                  applyPlan.sourceProofMode ===
                  "live-compatible-pair-preflight"
                ) {
                  setSessionProgress(
                    0.16,
                    "Validating live 2.2.6.10/hardware-5 compatibility before each temple START",
                  );
                } else if (applyPlan.flashMode === "complete") {
                  setSessionProgress(
                    0.16,
                    "Using the complete pinned target main for this version change",
                  );
                }
                setAutomaticStatus(
                  `${automaticInstallMode === "update" ? "Updating" : "Restoring"} both temples automatically…`,
                );
              }
            },
            onRecovery: (recovery) => {
              if (
                recovery.trigger !== "source-preflight-mismatch"
              ) {
                addLog(
                  `Differential transfer reached FINISH, but ${recovery.failedRoutes.join(" + ")} did not return the expected target liveness. Case-route cleanup and the prior reset proof are complete; Automatic Update will require one fresh bilateral recovery reset before switching to the complete pinned target main.`,
                  "warn",
                );
              } else {
                addLog(
                  `Differential preflight observed ${recovery.observedVersion}/hardware 5 before START. No firmware bytes were accepted and cleanup is verified; Automatic Update will require one fresh bilateral recovery reset before switching to the complete pinned target main.`,
                  "warn",
                );
              }
              setSessionProgress(
                0.16,
                "Resetting both temples before complete-image fallback",
              );
              setAutomaticStatus(
                "Differential happy path failed safely; resetting before the complete pinned target main…",
              );
            },
          });

          if (execution.action === "verify-only") {
            const result = execution.result;
            setRecheckReport(result);
            setReport({
              ...fresh,
              console: {
                ...fresh.console,
                ...result,
                telemetry: result.telemetry,
              },
            });
            setSessionProgress(1, "Reset and bilateral liveness verified");
            setAutomaticStatus(
              "Already up to date · both temples reset and verified.",
            );
            return;
          }

          const audit = execution.audit;
          setTempleFlashAudit(audit);
          recordInstalledProvenance(
            audit,
            fresh.console?.serialNumber,
            fresh.console?.identifier,
          );
          setAutomaticStatus(
            `${automaticInstallMode === "update" ? "Update" : "Restore"} complete · both temples reset and verified.`,
          );
          addLog(
            `Automatic ${automaticInstallMode} completed on right + left${execution.initialPlan ? " after safe differential-to-complete fallback" : ""} with FINISH, route restoration, final DEB0 reset, contacts, and application liveness verified.`,
            "success",
          );
        } catch (caught) {
          if (caught?.audit) {
            setTempleFlashAudit(caught.audit);
            recordInstalledProvenance(
              caught.audit,
              report?.console?.serialNumber,
              report?.console?.identifier,
            );
          }
          setAutomaticStatus(
            `Stopped safely · ${caught?.message || String(caught)}`,
          );
          throw caught;
        }
      },
      { total: automaticCaseUpdate ? 22 : 16 },
    );
  };

  const stageFirmware = async () => {
    if (!report || !backup || !firmware?.caseRecoveryEligible) return;
    await run("stage", async () => {
      const result = await getSession().stageCaseImage(
        firmware.caseImage,
        report.optionBytes,
      );
      setStaged({ ...result, firmware });
      addLog(
        `Case ${firmware.caseVersion} is verified in the inactive bank. The active bank is unchanged.`,
        "success",
      );
    });
  };

  const activateFirmware = async () => {
    if (
      !staged ||
      !report ||
      !confirmBackup ||
      confirmText.trim().toUpperCase() !== "ACTIVATE CASE BANK"
    ) {
      return;
    }
    await run("activate", async () => {
      const result = await getSession().activateStagedBank(
        staged.firmware.caseImage,
        report.optionBytes,
      );
      setRecheckReport(result);
      setConfirmText("");
      setConfirmBackup(false);
      addLog("The staged Case bank was activated and the Case restarted.", "success");
      const fresh = await getSession().analyze();
      setReport(fresh);
      setBackup(null);
      setStaged(null);
    });
  };

  const complete = {
    connect: Boolean(report),
    analyze: Boolean(report),
    backup: Boolean(backup),
    firmware: Boolean(
      firmware?.caseRecoveryEligible || firmware?.templeFlashEligible,
    ),
    recover: Boolean(
      staged ||
        templeFlashAudit?.outcome === "success" ||
        recheckReport ||
        Object.keys(pogoResults).length,
    ),
  };
  const telemetry = report?.console?.telemetry;
  const automaticContactAssessment =
    assessAutomaticTempleContacts(telemetry);
  const caseDisplayIdentity =
    report?.console?.serialNumber ??
    report?.console?.identifier ??
    "Identity unavailable";
  const selectedTemplePresent =
    pogoRoute === "left" ? telemetry?.leftPresent : telemetry?.rightPresent;
  const flashRoutesPresent =
    templeFlashRoute === "both"
      ? telemetry?.leftPresent && telemetry?.rightPresent
      : templeFlashRoute === "left"
        ? telemetry?.leftPresent
        : telemetry?.rightPresent;
  const templeFlashReady = Boolean(
    report?.console?.caseVersion === "1.2.57" &&
    firmware?.templeFlashEligible &&
    flashRoutesPresent &&
    templeFlashSeated &&
    templeFlashRisk &&
    (templeFlashMode !== "differences" ||
      (differenceState === "ready" &&
        differencePlan?.executable &&
        differenceSourceFirmware &&
        differenceSourceConfirmed)) &&
    templeFlashText.trim().toUpperCase() === "FLASH GLASSES FIRMWARE" &&
    !operation
  );
  const canStage = Boolean(
    report && backup && firmware?.caseRecoveryEligible && !operation,
  );
  const activationReady =
    Boolean(staged) &&
    confirmBackup &&
    confirmText.trim().toUpperCase() === "ACTIVATE CASE BANK";
  const caseReleases = catalog.filter((item) => item.caseRecoveryEligible);
  const latestCaseRelease = findLatestOfficialStockRelease(caseReleases);
  const latestCaseFirmwareRelease = findLatestCaseFirmwareRelease(catalog);
  const selectedRelease = catalog.find((item) => item.id === selectedReleaseId);
  const caseUpdateNeeded = Boolean(
    report?.console?.caseVersion &&
      latestCaseFirmwareRelease?.caseVersion &&
      report.console.caseVersion !== latestCaseFirmwareRelease.caseVersion,
  );
  const serialSupported = webCaseTransportSupported();
  const directWebUsbSupported = webUsbSupported();
  const selectedTransport = portRef.current
    ? g2CaseTransportLabel(portRef.current)
    : webSerialSupported()
      ? "Web Serial"
      : directWebUsbSupported
        ? "WebUSB"
        : "Unavailable";
  const deviceAnalytics = useMemo(
    () =>
      report
        ? buildG2DeviceAnalytics({
            report,
            pogoResults,
            recoveryConfig,
            templeFlashAudit,
          })
        : null,
    [report, pogoResults, recoveryConfig, templeFlashAudit],
  );
  const fullGlassesAnalysisComplete = Boolean(
    pogoResults.left?.version &&
    pogoResults.left?.status &&
    pogoResults.right?.version &&
    pogoResults.right?.status,
  );
  const clearConsole = useCallback(() => {
    setLogs([]);
    transcriptRef.current = [];
    if (transcriptPersistTimerRef.current) {
      clearTimeout(transcriptPersistTimerRef.current);
      transcriptPersistTimerRef.current = null;
    }
    try {
      window.localStorage.removeItem(CONSOLE_TRANSCRIPT_STORAGE_KEY);
    } catch {
      // Storage may be unavailable; nothing to clear in that case.
    }
  }, []);

  const downloadConsoleTranscript = useCallback(() => {
    const text = transcriptRef.current
      .map((entry) => `${entry.time}  ${entry.message}`)
      .join("\n");
    downloadBlob(
      new Blob([`${text}\n`], { type: "text/plain" }),
      `g2-recovery-${new Date().toISOString().replaceAll(":", "-")}.log`,
    );
  }, []);

  return (
    <div className={cx("app-shell", `is-${interfaceMode}`)}>
      <aside className="sidebar">
        <a
          className="brand"
          href={interfaceMode === "easy" ? "#easy" : "#connect"}
          aria-label="SybilSight G2 Recovery Console"
        >
          <span className="brand-wordmark" aria-hidden="true">
            <strong>SYBIL</strong>
            <strong>SIGHT</strong>
          </span>
          <small>G2 WebFlasher</small>
        </a>
        <div className="sidebar-intro">
          <span className="hardware-label">DEVICE SERVICE · WEB SERIAL / WEBUSB</span>
          <h1>Recover with precision.<br />Protect every byte.</h1>
          <p>
            A guided, local-only console for the Even Realities G2 Charging Case
            and Smart Glasses.
          </p>
        </div>
        {interfaceMode === "advanced" ? (
          <StepRail
            complete={complete}
            active={activeSection}
          />
        ) : (
          <div className="easy-sidebar-guide" aria-label="Easy Mode workflow">
            <div className={cx(report && "is-complete")}>
              <span>01</span>
              <strong>Select your Case</strong>
            </div>
            <div className={cx(selectedRelease && "is-complete")}>
              <span>02</span>
              <strong>Choose firmware</strong>
            </div>
            <div className={cx(templeFlashAudit?.outcome === "success" && "is-complete")}>
              <span>03</span>
              <strong>Apply automatically</strong>
            </div>
          </div>
        )}
        <div className="sidebar-foot">
          <span className={cx("support-dot", serialSupported && "is-supported")} />
          <span>
            {serialSupported
              ? `${selectedTransport} ready`
              : "Chromium USB access required"}
          </span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-status">
            <span className={cx("connection-dot", report && "is-connected")} />
            <span>{report ? "Case analyzed" : "No Case connected"}</span>
            {operation ? <strong>{progress.detail}</strong> : null}
          </div>
          <div className="topbar-actions">
            <div className="interface-mode-switch" aria-label="Interface mode">
              <button
                type="button"
                className={cx(interfaceMode === "easy" && "is-active")}
                aria-pressed={interfaceMode === "easy"}
                onClick={() => {
                  setInterfaceMode("easy");
                  window.history.replaceState(null, "", "#easy");
                }}
                disabled={Boolean(operation)}
              >
                Easy Mode
              </button>
              <button
                type="button"
                className={cx(interfaceMode === "advanced" && "is-active")}
                aria-pressed={interfaceMode === "advanced"}
                onClick={() => {
                  setInterfaceMode("advanced");
                  window.history.replaceState(null, "", `#${activeSection}`);
                }}
                disabled={Boolean(operation)}
              >
                Advanced Mode
              </button>
            </div>
            <button
              className="console-trigger"
              onClick={() => setSupportOpen(true)}
            >
              <Icon name="tools" />
              Remote Support
              <span
                className={cx(
                  "remote-support-trigger-dot",
                  supportState.status === "connected" && "is-connected",
                )}
              />
            </button>
            <button className="console-trigger" onClick={() => setConsoleOpen(true)}>
              <Icon name="terminal" />
              Console Log
              <span>{logs.length}</span>
            </button>
          </div>
        </header>

        <div className="pane-viewport">
          <OperationError error={error} onDismiss={() => setError("")} />

        <section
          className={cx("easy-mode-pane pane", interfaceMode === "easy" && "is-active")}
          id="easy"
          data-pane="easy"
        >
          <div className="easy-mode-heading">
            <div>
              <div className="eyebrow">Easy Mode · Automatic bilateral recovery</div>
              <h2>Choose it. Apply it. We handle the rest.</h2>
              <p>
                The WebFlasher validates the Case and image, handles both temples
                right then left, verifies every transfer, restores the Case route,
                and finishes with the required bilateral reset and liveness check.
              </p>
            </div>
            <StatusPill
              tone={
                report
                  ? !automaticContactAssessment.automaticApplyAllowed ||
                    caseUpdateNeeded
                    ? "warm"
                    : "success"
                  : "quiet"
              }
            >
              {report
                ? !automaticContactAssessment.automaticApplyAllowed
                  ? "No glasses detected"
                  : caseUpdateNeeded
                  ? `Case ${report.console?.caseVersion} · update available`
                  : `Case ${report.console?.caseVersion} ready`
                : "Case required"}
            </StatusPill>
          </div>

          <div className="easy-mode-grid">
            <article className="easy-action-card">
              <div className="easy-step-heading">
                <span>01</span>
                <div>
                  <strong>Select your G2 Case</strong>
                  <small>Web Serial or direct WebUSB stays local unless you start support.</small>
                </div>
              </div>
              <div className="case-transport-actions">
                <Button
                  onClick={connectAndAnalyze}
                  busy={operation === "analyze"}
                  disabled={!serialSupported || Boolean(operation)}
                >
                  <Icon name="usb" />
                  {report ? "Choose another Case" : "Select Case"}
                </Button>
                {directWebUsbSupported ? (
                  <Button
                    tone="secondary"
                    onClick={() => connectAndAnalyze("webusb")}
                    disabled={Boolean(operation)}
                  >
                    Use WebUSB
                  </Button>
                ) : null}
              </div>
              <div className={cx("easy-case-result", report && "is-ready")}>
                <span>{report ? caseDisplayIdentity : "No Case selected"}</span>
                <strong>
                  {report
                    ? `${telemetry?.leftPresent ? "L ready" : "L absent"} · ${telemetry?.rightPresent ? "R ready" : "R absent"}`
                    : "Both temples must be seated"}
                </strong>
              </div>
            </article>

            <article className="easy-action-card easy-firmware-card">
              <div className="easy-step-heading">
                <span>02</span>
                <div>
                  <strong>Choose firmware</strong>
                  <small>Every library image is size- and SHA-256-pinned.</small>
                </div>
              </div>
              <label className="select-label" htmlFor="easy-firmware-version">
                Firmware to install
              </label>
              <select
                id="easy-firmware-version"
                value={selectedReleaseId}
                onChange={(event) => setSelectedReleaseId(event.target.value)}
                disabled={catalogState !== "ready" || Boolean(operation)}
              >
                {catalog.map((release) => (
                  <option value={release.id} key={release.id}>
                    {release.channel === "custom"
                      ? `CFW · G2 ${release.baseVersion}`
                      : `Stock · G2 ${release.version}`}
                  </option>
                ))}
              </select>
              {selectedRelease ? (
                <div className="easy-release-summary">
                  <strong>
                    {selectedRelease.channel === "custom"
                      ? "Reviewed SybilSight CFW"
                      : "Official Stock firmware"}
                  </strong>
                  <span>{formatBytes(selectedRelease.size)}</span>
                  <code>{selectedRelease.sha256.slice(0, 16)}…</code>
                </div>
              ) : null}
              <InstallModeSelector
                idPrefix="easy"
                value={automaticInstallMode}
                onChange={setAutomaticInstallMode}
                disabled={Boolean(operation)}
              />
              <AutomaticCaseUpdateOption
                idPrefix="easy"
                checked={automaticCaseUpdate}
                onChange={setAutomaticCaseUpdate}
                disabled={Boolean(operation)}
                currentVersion={report?.console?.caseVersion}
                targetVersion={latestCaseFirmwareRelease?.caseVersion}
              />
            </article>

            <article className="easy-action-card easy-apply-card">
              <div className="easy-step-heading">
                <span>03</span>
                <div>
                  <strong>Apply automatically</strong>
                  <small>No confirmation phrases or mid-process prompts.</small>
                </div>
              </div>
              <div className="automatic-task-list">
                <span>
                  <Icon name="check" />
                  {automaticCaseUpdate
                    ? "Update + verify the Case first when needed"
                    : "Require the latest Case + fresh contact preflight"}
                </span>
                <span><Icon name="check" /> Hash and component validation</span>
                <span><Icon name="check" /> Version check → clean DEB0 reset</span>
                <span>
                  <Icon name="check" />
                  {automaticInstallMode === "update"
                    ? "Differential first → verified full fallback"
                    : "Complete right + left restore"}
                </span>
                <span><Icon name="check" /> Boot + bilateral liveness proof</span>
              </div>
              <Button
                className="automatic-apply-button"
                onClick={automaticApply}
                busy={operation === "automatic-apply"}
                disabled={
                  !report ||
                  !selectedRelease ||
                  !telemetry?.leftPresent ||
                  !telemetry?.rightPresent ||
                  Boolean(operation)
                }
              >
                Apply {automaticInstallMode === "update" ? "Update" : "Restore"}
              </Button>
              <div className="automatic-status" role="status">
                <span
                  className={cx(
                    "tiny-dot",
                    templeFlashAudit?.outcome === "success"
                      ? "tiny-dot-success"
                      : "",
                  )}
                />
                <span>{automaticStatus}</span>
              </div>
              {automaticInstallMode === "update" ? (
                <small className="automatic-boundary">
                  Update writes the complete pinned target main for cross-version or
                  unknown-source installs. It uses the Stock ↔ CFW optimization only
                  when saved audits or fresh bilateral analysis prove the exact
                  source, then rechecks it immediately before each temple START. If
                  the differential reaches FINISH but target boot/liveness fails,
                  Update resets both temples and starts the complete image only when
                  Case cleanup and bilateral application reachability are proven.
                </small>
              ) : null}
            </article>
          </div>
        </section>

        <section
          className={cx(
            "hero pane",
            interfaceMode === "advanced" &&
              activeSection === "connect" &&
              "is-active",
          )}
          id="connect"
          data-pane="connect"
        >
          <div className="hero-copy">
            <div className="eyebrow">
              01 · Connect · G2 Charging Case &amp; Smart Glasses
            </div>
            <h2>
              Restore with precision.
              <br />
              Zero compromise.
            </h2>
            <p>
              Inspect the factory console and both STM32 banks, capture a complete
              device-specific Case backup, snapshot both Smart Glasses temples,
              then stage and verify a recovery image before changing the active bank.
            </p>
            <div className="hero-actions">
              <Button
                onClick={connectAndAnalyze}
                busy={operation === "analyze"}
                disabled={!serialSupported || Boolean(operation)}
              >
                <Icon name="usb" />
                {report ? "Choose another Case" : "Connect & analyze Case"}
              </Button>
              {directWebUsbSupported ? (
                <Button
                  tone="secondary"
                  onClick={() => connectAndAnalyze("webusb")}
                  disabled={Boolean(operation)}
                >
                  Use direct WebUSB
                </Button>
              ) : null}
              {report ? (
                <Button
                  tone="secondary"
                  onClick={reanalyze}
                  disabled={Boolean(operation)}
                >
                  Refresh analysis
                </Button>
              ) : null}
            </div>
            {!serialSupported ? (
              <p className="browser-note">
                This browser exposes neither Web Serial nor WebUSB. Open this page
                in a current Chromium-based browser.
              </p>
            ) : null}
          </div>
          <div className="hero-visual">
            <img
              className="hero-product-image"
              src="/even-g2-case-grey.png"
              alt="Even Realities G2 Smart Glasses in their Charging Case"
              width="1501"
              height="1501"
              fetchPriority="high"
              draggable="false"
            />
            <div className="visual-callout callout-port">
              <span>USB-C</span>
              <strong>1A86:7523</strong>
            </div>
            <div className="visual-callout callout-mcu">
              <span>CASE MCU</span>
              <strong>STM32 · DUAL BANK</strong>
            </div>
          </div>
        </section>

        <section
          className={cx(
            "content-section pane",
            interfaceMode === "advanced" &&
              activeSection === "analyze" &&
              "is-active",
          )}
          id="analyze"
          data-pane="analyze"
        >
          <SectionHeading
            eyebrow="02 · Analyze"
            title="Analyze the Case and Smart Glasses"
            copy="Separate the Case factory shell, STM32 banks, and option bytes from left/right temple data captured through the Case pogo routes."
            action={
              report ? (
                <StatusPill tone="success">
                  <Icon name="check" /> Case pass complete
                </StatusPill>
              ) : (
                <StatusPill>Waiting for Case</StatusPill>
              )
            }
          />
          <div className="analysis-scope-tabs" role="tablist" aria-label="Analyze device scope">
            {[
              ["case", "Charging Case", "Factory shell + STM32"],
              ["glasses", "Smart Glasses", "Left + right temples"],
              ["evidence", "Shell & evidence", "Frames + recovery record"],
            ].map(([key, label, detail]) => (
              <button
                type="button"
                role="tab"
                aria-selected={analysisView === key}
                className={cx(analysisView === key && "is-active")}
                onClick={() => setAnalysisView(key)}
                key={key}
              >
                <Icon name={key === "case" ? "case" : key === "glasses" ? "glasses" : "terminal"} />
                <span>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                </span>
              </button>
            ))}
          </div>
          {report ? (
            <>
              {analysisView === "case" ? (
                <>
              <div className="status-grid">
                <article className="status-card status-card-primary">
                  <div className="card-topline">
                    <Icon name="case" />
                    <span>Case</span>
                    <StatusPill tone={telemetry?.open ? "warm" : "success"}>
                      {telemetry ? (telemetry.open ? "Lid open" : "Lid closed") : "Unknown"}
                    </StatusPill>
                  </div>
                  <div className="metric-large">
                    {telemetry?.percent ?? "—"}<span>%</span>
                  </div>
                  <div className="metric-caption">
                    {telemetry?.voltage ? `${telemetry.voltage} mV · ` : ""}
                    Firmware {report.console.caseVersion ?? report.banks.active.version}
                  </div>
                </article>
                <article className="status-card">
                  <div className="card-topline">
                    <Icon name="glasses" />
                    <span>Glasses present</span>
                  </div>
                  <div className="temple-pair">
                    <div className={cx(telemetry?.leftPresent && "is-present")}>
                      <span>L</span>
                      <strong>{telemetry?.leftPresent ? "Detected" : "Absent"}</strong>
                    </div>
                    <div className={cx(telemetry?.rightPresent && "is-present")}>
                      <span>R</span>
                      <strong>{telemetry?.rightPresent ? "Detected" : "Absent"}</strong>
                    </div>
                  </div>
                  <div className="metric-caption">
                    Live Case-link telemetry, not simple switches
                  </div>
                </article>
                <article className="status-card">
                  <div className="card-topline">
                    <Icon name="usb" />
                    <span>Power + USB</span>
                  </div>
                  <div className="compact-metrics">
                    <div><span>USB</span><strong>{telemetry?.usbPresent ? "Present" : "Not reported"}</strong></div>
                    <div><span>Current</span><strong>{telemetry?.current ?? "—"}</strong></div>
                    <div><span>Temperature</span><strong>{telemetry?.temperature ?? "—"}</strong></div>
                  </div>
                </article>
              </div>

              <div className="analysis-columns">
                <article className="panel">
                  <div className="panel-header">
                    <div>
                      <div className="eyebrow">Identity</div>
                      <h3>Identifiers</h3>
                    </div>
                    <StatusPill tone="quiet">Stays in browser</StatusPill>
                  </div>
                  <div className="field-grid">
                    <Field label="Case serial" value={report.console.serialNumber} />
                    <Field label="Factory identifier" value={report.console.identifier} />
                    <Field
                      label="Frame-fit variant"
                      value="Not reported by device"
                      detail="Frame A/B is not inferred from the factory identifier"
                    />
                    <Field
                      label="Electronic profile"
                      value={
                        deviceAnalytics.chargingCase.variantAssessment
                          .matchesReviewedElectronicProfile
                          ? "Reviewed profile"
                          : "Unrecognized"
                      }
                      detail="USB, STM32 ROM, and dual-bank signature"
                    />
                    <Field
                      label="USB bridge"
                      value={`${hex(report.usb.vendorId ?? 0, 4)}:${hex(report.usb.productId ?? 0, 4).slice(2)}`}
                      detail="WCH CH340/CH341 family"
                    />
                    <Field
                      label="STM32 product ID"
                      value={hex(report.rom.productId, 4)}
                      detail={`ROM protocol ${(report.rom.protocolVersion >> 4)}.${report.rom.protocolVersion & 0xf}`}
                    />
                  </div>
                </article>

                <article className="panel bank-panel">
                  <div className="panel-header">
                    <div>
                      <div className="eyebrow">Dual bank</div>
                      <h3>Case firmware map</h3>
                    </div>
                    <StatusPill tone="success">
                      RDP {hex(report.options.rdp, 2)}
                    </StatusPill>
                  </div>
                  <div className="bank-map">
                    <div className="bank-row is-active">
                      <div className="bank-index">A</div>
                      <div>
                        <span>ACTIVE · PHYSICAL BANK {report.banks.active.physicalBank}</span>
                        <strong>{report.banks.active.version}</strong>
                      </div>
                      <code>{hex(report.banks.active.aliasAddress)}</code>
                    </div>
                    <div className="bank-connector"><span /></div>
                    <div className="bank-row">
                      <div className="bank-index">B</div>
                      <div>
                        <span>FALLBACK · PHYSICAL BANK {report.banks.inactive.physicalBank}</span>
                        <strong>{report.banks.inactive.version}</strong>
                      </div>
                      <code>{hex(report.banks.inactive.aliasAddress)}</code>
                    </div>
                  </div>
                  <div className="option-summary">
                    <span>DUAL_BANK {report.options.dualBank ? "ON" : "OFF"}</span>
                    <span>nSWAP_BANK {report.options.swapBank ? "1" : "0"}</span>
                    <span>USER {hex(report.options.userWord)}</span>
                  </div>
                </article>
              </div>
                </>
              ) : null}
              {analysisView === "glasses" ? (
                <div className="glasses-analysis">
                  <div className="analysis-action-panel">
                    <div>
                      <div className="eyebrow">Read-only paired analysis</div>
                      <h3>Query both running temples</h3>
                      <p>
                        Captures version, hardware revision, battery, voltage, raw
                        frames, and exact route-restoration proof for left and right.
                        Presence alone comes from the Case; every other value requires
                        a checksum-valid reply from the Glasses application.
                      </p>
                    </div>
                    <label className="confirm-check">
                      <input
                        type="checkbox"
                        checked={glassesAnalyzeConfirm}
                        onChange={(event) =>
                          setGlassesAnalyzeConfirm(event.target.checked)
                        }
                        disabled={
                          !telemetry?.leftPresent ||
                          !telemetry?.rightPresent ||
                          Boolean(operation)
                        }
                      />
                      <span>
                        Both temples are seated; keep the Case and USB cable still.
                      </span>
                    </label>
                    <Button
                      onClick={analyzeSmartGlasses}
                      busy={operation === "glasses-analyze"}
                      disabled={
                        !telemetry?.leftPresent ||
                        !telemetry?.rightPresent ||
                        !glassesAnalyzeConfirm ||
                        Boolean(operation)
                      }
                    >
                      <Icon name="scan" />
                      {fullGlassesAnalysisComplete
                        ? "Refresh both Glasses"
                        : "Analyze both Smart Glasses"}
                    </Button>
                    {!telemetry?.leftPresent || !telemetry?.rightPresent ? (
                      <small>
                        Seat both temples, then refresh the Charging Case analysis.
                      </small>
                    ) : null}
                  </div>
                  <div className="glasses-analysis-grid">
                    <SmartGlassesAnalyticsCard
                      label="Left"
                      analytics={deviceAnalytics.smartGlasses.left}
                    />
                    <SmartGlassesAnalyticsCard
                      label="Right"
                      analytics={deviceAnalytics.smartGlasses.right}
                    />
                  </div>
                  <div className={cx(
                    "glasses-recovery-readiness",
                    deviceAnalytics.smartGlasses.recoveryAssessment.bothRoutesReady &&
                      "is-ready",
                  )}>
                    <Icon
                      name={
                        deviceAnalytics.smartGlasses.recoveryAssessment.bothRoutesReady
                          ? "check"
                          : "warning"
                      }
                    />
                    <div>
                      <strong>
                        {deviceAnalytics.smartGlasses.recoveryAssessment.bothRoutesReady
                          ? "Both routes match the validated recovery envelope"
                          : "Recovery readiness is not yet proven for both routes"}
                      </strong>
                      <span>
                        Requires Case 1.2.57, a checksum-valid running
                        hardware-5 application on each temple, and both
                        contacts responsive. Only exact 2.2.6.10 ↔ 2.2.6.11
                        transitions use differential mode; the Apollo
                        bootloader is never transferred.
                      </span>
                    </div>
                    <a href="#smart-glasses-recovery">Open Smart Glasses recovery</a>
                  </div>
                </div>
              ) : null}
              {analysisView === "evidence" ? (
                <ShellEvidenceView
                  analytics={deviceAnalytics}
                  onDownload={() =>
                    downloadBlob(
                      new Blob([`${JSON.stringify(deviceAnalytics, null, 2)}\n`], {
                        type: "application/json",
                      }),
                      `g2-case-glasses-analytics-${new Date()
                        .toISOString()
                        .replaceAll(":", "-")}.json`,
                    )
                  }
                />
              ) : null}
            </>
          ) : (
            <div className="empty-panel">
              <Icon name="scan" />
              <strong>Connect the Case to populate this analysis.</strong>
              <span>The first pass does not erase, write, or change option bytes.</span>
            </div>
          )}
        </section>

        <section
          className={cx(
            "content-section pane",
            interfaceMode === "advanced" &&
              activeSection === "backup" &&
              "is-active",
          )}
          id="backup"
          data-pane="backup"
        >
          <SectionHeading
            eyebrow="03 · Preserve"
            title="Back up the Case and Smart Glasses"
            copy="Captures the full Case memory, verifies both seated temples, and embeds the matching digest-pinned official Glasses recovery bundle into one local file."
            action={
              backup ? (
                <StatusPill tone="success"><Icon name="check" /> Downloaded</StatusPill>
              ) : null
            }
          />
          <div className="preserve-layout">
            <article className="backup-card">
              <div className="backup-graphic" aria-hidden="true">
                <div><span>ACTIVE</span><b>256 KiB</b></div>
                <div><span>FALLBACK</span><b>256 KiB</b></div>
                <div className="glasses-block">
                  <span>SMART GLASSES</span>
                  <b>LEFT + RIGHT · MATCHED RECOVERY BUNDLE</b>
                </div>
                <i>+</i>
                <div className="option-block"><span>OPTIONS</span><b>128 B</b></div>
              </div>
              <div>
                <h3>Complete G2 recovery set</h3>
                <p>
                  The Case is preserved byte-for-byte. Each running temple contributes
                  a checksum-validated version snapshot, and the matching official
                  Glasses firmware is embedded for recovery. Installed Apollo memory
                  cannot be read through the Case, so the Glasses portion is not an
                  MRAM, key, pairing, or calibration dump.
                </p>
                <Button
                  onClick={createBackup}
                  busy={operation === "backup"}
                  disabled={
                    !report ||
                    catalogState !== "ready" ||
                    Boolean(operation)
                  }
                >
                  <Icon name="backup" />
                  {backup
                    ? "Download a fresh recovery set"
                    : "Back up Case + Smart Glasses"}
                </Button>
              </div>
            </article>
            <div className="backup-checklist">
              <div><Icon name="check" /><span><strong>Exact Case acquisition</strong>512 KiB flash + 128-byte options</span></div>
              <div><Icon name="check" /><span><strong>Both temples captured</strong>Version, hardware, raw frame + route proof</span></div>
              <div><Icon name="check" /><span><strong>Glasses recovery image</strong>Matching official bundle, size + SHA-256 validated</span></div>
              <div><Icon name="check" /><span><strong>Application restored</strong>Normal Case console after every read</span></div>
              {backup ? (
                <div className="backup-digest">
                  <span>CASE FLASH SHA-256</span>
                  <code>{backup.flashSha256}</code>
                  <span>SMART GLASSES BUNDLE SHA-256</span>
                  <code>{backup.recoveryRelease.sha256}</code>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section
          className={cx(
            "content-section pane",
            interfaceMode === "advanced" &&
              activeSection === "firmware" &&
              "is-active",
          )}
          id="firmware"
          data-pane="firmware"
        >
          <SectionHeading
            eyebrow="04 · Choose image"
            title="The SybilSight verified library, or your own file"
            copy="Every entry in the library is a hash-pinned image that is re-validated locally before any write is enabled: Charging Case recovery images, plus the reviewed SybilSight transformation of stock 2.2.6.10 for the Smart Glasses. You can also supply your own file."
            action={
              catalogState === "ready" ? (
                <StatusPill tone="quiet">
                  {catalog.length} verified {catalog.length === 1 ? "build" : "builds"}
                </StatusPill>
              ) : (
                <StatusPill tone="warm">Library {catalogState}</StatusPill>
              )
            }
          />
          <div className="firmware-layout">
            <article className="panel firmware-picker">
              <div className="source-tabs">
                <span className="is-active">SybilSight verified library</span>
              </div>
              <label className="select-label" htmlFor="firmware-version">
                G2 firmware artifact
              </label>
              <div className="select-row">
                <select
                  id="firmware-version"
                  value={selectedReleaseId}
                  onChange={(event) => setSelectedReleaseId(event.target.value)}
                  disabled={catalogState !== "ready" || Boolean(operation)}
                >
                  {catalog.map((release) => (
                    <option value={release.id} key={release.id}>
                      {release.caseRecoveryEligible
                        ? `Charging Case ${release.caseVersion} · G2 ${release.version}`
                        : `Smart Glasses ${release.baseVersion ?? release.version} · CFW`}
                    </option>
                  ))}
                </select>
                <Button
                  onClick={loadMirroredFirmware}
                  busy={operation === "firmware"}
                  disabled={!selectedRelease || Boolean(operation)}
                >
                  Load & validate
                </Button>
              </div>
              {selectedRelease ? (
                <div className="release-meta">
                  <span>
                    {!selectedRelease.caseRecoveryEligible
                      ? "Smart Glasses CFW · pinned temple target"
                      : selectedRelease === latestCaseRelease
                        ? "Latest official Stock · default Easy Mode target"
                        : "Earlier Case image"}
                  </span>
                  <span>{formatBytes(selectedRelease.size)}</span>
                  <code>{selectedRelease.sha256.slice(0, 20)}…</code>
                  <a href={selectedRelease.url} download>
                    Source bundle
                  </a>
                  {selectedRelease.patchUrl ? (
                    <a href={selectedRelease.patchUrl} download>
                      Reviewed patch recipe
                    </a>
                  ) : null}
                </div>
              ) : null}
              <div className="advanced-automatic-apply">
                <InstallModeSelector
                  idPrefix="advanced"
                  value={automaticInstallMode}
                  onChange={setAutomaticInstallMode}
                  disabled={Boolean(operation)}
                />
                <AutomaticCaseUpdateOption
                  idPrefix="advanced"
                  checked={automaticCaseUpdate}
                  onChange={setAutomaticCaseUpdate}
                  disabled={Boolean(operation)}
                  currentVersion={report?.console?.caseVersion}
                  targetVersion={latestCaseFirmwareRelease?.caseVersion}
                />
                <Button
                  onClick={automaticApply}
                  busy={operation === "automatic-apply"}
                  disabled={
                    !report ||
                    !selectedRelease ||
                    !telemetry?.leftPresent ||
                    !telemetry?.rightPresent ||
                    Boolean(operation)
                  }
                >
                  Apply {automaticInstallMode === "update" ? "Update" : "Restore"} automatically
                </Button>
                <small>
                  Applies to both temples, right then left, and always ends with
                  route cleanup, a bilateral DEB0 reset, contact checks, and
                  application-liveness verification.
                </small>
                <div className="automatic-status" role="status">
                  {automaticStatus}
                </div>
              </div>
              <div className="or-divider"><span>or</span></div>
              <label className="upload-zone">
                <input
                  type="file"
                  accept=".bin,.evenota,application/octet-stream"
                  onChange={loadLocalFirmware}
                  disabled={Boolean(operation)}
                />
                <Icon name="file" />
                <span>
                  <strong>Choose a local firmware file</strong>
                  EVENOTA bundle, firmware_box.bin, or validated raw Case image
                </span>
              </label>
            </article>

            <article className={cx("panel selected-firmware", firmware && "has-firmware")}>
              {firmware ? (
                <>
                  <div className="selected-check"><Icon name="check" /></div>
                  <div className="eyebrow">Validated locally</div>
                  <h3>
                    {firmware.provenance.channel === "custom"
                      ? `Smart Glasses ${firmware.provenance.baseVersion ?? firmware.g2Version} CFW`
                      : `Charging Case ${firmware.caseVersion}`}
                  </h3>
                  <p>
                    {firmware.kind === "bundle"
                      ? `${firmware.provenance.label}. The ${firmware.components.length}-component bundle passed outer CRC-32C, Apollo preamble/CRC/vector, Case wrapper, and Case vector checks.`
                      : "Validated standalone Charging-Case image."}
                  </p>
                  <div className="firmware-facts">
                    <Field
                      label="Trust"
                      value={firmware.provenance.label}
                      status={
                        firmware.provenance.trust === "unrecognized"
                          ? null
                          : "success"
                      }
                    />
                    <Field label="Source" value={firmware.fileName} />
                    <Field label="Bundle size" value={formatBytes(firmware.fileSize)} />
                    <Field label="Case payload" value={formatBytes(firmware.caseImage.length)} />
                    {firmware.mainFirmware ? (
                      <>
                        <Field
                          label="Apollo target"
                          value={hex(firmware.mainFirmware.runBase)}
                          detail="Single in-place main application"
                        />
                        <Field
                          label="Apollo image end"
                          value={hex(firmware.mainFirmware.installedImageEnd)}
                          detail={`Below update flag ${hex(0x007fe000)}`}
                        />
                      </>
                    ) : null}
                    <Field label="SHA-256" value={`${firmware.fileSha256.slice(0, 24)}…`} />
                  </div>
                  {firmware.provenance.channel === "custom" ? (
                    <div className="firmware-boundary firmware-boundary-custom">
                      <strong>Reviewed CFW targets the Glasses; do not stage it as Case firmware.</strong>
                      <span>
                        Its Case component is byte-identical to the stock 1.2.57 component.
                        The exact reviewed Apollo main payload has successful left- and
                        right-temple transfers through SybilSight’s volatile Case bridge.
                        It is eligible only for the guarded running-temple writer in Recover,
                        never for Case-bank staging.
                      </span>
                      <ul>
                        {firmware.provenance.capabilities.map((capability) => (
                          <li key={capability}>{capability}</li>
                        ))}
                      </ul>
                    </div>
                  ) : firmware.provenance.trust === "unrecognized" &&
                    firmware.kind === "bundle" ? (
                    <div className="firmware-boundary">
                      <strong>Integrity is valid; publisher provenance is unknown.</strong>
                      <span>
                        A self-consistent local bundle is not proof that Even or SybilSight
                        published it. Only its extracted Case image is eligible here.
                      </span>
                    </div>
                  ) : null}
                  {firmware.kind === "bundle" ? (
                    <details>
                      <summary>
                        Show all {firmware.components.length} G2 components
                      </summary>
                      <div className="component-list">
                        {firmware.components.map((component) => (
                          <div
                            className={
                              component.pogoOta.disposition === "omit"
                                ? "is-pogo-omit"
                                : ""
                            }
                            key={component.name}
                          >
                            <span>
                              {component.name} · type {component.typeId}
                              <small>
                                {component.pogoOta.dataRecordCount.toLocaleString()} ×
                                {" "}0x54 · final seq {component.pogoOta.finalSequence}
                              </small>
                              <small className="component-disposition">
                                {component.pogoOta.safetyLabel}
                              </small>
                            </span>
                            <code>{formatBytes(component.payloadSize)}</code>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </>
              ) : (
                <div className="selected-empty">
                  <Icon name="firmware" />
                  <strong>No recovery image selected</strong>
                  <span>Files remain in this browser and are validated before a write is enabled.</span>
                </div>
              )}
            </article>
          </div>
        </section>

        <section
          className={cx(
            "content-section recovery-section pane",
            interfaceMode === "advanced" &&
              activeSection === "recover" &&
              "is-active",
          )}
          id="recover"
          data-pane="recover"
        >
          <SectionHeading
            eyebrow="05 · Recovery Console"
            title="Recover the Case or Smart Glasses"
            copy="Use dual-bank staging for the Charging Case, or the hardware-validated Case-to-pogo path to reinstall a pinned Apollo main on responsive Smart Glasses. Read-only temple probes, provisioning decode, and the recorded transfer evidence sit below."
          />
          <div className="recovery-target-heading">
            <div>
              <div className="eyebrow">Charging Case</div>
              <h3>Dual-bank Case recovery</h3>
              <p>
                The active bank remains untouched while the selected Case image is
                written and byte-for-byte verified in the fallback bank.
              </p>
            </div>
            <StatusPill tone={staged ? "success" : "quiet"}>
              {staged ? "Inactive bank verified" : "Case path"}
            </StatusPill>
          </div>
          <div className="recovery-flow">
            <article
              className={cx(
                "recovery-step",
                report && backup && firmware?.caseRecoveryEligible && "is-ready",
              )}
            >
              <div className="recovery-number">1</div>
              <div>
                <h3>Preflight</h3>
                <ul>
                  <li className={report ? "done" : ""}>Fresh Case analysis</li>
                  <li className={backup ? "done" : ""}>
                    Case + Smart Glasses recovery set downloaded
                  </li>
                  <li className={firmware?.caseRecoveryEligible ? "done" : ""}>
                    Case-recovery image validated
                  </li>
                </ul>
                {firmware && !firmware.caseRecoveryEligible ? (
                  <p className="preflight-blocked">
                    The reviewed CFW is authenticated, but it targets the G2 Apollo
                    application and cannot be staged through the Case USB loader.
                  </p>
                ) : null}
              </div>
            </article>
            <article className={cx("recovery-step", staged && "is-complete")}>
              <div className="recovery-number">{staged ? <Icon name="check" /> : "2"}</div>
              <div>
                <h3>Stage inactive bank</h3>
                <p>
                  Erases only the bounded image pages, leaving the active bank and
                  end-of-bank device data untouched.
                </p>
                <Button
                  onClick={stageFirmware}
                  busy={operation === "stage"}
                  disabled={!canStage}
                >
                  <Icon name="bank" />
                  {staged ? "Stage again" : "Stage & verify inactive bank"}
                </Button>
                {staged ? (
                  <div className="stage-proof">
                    <span>READBACK SHA-256</span>
                    <code>{staged.readbackSha256}</code>
                  </div>
                ) : null}
              </div>
            </article>
            <article className={cx("recovery-step recovery-step-danger", staged && "is-ready")}>
              <div className="recovery-number">3</div>
              <div>
                <h3>Activate staged bank</h3>
                <p>
                  This rewrites the full option block with only nSWAP_BANK changed,
                  then resets the Case. The write path is research-derived and has not
                  yet been physically exercised on a sacrificial G2 Case.
                </p>
                <label className="confirm-check">
                  <input
                    type="checkbox"
                    checked={confirmBackup}
                    onChange={(event) => setConfirmBackup(event.target.checked)}
                    disabled={!staged || Boolean(operation)}
                  />
                  <span>I have stored the downloaded G2 recovery set privately.</span>
                </label>
                <label className="confirm-label" htmlFor="activate-confirmation">
                  Type <strong>ACTIVATE CASE BANK</strong>
                </label>
                <input
                  id="activate-confirmation"
                  className="confirm-input"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  placeholder="ACTIVATE CASE BANK"
                  autoComplete="off"
                  disabled={!staged || Boolean(operation)}
                />
                <Button
                  tone="danger"
                  onClick={activateFirmware}
                  busy={operation === "activate"}
                  disabled={!activationReady || Boolean(operation)}
                >
                  Activate staged bank & restart
                </Button>
              </div>
            </article>
          </div>
          <div className="smart-glasses-recovery" id="smart-glasses-recovery">
            <div className="smart-glasses-recovery-heading">
              <div>
                <div className="eyebrow">Smart Glasses</div>
                <h3>Running-temple recovery through the Case</h3>
                <p>
                  Reinstalls the Apollo main from any image in the SybilSight
                  verified library — stock or reviewed CFW — using the successful
                  right- and left-temple procedure. The writer pins the Case SRAM
                  bridge and re-hashes the main payload against its own compiled-in
                  allowlist; requires finish and post-reboot replies; restores all
                  ten YHM route registers; confirms Case firmware 1.2.57 returns;
                  then makes the traced dual-temple reset the final temple mutation
                  and verifies contacts plus checksum-valid version liveness. If
                  START returns no frame with zero declared/accepted bytes, the
                  audit stops wired retries and points to the proven fresh-BLE
                  full-package fallback; this Web Serial tool does not perform
                  that BLE transfer.
                </p>
              </div>
              <StatusPill tone={firmware?.templeFlashEligible ? "success" : "quiet"}>
                {firmware?.templeFlashTarget
                  ? firmware.templeFlashTarget.label
                  : "Load a library image"}
              </StatusPill>
            </div>
            <div className="smart-glasses-recovery-gate">
              <div className={report?.console?.caseVersion === "1.2.57" ? "done" : ""}>
                <Icon name="check" />
                <span>Case 1.2.57 analyzed</span>
              </div>
              <div className={flashRoutesPresent ? "done" : ""}>
                <Icon name="check" />
                <span>Selected temple route seated</span>
              </div>
              <div className={firmware?.templeFlashEligible ? "done" : ""}>
                <Icon name="check" />
                <span>Pinned Glasses image loaded</span>
              </div>
              <div className={fullGlassesAnalysisComplete ? "done" : ""}>
                <Icon name="check" />
                <span>Version + status evidence captured</span>
              </div>
            </div>
            <div className="smart-glasses-recovery-grid">
              <div className="smart-glasses-recovery-controls">
                <label className="flash-select-label">
                  Temple recovery target
                  <select
                    value={templeFlashRoute}
                    onChange={(event) => {
                      setTempleFlashRoute(event.target.value);
                      setTempleFlashSeated(false);
                      setTempleFlashText("");
                    }}
                    disabled={Boolean(operation)}
                  >
                    <option value="both">Both temples · right then left</option>
                    <option value="right">Right temple only</option>
                    <option value="left">Left temple only</option>
                  </select>
                </label>
                <label className="flash-select-label">
                  Transfer mode
                  <select
                    value={templeFlashMode}
                    onChange={(event) => {
                      setTempleFlashMode(event.target.value);
                      setDifferenceSourceConfirmed(false);
                      setTempleFlashSeated(false);
                      setTempleFlashText("");
                    }}
                    disabled={Boolean(operation)}
                  >
                    <option value="complete">Complete pinned Apollo main</option>
                    <option value="differences">
                      Flash differences · Stock ↔ CFW
                    </option>
                  </select>
                </label>
                {templeFlashMode === "differences" ? (
                  <div
                    className={cx(
                      "difference-plan",
                      differenceState === "ready" && "is-ready",
                      differenceState === "blocked" && "is-blocked",
                    )}
                  >
                    <div className="difference-plan-heading">
                      <span>Bundle difference plan</span>
                      <strong>
                        {differenceState === "loading"
                          ? "Comparing pinned images…"
                          : differenceState === "ready"
                            ? "Ready"
                            : "Blocked"}
                      </strong>
                    </div>
                    {differencePlan ? (
                      <>
                        <div className="difference-plan-route">
                          <code>{differencePlan.source.label}</code>
                          <span>→</span>
                          <code>{differencePlan.target.label}</code>
                        </div>
                        <div className="difference-plan-facts">
                          <span>
                            <strong>{differencePlan.unchangedComponentCount}</strong>
                            identical components skipped
                          </span>
                          <span>
                            <strong>{differencePlan.changedComponentCount}</strong>
                            changed component transferred
                          </span>
                          <span>
                            <strong>
                              {differencePlan.mainDifferences.changedBytes.toLocaleString()}
                            </strong>
                            byte positions differ offline
                          </span>
                          <span>
                            <strong>
                              {formatBytes(differencePlan.wireTransfer.bytes)}
                            </strong>
                            contiguous CRC-gated wire payload
                          </span>
                        </div>
                        <small>
                          The G2 receiver exposes no write offset, so arbitrary sparse
                          byte ranges cannot be skipped safely. This mode omits every
                          byte-identical bundle component and transfers the complete
                          changed Apollo main.
                        </small>
                        <label className="pogo-confirm difference-source-confirm">
                          <input
                            type="checkbox"
                            checked={differenceSourceConfirmed}
                            onChange={(event) =>
                              setDifferenceSourceConfirmed(event.target.checked)
                            }
                            disabled={Boolean(operation)}
                          />
                          <span>
                            I confirm the source shown above is currently installed.
                          </span>
                        </label>
                      </>
                    ) : (
                      <small>{differenceError || "Preparing the comparison…"}</small>
                    )}
                  </div>
                ) : null}
                <label className="pogo-confirm">
                  <input
                    type="checkbox"
                    checked={templeFlashSeated}
                    onChange={(event) => setTempleFlashSeated(event.target.checked)}
                    disabled={!report || !flashRoutesPresent || Boolean(operation)}
                  />
                  <span>
                    The selected route{templeFlashRoute === "both" ? "s are" : " is"}
                    {" "}seated; I will not move the Glasses, Case, or USB cable.
                  </span>
                </label>
                <label className="pogo-confirm">
                  <input
                    type="checkbox"
                    checked={templeFlashRisk}
                    onChange={(event) => setTempleFlashRisk(event.target.checked)}
                    disabled={!firmware?.templeFlashEligible || Boolean(operation)}
                  />
                  <span>
                    I understand this single-slot reinstall cannot recover a temple
                    whose Apollo application or pogo UART task is already dead.
                  </span>
                </label>
                <label
                  className="confirm-label"
                  htmlFor="recover-temple-flash-confirmation"
                >
                  Type <strong>FLASH GLASSES FIRMWARE</strong>
                </label>
                <input
                  id="recover-temple-flash-confirmation"
                  className="confirm-input"
                  value={templeFlashText}
                  onChange={(event) => setTempleFlashText(event.target.value)}
                  placeholder="FLASH GLASSES FIRMWARE"
                  autoComplete="off"
                  disabled={!firmware?.templeFlashEligible || Boolean(operation)}
                />
                <Button
                  tone="danger"
                  onClick={flashTempleFirmware}
                  busy={operation === "temple-flash"}
                  disabled={!templeFlashReady}
                >
                  {templeFlashMode === "differences"
                    ? "Flash bundle differences"
                    : "Recover selected Smart Glasses"}
                </Button>
                {!firmware?.templeFlashEligible ? (
                  <small className="pogo-presence-warning">
                    Load a stock or reviewed-CFW image from the SybilSight verified
                    library in Choose image.
                  </small>
                ) : !firmware.templeFlashTarget?.hardwareValidated ? (
                  <small className="pogo-presence-warning">
                    {firmware.templeFlashTarget.label} is hash-pinned, but its
                    temple transfer has not completed on Case USB hardware.
                  </small>
                ) : report && !flashRoutesPresent ? (
                  <small className="pogo-presence-warning">
                    Refresh analysis after seating every selected route.
                  </small>
                ) : null}
              </div>
              <div className="smart-glasses-recovery-proof">
                <div>
                  <span>ALLOWLIST</span>
                  <strong>{POGO_TRANSFER_RESEARCH.directTempleHost.component}</strong>
                </div>
                <div>
                  <span>SELECTED PINNED MAIN</span>
                  <strong>
                    {(firmware?.templeFlashTarget?.mainBytes ??
                      POGO_TRANSFER_RESEARCH.caseUsbBridge.successfulTransfers.right
                        .payloadBytes
                    ).toLocaleString()}
                    {" B · "}
                    {Math.ceil(
                      (firmware?.templeFlashTarget?.mainBytes ??
                        POGO_TRANSFER_RESEARCH.caseUsbBridge.successfulTransfers.right
                          .payloadBytes) / 1000,
                    ).toLocaleString()}
                    {" records"}
                  </strong>
                </div>
                <div>
                  <span>RECOVERY ENVELOPE</span>
                  <strong>Case 1.2.57 · G2 2.2.6.10 · HW 5</strong>
                </div>
                <div>
                  <span>FINAL RECOVERY PHASE</span>
                  <strong>DEB0 reset · contacts · version liveness</strong>
                </div>
                <div>
                  <span>PROVEN FALLBACK FROM WIRED</span>
                  <strong>Fresh BLE · all 6 stock components · 1,053 ACKs</strong>
                </div>
                <div>
                  <span>EXCLUDED</span>
                  <strong>Apollo bootloader + all peripheral components</strong>
                </div>
                <div className="smart-glasses-recovery-boundary">
                  <Icon name="warning" />
                  <span>
                    An application-dead temple remains outside this WebFlasher’s
                    proven recovery boundary. INFOC/INFO0 analysis can identify an
                    SBL candidate, but does not authorize or perform that write.
                  </span>
                </div>
              </div>
            </div>
            {templeFlashAudit ? (
              <div className={cx(
                "temple-flash-audit",
                templeFlashAudit.outcome === "success" && "is-success",
              )}>
                <div>
                  <strong>
                    {templeFlashAudit.outcome === "success"
                      ? "Transfer, final reset, and liveness verified"
                      : "Stopped · state failed or uncertain"}
                  </strong>
                  <span>
                    {templeFlashAudit.routeResults
                      .map((item) => `${item.route}: ${item.outcome}`)
                      .join(" · ")}
                    {templeFlashAudit.finalResetAndLiveness?.resetConfirmed
                      ? " · B0 reset: confirmed"
                      : ""}
                  </span>
                  {templeFlashAudit.verification ? (
                    <span>
                      Target SHA/byte count + finish acknowledgement:{" "}
                      {templeFlashAudit.verification
                        .everyRouteAcceptedExactTargetBytes
                        ? "verified"
                        : "incomplete"}
                      {" · "}postflight:{" "}
                      {templeFlashAudit.verification
                        .everyRoutePostflightVersionValid
                        ? "verified"
                        : "incomplete"}
                      {" · "}final reset/liveness:{" "}
                      {templeFlashAudit.verification
                        .finalDualTempleResetVerified &&
                      templeFlashAudit.verification.postResetLivenessVerified
                        ? "verified"
                        : "incomplete"}
                    </span>
                  ) : null}
                  {templeFlashAudit.routeResults
                    .find((item) => item.recoveryBoundary)
                    ?.recoveryBoundary?.recoveryRecommendation ? (
                      <span>
                        {
                          templeFlashAudit.routeResults.find(
                            (item) => item.recoveryBoundary,
                          ).recoveryBoundary.recoveryRecommendation
                        }
                      </span>
                    ) : null}
                </div>
                <Button
                  tone="ghost"
                  onClick={() =>
                    downloadBlob(
                      new Blob([`${JSON.stringify(templeFlashAudit, null, 2)}\n`], {
                        type: "application/json",
                      }),
                      `g2-temple-restore-${new Date().toISOString().replaceAll(":", "-")}.json`,
                    )
                  }
                >
                  Download recovery audit
                </Button>
              </div>
            ) : null}
          </div>
          <div className="recovery-target-heading">
            <div>
              <div className="eyebrow">Recovery boundary</div>
              <h3>
                The Case can recover a running temple. Dead-temple recovery is
                not proven.
              </h3>
              <p>
                The traced B0 command can hardware-reset both seated temples, and
                the Case reports when each application link returns. This console
                can also load the exact reviewed read-only SRAM bridge for
                checksum-valid status or version replies from either pogo route.
                Its hash-gated writer can install only an Apollo main from its own
                compiled-in allowlist — stock or reviewed CFW — on a running
                temple, with finish acknowledgement, post-reboot version,
                byte-for-byte route restoration, normal Case-app return, a final
                B0 reset, renewed contact presence, and post-reset version
                liveness required on every selected route. The recovery-session
                reset revived a nonresponsive left application/display without
                sending firmware bytes. The reviewed CFW main has confirmed wired
                left- and right-temple transfers. Stock is now proven by a complete
                wired right-main restore and a complete fresh-BLE six-component
                left restore; the browser remains a wired, main-only writer.
              </p>
            </div>
            <Button
              tone="secondary"
              onClick={restartAndRecheck}
              busy={operation === "recheck"}
              disabled={!report || Boolean(operation)}
            >
              Reset both temples & recheck
            </Button>
          </div>
          {recheckReport ? (
            <div className="recheck-result">
              <Icon name="check" />
              B0 reset confirmed · L {recheckReport.telemetry?.leftPresent ? "present" : "absent"} · R{" "}
              {recheckReport.telemetry?.rightPresent ? "present" : "absent"} ·{" "}
              {recheckReport.applicationLivenessVerified
                ? "both applications verified"
                : "application liveness pending"}
            </div>
          ) : null}
          <div className="boundary-evidence">
            <div className="is-confirmed">
              <span>CASE MCU</span>
              <strong>USB ROM loader verified</strong>
            </div>
            <div className="is-confirmed">
              <span>RUNNING TEMPLE</span>
              <strong>Reviewed read-only pogo bridge available</strong>
            </div>
            <div className="is-confirmed">
              <span>POGO OTA</span>
              <strong>Pinned main writer enabled</strong>
            </div>
            <div className="is-blocked">
              <span>APPLICATION-DEAD TEMPLE</span>
              <strong>SBL requires matching INFOC + active INFO0</strong>
            </div>
          </div>
          <div className="pogo-tool">
            <div className="pogo-tool-heading">
              <div>
                <div className="eyebrow">Volatile read-only bridge</div>
                <h3>Query a running temple through the Case</h3>
              </div>
              <StatusPill tone="success">Pinned SHA-256 · SRAM only</StatusPill>
            </div>
            <p>
              Loads the physically reviewed 1,720-byte bridge into high Case SRAM,
              emits one embedded status or version request, verifies exact YHM route
              restoration, clears the retained proof/result, and returns to stock Case
              firmware. Arbitrary bytes and OTA commands are absent from the payload.
            </p>
            <div className="pogo-controls">
              <label>
                Temple route
                <select
                  value={pogoRoute}
                  onChange={(event) => {
                    setPogoRoute(event.target.value);
                    setPogoConfirm(false);
                  }}
                  disabled={Boolean(operation)}
                >
                  <option value="left">Left temple</option>
                  <option value="right">Right temple</option>
                </select>
              </label>
              <label>
                Read-only request
                <select
                  value={pogoOperation}
                  onChange={(event) => {
                    setPogoOperation(event.target.value);
                    setPogoConfirm(false);
                  }}
                  disabled={Boolean(operation)}
                >
                  <option value="version">Firmware + hardware version</option>
                  <option value="status">Battery + voltage status</option>
                </select>
              </label>
              <Button
                tone="secondary"
                onClick={probeRunningTemple}
                busy={operation === "pogo"}
                disabled={
                  !report ||
                  !selectedTemplePresent ||
                  !pogoConfirm ||
                  Boolean(operation)
                }
              >
                Run read-only probe
              </Button>
              <label className="pogo-confirm">
                <input
                  type="checkbox"
                  checked={pogoConfirm}
                  onChange={(event) => setPogoConfirm(event.target.checked)}
                  disabled={!report || !selectedTemplePresent || Boolean(operation)}
                />
                <span>
                  I confirm the {pogoRoute} temple is seated and will leave the Case
                  connected while the reviewed bridge runs.
                </span>
              </label>
              {report && !selectedTemplePresent ? (
                <small className="pogo-presence-warning">
                  The latest Case telemetry does not report this temple as present.
                  Refresh analysis after seating it.
                </small>
              ) : null}
            </div>
            <div className="pogo-results">
              <TempleProbeResult side="Left" results={pogoResults.left} />
              <TempleProbeResult side="Right" results={pogoResults.right} />
            </div>
            <small className="pogo-safety-note">
              A non-idle charging route is rejected before temple transmission. Wait
              for stock charging activity to settle, then retry if status 3 is reported.
              The payload and protocol are physically verified; this Web Serial port
              remains experimental until exercised on G2 hardware.
            </small>
          </div>
          <div className="transfer-research">
            <div className="pogo-tool-heading">
              <div>
                <div className="eyebrow">Validated recovery evidence</div>
                <h3>Successful Case-to-Glasses transfer record</h3>
              </div>
              <StatusPill tone={firmware?.templeFlashEligible ? "success" : "quiet"}>
                {firmware?.templeFlashEligible
                  ? firmware.templeFlashTarget?.hardwareValidated
                    ? "Transfer validated"
                    : "Hash pinned"
                  : "Load a pinned image"}
              </StatusPill>
            </div>
            <p>
              The physically validated Case-USB bridge uses the running
              application’s 0x52–0x55 path. This evidence sits below the recovery
              controls so the writer’s allowlist, hardware results, and known
              failure boundary stay visible alongside the diagnostic tools.
            </p>
            <div className="transfer-facts">
              <div>
                <span>DIRECT UART HOST</span>
                <strong>
                  {POGO_TRANSFER_RESEARCH.directTempleHost.offlineTestsPassed}/
                  {POGO_TRANSFER_RESEARCH.directTempleHost.offlineTestsPassed} offline
                  tests pass
                </strong>
              </div>
              <div>
                <span>TRANSFER ALLOWLIST</span>
                <strong>{POGO_TRANSFER_RESEARCH.directTempleHost.component}</strong>
              </div>
              <div>
                <span>CASE-USB ATTEMPTS</span>
                <strong>
                  {POGO_TRANSFER_RESEARCH.caseUsbBridge.attempts}
                  {" · "}
                  {POGO_TRANSFER_RESEARCH.caseUsbBridge.completeWiredTransfers}
                  {" complete wired"}
                </strong>
              </div>
              <div>
                <span>VERIFIED EACH ROUTE</span>
                <strong>
                  {POGO_TRANSFER_RESEARCH.caseUsbBridge.successfulTransfers.right.payloadBytes.toLocaleString()}
                  {" B · "}
                  {POGO_TRANSFER_RESEARCH.caseUsbBridge.successfulTransfers.right.recordsSent.toLocaleString()}
                  {" records each"}
                </strong>
              </div>
              <div>
                <span>CURRENT BRIDGE GATE</span>
                <strong>
                  {POGO_TRANSFER_RESEARCH.caseUsbBridge.hardwareAttemptsWithCurrentSource}
                  {" hardware runs · "}
                  {POGO_TRANSFER_RESEARCH.caseUsbBridge.observedBytes.toLocaleString()} B
                </strong>
              </div>
              <div>
                <span>OFFICIAL LEFT FALLBACK</span>
                <strong>
                  {POGO_TRANSFER_RESEARCH.caseUsbBridge.officialRestore.left.blockAcks.toLocaleString()}
                  {" BLE ACKs · "}
                  {POGO_TRANSFER_RESEARCH.caseUsbBridge.officialRestore.left.fullPackageComponents}
                  {" components"}
                </strong>
              </div>
            </div>
            <a
              className="button button-secondary transfer-recovery-link"
              href="#smart-glasses-recovery"
            >
              Open Smart Glasses recovery
            </a>
            <small className="transfer-warning">
              Attempt 6 sent all 3,540 data records without retry, received the finish
              acknowledgement, verified 2.2.6.10/hardware 5 after reboot, restored all
              ten YHM registers, and resumed Case firmware 1.2.57. Because stock and
              reviewed CFW share the same version string, the exact input and main
              payload SHA-256 pins remain essential provenance. Attempt 7 rejected the
              left route at status 3 before any firmware transmission. Attempt 8 then
              accepted 2,733,000 left-temple bytes before an explicit 0x54 status-1
              rejection; all ten route registers and Case firmware 1.2.57 were restored.
              That historical host retried the exact record because a rejection did not
              advance the expected sequence. Current V7 policy replays no DATA record;
              it requires exact cleanup, bilateral reset/liveness, and a fresh complete
              component START. Attempt 9 subsequently completed
              the left transfer with all 3,540 records, zero retries, finish and
              postflight confirmation, full route restoration, and Case-app return. This
              browser port preserves those same gates. A later recovery session found
              GLS_L=0/GLS_R=1 with no left application reply; the traced dual-route reset
              restored both contacts, a checksum-valid left 2.2.6.10/hardware-5 reply,
              and both displays without transmitting firmware. A later interrupted
              85,000-byte official left run left the wired product-test service in a state
              where fresh START requests returned no frame and retained zero declared and
              accepted bytes. That signature now stops wired retries. A fresh BLE session
              then installed all six pinned stock components with 1,053 block ACKs, six
              END status-8 verifications, zero resends, and all 861 main blocks before the
              final bilateral reset verified both temples. Restore audits therefore
              require that reset and liveness phase last. The V4 bridge then completed
              all 3,523,396 pinned Stock bytes on the right with FINISH, postflight,
              route restoration, and Case-app return. Its longer bounded DATA-reply
              window crossed the former 829,000/840,000-byte host timeout boundary. A
              left V4 retry stopped at 823,000 accepted bytes without FINISH, so it did
              not replace the previously proven six-component Stock installation. The
              hosted V7 cycle then completed the reviewed CFW main on left after bounded
              reset-gated whole-component restarts. A right-only V7 repair accepted all
              3,540 CFW records and FINISH, proved postflight and route restoration,
              returned Case 1.2.57, and ended with bilateral DEB0 plus checksum-valid
              replies from both temples.
              Retain every downloaded audit and treat any interrupted result as failed or
              uncertain.
            </small>
          </div>
          <div className="sbl-audit">
            <div className="pogo-tool-heading">
              <div>
                <div className="eyebrow">Offline dead-temple candidate</div>
                <h3>Decode Apollo510 recovery provisioning</h3>
              </div>
              <StatusPill tone="quiet">Local files · read-only</StatusPill>
            </div>
            <p>
              Inspect debugger dumps without contacting or writing a temple. INFOC must
              begin at 0x400C2000; active INFO0 begins at offset zero. The decoder checks
              the exact UART enable/module, 1-Mbaud 8N1 framing, GPIO44/RX,
              GPIO42/TX, pin functions, receive window, override, and MRAM-recovery
              controls recovered by SybilSight.
            </p>
            <div className="sbl-upload-grid">
              <label>
                <span>INFOC · at least 0x400 bytes</span>
                <input
                  type="file"
                  accept=".bin,.dump,application/octet-stream"
                  onChange={(event) => loadRecoveryDump("infoc", event)}
                />
                <strong>{recoveryDumps.infoc?.name ?? "Choose debugger dump"}</strong>
              </label>
              <label>
                <span>Active INFO0 · at least 0x6C bytes</span>
                <input
                  type="file"
                  accept=".bin,.dump,application/octet-stream"
                  onChange={(event) => loadRecoveryDump("info0", event)}
                />
                <strong>{recoveryDumps.info0?.name ?? "Choose debugger dump"}</strong>
              </label>
              {recoveryConfig ? (
                <Button tone="ghost" onClick={clearRecoveryDumps}>
                  Clear dumps
                </Button>
              ) : null}
            </div>
            {recoveryConfigError ? (
              <small className="sbl-error">{recoveryConfigError}</small>
            ) : null}
            <RecoveryConfigResult report={recoveryConfig} />
            <small className="pogo-safety-note">
              A positive match makes the protected Ambiq SBL a restoration candidate;
              it does not prove retail image authorization, provide a backup, or enable
              any write control in this webflasher.
            </small>
          </div>
        </section>


        </div>
        <footer className={cx("footer", progress.visible && "has-task")}>
          <div className="footer-meta">
            <span>
              Sybil Sight™ · G2 WebFlasher {WEBFLASHER_BUILD_LABEL} ·{" "}
              {selectedTransport}
            </span>
            <span>
              Device data stays local unless the person explicitly starts remote support.
            </span>
          </div>
          <TaskProgress
            progress={progress}
            wakeLockStatus={wakeLockStatus}
          />
        </footer>
      </main>

      <Console
        open={consoleOpen}
        entries={logs}
        onClose={() => setConsoleOpen(false)}
        onClear={clearConsole}
        onDownload={downloadConsoleTranscript}
      />
      <RemoteSupportDialog
        open={supportOpen}
        onClose={() => setSupportOpen(false)}
        mode={supportMode}
        onModeChange={setSupportMode}
        state={supportState}
        supportCode={supportCode}
        onSupportCodeChange={setSupportCode}
        operatorKey={supportOperatorKey}
        onOperatorKeyChange={setSupportOperatorKey}
        deviceReady={Boolean(report && portRef.current)}
        transport={selectedTransport}
        events={supportEvents}
        onStartDevice={startRemoteSupport}
        onJoinOperator={joinRemoteSupport}
        onStop={stopRemoteSupport}
        onOpenRemoteCase={openRemoteSupportCase}
      />
    </div>
  );
}

export default App;
