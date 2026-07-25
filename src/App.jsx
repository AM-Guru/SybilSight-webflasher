import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FLASH_BASE,
  OPTION_BASE,
  POGO_TRANSFER_RESEARCH,
  bytesToBase64,
  formatBytes,
  hex,
  hexBytes,
  parseFirmwareInput,
} from "./lib/firmware.js";
import {
  G2CaseSession,
  requestG2CasePort,
  webSerialSupported,
} from "./lib/serial.js";
import { decodeApollo510RecoveryConfig } from "./lib/recoveryConfig.js";

const EMPTY_PROGRESS = { fraction: 0, detail: "Ready", visible: false };

function cx(...values) {
  return values.filter(Boolean).join(" ");
}

function Icon({ name }) {
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

function StepRail({ complete }) {
  const steps = [
    ["connect", "Connect", "USB Serial"],
    ["analyze", "Analyze", "Status + banks"],
    ["backup", "Preserve", "Full case backup"],
    ["firmware", "Choose image", "CDN or local file"],
    ["recover", "Recover", "Stage, verify, activate"],
  ];
  return (
    <nav className="step-rail" aria-label="Recovery workflow">
      {steps.map(([key, title, detail], index) => (
        <a
          href={`#${key}`}
          className={cx("step-link", complete[key] && "is-complete")}
          key={key}
        >
          <span className="step-number">
            {complete[key] ? <Icon name="check" /> : String(index + 1).padStart(2, "0")}
          </span>
          <span>
            <strong>{title}</strong>
            <small>{detail}</small>
          </span>
        </a>
      ))}
    </nav>
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
            <h2 id="console-title">Recovery console</h2>
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

function App() {
  const [report, setReport] = useState(null);
  const [backup, setBackup] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [catalogState, setCatalogState] = useState("loading");
  const [selectedReleaseId, setSelectedReleaseId] = useState("");
  const [firmware, setFirmware] = useState(null);
  const [staged, setStaged] = useState(null);
  const [progress, setProgress] = useState(EMPTY_PROGRESS);
  const [operation, setOperation] = useState(null);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [confirmBackup, setConfirmBackup] = useState(false);
  const [recheckReport, setRecheckReport] = useState(null);
  const [pogoResults, setPogoResults] = useState({});
  const [pogoRoute, setPogoRoute] = useState("left");
  const [pogoOperation, setPogoOperation] = useState("version");
  const [pogoConfirm, setPogoConfirm] = useState(false);
  const [templeFlashRoute, setTempleFlashRoute] = useState("both");
  const [templeFlashSeated, setTempleFlashSeated] = useState(false);
  const [templeFlashRisk, setTempleFlashRisk] = useState(false);
  const [templeFlashText, setTempleFlashText] = useState("");
  const [templeFlashAudit, setTempleFlashAudit] = useState(null);
  const [recoveryDumps, setRecoveryDumps] = useState({});
  const [recoveryConfig, setRecoveryConfig] = useState(null);
  const [recoveryConfigError, setRecoveryConfigError] = useState("");
  const portRef = useRef(null);
  const sessionRef = useRef(null);

  const addLog = useCallback((message, tone = "info") => {
    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setLogs((current) => [...current.slice(-299), { time, message, tone }]);
  }, []);

  const setSessionProgress = useCallback((fraction, detail) => {
    setProgress({ fraction: Math.max(0, Math.min(1, fraction)), detail, visible: true });
  }, []);

  const getSession = useCallback(
    (port = portRef.current) => {
      if (!port) throw new Error("Connect the G2 case first.");
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
        const latestOfficial = releases.find(
          (release) => release.channel === "official",
        );
        setSelectedReleaseId((latestOfficial ?? releases[0])?.id ?? "");
        setCatalogState("ready");
      })
      .catch(() => {
        if (active) setCatalogState("offline");
      });
    return () => {
      active = false;
    };
  }, []);

  const run = useCallback(async (name, task) => {
    setOperation(name);
    setError("");
    setProgress({ fraction: 0, detail: "Starting…", visible: true });
    try {
      return await task();
    } catch (caught) {
      const message = caught?.message || String(caught);
      setError(message);
      addLog(message, "error");
      return null;
    } finally {
      setOperation(null);
      setTimeout(() => setProgress((value) => ({ ...value, visible: false })), 1400);
    }
  }, [addLog]);

  const connectAndAnalyze = async () => {
    await run("analyze", async () => {
      addLog("Waiting for a G2 case USB Serial selection.");
      const port = await requestG2CasePort();
      portRef.current = port;
      sessionRef.current = null;
      addLog("G2 case serial interface selected.");
      const result = await getSession(port).analyze();
      setReport(result);
      setBackup(null);
      setStaged(null);
      setPogoResults({});
      setPogoConfirm(false);
      setTempleFlashAudit(null);
      addLog("Analysis complete. No device memory was changed.", "success");
    });
  };

  const reanalyze = async () => {
    await run("analyze", async () => {
      const result = await getSession().analyze();
      setReport(result);
      setBackup(null);
      setStaged(null);
      setPogoResults({});
      setPogoConfirm(false);
      setTempleFlashAudit(null);
      addLog("Fresh analysis complete.", "success");
    });
  };

  const createBackup = async () => {
    await run("backup", async () => {
      const result = await getSession().backup();
      const artifact = {
        schemaVersion: 1,
        device: "Even Realities G2 charging case",
        createdAt: new Date().toISOString(),
        flashBase: hex(FLASH_BASE),
        flashSize: result.flash.length,
        flashSha256: result.flashSha256,
        flashBase64: bytesToBase64(result.flash),
        optionBase: hex(OPTION_BASE),
        optionSize: result.optionBytes.length,
        optionSha256: result.optionSha256,
        optionBytesBase64: bytesToBase64(result.optionBytes),
        caseVersion: report?.console?.caseVersion ?? report?.banks?.active?.version,
        caseSerial: report?.console?.serialNumber,
        factoryIdentifier: report?.console?.identifier,
        activePhysicalBank: report?.options?.activePhysicalBank,
      };
      const nameVersion = artifact.caseVersion ?? "unknown";
      downloadBlob(
        new Blob([`${JSON.stringify(artifact, null, 2)}\n`], {
          type: "application/json",
        }),
        `g2-case-${nameVersion}-${new Date().toISOString().slice(0, 10)}.g2case-backup.json`,
      );
      setBackup({ ...result, artifact });
      addLog("Full case backup downloaded and retained for this session.", "success");
    });
  };

  const acceptFirmware = async (bytes, fileName, expected) => {
    const parsed = await parseFirmwareInput(bytes, fileName);
    if (expected) {
      if (parsed.fileSize !== expected.size) {
        throw new Error("The mirrored firmware size does not match its catalog.");
      }
      if (parsed.fileSha256 !== expected.sha256) {
        throw new Error("The mirrored firmware SHA-256 does not match its catalog.");
      }
    }
    const accepted = expected
      ? {
          ...parsed,
          provenance: {
            ...parsed.provenance,
            channel: expected.channel,
            trust: expected.trust ?? parsed.provenance.trust,
            label:
              expected.channel === "custom"
                ? `Reviewed CFW · stock ${expected.baseVersion} base`
                : `Official G2 ${expected.version} · archived SHA-256`,
            capabilities:
              expected.capabilities ?? parsed.provenance.capabilities ?? [],
          },
          caseRecoveryEligible:
            expected.caseRecoveryEligible ?? parsed.caseRecoveryEligible,
          catalogRelease: expected,
        }
      : parsed;
    setFirmware(accepted);
    setStaged(null);
    setTempleFlashAudit(null);
    setTempleFlashText("");
    setTempleFlashSeated(false);
    setTempleFlashRisk(false);
    addLog(
      `Validated ${fileName} · ${accepted.provenance.label} · ${accepted.fileSha256.slice(0, 16)}…`,
      "success",
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
        `Loading archived ${release.channel === "custom" ? "reviewed CFW" : "official G2"} ${release.version}.`,
      );
      const response = await fetch(release.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Firmware archive returned HTTP ${response.status}.`);
      await acceptFirmware(
        new Uint8Array(await response.arrayBuffer()),
        release.fileName,
        release,
      );
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
      const result = await getSession().restartAndRecheck();
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
      addLog("Both seated temples were reset and stock presence checks resumed.", "success");
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

  const flashReviewedCfw = async () => {
    if (
      !firmware?.templeFlashEligible ||
      !templeFlashSeated ||
      !templeFlashRisk ||
      templeFlashText.trim().toUpperCase() !== "FLASH REVIEWED CFW"
    ) {
      return;
    }
    await run("temple-flash", async () => {
      try {
        const audit = await getSession().flashReviewedCfwMain(
          firmware,
          templeFlashRoute,
        );
        setTempleFlashAudit(audit);
        setTempleFlashText("");
        setTempleFlashSeated(false);
        setTempleFlashRisk(false);
        addLog(
          `Reviewed CFW main transfer completed on ${audit.routes.join(" + ")} with route restoration verified.`,
          "success",
        );
      } catch (caught) {
        if (caught?.audit) setTempleFlashAudit(caught.audit);
        throw caught;
      }
    });
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
      addLog("The staged case bank was activated and the case restarted.", "success");
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
    recover: Boolean(staged),
  };
  const telemetry = report?.console?.telemetry;
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
    templeFlashText.trim().toUpperCase() === "FLASH REVIEWED CFW" &&
    !operation
  );
  const canStage = Boolean(
    report && backup && firmware?.caseRecoveryEligible && !operation,
  );
  const activationReady =
    Boolean(staged) &&
    confirmBackup &&
    confirmText.trim().toUpperCase() === "ACTIVATE CASE BANK";
  const officialReleases = catalog.filter((item) => item.channel === "official");
  const latestOfficial = officialReleases[0];
  const customReleaseCount = catalog.filter((item) => item.channel === "custom").length;
  const selectedRelease = catalog.find((item) => item.id === selectedReleaseId);
  const serialSupported = webSerialSupported();
  const consoleText = useMemo(
    () => logs.map((entry) => `${entry.time}  ${entry.message}`).join("\n"),
    [logs],
  );

  return (
    <div className="app-shell">
      <div
        className={cx("global-progress", progress.visible && "is-visible")}
        aria-hidden={!progress.visible}
      >
        <span style={{ width: `${progress.fraction * 100}%` }} />
      </div>

      <aside className="sidebar">
        <a className="brand" href="#connect" aria-label="SybilSight G2 Recovery Console">
          <span className="brand-wordmark" aria-hidden="true">
            <strong>SYBIL</strong>
            <strong>SIGHT</strong>
          </span>
          <small>G2 WebFlasher</small>
        </a>
        <div className="sidebar-intro">
          <span className="hardware-label">DEVICE SERVICE · USB SERIAL</span>
          <h1>Recover with precision.<br />Protect every byte.</h1>
          <p>
            A guided, local-only console for the Even Realities G2 charging case.
          </p>
        </div>
        <StepRail complete={complete} />
        <div className="sidebar-foot">
          <span className={cx("support-dot", serialSupported && "is-supported")} />
          <span>
            {serialSupported ? "Web Serial ready" : "Chrome or Edge required"}
          </span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-status">
            <span className={cx("connection-dot", report && "is-connected")} />
            <span>{report ? "Case analyzed" : "No case connected"}</span>
            {operation ? <strong>{progress.detail}</strong> : null}
          </div>
          <button className="console-trigger" onClick={() => setConsoleOpen(true)}>
            <Icon name="terminal" />
            Console
            <span>{logs.length}</span>
          </button>
        </header>

        <OperationError error={error} onDismiss={() => setError("")} />

        <section className="hero" id="connect">
          <div className="hero-copy">
            <div className="eyebrow">Recovery console · Even Realities G2</div>
            <h2>
              Restore with precision.
              <br />
              Zero compromise.
            </h2>
            <p>
              Inspect the factory console and both STM32 banks, capture a complete
              device-specific backup, then stage and verify a recovery image before
              changing the active bank.
            </p>
            <div className="hero-actions">
              <Button
                onClick={connectAndAnalyze}
                busy={operation === "analyze"}
                disabled={!serialSupported || Boolean(operation)}
              >
                <Icon name="usb" />
                {report ? "Choose another case" : "Connect & analyze case"}
              </Button>
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
                This browser does not expose Web Serial. Open this page in current
                desktop Chrome or Edge.
              </p>
            ) : null}
          </div>
          <div className="hero-visual">
            <img
              className="hero-product-image"
              src="/even-g2-case-grey.png"
              alt="Even Realities G2 smart glasses in their charging case"
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

        <section className="content-section" id="analyze">
          <SectionHeading
            eyebrow="01 · Analyze"
            title="Case state at a glance"
            copy="Read-only A0/A2/A3/A4 factory queries plus ROM-level bank and option-byte inspection."
            action={
              report ? (
                <StatusPill tone="success">
                  <Icon name="check" /> Read-only pass complete
                </StatusPill>
              ) : (
                <StatusPill>Waiting for case</StatusPill>
              )
            }
          />
          {report ? (
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
                    Live case-link telemetry, not simple switches
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
          ) : (
            <div className="empty-panel">
              <Icon name="scan" />
              <strong>Connect the case to populate this analysis.</strong>
              <span>The first pass does not erase, write, or change option bytes.</span>
            </div>
          )}
        </section>

        <section className="boundary-section">
          <div className="boundary-mark"><Icon name="glasses" /></div>
          <div>
            <div className="eyebrow">Recovery boundary</div>
            <h2>The case can recover a running temple. Dead-temple recovery is not proven.</h2>
            <p>
              The traced B0 command can hardware-reset both seated temples, and the case
              reports when each application link returns. This console can also load the
              exact reviewed read-only SRAM bridge for checksum-valid status or version
              replies from either pogo route. Its hash-gated writer can install only the
              exact reviewed-CFW Apollo main on a running temple, with finish
              acknowledgement, post-reboot version, byte-for-byte route restoration,
              and normal case-app return required on every selected route.
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
          {recheckReport ? (
            <div className="recheck-result">
              <Icon name="check" />
              B0 reset confirmed · L {recheckReport.telemetry?.leftPresent ? "present" : "absent"} · R{" "}
              {recheckReport.telemetry?.rightPresent ? "present" : "absent"}
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
              <strong>Reviewed CFW main writer enabled</strong>
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
                <h3>Query a running temple through the case</h3>
              </div>
              <StatusPill tone="success">Pinned SHA-256 · SRAM only</StatusPill>
            </div>
            <p>
              Loads the physically reviewed 1,712-byte bridge into high case SRAM,
              emits one embedded status or version request, verifies exact YHM route
              restoration, clears the retained proof/result, and returns to stock case
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
                  I confirm the {pogoRoute} temple is seated and will leave the case
                  connected while the reviewed bridge runs.
                </span>
              </label>
              {report && !selectedTemplePresent ? (
                <small className="pogo-presence-warning">
                  The latest case telemetry does not report this temple as present.
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
                <div className="eyebrow">Guarded running-temple reinstall</div>
                <h3>Flash the exact reviewed CFW through the case.</h3>
              </div>
              <StatusPill tone={firmware?.templeFlashEligible ? "success" : "quiet"}>
                {firmware?.templeFlashEligible ? "Exact CFW validated" : "Load reviewed CFW"}
              </StatusPill>
            </div>
            <p>
              The browser now uses the physically validated case-USB bridge on the
              running application’s 0x52–0x55 path. It independently pins the 2,872-byte
              SRAM payload, complete CFW bundle, and Apollo-main payload; the bridge and
              host both reject the Apollo bootloader and every peripheral component.
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
                  {POGO_TRANSFER_RESEARCH.caseUsbBridge.attempts} · 2 complete
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
            </div>
            <div className="temple-flash-controls">
              <label>
                Temple route
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
              <div className="temple-flash-pins">
                <span>CFW BUNDLE SHA-256</span>
                <code>5c1539fd39c599e6035f6a8ec0779ba687c250d342a24c21a39952fed6c56aa0</code>
                <span>APOLLO MAIN SHA-256</span>
                <code>38dea7dc05e832e6f5aea8fa726454b2ec44055af5d456b323448ee6989e53d1</code>
              </div>
            </div>
            <div className="temple-flash-confirmations">
              <label className="pogo-confirm">
                <input
                  type="checkbox"
                  checked={templeFlashSeated}
                  onChange={(event) => setTempleFlashSeated(event.target.checked)}
                  disabled={!report || !flashRoutesPresent || Boolean(operation)}
                />
                <span>
                  I confirm the selected temple route{templeFlashRoute === "both" ? "s are" : " is"} seated
                  and I will not move the glasses, case, or USB cable.
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
                  I understand this is a single-slot application reinstall. It cannot
                  recover a temple whose Apollo application or pogo UART task is already dead.
                </span>
              </label>
              <label className="confirm-label" htmlFor="temple-flash-confirmation">
                Type <strong>FLASH REVIEWED CFW</strong>
              </label>
              <input
                id="temple-flash-confirmation"
                className="confirm-input"
                value={templeFlashText}
                onChange={(event) => setTempleFlashText(event.target.value)}
                placeholder="FLASH REVIEWED CFW"
                autoComplete="off"
                disabled={!firmware?.templeFlashEligible || Boolean(operation)}
              />
              <Button
                tone="danger"
                onClick={flashReviewedCfw}
                busy={operation === "temple-flash"}
                disabled={!templeFlashReady}
              >
                Flash reviewed CFW main
              </Button>
              {!firmware?.templeFlashEligible ? (
                <small className="pogo-presence-warning">
                  Load the exact reviewed 2.2.6.10 CFW bundle in “Choose image” to
                  enable this operation.
                </small>
              ) : report && !flashRoutesPresent ? (
                <small className="pogo-presence-warning">
                  Fresh analysis does not report every selected route as seated.
                </small>
              ) : null}
            </div>
            {templeFlashAudit ? (
              <div className={cx(
                "temple-flash-audit",
                templeFlashAudit.outcome === "success" && "is-success",
              )}>
                <div>
                  <strong>
                    {templeFlashAudit.outcome === "success"
                      ? "Transfer and restoration verified"
                      : "Stopped · state failed or uncertain"}
                  </strong>
                  <span>
                    {templeFlashAudit.routeResults
                      .map((item) => `${item.route}: ${item.outcome}`)
                      .join(" · ")}
                  </span>
                </div>
                <Button
                  tone="ghost"
                  onClick={() =>
                    downloadBlob(
                      new Blob([`${JSON.stringify(templeFlashAudit, null, 2)}\n`], {
                        type: "application/json",
                      }),
                      `g2-cfw-flash-${new Date().toISOString().replaceAll(":", "-")}.json`,
                    )
                  }
                >
                  Download audit
                </Button>
              </div>
            ) : null}
            <small className="transfer-warning">
              Attempt 6 sent all 3,540 data records without retry, received the finish
              acknowledgement, verified 2.2.6.10/hardware 5 after reboot, restored all
              ten YHM registers, and resumed case firmware 1.2.57. Because stock and
              reviewed CFW share the same version string, the exact input and main
              payload SHA-256 pins remain essential provenance. Attempt 7 rejected the
              left route at status 3 before any firmware transmission. Attempt 8 then
              accepted 2,733,000 left-temple bytes before an explicit 0x54 status-1
              rejection; all ten route registers and case firmware 1.2.57 were restored.
              The updated host safely retries that exact data record because a rejection
              does not advance the expected sequence. Attempt 9 subsequently completed
              the left transfer with all 3,540 records, zero retries, finish and
              postflight confirmation, full route restoration, and case-app return. This
              browser port preserves those same gates; until its Web Serial path receives
              an independent hardware run, retain the downloaded audit and treat any
              interrupted result as failed or uncertain.
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

        <section className="content-section" id="backup">
          <SectionHeading
            eyebrow="02 · Preserve"
            title="Back up before touching flash"
            copy="Captures all 512 KiB, both device-data regions, and the complete 128-byte option block into one local file."
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
                <i>+</i>
                <div className="option-block"><span>OPTIONS</span><b>128 B</b></div>
              </div>
              <div>
                <h3>Device-specific recovery backup</h3>
                <p>
                  Includes serial/provisioning regions that are not present in an
                  official OTA bundle. The downloaded file can contain device identifiers;
                  store it privately.
                </p>
                <Button
                  onClick={createBackup}
                  busy={operation === "backup"}
                  disabled={!report || Boolean(operation)}
                >
                  <Icon name="backup" />
                  {backup ? "Download a fresh backup" : "Back up full case"}
                </Button>
              </div>
            </article>
            <div className="backup-checklist">
              <div><Icon name="check" /><span><strong>Read-only acquisition</strong>256-byte ROM-loader blocks</span></div>
              <div><Icon name="check" /><span><strong>Integrity recorded</strong>SHA-256 for flash and options</span></div>
              <div><Icon name="check" /><span><strong>Application restored</strong>Returns to the normal case console</span></div>
              {backup ? (
                <div className="backup-digest">
                  <span>FLASH SHA-256</span>
                  <code>{backup.flashSha256}</code>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="content-section" id="firmware">
          <SectionHeading
            eyebrow="03 · Choose image"
            title="Official archive, reviewed CFW, or your own file"
            copy="Official bundles are pinned CDN copies. The CFW is the reviewed SybilSight transformation of stock 2.2.6.10; its exact Apollo-main payload now has verified case-USB transfers on both running temple routes."
            action={
              catalogState === "ready" ? (
                <StatusPill tone="quiet">
                  {officialReleases.length} official · {customReleaseCount} reviewed CFW
                </StatusPill>
              ) : (
                <StatusPill tone="warm">Archive {catalogState}</StatusPill>
              )
            }
          />
          <div className="firmware-layout">
            <article className="panel firmware-picker">
              <div className="source-tabs" aria-label="Firmware source">
                <span className="is-active">SybilSight verified library</span>
                <span>Official</span>
                <span>Reviewed CFW</span>
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
                      {release.channel === "custom" ? "Reviewed CFW" : "Official G2"}{" "}
                      {release.version} · case {release.caseVersion}
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
                    {selectedRelease.channel === "custom"
                      ? "Glasses CFW · analysis/download only"
                      : selectedRelease === latestOfficial
                        ? "Latest official"
                        : "Historical official"}
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
                  Official/CFW EVENOTA, firmware_box.bin, or validated raw case image
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
                      ? `G2 ${firmware.provenance.baseVersion ?? firmware.g2Version} CFW`
                      : `Case ${firmware.caseVersion}`}
                  </h3>
                  <p>
                    {firmware.kind === "bundle"
                      ? `${firmware.provenance.label}. The ${firmware.components.length}-component bundle passed outer CRC-32C, Apollo preamble/CRC/vector, case wrapper, and case vector checks.`
                      : "Validated standalone charging-case image."}
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
                      <strong>Reviewed CFW targets the glasses; do not stage it as case firmware.</strong>
                      <span>
                        Its case component is byte-identical to the stock 1.2.57 component.
                        The exact reviewed Apollo main payload has successful left- and
                        right-temple transfers through SybilSight’s volatile case bridge.
                        It is eligible only for the guarded running-temple writer above,
                        never for case-bank staging.
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
                        published it. Only its extracted case image is eligible here.
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

        <section className="content-section recovery-section" id="recover">
          <SectionHeading
            eyebrow="04 · Recover"
            title="Stage first. Activate only after readback."
            copy="The active bank remains untouched while the selected case image is written and byte-for-byte verified in the fallback bank."
          />
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
                  <li className={report ? "done" : ""}>Fresh case analysis</li>
                  <li className={backup ? "done" : ""}>Full private backup downloaded</li>
                  <li className={firmware?.caseRecoveryEligible ? "done" : ""}>
                    Case-recovery image validated
                  </li>
                </ul>
                {firmware && !firmware.caseRecoveryEligible ? (
                  <p className="preflight-blocked">
                    The reviewed CFW is authenticated, but it targets the G2 Apollo
                    application and cannot be staged through the case USB loader.
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
                  then resets the case. The write path is research-derived and has not
                  yet been physically exercised on a sacrificial G2 case.
                </p>
                <label className="confirm-check">
                  <input
                    type="checkbox"
                    checked={confirmBackup}
                    onChange={(event) => setConfirmBackup(event.target.checked)}
                    disabled={!staged || Boolean(operation)}
                  />
                  <span>I have stored the downloaded device-specific backup privately.</span>
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
        </section>

        <footer className="footer">
          <span>Sybil Sight™ · G2 WebFlasher · local Web Serial</span>
          <span>No device data is uploaded by this app.</span>
        </footer>
      </main>

      <Console
        open={consoleOpen}
        entries={logs}
        onClose={() => setConsoleOpen(false)}
        onClear={() => setLogs([])}
        onDownload={() =>
          downloadBlob(
            new Blob([`${consoleText}\n`], { type: "text/plain" }),
            `g2-recovery-${new Date().toISOString().replaceAll(":", "-")}.log`,
          )
        }
      />
    </div>
  );
}

export default App;
