import {
  EXPECTED_COMPONENTS,
  EXPECTED_COMPONENT_TYPES,
} from "./firmware.js";

export const G2_BLE_DATA_SERVICE =
  "00002760-08c2-11e1-9073-0e8ac72e1001";
export const G2_BLE_DATA_WRITE =
  "00002760-08c2-11e1-9073-0e8ac72e0001";
export const G2_BLE_DATA_NOTIFY =
  "00002760-08c2-11e1-9073-0e8ac72e0002";
export const G2_BLE_CONTROL_SERVICE =
  "00002760-08c2-11e1-9073-0e8ac72e5450";
export const G2_BLE_CONTROL_WRITE =
  "00002760-08c2-11e1-9073-0e8ac72e5401";
export const G2_BLE_CONTROL_NOTIFY =
  "00002760-08c2-11e1-9073-0e8ac72e5402";

export const G2_BLE_BLOCK_BYTES = 4096;
export const G2_BLE_ENVELOPE_CHUNK_BYTES = 232;
export const G2_BLE_BLOCK_ACK_TIMEOUT_MS = 4000;
export const G2_BLE_CONTROL_ACK_TIMEOUT_MS = 8000;
export const G2_BLE_HEARTBEAT_INTERVAL_MS = 12000;
export const G2_BLE_BLOCK_NAK_ATTEMPTS = 3;
export const G2_BLE_COMPONENT_ATTEMPTS = 3;
export const G2_BLE_REBOOT_SETTLE_MS = 2500;
export const G2_BLE_RECONNECT_INTERVAL_MS = 2500;
export const G2_BLE_RECONNECT_ATTEMPTS = 8;
export const G2_BLE_TARGET_PROOF_MAX_AGE_MS = 15 * 60 * 1000;

export const G2_BLE_OTA_STATUS = Object.freeze({
  0: "SUCCESS",
  1: "HEADER_ERR",
  2: "PATH_ERR",
  3: "CRC_ERR",
  4: "TIMEOUT",
  5: "NO_RESOURCES",
  6: "FLASH_WRITE_ERR",
  7: "CHECK_FAIL",
  8: "UPDATING",
  9: "SYS_RESTART",
  10: "FAIL",
});

const END_OK = new Set([0, 8, 9]);
const HEARTBEAT_PAYLOAD = Uint8Array.from([
  0x08, 0x0e, 0x10, 0x26, 0x6a, 0x00,
]);

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return Uint8Array.from(input ?? []);
}

function concatBytes(...parts) {
  const normalized = parts.map(asBytes);
  const output = new Uint8Array(
    normalized.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of normalized) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function crc16CcittFalse(input) {
  let crc = 0xffff;
  for (const byte of asBytes(input)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc =
        crc & 0x8000
          ? ((crc << 1) ^ 0x1021) & 0xffff
          : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function makeBleEnvelopeFrames(
  sid,
  payload,
  { sequence, flag = 0 } = {},
) {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xff) {
    throw new Error("A one-byte G2 BLE transport sequence is required.");
  }
  const pb = asBytes(payload);
  const crc = crc16CcittFalse(pb);
  const body = concatBytes(pb, [crc & 0xff, (crc >>> 8) & 0xff]);
  const totalFragments = Math.max(
    1,
    Math.ceil(body.length / G2_BLE_ENVELOPE_CHUNK_BYTES),
  );
  const frames = [];
  for (let index = 0; index < totalFragments; index += 1) {
    const chunk = body.subarray(
      index * G2_BLE_ENVELOPE_CHUNK_BYTES,
      (index + 1) * G2_BLE_ENVELOPE_CHUNK_BYTES,
    );
    frames.push(
      concatBytes(
        [
          0xaa,
          0x21,
          sequence,
          chunk.length,
          totalFragments,
          index + 1,
          sid,
          flag,
        ],
        chunk,
      ),
    );
  }
  return frames;
}

export function makeBleControlFrames(opcode, data, sequence) {
  return makeBleEnvelopeFrames(
    0xc0,
    concatBytes([opcode], data ?? []),
    { sequence },
  );
}

export function parseBleAck(input) {
  const frame = asBytes(input);
  if (
    frame.length < 10 ||
    frame[0] !== 0xaa ||
    frame[1] !== 0x12
  ) {
    return null;
  }
  const frameLength = frame[3];
  const payloadLength = Math.max(0, frameLength - 2);
  if (frame.length < 8 + payloadLength) return null;
  const payload = frame.slice(8, 8 + payloadLength);
  return {
    sequence: frame[2],
    sid: frame[6],
    flag: frame[7],
    payload,
    opcode: payload[0] ?? null,
    status: payload[1] ?? null,
  };
}

export function g2BleStatusName(status) {
  return G2_BLE_OTA_STATUS[status] ?? `0x${Number(status)
    .toString(16)
    .padStart(2, "0")}`;
}

export function g2BleSupported(bluetooth = globalThis.navigator?.bluetooth) {
  return Boolean(bluetooth?.requestDevice);
}

export function g2BleDeviceSide(name) {
  const normalized = String(name ?? "").trim().toUpperCase();
  if (!/^(?:EVEN\s+)?G2(?:[\s_-]|$)/.test(normalized)) return null;
  const markers = [
    ...normalized.matchAll(
      /(?:^|[\s_-])(LEFT|RIGHT|L|R)(?=[\s_-]|$)/g,
    ),
  ].map((match) =>
    ["LEFT", "L"].includes(match[1]) ? "left" : "right",
  );
  const unique = [...new Set(markers)];
  return unique.length === 1 ? unique[0] : null;
}

export function g2BleTargetVersionProof(
  routeResults,
  targetVersion,
  {
    now = Date.now(),
    maxAgeMs = G2_BLE_TARGET_PROOF_MAX_AGE_MS,
  } = {},
) {
  const version = routeResults?.version;
  const observedAt = Date.parse(version?.observedAt ?? "");
  const ageMs = now - observedAt;
  return Boolean(
    targetVersion &&
      !routeResults?.lastProbeFailure &&
      version?.decoded?.firmwareVersion === targetVersion &&
      version?.transportProof?.restoredMask === 0x3ff &&
      Number.isFinite(observedAt) &&
      ageMs >= 0 &&
      ageMs <= maxAgeMs,
  );
}

export async function requestG2BleDevice(
  side,
  bluetooth = globalThis.navigator?.bluetooth,
) {
  if (!["left", "right"].includes(side)) {
    throw new Error("Choose the left or right G2 temple.");
  }
  if (!g2BleSupported(bluetooth)) {
    throw new Error(
      "Web Bluetooth is unavailable. Open the WebFlasher in current Chrome.",
    );
  }
  const device = await bluetooth.requestDevice({
    // G2 names put the side marker after a model-variant token
    // (for example Even G2_32_L_…), so Web Bluetooth's prefix-only
    // chooser filter cannot express the side safely. Narrow the chooser to
    // G2 name prefixes, request access to only the two required services,
    // then enforce one explicit matching side marker on the returned device.
    filters: [
      { namePrefix: "Even G2" },
      { namePrefix: "G2_" },
    ],
    optionalServices: [
      G2_BLE_DATA_SERVICE,
      G2_BLE_CONTROL_SERVICE,
    ],
  });
  const observedSide = g2BleDeviceSide(device?.name);
  if (observedSide !== side) {
    device?.gatt?.disconnect();
    throw new Error(
      observedSide
        ? `Select the ${side} temple. Chrome returned ${JSON.stringify(device?.name ?? "unnamed G2")}, which identifies the ${observedSide} temple. The ${side} pairing accepts only an explicit ${side}-side name.`
        : `Select the ${side} temple. Chrome returned ${JSON.stringify(device?.name ?? "unnamed G2")} without one unambiguous Left/Right marker. The ${side} pairing accepts only a G2 device whose advertised name explicitly identifies the ${side} side.`,
    );
  }
  return device;
}

export function assertPinnedG2BleBundle(firmware) {
  if (
    !firmware?.templeFlashEligible ||
    !firmware?.templeFlashTarget ||
    firmware.fileSha256 !== firmware.templeFlashTarget.imageSha256
  ) {
    throw new Error(
      "Direct Bluetooth recovery is restricted to an exact hash-pinned G2 temple bundle.",
    );
  }
  const components = firmware.componentImages;
  if (!Array.isArray(components) || components.length !== EXPECTED_COMPONENTS.length) {
    throw new Error(
      `Direct Bluetooth recovery requires the complete ${EXPECTED_COMPONENTS.length}-component G2 package.`,
    );
  }
  for (const [index, component] of components.entries()) {
    if (
      component?.name !== EXPECTED_COMPONENTS[index] ||
      component?.typeId !== EXPECTED_COMPONENT_TYPES[index] ||
      !(component.header instanceof Uint8Array) ||
      component.header.length !== 128 ||
      !(component.payload instanceof Uint8Array) ||
      component.payload.length !== component.payloadSize
    ) {
      throw new Error(
        `G2 Bluetooth component ${index + 1} does not match the reviewed package topology.`,
      );
    }
  }
  return firmware;
}

export class G2BleOtaError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "G2BleOtaError";
    Object.assign(this, details);
  }
}

export class G2BleOtaSession {
  constructor(
    device,
    {
      side,
      log = () => {},
      progress = () => {},
      blockAckTimeoutMs = G2_BLE_BLOCK_ACK_TIMEOUT_MS,
      controlAckTimeoutMs = G2_BLE_CONTROL_ACK_TIMEOUT_MS,
      heartbeatIntervalMs = G2_BLE_HEARTBEAT_INTERVAL_MS,
      blockNakAttempts = G2_BLE_BLOCK_NAK_ATTEMPTS,
      componentAttempts = G2_BLE_COMPONENT_ATTEMPTS,
      componentRetrySettleMs = 1500,
      rebootSettleMs = G2_BLE_REBOOT_SETTLE_MS,
      reconnectIntervalMs = G2_BLE_RECONNECT_INTERVAL_MS,
      reconnectAttempts = G2_BLE_RECONNECT_ATTEMPTS,
    } = {},
  ) {
    this.device = device;
    this.side = side;
    this.log = log;
    this.progress = progress;
    this.blockAckTimeoutMs = blockAckTimeoutMs;
    this.controlAckTimeoutMs = controlAckTimeoutMs;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.blockNakAttempts = blockNakAttempts;
    this.componentAttempts = componentAttempts;
    this.componentRetrySettleMs = componentRetrySettleMs;
    this.rebootSettleMs = rebootSettleMs;
    this.reconnectIntervalMs = reconnectIntervalMs;
    this.reconnectAttempts = reconnectAttempts;
    this.sequence = 0;
    this.ackQueue = [];
    this.ackWaiters = [];
    this.writeTail = Promise.resolve();
    this.heartbeatTimer = null;
    this.heartbeatError = null;
    this.dataNotifyHandler = (event) => {
      const value = event?.target?.value;
      const ack = parseBleAck(value);
      if (!ack || ack.opcode === null || ack.status === null) return;
      const waiterIndex = this.ackWaiters.findIndex(
        (waiter) => waiter.opcode === ack.opcode,
      );
      if (waiterIndex >= 0) {
        const [waiter] = this.ackWaiters.splice(waiterIndex, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(ack.status);
      } else {
        this.ackQueue.push(ack);
      }
    };
  }

  nextSequence() {
    this.sequence = (this.sequence + 1) & 0xff;
    return this.sequence;
  }

  drainAcks() {
    this.ackQueue = [];
  }

  async connect() {
    if (!this.device?.gatt) {
      throw new G2BleOtaError(`The selected ${this.side} temple has no GATT interface.`);
    }
    this.server = this.device.gatt.connected
      ? this.device.gatt
      : await this.device.gatt.connect();
    // Keep discovery and CCCD writes strictly serialized. CoreBluetooth
    // occasionally surfaces concurrent Web Bluetooth GATT operations as
    // "operation already in progress" even though the services are unrelated.
    const dataService = await this.server.getPrimaryService(
      G2_BLE_DATA_SERVICE,
    );
    const controlService = await this.server.getPrimaryService(
      G2_BLE_CONTROL_SERVICE,
    );
    this.dataWrite = await dataService.getCharacteristic(G2_BLE_DATA_WRITE);
    this.dataNotify = await dataService.getCharacteristic(G2_BLE_DATA_NOTIFY);
    this.controlWrite = await controlService.getCharacteristic(
      G2_BLE_CONTROL_WRITE,
    );
    this.controlNotify = await controlService.getCharacteristic(
      G2_BLE_CONTROL_NOTIFY,
    );
    this.dataNotify.addEventListener(
      "characteristicvaluechanged",
      this.dataNotifyHandler,
    );
    await this.dataNotify.startNotifications();
    await this.controlNotify.startNotifications();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    this.drainAcks();
    this.log(
      `${this.side}: direct Bluetooth OTA services and notifications are ready.`,
      "success",
    );
  }

  async disconnect() {
    this.stopHeartbeat();
    for (const waiter of this.ackWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(
        new G2BleOtaError(`${this.side}: Bluetooth OTA session closed.`),
      );
    }
    try {
      this.dataNotify?.removeEventListener(
        "characteristicvaluechanged",
        this.dataNotifyHandler,
      );
      await this.dataNotify?.stopNotifications();
    } catch {
      // A successful OTA commonly reboots the temple before cleanup.
    }
    try {
      await this.controlNotify?.stopNotifications();
    } catch {
      // A successful OTA commonly reboots the temple before cleanup.
    }
    try {
      this.device?.gatt?.disconnect();
    } catch {
      // The device may already have rebooted and disconnected.
    }
  }

  waitForAck(opcode, timeoutMs) {
    const queuedIndex = this.ackQueue.findIndex(
      (ack) => ack.opcode === opcode,
    );
    if (queuedIndex >= 0) {
      const [ack] = this.ackQueue.splice(queuedIndex, 1);
      return Promise.resolve(ack.status);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        opcode,
        resolve,
        reject,
        timer: null,
      };
      waiter.timer = setTimeout(() => {
        const index = this.ackWaiters.indexOf(waiter);
        if (index >= 0) this.ackWaiters.splice(index, 1);
        reject(
          new G2BleOtaError(
            `${this.side}: no Bluetooth OTA acknowledgement for opcode 0x${opcode
              .toString(16)
              .padStart(2, "0")}.`,
            { code: "ACK_TIMEOUT", opcode },
          ),
        );
      }, timeoutMs);
      this.ackWaiters.push(waiter);
    });
  }

  writeFrames(characteristic, frames) {
    const operation = this.writeTail
      .catch(() => {})
      .then(async () => {
        for (const frame of frames) {
          if (typeof characteristic.writeValueWithoutResponse === "function") {
            await characteristic.writeValueWithoutResponse(frame);
          } else {
            await characteristic.writeValue(frame);
          }
        }
      });
    this.writeTail = operation;
    return operation;
  }

  async sendControl(opcode, data = new Uint8Array(), timeoutMs) {
    this.drainAcks();
    const frames = makeBleControlFrames(
      opcode,
      data,
      this.nextSequence(),
    );
    await this.writeFrames(this.dataWrite, frames);
    return this.waitForAck(
      opcode,
      timeoutMs ?? this.controlAckTimeoutMs,
    );
  }

  async sendBlock(block) {
    const sequence = this.nextSequence();
    const frames = [
      ...makeBleControlFrames(0x02, new Uint8Array(), sequence),
      ...makeBleEnvelopeFrames(0xc1, block, { sequence }),
    ];
    this.drainAcks();
    await this.writeFrames(this.dataWrite, frames);
    return this.waitForAck(0x02, this.blockAckTimeoutMs);
  }

  startHeartbeat() {
    this.heartbeatError = null;
    this.heartbeatTimer = setInterval(() => {
      const frames = makeBleEnvelopeFrames(0x80, HEARTBEAT_PAYLOAD, {
        sequence: this.nextSequence(),
      });
      void this.writeFrames(this.controlWrite, frames).catch((error) => {
        this.heartbeatError ??= error;
      });
    }, this.heartbeatIntervalMs);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  async settleFinalUpdate(endStatus) {
    this.stopHeartbeat();
    // A heartbeat may already be queued behind the final END write. Let that
    // queue settle before deciding whether its failure was the expected reboot.
    await this.writeTail.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, this.rebootSettleMs));

    if (this.device?.gatt?.connected) {
      this.heartbeatError = null;
      this.log(
        `${this.side}: final END ${endStatus} (${g2BleStatusName(endStatus)}) completed and the Bluetooth link remained live.`,
        "success",
      );
      return {
        expectedReboot: true,
        reconnected: false,
        linkRemainedLive: true,
      };
    }

    this.log(
      `${this.side}: final END ${endStatus} (${g2BleStatusName(endStatus)}) triggered the expected temple reboot; waiting for the selected device to advertise again.`,
      "warn",
    );
    let lastError = this.heartbeatError;
    this.heartbeatError = null;
    this.writeTail = Promise.resolve();
    for (let attempt = 1; attempt <= this.reconnectAttempts; attempt += 1) {
      if (attempt > 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.reconnectIntervalMs),
        );
      }
      try {
        await this.connect();
        this.log(
          `${this.side}: the temple returned after its firmware reboot · automatic Bluetooth reconnect ${attempt}/${this.reconnectAttempts} verified GATT liveness.`,
          "success",
        );
        return {
          expectedReboot: true,
          reconnected: true,
          reconnectAttempts: attempt,
        };
      } catch (error) {
        lastError = error;
        try {
          this.device?.gatt?.disconnect();
        } catch {
          // The failed attempt may already have closed the transient link.
        }
      }
    }

    // All payload blocks and the final END response are unambiguous. Replaying
    // the package here would be less safe than preserving that proof and using
    // the required Case reset/version interrogation as the authoritative boot
    // check after both temples have been transferred.
    this.log(
      `${this.side}: all final-image blocks and END ${endStatus} were verified, but the rebooted temple did not resume GATT within ${this.reconnectAttempts} bounded attempts${lastError?.message ? ` (${lastError.message})` : ""}. No firmware will be replayed; continuing to the other side and deferring version authority to the final Case check.`,
      "warn",
    );
    return {
      expectedReboot: true,
      reconnected: false,
      reconnectAttempts: this.reconnectAttempts,
      reconnectError: lastError?.message ?? null,
    };
  }

  async flashComponent(component, componentIndex, totals) {
    const blockCount = Math.ceil(
      component.payload.length / G2_BLE_BLOCK_BYTES,
    );
    let lastError = null;
    for (let attempt = 1; attempt <= this.componentAttempts; attempt += 1) {
      let attemptAccepted = 0;
      if (attempt > 1) {
        this.log(
          `${this.side}: restarting ${component.name} from FILE_CHECK · attempt ${attempt}/${this.componentAttempts}.`,
          "warn",
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.componentRetrySettleMs),
        );
      }
      try {
        const fileCheckStatus = await this.sendControl(
          0x01,
          component.header,
        );
        if (fileCheckStatus !== 0) {
          throw new G2BleOtaError(
            `${this.side}: ${component.name} FILE_CHECK returned ${fileCheckStatus} (${g2BleStatusName(fileCheckStatus)}).`,
            { code: "FILE_CHECK_REJECTED", status: fileCheckStatus },
          );
        }
        for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
          const block = component.payload.subarray(
            blockIndex * G2_BLE_BLOCK_BYTES,
            (blockIndex + 1) * G2_BLE_BLOCK_BYTES,
          );
          let accepted = false;
          for (
            let blockAttempt = 1;
            blockAttempt <= this.blockNakAttempts;
            blockAttempt += 1
          ) {
            const status = await this.sendBlock(block);
            if (status === 0) {
              accepted = true;
              break;
            }
            this.log(
              `${this.side}: ${component.name} block ${blockIndex + 1}/${blockCount} explicitly rejected with ${status} (${g2BleStatusName(status)}) · safe resend ${blockAttempt}/${this.blockNakAttempts}.`,
              "warn",
            );
          }
          if (!accepted) {
            throw new G2BleOtaError(
              `${this.side}: ${component.name} block ${blockIndex + 1} remained rejected after ${this.blockNakAttempts} safe resends.`,
              { code: "BLOCK_REJECTED", blockIndex },
            );
          }
          attemptAccepted += block.length;
          const completed =
            totals.completedBeforeComponent + attemptAccepted;
          totals.highWater = Math.max(totals.highWater, completed);
          this.progress(
            totals.highWater / totals.totalBytes,
            `${this.side}: ${component.name} block ${blockIndex + 1}/${blockCount}`,
          );
        }
        const endStatus = await this.sendControl(0x03);
        if (!END_OK.has(endStatus)) {
          throw new G2BleOtaError(
            `${this.side}: ${component.name} END verification returned ${endStatus} (${g2BleStatusName(endStatus)}).`,
            { code: "END_REJECTED", status: endStatus },
          );
        }
        this.log(
          `${this.side}: verified ${component.name} · ${blockCount} block ACKs · END ${endStatus} (${g2BleStatusName(endStatus)}).`,
          "success",
        );
        totals.completedBeforeComponent += component.payload.length;
        totals.highWater = totals.completedBeforeComponent;
        return {
          name: component.name,
          payloadBytes: component.payload.length,
          blocks: blockCount,
          endStatus,
          attempts: attempt,
        };
      } catch (error) {
        lastError = error;
        if (
          error?.code === "ACK_TIMEOUT" &&
          error?.opcode === 0x02
        ) {
          this.log(
            `${this.side}: ${component.name} block ACK timed out. The write outcome is ambiguous, so this block will not be replayed; the whole component will restart from FILE_CHECK.`,
            "warn",
          );
        } else {
          this.log(
            `${this.side}: ${component.name} attempt ${attempt}/${this.componentAttempts} stopped · ${error.message}`,
            "warn",
          );
        }
      }
    }
    throw new G2BleOtaError(
      `${this.side}: ${component.name} failed after ${this.componentAttempts} complete component attempts: ${lastError?.message ?? "unknown error"}`,
      {
        code: "COMPONENT_FAILED",
        cause: lastError,
        componentIndex,
      },
    );
  }

  async flashBundle(firmware, { progressBase = 0, progressSpan = 1 } = {}) {
    assertPinnedG2BleBundle(firmware);
    this.sequence = 0;
    await this.connect();
    const totalBytes = firmware.componentImages.reduce(
      (sum, component) => sum + component.payload.length,
      0,
    );
    const totals = {
      totalBytes,
      completedBeforeComponent: 0,
      highWater: 0,
    };
    const componentResults = [];
    this.progress(
      progressBase,
      `${this.side}: starting the pinned six-component Bluetooth package`,
    );
    this.startHeartbeat();
    try {
      const beginStatus = await this.sendControl(0x00);
      if (!END_OK.has(beginStatus)) {
        this.log(
          `${this.side}: BEGIN returned ${beginStatus} (${g2BleStatusName(beginStatus)}); continuing because FILE_CHECK remains the authoritative per-component gate.`,
          "warn",
        );
      }
      for (const [index, component] of firmware.componentImages.entries()) {
        const result = await this.flashComponent(
          component,
          index,
          totals,
        );
        componentResults.push(result);
        const localFraction = totals.completedBeforeComponent / totalBytes;
        this.progress(
          progressBase + localFraction * progressSpan,
          `${this.side}: verified ${index + 1}/${firmware.componentImages.length} components`,
        );
        const isFinalComponent =
          index === firmware.componentImages.length - 1;
        if (
          isFinalComponent &&
          (result.endStatus === 8 || result.endStatus === 9)
        ) {
          result.postUpdate = await this.settleFinalUpdate(result.endStatus);
        } else if (this.heartbeatError) {
          throw this.heartbeatError;
        }
      }
    } finally {
      this.stopHeartbeat();
    }
    this.progress(
      progressBase + progressSpan,
      `${this.side}: all six Bluetooth OTA components verified`,
    );
    return {
      side: this.side,
      deviceName: this.device.name,
      imageSha256: firmware.fileSha256,
      version: firmware.g2Version,
      components: componentResults,
      blockAcks: componentResults.reduce(
        (sum, component) => sum + component.blocks,
        0,
      ),
      outcome: "success",
    };
  }
}
