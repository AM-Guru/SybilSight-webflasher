import {
  BANK_SIZE,
  FLASH_BASE,
  FLASH_PAGE_SIZE,
  FLASH_SIZE,
  OPTION_BASE,
  OPTION_SIZE,
  decodeOptionBytes,
  detectCaseVersion,
  equalBytes,
  isPlausibleCaseImage,
  parseConsoleReport,
  sha256Hex,
  toggledBankOptionBytes,
} from "./firmware.js";
import {
  POGO_BRIDGE_ADDRESS,
  POGO_BRIDGE_BANNER,
  POGO_BRIDGE_PROOF,
  POGO_BRIDGE_PROOF_ADDRESS,
  POGO_BRIDGE_RESULT_ADDRESS,
  POGO_BRIDGE_RESULT_LENGTH,
  POGO_BRIDGE_STATUS,
  getVerifiedPogoBridgePayload,
  makePogoBridgeRequest,
  parsePogoBridgeResponse,
  parseTempleFrame,
  validatePogoBridgeRetainedResult,
} from "./pogoBridge.js";
import {
  POGO_FLASH_BRIDGE_ADDRESS,
  POGO_FLASH_BRIDGE_BANNER,
  POGO_FLASH_BRIDGE_SHA256,
  POGO_FLASH_PROOF,
  POGO_FLASH_PROOF_ADDRESS,
  POGO_FLASH_RESULT_ADDRESS,
  POGO_FLASH_RESULT_LENGTH,
  POGO_FLASH_STATUS,
  REVIEWED_CASE_VERSION,
  REVIEWED_CFW_BASE_VERSION,
  RetryablePogoFlashError,
  TempleRejectedError,
  PogoFlashSafetyError,
  assertPinnedTempleFlashCandidate,
  classifyPogoFlashRecoveryBoundary,
  decodePogoFlashRetainedResult,
  decodeTempleVersion,
  getVerifiedPogoFlashBridgePayload,
  makeOtaDataRequest,
  makeOtaFinishRequest,
  makeOtaHeaderRequest,
  makeOtaStartRequest,
  makePogoFlashHostStressHeader,
  makePogoFlashSetup,
  makePogoFlashTransactionHeader,
  makeTempleVersionRequest,
  parsePogoFlashReady,
  parsePogoFlashResponse,
  parsePogoFlashRetainedResult,
  requireOtaAcknowledgement,
  verifyPogoFlashHostTimeoutRestoration,
  verifyPogoFlashOppositePhaseStop,
} from "./pogoFlashBridge.js";
import { buildBundleDifferencePlan } from "./differential.js";

const ACK = 0x79;
const NACK = 0x1f;
const SYNC = 0x7f;
const GET = 0x00;
const GET_ID = 0x02;
const READ_MEMORY = 0x11;
const GO = 0x21;
const WRITE_MEMORY = 0x31;
const EXTENDED_ERASE = 0x44;
const INACTIVE_ALIAS = FLASH_BASE + BANK_SIZE;
const REVIEWED_CASE_ROM_COMMANDS = Object.freeze([
  0x00, 0x01, 0x02, READ_MEMORY, GO, WRITE_MEMORY, EXTENDED_ERASE,
  0x63, 0x73, 0x82, 0x92,
]);
// Repeated read-only probes consumed the same short app-mode route needed by
// START on hardware. One checksum-valid version query is the just-in-time
// liveness gate; it is not a multi-query stability claim.
const POGO_STABILITY_READ_QUERIES = 1;
const POGO_STABILITY_INTERVAL_MS = 25;
const POGO_DEFERRED_BATCH_BYTES = 6000;
const POGO_DATA_BATCH_SETTLE_MS = 1000;
const POGO_DATA_LATE_BATCH_SETTLE_MS = 2000;
const POGO_DATA_FINAL_SETTLE_MS = 15000;
const POGO_DATA_LATE_SETTLE_NUMERATOR = 3;
const POGO_DATA_LATE_SETTLE_DENOMINATOR = 4;
const POGO_COMPONENT_RESTART_LIMIT = 2;
const POGO_BILATERAL_ROUTE_ADAPTATION_LIMIT = 4;
const POGO_INTERMEDIATE_RESET_ATTEMPTS = 2;
export const WEB_SERIAL_ROM_READ_SIZE = 31;

export function isExplicitTempleDataRejection(error) {
  return error instanceof TempleRejectedError;
}

export function isPogoRoutePhaseMismatch(error) {
  return Boolean(
    error instanceof PogoFlashSafetyError &&
      error.message.includes(
        "YHM baseline is not an allowlisted seated-idle state",
      ),
  );
}

export function isRetryablePostResetLivenessFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("no framed temple response");
}

export function templeDataSettleMilliseconds(acceptedBytes, totalBytes) {
  if (
    !Number.isInteger(acceptedBytes) ||
    !Number.isInteger(totalBytes) ||
    acceptedBytes < 0 ||
    totalBytes < 1 ||
    acceptedBytes > totalBytes
  ) {
    throw new Error("Temple DATA pacing requires valid accepted and total byte counts.");
  }
  const final = acceptedBytes === totalBytes;
  if (!final && acceptedBytes % POGO_DEFERRED_BATCH_BYTES !== 0) return 0;
  if (final) return POGO_DATA_FINAL_SETTLE_MS;
  const lateTransfer =
    acceptedBytes * POGO_DATA_LATE_SETTLE_DENOMINATOR >=
    totalBytes * POGO_DATA_LATE_SETTLE_NUMERATOR;
  return lateTransfer
    ? POGO_DATA_LATE_BATCH_SETTLE_MS
    : POGO_DATA_BATCH_SETTLE_MS;
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function retryReadOnlyBlock(
  read,
  resynchronize,
  { attempts = 5, onRetry = () => {} } = {},
) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("Read-only retry attempts must be a positive integer.");
  }
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await read(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      onRetry(error, attempt, attempts - 1);
      await resynchronize(attempt);
    }
  }
  throw lastError;
}

export function isWebSerialRomPacketBoundary(error, requestedSize) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    requestedSize > WEB_SERIAL_ROM_READ_SIZE &&
    message.includes(
      `received ${WEB_SERIAL_ROM_READ_SIZE} of ${requestedSize} bytes`,
    )
  );
}

export async function readRomBlockWithBoundaryRecovery(
  read,
  resynchronize,
  {
    requestedSize,
    attempts = 5,
    onRetry = () => {},
    onPacketBoundary = () => {},
  } = {},
) {
  if (!Number.isInteger(requestedSize) || requestedSize < 1) {
    throw new Error("A positive ROM read size is required.");
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("ROM read attempts must be a positive integer.");
  }
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return {
        block: await read(attempt),
        packetBoundaryDetected: false,
      };
    } catch (error) {
      lastError = error;
      if (isWebSerialRomPacketBoundary(error, requestedSize)) {
        onPacketBoundary(error, attempt);
        await resynchronize(attempt);
        return {
          block: null,
          packetBoundaryDetected: true,
        };
      }
      if (attempt === attempts) break;
      onRetry(error, attempt + 1, attempts);
      await resynchronize(attempt);
    }
  }
  throw lastError;
}

export async function writePogoFlashTransactionHeader(
  bridge,
  header,
  sleeper = delay,
) {
  if (!(header instanceof Uint8Array) || header.length !== 10) {
    throw new PogoFlashSafetyError(
      "The Case flash bridge transaction header must be exactly 10 bytes.",
    );
  }
  // The physical CH340 captured only five bytes from one 10-byte write after
  // the former two-second pre-start idle. Independently flush both halves so the
  // bridge either receives the complete header or times out before any temple
  // request payload can be sent.
  await bridge.write(header.subarray(0, 5));
  await sleeper(5);
  await bridge.write(header.subarray(5));
}

const POGO_FLASH_RESPONSE_MAGIC = new TextEncoder().encode("G2RX");

export async function readPogoFlashResponseHeader(
  bridge,
  timeoutMs,
  onResynchronized = () => {},
) {
  if (
    !bridge?.readExact ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 1
  ) {
    throw new PogoFlashSafetyError(
      "A readable Case bridge and positive response deadline are required.",
    );
  }
  const deadline = Date.now() + timeoutMs;
  const window = [];
  let inspected = 0;
  while (inspected < 128) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new RetryablePogoFlashError(
        `Timed out locating a complete flash bridge response after ${inspected} bytes.`,
      );
    }
    const byte = (
      await bridge.readExact(
        1,
        remaining,
        "flash bridge response synchronization byte",
      )
    )[0];
    inspected += 1;
    window.push(byte);
    if (window.length > POGO_FLASH_RESPONSE_MAGIC.length) window.shift();
    if (
      window.length === POGO_FLASH_RESPONSE_MAGIC.length &&
      window.every(
        (value, index) => value === POGO_FLASH_RESPONSE_MAGIC[index],
      )
    ) {
      const discardedBytes = inspected - POGO_FLASH_RESPONSE_MAGIC.length;
      if (discardedBytes > 0) onResynchronized(discardedBytes);
      const suffix = await bridge.readExact(
        7,
        Math.max(1, deadline - Date.now()),
        "flash bridge response header suffix",
      );
      const header = new Uint8Array(11);
      header.set(POGO_FLASH_RESPONSE_MAGIC);
      header.set(suffix, POGO_FLASH_RESPONSE_MAGIC.length);
      return header;
    }
  }
  throw new RetryablePogoFlashError(
    "The Case bridge emitted 128 bytes without a complete G2RX response marker.",
  );
}

export function canRunFinalResetAfterFailure(routeResults) {
  return (
    Array.isArray(routeResults) &&
    routeResults.length > 0 &&
    routeResults.every(
      (result) =>
        result?.caseRestoreVerified === true &&
        result?.caseApplicationVersion === REVIEWED_CASE_VERSION,
    )
  );
}

export function canRestartFailedTempleComponent(
  routeResult,
  restartCount = 0,
) {
  return (
    Number.isInteger(restartCount) &&
    restartCount >= 0 &&
    restartCount < POGO_COMPONENT_RESTART_LIMIT &&
    routeResult?.outcome === "failed_or_uncertain" &&
    routeResult?.otaMutationAttempted === true &&
    /^DATA:\d+$/.test(routeResult?.failureStage ?? "") &&
    routeResult?.transfer === null &&
    routeResult?.caseRestoreVerified === true &&
    routeResult?.caseApplicationVersion === REVIEWED_CASE_VERSION &&
    routeResult?.retainedResult?.baselineMask === 0x3ff &&
    routeResult?.retainedResult?.selectedMask === 0x3ff &&
    routeResult?.retainedResult?.restoredMask === 0x3ff &&
    routeResult?.retainedResult?.templeUartErrors === 0
  );
}

function compactHex(input) {
  return [...(input ?? [])]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function requireReviewedCaseRom(loader) {
  if (loader.version !== 0x31 || loader.productId !== 0x0467) {
    throw new PogoFlashSafetyError(
      `The Case ROM identity differs from the reviewed device (protocol=0x${loader.version
        ?.toString(16)}, product=0x${loader.productId?.toString(16)}).`,
    );
  }
  if (
    loader.commands.length !== REVIEWED_CASE_ROM_COMMANDS.length ||
    !REVIEWED_CASE_ROM_COMMANDS.every((command) =>
      loader.commands.includes(command))
  ) {
    throw new PogoFlashSafetyError(
      `The Case ROM command table differs from the reviewed device (${loader.commands
        .map((command) => command.toString(16).padStart(2, "0"))
        .join(" ")}).`,
    );
  }
}

function xor(bytes) {
  return bytes.reduce((result, value) => result ^ value, 0);
}

function addressPacket(address) {
  const bytes = new Uint8Array([
    (address >>> 24) & 0xff,
    (address >>> 16) & 0xff,
    (address >>> 8) & 0xff,
    address & 0xff,
  ]);
  return new Uint8Array([...bytes, xor([...bytes])]);
}

class SerialTransport {
  constructor(port, log) {
    this.port = port;
    this.log = log;
    this.reader = null;
    this.writer = null;
    this.queue = [];
    this.queuedBytes = 0;
    this.waiters = new Set();
    this.readError = null;
    this.pumpPromise = null;
  }

  async open(options) {
    await this.port.open(options);
    if (!this.port.readable || !this.port.writable) {
      throw new Error("The serial port did not expose readable and writable streams.");
    }
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.pumpPromise = this.pump();
  }

  async pump() {
    try {
      while (this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value?.length) {
          this.queue.push(value);
          this.queuedBytes += value.length;
          this.notify();
        }
      }
    } catch (error) {
      if (error?.name !== "NetworkError" && error?.name !== "AbortError") {
        this.readError = error;
      }
      this.notify();
    }
  }

  notify() {
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }

  async setSignals(dataTerminalReady, requestToSend) {
    await this.port.setSignals({ dataTerminalReady, requestToSend });
  }

  async write(data) {
    if (!this.writer) throw new Error("The serial writer is not open.");
    await this.writer.write(data instanceof Uint8Array ? data : new Uint8Array(data));
  }

  clear() {
    this.queue = [];
    this.queuedBytes = 0;
    this.readError = null;
  }

  take(count = this.queuedBytes) {
    const target = Math.min(count, this.queuedBytes);
    const result = new Uint8Array(target);
    let written = 0;
    while (written < target) {
      const chunk = this.queue[0];
      const needed = target - written;
      const used = Math.min(needed, chunk.length);
      result.set(chunk.subarray(0, used), written);
      written += used;
      this.queuedBytes -= used;
      if (used === chunk.length) {
        this.queue.shift();
      } else {
        this.queue[0] = chunk.subarray(used);
      }
    }
    return result;
  }

  async waitForData(timeoutMs) {
    if (this.queuedBytes || this.readError) return;
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.waiters.delete(onData);
        resolve();
      }, timeoutMs);
      const onData = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.waiters.add(onData);
    });
  }

  async readExact(count, timeoutMs = 3000, label = "serial response") {
    const deadline = Date.now() + timeoutMs;
    while (this.queuedBytes < count && !this.readError && Date.now() < deadline) {
      await this.waitForData(Math.max(1, deadline - Date.now()));
    }
    if (this.readError) throw this.readError;
    if (this.queuedBytes < count) {
      throw new Error(
        `Timed out reading ${label}: received ${this.queuedBytes} of ${count} bytes.`,
      );
    }
    return this.take(count);
  }

  async collectFor(milliseconds) {
    await delay(milliseconds);
    return this.take();
  }

  async close() {
    const reader = this.reader;
    this.reader = null;
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // A hardware reset can close the stream before cancellation.
      }
      try {
        await this.pumpPromise;
      } catch {
        // The read error is surfaced by readExact when it matters.
      }
      try {
        reader.releaseLock();
      } catch {
        // Already released by the browser.
      }
    }
    if (this.writer) {
      try {
        this.writer.releaseLock();
      } catch {
        // Already released by the browser.
      }
      this.writer = null;
    }
    try {
      await this.port.close();
    } catch {
      // The device may have reset immediately after option-byte programming.
    }
  }
}

class Stm32Bootloader {
  constructor(port, log) {
    this.port = port;
    this.log = log;
    this.transport = null;
    this.commands = [];
    this.version = null;
    this.productId = null;
    this.maximumReadSize = 256;
  }

  async connect() {
    this.transport = new SerialTransport(this.port, this.log);
    await this.transport.open({
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "even",
      flowControl: "none",
      bufferSize: 4096,
    });
    await this.transport.setSignals(false, true);
    await delay(60);
    await this.transport.setSignals(false, false);
    await delay(180);
    this.transport.clear();
    await this.transport.write(new Uint8Array([SYNC]));
    await this.expectAck("bootloader synchronization", 3000);
    const identity = await this.get();
    this.version = identity.version;
    this.commands = identity.commands;
    this.productId = await this.getId();
    if (this.productId !== 0x0467) {
      throw new Error(
        `Unexpected STM32 product ID 0x${this.productId.toString(16).padStart(4, "0")}.`,
      );
    }
  }

  async close() {
    await this.transport?.close();
    this.transport = null;
  }

  takeTransport() {
    if (!this.transport) {
      throw new Error("The STM32 ROM transport is not open.");
    }
    const transport = this.transport;
    this.transport = null;
    return transport;
  }

  requireCommand(command, label) {
    if (!this.commands.includes(command)) {
      throw new Error(`The Case ROM loader does not advertise ${label}.`);
    }
  }

  async sendCommand(command, label) {
    await this.transport.write(new Uint8Array([command, command ^ 0xff]));
    await this.expectAck(label);
  }

  async expectAck(label, timeoutMs = 3000) {
    const value = (await this.transport.readExact(1, timeoutMs, `${label} ACK`))[0];
    if (value === NACK) throw new Error(`The Case returned NACK during ${label}.`);
    if (value !== ACK) {
      throw new Error(
        `Unexpected 0x${value.toString(16).padStart(2, "0")} during ${label}.`,
      );
    }
  }

  async get() {
    await this.transport.write(new Uint8Array([GET, GET ^ 0xff]));
    await this.expectAck("Get command");
    const countMinusOne = (await this.transport.readExact(1, 1000, "Get length"))[0];
    const response = await this.transport.readExact(
      countMinusOne + 1,
      1000,
      "Get payload",
    );
    await this.expectAck("Get completion");
    return { version: response[0], commands: [...response.subarray(1)] };
  }

  async getId() {
    await this.transport.write(new Uint8Array([GET_ID, GET_ID ^ 0xff]));
    await this.expectAck("Get ID command");
    const countMinusOne = (await this.transport.readExact(1, 1000, "Get ID length"))[0];
    const response = await this.transport.readExact(
      countMinusOne + 1,
      1000,
      "Get ID payload",
    );
    await this.expectAck("Get ID completion");
    return response.reduce((result, value) => (result << 8) | value, 0);
  }

  async readMemory(address, size) {
    if (size < 1 || size > 256) throw new Error("ROM reads must be 1–256 bytes.");
    this.requireCommand(READ_MEMORY, "Read Memory");
    await this.sendCommand(READ_MEMORY, "Read Memory command");
    await this.transport.write(addressPacket(address));
    await this.expectAck("Read Memory address");
    const encodedSize = size - 1;
    await this.transport.write(new Uint8Array([encodedSize, encodedSize ^ 0xff]));
    await this.expectAck("Read Memory length");
    return this.transport.readExact(size, 3000, `memory at 0x${address.toString(16)}`);
  }

  async readRange(address, size, onProgress) {
    const output = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const length = Math.min(this.maximumReadSize, size - offset);
      const blockAddress = address + offset;
      const resynchronize = async () => {
        await this.close();
        await delay(120);
        await this.connect();
      };
      const readResult = await readRomBlockWithBoundaryRecovery(
        () => this.readMemory(blockAddress, length),
        resynchronize,
        {
          requestedSize: length,
          attempts: 5,
          onPacketBoundary: () =>
            this.log(
              `Detected the CH340 Web Serial packet boundary at 0x${blockAddress.toString(16)}; discarding the partial reply and switching to ${WEB_SERIAL_ROM_READ_SIZE}-byte ROM reads.`,
              "warn",
            ),
          onRetry: (retryError, nextAttempt, attemptCount) =>
            this.log(
              `ROM read retry ${nextAttempt}/${attemptCount} at 0x${blockAddress.toString(16)} after ${retryError.message}`,
              "warn",
            ),
        },
      );
      if (readResult.packetBoundaryDetected) {
        this.maximumReadSize = WEB_SERIAL_ROM_READ_SIZE;
        continue;
      }
      const block = readResult.block;
      output.set(block, offset);
      offset += length;
      onProgress?.(offset / size);
    }
    return output;
  }

  async go(address) {
    this.requireCommand(GO, "Go");
    await this.sendCommand(GO, "Go command");
    await this.transport.write(addressPacket(address));
    await this.expectAck("Go address");
  }

  async releaseBootSelection() {
    await this.transport.setSignals(true, false);
  }

  async erasePages(pageNumbers) {
    this.requireCommand(EXTENDED_ERASE, "Extended Erase");
    if (!pageNumbers.length || pageNumbers.length > 128) {
      throw new Error("The bounded recovery path erases 1–128 pages.");
    }
    await this.sendCommand(EXTENDED_ERASE, "Extended Erase command");
    const count = pageNumbers.length - 1;
    const payload = [
      (count >>> 8) & 0xff,
      count & 0xff,
      ...pageNumbers.flatMap((page) => [(page >>> 8) & 0xff, page & 0xff]),
    ];
    await this.transport.write(new Uint8Array([...payload, xor(payload)]));
    await this.expectAck("page erase", 30000);
  }

  async writeMemory(address, input, timeoutMs = 5000) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!bytes.length || bytes.length > 256 || bytes.length % 4 !== 0) {
      throw new Error("ROM writes must contain 4–256 bytes in a multiple of four.");
    }
    this.requireCommand(WRITE_MEMORY, "Write Memory");
    await this.sendCommand(WRITE_MEMORY, "Write Memory command");
    await this.transport.write(addressPacket(address));
    await this.expectAck("Write Memory address");
    const encodedSize = bytes.length - 1;
    const body = [encodedSize, ...bytes];
    await this.transport.write(new Uint8Array([...body, xor(body)]));
    await this.expectAck("Write Memory data", timeoutMs);
  }

  async writeRange(address, input, onProgress) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    for (let offset = 0; offset < bytes.length; offset += 256) {
      const source = bytes.subarray(offset, Math.min(offset + 256, bytes.length));
      const paddedLength = Math.ceil(source.length / 4) * 4;
      const block = new Uint8Array(paddedLength);
      block.fill(0xff);
      block.set(source);
      await this.writeMemory(address + offset, block);
      onProgress?.((offset + source.length) / bytes.length);
    }
  }
}

async function openNormalConsole(port) {
  const transport = new SerialTransport(port);
  await transport.open({
    baudRate: 1_000_000,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
    bufferSize: 65536,
  });
  await transport.setSignals(true, true);
  await delay(60);
  await transport.setSignals(true, false);
  return transport;
}

async function queryNormal(transport, command, duration = 850) {
  if (![0xa0, 0xa2, 0xa3, 0xa4].includes(command)) {
    throw new Error("Only the read-only A0/A2/A3/A4 query allowlist is available.");
  }
  transport.clear();
  const line = new TextEncoder().encode(`DE${command.toString(16).toUpperCase()}\n`);
  await transport.write(line);
  return new TextDecoder().decode(await transport.collectFor(duration));
}

async function resetTemples(transport) {
  transport.clear();
  await transport.write(new TextEncoder().encode("DEB0\n"));
  const resetOutput = new TextDecoder().decode(await transport.collectFor(2200));
  if (!/reset gls L & R, reason: cmd/i.test(resetOutput)) {
    throw new Error(
      "The Case did not confirm the traced B0 left/right temple reset command.",
    );
  }
  return resetOutput;
}

class CasePogoFlashTransport {
  constructor(session, route, { progressBase = 0, progressSpan = 1 } = {}) {
    if (!["left", "right"].includes(route)) {
      throw new PogoFlashSafetyError("The Case bridge route must be left or right.");
    }
    this.session = session;
    this.port = session.port;
    this.route = route;
    this.reportProgress = (fraction, detail) =>
      session.progress(progressBase + fraction * progressSpan, detail);
    this.loader = null;
    this.bridge = null;
    this.sequence = 0;
    this.bridgeLaunched = false;
    this.active = false;
    this.closed = false;
    this.restoreVerified = false;
    this.retainedResult = null;
    this.setupPhaseStopVerified = false;
    this.caseReport = null;
    this.completedTransfer = null;
    this.hostOnlyKeepalives = 0;
    this.routePhaseSetupAttempts = 0;
  }

  async closeTransport(name) {
    const transport = this[name];
    this[name] = null;
    if (!transport) return;
    try {
      await transport.close();
    } catch (error) {
      this.session.log(
        `${name === "bridge" ? "Flash bridge" : "ROM loader"} close was not confirmed: ${error.message}`,
        "warn",
      );
    }
  }

  async open() {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      this.routePhaseSetupAttempts = attempt;
      try {
        await this.openOnce();
        return;
      } catch (error) {
        const routePhaseMismatch = isPogoRoutePhaseMismatch(error);
        if (!routePhaseMismatch || attempt === 4) throw error;
        this.session.log(
          `${this.route}: Case idle phase does not match the selected mutation route; returning fully to Case 1.2.57 before retrying the same route with zero temple transmissions.`,
          "warn",
        );
        this.active = false;
        this.bridgeLaunched = false;
        await this.session.restoreNormal({
          requireVersion: true,
          expectedVersion: REVIEWED_CASE_VERSION,
        });
        await delay(500 * attempt);
      }
    }
  }

  async openOnce() {
    const payload = await getVerifiedPogoFlashBridgePayload();
    const zeroProof = new Uint8Array(POGO_FLASH_PROOF.length);
    const zeroResult = new Uint8Array(POGO_FLASH_RESULT_LENGTH);
    try {
      this.loader = new Stm32Bootloader(this.port, this.session.log);
      await this.loader.connect();
      requireReviewedCaseRom(this.loader);

      await this.loader.writeMemory(POGO_FLASH_PROOF_ADDRESS, zeroProof);
      await this.loader.writeMemory(POGO_FLASH_RESULT_ADDRESS, zeroResult);
      const initialProof = await this.loader.readRange(
        POGO_FLASH_PROOF_ADDRESS,
        zeroProof.length,
      );
      const initialResult = await this.loader.readRange(
        POGO_FLASH_RESULT_ADDRESS,
        zeroResult.length,
      );
      if (
        !equalBytes(initialProof, zeroProof) ||
        !equalBytes(initialResult, zeroResult)
      ) {
        throw new PogoFlashSafetyError(
          "The volatile flash bridge proof/result locations did not clear.",
        );
      }
      for (let offset = 0; offset < payload.length; offset += 256) {
        const chunk = payload.subarray(offset, Math.min(offset + 256, payload.length));
        const address = POGO_FLASH_BRIDGE_ADDRESS + offset;
        await this.loader.writeMemory(address, chunk);
        const readback = await this.loader.readRange(address, chunk.length);
        if (!equalBytes(readback, chunk)) {
          throw new PogoFlashSafetyError(
            `The volatile flash bridge readback differs at 0x${address.toString(16)}.`,
          );
        }
        this.reportProgress(
          0.02 + ((offset + chunk.length) / payload.length) * 0.04,
          `${this.route}: verifying volatile flash bridge`,
        );
      }
      await this.loader.go(POGO_FLASH_BRIDGE_ADDRESS);
      await this.loader.releaseBootSelection();
      this.bridgeLaunched = true;
      this.bridge = this.loader.takeTransport();
      this.loader = null;

      const banner = await this.bridge.readExact(
        POGO_FLASH_BRIDGE_BANNER.length,
        3000,
        "flash bridge banner",
      );
      if (!equalBytes(banner, POGO_FLASH_BRIDGE_BANNER)) {
        throw new PogoFlashSafetyError("The volatile flash bridge banner is invalid.");
      }

      const setup = makePogoFlashSetup(this.route);
      await this.bridge.write(setup);
      const ready = await this.bridge.readExact(13, 10000, "flash bridge ready response");
      parsePogoFlashReady(ready, setup);
      this.active = true;
      this.session.log(
        `${this.route}: verified the ${payload.length.toLocaleString("en-US")}-byte volatile writer and selected the mutation-compatible Case phase.`,
      );
    } catch (error) {
      await this.closeTransport("loader");
      await this.closeTransport("bridge");
      throw error;
    }
  }

  async readBridgeResponse(timeoutMs) {
    const responseTimeout = Math.max(10000, timeoutMs + 10000);
    const header = await readPogoFlashResponseHeader(
      this.bridge,
      responseTimeout,
      (discardedBytes) =>
        this.session.log(
          `${this.route}: discarded ${discardedBytes} byte${discardedBytes === 1 ? "" : "s"} from a short Case response prefix and synchronized to the retransmitted G2RX frame.`,
          "warn",
        ),
    );
    const length = header[8];
    if (length > 64) {
      throw new RetryablePogoFlashError(
        `The flash bridge declared ${length} captured bytes.`,
      );
    }
    const tail = await this.bridge.readExact(
      length + 1,
      Math.max(10000, timeoutMs + 10000),
      "flash bridge response payload",
    );
    return parsePogoFlashResponse(header, tail, this.sequence);
  }

  async transact(request, timeoutMs) {
    if (!this.active || !this.bridge) {
      throw new PogoFlashSafetyError("The volatile flash bridge is not active.");
    }
    const bytes = request instanceof Uint8Array ? request : new Uint8Array(request);
    if (!bytes.length || bytes.length > 1009) {
      throw new PogoFlashSafetyError("The temple request is outside the bridge bounds.");
    }
    this.sequence = (this.sequence + 1) & 0xff;
    try {
      await writePogoFlashTransactionHeader(
        this.bridge,
        makePogoFlashTransactionHeader(this.sequence, bytes.length),
      );
      const headerToken = await this.bridge.readExact(
        1,
        8000,
        "transaction-header flow-control token",
      );
      if (headerToken[0] !== 0xc3) {
        throw new RetryablePogoFlashError(
          "The flash bridge rejected the transaction header.",
        );
      }
      for (let offset = 0; offset < bytes.length; offset += 32) {
        await this.bridge.write(bytes.subarray(offset, Math.min(offset + 32, bytes.length)));
        const token = await this.bridge.readExact(
          1,
          8000,
          `transaction flow-control token at ${offset}`,
        );
        if (token[0] !== 0xc3) {
          throw new RetryablePogoFlashError(
            `The flash bridge did not consume the payload chunk at ${offset}.`,
          );
        }
      }
      const checksum = [...bytes].reduce((sum, value) => (sum + value) & 0xff, 0);
      await this.bridge.write(new Uint8Array([checksum]));
      const response = await this.readBridgeResponse(timeoutMs);
      if (response.uartErrors) {
        throw new RetryablePogoFlashError(
          `The pogo UART reported error mask 0x${response.uartErrors.toString(16)}.`,
        );
      }
      if (response.status === 6) {
        throw new RetryablePogoFlashError(
          "No complete temple response arrived through the Case bridge.",
        );
      }
      if (response.status !== 0) {
        throw new PogoFlashSafetyError(
          `The Case bridge stopped safely: ${POGO_FLASH_STATUS[response.status] ?? `status ${response.status}`}.`,
        );
      }
      return response.captured;
    } catch (error) {
      if (
        error instanceof RetryablePogoFlashError ||
        error instanceof PogoFlashSafetyError
      ) {
        throw error;
      }
      throw new RetryablePogoFlashError(error?.message ?? String(error));
    }
  }

  drainInput() {
    this.bridge?.clear();
  }

  async stressHostReceive(payloadSize = 1) {
    if (
      !this.active ||
      !this.bridge ||
      !Number.isInteger(payloadSize) ||
      payloadSize < 1 ||
      payloadSize > 1009
    ) {
      throw new PogoFlashSafetyError(
        "The Case host-only keepalive requires an active bridge and 1–1,009 bytes.",
      );
    }
    this.sequence = (this.sequence + 1) & 0xff;
    const payload = new Uint8Array(payloadSize);
    await writePogoFlashTransactionHeader(
      this.bridge,
      makePogoFlashHostStressHeader(this.sequence, payload.length),
    );
    const headerToken = await this.bridge.readExact(
      1,
      8000,
      "host-only keepalive header token",
    );
    if (headerToken[0] !== 0xc3) {
      throw new RetryablePogoFlashError(
        "The flash bridge rejected the host-only keepalive header.",
      );
    }
    for (let offset = 0; offset < payload.length; offset += 32) {
      const chunk = payload.subarray(offset, Math.min(offset + 32, payload.length));
      await this.bridge.write(chunk);
      const token = await this.bridge.readExact(
        1,
        8000,
        "host-only keepalive payload token",
      );
      if (token[0] !== 0xc3) {
        throw new RetryablePogoFlashError(
          "The flash bridge did not consume the host-only keepalive payload.",
        );
      }
    }
    await this.bridge.write(new Uint8Array([0]));
    const response = await this.readBridgeResponse(8000);
    if (
      response.status !== 0 ||
      response.uartErrors !== 0 ||
      response.captured.length !== 0
    ) {
      throw new RetryablePogoFlashError(
        "The host-only keepalive response was not empty and checksum-valid.",
      );
    }
    this.hostOnlyKeepalives += 1;
  }

  async settleTempleStorage(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new PogoFlashSafetyError("Temple storage settle time is invalid.");
    }
    let remaining = milliseconds;
    while (remaining > 5000) {
      await delay(5000);
      remaining -= 5000;
      await this.stressHostReceive(1);
    }
    if (remaining > 0) await delay(remaining);
  }

  async requestExit() {
    if (!this.active || !this.bridge) return null;
    this.sequence = (this.sequence + 1) & 0xff;
    await writePogoFlashTransactionHeader(
      this.bridge,
      makePogoFlashTransactionHeader(this.sequence, 0),
    );
    const response = await this.readBridgeResponse(10000);
    if (
      response.status !== 0 ||
      response.uartErrors !== 0 ||
      response.captured.length !== 10
    ) {
      throw new PogoFlashSafetyError(
        `The bridge exit did not return a restored route (status=${response.status}, errors=${response.uartErrors}, bytes=${response.captured.length}).`,
      );
    }
    this.active = false;
    return response.captured;
  }

  async verifyAndClearRetainedResult() {
    const zeroProof = new Uint8Array(POGO_FLASH_PROOF.length);
    const zeroResult = new Uint8Array(POGO_FLASH_RESULT_LENGTH);
    this.loader = new Stm32Bootloader(this.port, this.session.log);
    let validationError = null;
    try {
      await this.loader.connect();
      requireReviewedCaseRom(this.loader);
      const proof = await this.loader.readRange(
        POGO_FLASH_PROOF_ADDRESS,
        POGO_FLASH_PROOF.length,
      );
      const result = await this.loader.readRange(
        POGO_FLASH_RESULT_ADDRESS,
        POGO_FLASH_RESULT_LENGTH,
      );
      try {
        this.retainedResult = decodePogoFlashRetainedResult(result);
        const retainedResult = parsePogoFlashRetainedResult(
          result,
          proof,
          this.route,
          this.sequence,
          {
            expectedAcceptedSize: this.completedTransfer?.payloadBytes ?? null,
            expectedOtaSequence: this.completedTransfer?.records ?? null,
          },
        );
        this.retainedResult = retainedResult;
      } catch (error) {
        const hostTimeoutRestoration =
          verifyPogoFlashHostTimeoutRestoration(
            result,
            proof,
            this.route,
          );
        const phaseStop =
          hostTimeoutRestoration === null
            ? verifyPogoFlashOppositePhaseStop(
                result,
                proof,
                this.route,
              )
            : null;
        if (hostTimeoutRestoration) {
          this.retainedResult = hostTimeoutRestoration;
          this.restoreVerified = true;
          this.session.log(
            `${this.route}: the retained host-timeout record proves exact byte-for-byte route restoration after ${hostTimeoutRestoration.acceptedSize.toLocaleString("en-US")} accepted firmware bytes; no temple record will be replayed.`,
            "warn",
          );
        } else if (phaseStop) {
          this.retainedResult = phaseStop;
          this.setupPhaseStopVerified = true;
          this.restoreVerified = true;
          this.session.log(
            `${this.route}: verified a zero-write setup stop in the ${phaseStop.phaseCompatibleRoute}-compatible allowlisted Case phase.`,
            "warn",
          );
        } else {
          validationError = error;
        }
        if (this.retainedResult) {
          this.session.log(
            `${this.route}: retained setup/result diagnostics · status=${this.retainedResult.status}, progress=${this.retainedResult.progress}, baseline=${compactHex(this.retainedResult.baseline)}, selected=${compactHex(this.retainedResult.selected)}, restored=${compactHex(this.retainedResult.restored)}, accepted=${this.retainedResult.acceptedSize}.`,
            "warn",
          );
        }
      }

      await this.loader.writeMemory(POGO_FLASH_PROOF_ADDRESS, zeroProof);
      await this.loader.writeMemory(POGO_FLASH_RESULT_ADDRESS, zeroResult);
      const proofCheck = await this.loader.readRange(
        POGO_FLASH_PROOF_ADDRESS,
        zeroProof.length,
      );
      const resultCheck = await this.loader.readRange(
        POGO_FLASH_RESULT_ADDRESS,
        zeroResult.length,
      );
      if (!equalBytes(proofCheck, zeroProof) || !equalBytes(resultCheck, zeroResult)) {
        throw new PogoFlashSafetyError(
          "The volatile flash bridge proof/result could not be cleared.",
        );
      }
      if (validationError) throw validationError;
      this.restoreVerified = true;
    } finally {
      await this.closeTransport("loader");
    }
  }

  async close() {
    if (this.closed) {
      if (!this.restoreVerified || !this.caseReport) {
        throw new PogoFlashSafetyError(
          "The flash bridge cleanup did not previously complete.",
        );
      }
      return;
    }
    this.closed = true;
    const errors = [];
    let bridgeExitError = null;
    if (this.bridge) {
      try {
        await this.requestExit();
      } catch (error) {
        bridgeExitError = error;
      }
      await this.closeTransport("bridge");
    }
    await this.closeTransport("loader");
    await delay(350);

    if (this.bridgeLaunched) {
      try {
        await this.verifyAndClearRetainedResult();
      } catch (error) {
        errors.push(`retained route-restoration proof: ${error.message}`);
      }
    }
    if (bridgeExitError) {
      if (this.restoreVerified) {
        this.session.log(
          `${this.route}: ignored the incomplete live EXIT reply because immutable-ROM readback proved the route was already restored byte-for-byte.`,
          "warn",
        );
      } else {
        errors.push(`bridge exit: ${bridgeExitError.message}`);
      }
    }
    try {
      this.caseReport = await this.session.restoreNormal({
        requireVersion: true,
        expectedVersion: REVIEWED_CASE_VERSION,
      });
    } catch (error) {
      errors.push(`Case application return: ${error.message}`);
    }
    if (errors.length) {
      throw new PogoFlashSafetyError(errors.join("; "));
    }
  }
}

export class G2CaseSession {
  constructor(
    port,
    {
      log = () => {},
      progress = () => {},
      openNormal = openNormalConsole,
      wait = delay,
    } = {},
  ) {
    this.port = port;
    this.log = log;
    this.progress = progress;
    this.openNormal = openNormal;
    this.wait = wait;
  }

  async analyze() {
    const info = this.port.getInfo?.() ?? {};
    this.log("Opening the 1 Mbaud read-only factory console.");
    const normal = await openNormalConsole(this.port);
    let bootText;
    const replies = {};
    try {
      bootText = new TextDecoder().decode(await normal.collectFor(2500));
      for (const command of [0xa0, 0xa2, 0xa3, 0xa4]) {
        replies[command] = await queryNormal(normal, command);
      }
    } finally {
      await normal.close();
    }
    const consoleReport = parseConsoleReport(
      bootText,
      replies[0xa0],
      replies[0xa2],
      replies[0xa3],
      replies[0xa4],
    );
    this.progress(0.32, "Factory telemetry captured");
    this.log("Factory telemetry and identifiers captured.");

    const loader = new Stm32Bootloader(this.port, this.log);
    try {
      this.log("Entering the immutable STM32 ROM loader for bank inspection.");
      await loader.connect();
      this.progress(0.42, "ROM loader identified");
      const optionBytes = await loader.readRange(OPTION_BASE, OPTION_SIZE);
      const options = decodeOptionBytes(optionBytes);
      const activeHead = await loader.readRange(FLASH_BASE, 0x4000, (fraction) =>
        this.progress(0.45 + fraction * 0.18, "Reading active bank"),
      );
      const inactiveHead = await loader.readRange(
        FLASH_BASE + BANK_SIZE,
        0x4000,
        (fraction) => this.progress(0.63 + fraction * 0.18, "Reading inactive bank"),
      );
      return {
        usb: {
          vendorId: info.usbVendorId ?? null,
          productId: info.usbProductId ?? null,
        },
        console: consoleReport,
        rom: {
          protocolVersion: loader.version,
          productId: loader.productId,
          commands: loader.commands,
        },
        options,
        optionBytes,
        banks: {
          active: {
            aliasAddress: FLASH_BASE,
            physicalBank: options.activePhysicalBank,
            version: detectCaseVersion(activeHead),
            vectorValid: isPlausibleCaseImage(activeHead),
          },
          inactive: {
            aliasAddress: FLASH_BASE + BANK_SIZE,
            physicalBank: options.inactivePhysicalBank,
            version: detectCaseVersion(inactiveHead),
            vectorValid: isPlausibleCaseImage(inactiveHead),
          },
        },
      };
    } finally {
      await loader.close();
      await this.restoreNormal();
      this.progress(1, "Analysis complete");
    }
  }

  async restoreNormal({ requireVersion = false, expectedVersion = null } = {}) {
    try {
      const normal = await openNormalConsole(this.port);
      let text;
      try {
        text = new TextDecoder().decode(
          await normal.collectFor(requireVersion ? 5000 : 900),
        );
      } finally {
        await normal.close();
      }
      const report = parseConsoleReport(text);
      if (requireVersion && !report.caseVersion) {
        throw new Error("The normal B200 application banner was not observed.");
      }
      if (expectedVersion && report.caseVersion !== expectedVersion) {
        throw new Error(
          `The Case returned firmware ${report.caseVersion ?? "unknown"}, expected ${expectedVersion}.`,
        );
      }
      this.log(
        `Case returned to its normal application${report.caseVersion ? ` · B200 ${report.caseVersion}` : ""}.`,
      );
      return report;
    } catch (error) {
      this.log(`Normal-application return was not confirmed: ${error.message}`, "warn");
      if (requireVersion) throw error;
      return null;
    }
  }

  async backup({ progressBase = 0, progressSpan = 1 } = {}) {
    const reportProgress = (fraction, detail) =>
      this.progress(progressBase + fraction * progressSpan, detail);
    const loader = new Stm32Bootloader(this.port, this.log);
    try {
      this.log("Starting a read-only 512 KiB Case backup.");
      await loader.connect();
      const flash = await loader.readRange(FLASH_BASE, FLASH_SIZE, (fraction) =>
        reportProgress(
          fraction * 0.96,
          `Backing up Case · ${Math.round(fraction * 100)}%`,
        ),
      );
      const optionBytes = await loader.readRange(OPTION_BASE, OPTION_SIZE);
      const flashSha256 = await sha256Hex(flash);
      const optionSha256 = await sha256Hex(optionBytes);
      reportProgress(1, "Case backup verified");
      this.log(`Case backup verified · ${flashSha256.slice(0, 16)}…`);
      return { flash, optionBytes, flashSha256, optionSha256 };
    } finally {
      await loader.close();
      await this.restoreNormal();
    }
  }

  async readPostResetCaseTelemetry(attempts = 3) {
    if (!Number.isInteger(attempts) || attempts < 1) {
      throw new Error("Post-reset telemetry attempts must be a positive integer.");
    }
    const errors = [];
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let normal = null;
      try {
        normal = await this.openNormal(this.port);
        const boot = new TextDecoder().decode(await normal.collectFor(2500));
        const version = await queryNormal(normal, 0xa0, 900);
        const telemetry = await queryNormal(normal, 0xa3, 1000);
        const report = parseConsoleReport(boot, version, telemetry);
        if (report.caseVersion !== REVIEWED_CASE_VERSION) {
          throw new Error(
            `the Case returned firmware ${report.caseVersion ?? "unknown"}, expected ${REVIEWED_CASE_VERSION}`,
          );
        }
        if (!report.telemetry) {
          throw new Error("fresh GLS_L/GLS_R telemetry was not observed");
        }
        return {
          ...report,
          postResetTelemetrySession: "reopened",
          postResetTelemetryAttempt: attempt,
        };
      } catch (error) {
        errors.push(`attempt ${attempt}: ${error.message}`);
        this.log(
          `Post-reset Case-console attempt ${attempt}/${attempts} did not return complete telemetry: ${error.message}`,
          "warn",
        );
      } finally {
        if (normal) await normal.close();
      }
      if (attempt !== attempts) await this.wait(500);
    }
    throw new Error(
      `Fresh Case telemetry did not return after ${attempts} reopened serial sessions (${errors.join("; ")}).`,
    );
  }

  async restartAndRecheck() {
    this.log("Starting the traced stock reset for both seated G2 temples.");
    const normal = await this.openNormal(this.port);
    let boot;
    let resetOutput;
    try {
      boot = new TextDecoder().decode(await normal.collectFor(3000));
      resetOutput = await resetTemples(normal);
      this.log("The Case confirmed its left/right hardware reset sequence.");
    } finally {
      await normal.close();
    }
    this.log(
      "Reset confirmation captured; reopening the Case console for fresh post-reset telemetry.",
    );
    await this.wait(6500);
    const telemetryReport = await this.readPostResetCaseTelemetry();
    const resetReport = parseConsoleReport(boot, resetOutput);
    return {
      ...resetReport,
      ...telemetryReport,
      text: [resetReport.text, telemetryReport.text].filter(Boolean).join("\n"),
      serialNumber: telemetryReport.serialNumber ?? resetReport.serialNumber,
      identifier: telemetryReport.identifier ?? resetReport.identifier,
      resetConfirmed: true,
      resetConfirmationSession: "pre-restart",
    };
  }

  async probeRunningTemple(
    operation,
    route,
    options = {},
  ) {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await this.probeRunningTempleOnce(operation, route, options);
      } catch (error) {
        const routePhaseMismatch = error?.message?.includes(
          "YHM baseline was not an allowlisted seated-idle state",
        );
        if (!routePhaseMismatch || attempt === 4) throw error;
        this.log(
          `${route} ${operation}: Case charging phase is between allowlisted idle states; waiting before read-only retry ${attempt}/3.`,
          "warn",
        );
        await this.wait(500 * attempt);
      }
    }
    throw new Error("The bounded read-only temple retry loop ended unexpectedly.");
  }

  async probeRunningTempleOnce(
    operation,
    route,
    { progressBase = 0, progressSpan = 1 } = {},
  ) {
    const reportProgress = (fraction, detail) =>
      this.progress(progressBase + fraction * progressSpan, detail);
    if (!["status", "version"].includes(operation)) {
      throw new Error("The reviewed pogo bridge permits only status or version.");
    }
    if (!["left", "right"].includes(route)) {
      throw new Error("Select the left or right temple route.");
    }

    const payload = await getVerifiedPogoBridgePayload();
    const zeroProof = new Uint8Array(POGO_BRIDGE_PROOF.length);
    const zeroResult = new Uint8Array(POGO_BRIDGE_RESULT_LENGTH);
    let loader = null;
    let bridge = null;
    let bridgeLoaded = false;
    let residueCleared = false;

    const openProbeLoader = async (purpose) =>
      retryReadOnlyBlock(
        async () => {
          const candidate = new Stm32Bootloader(this.port, this.log);
          try {
            await candidate.connect();
            return candidate;
          } catch (error) {
            await candidate.close();
            throw error;
          }
        },
        async () => this.wait(400),
        {
          attempts: 3,
          onRetry: (error, attempt) =>
            this.log(
              `${purpose} loader synchronization retry ${attempt}/2 after ${error.message}`,
              "warn",
            ),
        },
      );

    const closeOpenTransports = async () => {
      if (bridge) {
        try {
          await bridge.close();
        } catch (error) {
          this.log(`Bridge transport close was not confirmed: ${error.message}`, "warn");
        } finally {
          bridge = null;
        }
      }
      if (loader) {
        try {
          await loader.close();
        } catch (error) {
          this.log(`ROM-loader transport close was not confirmed: ${error.message}`, "warn");
        } finally {
          loader = null;
        }
      }
    };

    const clearRetainedBridgeData = async () => {
      const cleanupLoader = await openProbeLoader("Pogo cleanup");
      try {
        await cleanupLoader.writeMemory(POGO_BRIDGE_PROOF_ADDRESS, zeroProof);
        await cleanupLoader.writeMemory(POGO_BRIDGE_RESULT_ADDRESS, zeroResult);
        const proofCheck = await cleanupLoader.readRange(
          POGO_BRIDGE_PROOF_ADDRESS,
          zeroProof.length,
        );
        const resultCheck = await cleanupLoader.readRange(
          POGO_BRIDGE_RESULT_ADDRESS,
          zeroResult.length,
        );
        if (!equalBytes(proofCheck, zeroProof) || !equalBytes(resultCheck, zeroResult)) {
          throw new Error("The volatile pogo bridge proof/result could not be cleared.");
        }
        residueCleared = true;
      } finally {
        await cleanupLoader.close();
      }
    };

    try {
      this.log(
        `Loading the pinned read-only pogo bridge for ${route} ${operation}.`,
      );
      loader = await openProbeLoader(`${route} ${operation}`);
      if (loader.version !== 0x31) {
        throw new Error(
          `Unexpected STM32 ROM protocol 0x${loader.version.toString(16)} for the reviewed bridge.`,
        );
      }
      for (const [command, label] of [
        [READ_MEMORY, "Read Memory"],
        [GO, "Go"],
        [WRITE_MEMORY, "Write Memory"],
      ]) {
        loader.requireCommand(command, label);
      }

      await loader.writeMemory(POGO_BRIDGE_PROOF_ADDRESS, zeroProof);
      await loader.writeMemory(POGO_BRIDGE_RESULT_ADDRESS, zeroResult);
      for (let offset = 0; offset < payload.length; offset += 256) {
        const chunk = payload.subarray(offset, Math.min(offset + 256, payload.length));
        const address = POGO_BRIDGE_ADDRESS + offset;
        await loader.writeMemory(address, chunk);
        const readback = await loader.readRange(address, chunk.length);
        if (!equalBytes(readback, chunk)) {
          throw new Error(
            `The volatile bridge readback differs at 0x${address.toString(16)}.`,
          );
        }
        reportProgress(
          0.1 + ((offset + chunk.length) / payload.length) * 0.42,
          "Verifying volatile read-only bridge",
        );
      }
      bridgeLoaded = true;
      this.log(`Verified all ${payload.length} pinned SRAM bridge bytes.`);

      await loader.go(POGO_BRIDGE_ADDRESS);
      // Both pinned bridges deliberately retain the ROM loader's 115200 8E1
      // host framing. Keep one Web Serial session so CH340 close/open control
      // transitions cannot reset the Case between GO and the bridge banner.
      await loader.releaseBootSelection();
      bridge = loader.takeTransport();
      loader = null;

      const banner = await bridge.readExact(
        POGO_BRIDGE_BANNER.length,
        3000,
        "pogo bridge banner",
      );
      if (!equalBytes(banner, POGO_BRIDGE_BANNER)) {
        throw new Error("The volatile pogo bridge banner is invalid.");
      }
      const request = makePogoBridgeRequest(operation, route);
      await bridge.write(request);
      const header = await bridge.readExact(12, 5000, "pogo bridge response header");
      const capturedLength = header[9];
      if (capturedLength > 64) {
        throw new Error("The pogo bridge declared an invalid capture length.");
      }
      const tail = await bridge.readExact(
        capturedLength + 1,
        3000,
        "pogo bridge response payload",
      );
      const response = parsePogoBridgeResponse(header, tail, request);
      await bridge.close();
      bridge = null;
      reportProgress(0.66, "Temple response captured");

      await delay(300);
      loader = await openProbeLoader(`${route} restoration proof`);
      const proof = await loader.readRange(
        POGO_BRIDGE_PROOF_ADDRESS,
        POGO_BRIDGE_PROOF.length,
      );
      if (!equalBytes(proof, POGO_BRIDGE_PROOF)) {
        throw new Error("The volatile pogo bridge execution proof was not retained.");
      }
      const retainedResult = await loader.readRange(
        POGO_BRIDGE_RESULT_ADDRESS,
        POGO_BRIDGE_RESULT_LENGTH,
      );
      const transportProof = validatePogoBridgeRetainedResult(
        retainedResult,
        response,
        operation,
        route,
      );
      reportProgress(0.84, "Router restoration proof verified");

      await loader.writeMemory(POGO_BRIDGE_PROOF_ADDRESS, zeroProof);
      await loader.writeMemory(POGO_BRIDGE_RESULT_ADDRESS, zeroResult);
      const proofCheck = await loader.readRange(
        POGO_BRIDGE_PROOF_ADDRESS,
        zeroProof.length,
      );
      const resultCheck = await loader.readRange(
        POGO_BRIDGE_RESULT_ADDRESS,
        zeroResult.length,
      );
      if (!equalBytes(proofCheck, zeroProof) || !equalBytes(resultCheck, zeroResult)) {
        throw new Error("The volatile pogo bridge proof/result could not be cleared.");
      }
      residueCleared = true;

      if (response.status !== 0) {
        throw new Error(
          `The pogo bridge stopped safely: ${POGO_BRIDGE_STATUS[response.status] ?? `status ${response.status}`}.`,
        );
      }
      const decoded = parseTempleFrame(response.captured, operation);
      this.log(
        `Verified ${route} ${operation} response and byte-for-byte YHM restoration.`,
        "success",
      );
      reportProgress(0.94, "Read-only pogo diagnostics verified");
      return {
        operation,
        route,
        decoded,
        captured: response.captured,
        transportProof,
      };
    } finally {
      await closeOpenTransports();
      if (bridgeLoaded && !residueCleared) {
        try {
          await clearRetainedBridgeData();
          this.log("Cleared retained volatile pogo bridge proof after interruption.");
        } catch (cleanupError) {
          this.log(
            `Could not confirm volatile pogo bridge cleanup: ${cleanupError.message}`,
            "warn",
          );
        }
      }
      await this.restoreNormal();
      if (residueCleared) reportProgress(1, "Case application restored");
    }
  }

  async readTempleFlashPreflight(routes) {
    this.log("Refreshing Case firmware and seated-temple telemetry before flashing.");
    const normal = await openNormalConsole(this.port);
    try {
      const bootText = new TextDecoder().decode(await normal.collectFor(2500));
      const telemetryText = await queryNormal(normal, 0xa3, 1000);
      const report = parseConsoleReport(bootText, telemetryText);
      if (report.caseVersion !== REVIEWED_CASE_VERSION) {
        throw new PogoFlashSafetyError(
          `The volatile writer is pinned to Case ${REVIEWED_CASE_VERSION}; this Case reports ${report.caseVersion ?? "unknown"}.`,
        );
      }
      if (!report.telemetry) {
        throw new PogoFlashSafetyError(
          "Fresh Case telemetry was not available before the mutating operation.",
        );
      }
      for (const route of routes) {
        const present =
          route === "left"
            ? report.telemetry.leftPresent
            : report.telemetry.rightPresent;
        if (!present) {
          throw new PogoFlashSafetyError(
            `Fresh Case telemetry does not report the ${route} temple as seated.`,
          );
        }
      }
      return report;
    } finally {
      await normal.close();
    }
  }

  async verifyPostResetTempleLiveness(
    resetReport,
    routes,
    {
      expectedVersion = null,
      progressBase = 0.95,
      progressSpan = 0.04,
    } = {},
  ) {
    if (resetReport.caseVersion !== REVIEWED_CASE_VERSION) {
      throw new PogoFlashSafetyError(
        `The final reset returned Case ${resetReport.caseVersion ?? "unknown"}, expected ${REVIEWED_CASE_VERSION}.`,
      );
    }
    if (!resetReport.telemetry) {
      throw new PogoFlashSafetyError(
        "Fresh Case telemetry did not return after the final B0 reset.",
      );
    }
    for (const route of routes) {
      const present =
        route === "left"
          ? resetReport.telemetry.leftPresent
          : resetReport.telemetry.rightPresent;
      if (!present) {
        throw new PogoFlashSafetyError(
          `${route}: contact did not return after the final B0 reset.`,
        );
      }
    }

    const versions = {};
    for (let index = 0; index < routes.length; index += 1) {
      const route = routes[index];
      const probe = await this.probeRunningTemple("version", route, {
        progressBase: progressBase + (index / routes.length) * progressSpan,
        progressSpan: progressSpan / routes.length,
      });
      const version = probe.decoded;
      if (
        version.hardwareRevision !== 5 ||
        (expectedVersion && version.firmwareVersion !== expectedVersion)
      ) {
        const expected = expectedVersion
          ? `${expectedVersion}/hardware 5`
          : "hardware 5";
        throw new PogoFlashSafetyError(
          `${route}: post-reset expected ${expected}, observed ${version.firmwareVersion}/hardware ${version.hardwareRevision}.`,
        );
      }
      versions[route] = {
        firmware: version.firmwareVersion,
        hardware: version.hardwareRevision,
        yhmRestoreVerified: probe.transportProof?.restoredMask === 0x3ff,
      };
    }
    const finalCase = await this.restoreNormal({
      requireVersion: true,
      expectedVersion: REVIEWED_CASE_VERSION,
    });
    return { versions, finalCase };
  }

  async restartAndVerifyBothTemples() {
    const resetReport = await this.restartAndRecheck();
    const { versions, finalCase } = await this.verifyPostResetTempleLiveness(
      resetReport,
      ["right", "left"],
      { progressBase: 0.6, progressSpan: 0.38 },
    );
    this.progress(1, "Reset, contacts, and temple liveness verified");
    this.log(
      "B0 reset confirmed in the first serial session; reopened Case telemetry and checksum-valid left/right version replies verified.",
      "success",
    );
    return {
      ...resetReport,
      caseVersion: finalCase.caseVersion,
      versions,
      applicationLivenessVerified: true,
      firmwareBytesTransmitted: 0,
    };
  }

  async finalizeTempleRestore(routes, expectedVersion) {
    this.log(
      "All selected routes and the Case application are restored; sending the final traced B0 dual-temple reset.",
    );
    this.progress(0.93, "Final dual-temple reset");
    const resetReport = await this.restartAndRecheck();
    const { versions, finalCase } = await this.verifyPostResetTempleLiveness(
      resetReport,
      routes,
      { expectedVersion },
    );
    this.progress(1, "Final reset and temple liveness verified");
    this.log(
      "Final B0 reset confirmed; selected contacts and checksum-valid post-reset version replies verified.",
      "success",
    );
    return {
      outcome: "success",
      command: "DEB0",
      templeMutation: "traced stock dual-temple reset",
      resetConfirmed: true,
      caseFirmware: finalCase.caseVersion,
      resetConfirmationSession: resetReport.resetConfirmationSession,
      postResetTelemetrySession: resetReport.postResetTelemetrySession,
      postResetTelemetryAttempt: resetReport.postResetTelemetryAttempt,
      leftPresent: resetReport.telemetry.leftPresent,
      rightPresent: resetReport.telemetry.rightPresent,
      versions,
      versionIsLivenessNotImageProvenance: true,
    };
  }

  async resetTempleOtaReceiverForComponentRestart(
    routes,
    expectedVersion,
    route,
    routeIndex,
    routeCount,
  ) {
    const progressBase = (routeIndex / routeCount) * 0.9;
    this.log(
      `${route}: cleanup is fully proven; sending an intermediate bilateral reset before one fresh full-component restart.`,
      "warn",
    );
    this.progress(progressBase, `${route}: recovery reset before full restart`);
    const attempts = [];
    for (
      let attempt = 1;
      attempt <= POGO_INTERMEDIATE_RESET_ATTEMPTS;
      attempt += 1
    ) {
      const resetReport = await this.restartAndRecheck();
      try {
        const { versions, finalCase } =
          await this.verifyPostResetTempleLiveness(
            resetReport,
            routes,
            {
              expectedVersion,
              progressBase,
              progressSpan: Math.min(0.04, 0.9 / routeCount),
            },
          );
        attempts.push({ attempt, outcome: "success" });
        this.log(
          `${route}: intermediate reset, contacts, Case application, and temple liveness verified${attempt > 1 ? ` on bounded reset attempt ${attempt}` : ""}; restarting from START rather than replaying an ambiguous DATA record.`,
          "success",
        );
        return {
          outcome: "success",
          command: "DEB0",
          resetConfirmed: true,
          resetAttempts: attempts,
          caseFirmware: finalCase.caseVersion,
          leftPresent: resetReport.telemetry.leftPresent,
          rightPresent: resetReport.telemetry.rightPresent,
          versions,
        };
      } catch (error) {
        attempts.push({
          attempt,
          outcome: "failed",
          error: error.message,
        });
        if (
          attempt === POGO_INTERMEDIATE_RESET_ATTEMPTS ||
          !isRetryablePostResetLivenessFailure(error)
        ) {
          error.intermediateResetAttempts = attempts;
          throw error;
        }
        this.log(
          `${route}: the first intermediate reset returned a transient no-frame liveness probe; sending one bounded second bilateral reset before deciding whether a fresh START is safe.`,
          "warn",
        );
      }
    }
    throw new PogoFlashSafetyError(
      "The bounded intermediate reset loop ended unexpectedly.",
    );
  }

  async flashPinnedTempleRoute(
    component,
    expectedTargetVersion,
    route,
    routeIndex,
    routeCount,
    dataPacingMultiplier = 1,
  ) {
    if (
      !Number.isInteger(dataPacingMultiplier) ||
      dataPacingMultiplier < 1 ||
      dataPacingMultiplier > 2
    ) {
      throw new PogoFlashSafetyError(
        "Temple DATA pacing multiplier must be one or two.",
      );
    }
    const progressBase = (routeIndex / routeCount) * 0.9;
    const progressSpan = 0.9 / routeCount;
    const transport = new CasePogoFlashTransport(this, route, {
      progressBase,
      progressSpan,
    });
    const result = {
      route,
      outcome: "started",
      preflightVersion: null,
      transfer: null,
      postflightVersion: null,
      caseRestoreVerified: false,
      caseApplicationVersion: null,
      retainedResult: null,
      routePhaseSetupAttempts: 0,
      otaMutationAttempted: false,
      acceptedFirmwareBytes: 0,
      dataPacingPolicy: {
        deferredBatchBytes: POGO_DEFERRED_BATCH_BYTES,
        multiplier: dataPacingMultiplier,
        batchSettleMs:
          POGO_DATA_BATCH_SETTLE_MS * dataPacingMultiplier,
        lateBatchSettleMs:
          POGO_DATA_LATE_BATCH_SETTLE_MS * dataPacingMultiplier,
        finalSettleMs:
          POGO_DATA_FINAL_SETTLE_MS * dataPacingMultiplier,
        lateThresholdPercent:
          (POGO_DATA_LATE_SETTLE_NUMERATOR /
            POGO_DATA_LATE_SETTLE_DENOMINATOR) *
          100,
        explicitRejectionRetryAllowed: false,
        explicitRejectionAction:
          "cleanup_reset_and_fresh_component_restart",
        hostOnlyKeepaliveIntervalMs: 5000,
      },
    };
    let operationError = null;
    let cleanupError = null;
    let failureStage = "setup";

    try {
      await transport.open();
      result.routePhaseSetupAttempts = transport.routePhaseSetupAttempts;
      failureStage = "PREFLIGHT";
      const preflightFrame = await transport.transact(makeTempleVersionRequest(), 8000);
      const preflight = decodeTempleVersion(preflightFrame);
      result.preflightVersion = preflight;
      if (
        preflight.firmware !== REVIEWED_CFW_BASE_VERSION ||
        preflight.hardware !== 5
      ) {
        throw new PogoFlashSafetyError(
          `${route}: expected running firmware ${REVIEWED_CFW_BASE_VERSION}/hardware 5, observed ${preflight.firmware}/hardware ${preflight.hardware}.`,
        );
      }
      this.log(
        `${route}: preflight firmware=${preflight.firmware}, hardware=${preflight.hardware}.`,
      );

      // Take one just-in-time liveness sample before the first non-idempotent
      // OTA transition. Repeated probes consume the short app-mode route and
      // do not prove that the later mutation will work.
      for (let probe = 2; probe <= POGO_STABILITY_READ_QUERIES; probe += 1) {
        await delay(POGO_STABILITY_INTERVAL_MS);
        try {
          const observed = decodeTempleVersion(
            await transport.transact(makeTempleVersionRequest(), 8000),
          );
          if (
            observed.firmware !== preflight.firmware ||
            observed.hardware !== preflight.hardware
          ) {
            throw new PogoFlashSafetyError(
              `${route}: stability query ${probe}/${POGO_STABILITY_READ_QUERIES} changed from ${preflight.firmware}/hardware ${preflight.hardware} to ${observed.firmware}/hardware ${observed.hardware}.`,
            );
          }
        } catch (error) {
          throw new PogoFlashSafetyError(
            `${route}: stability query ${probe}/${POGO_STABILITY_READ_QUERIES} failed before any OTA command: ${error.message}`,
          );
        }
      }
      result.stabilityPreflight = {
        outcome: "success",
        queries: POGO_STABILITY_READ_QUERIES,
        intervalMs: POGO_STABILITY_INTERVAL_MS,
      };
      this.log(
        `${route}: completed ${POGO_STABILITY_READ_QUERIES} fresh read-only liveness query.`,
      );
      await delay(250);
      transport.drainInput();

      // Start and header mutate OTA state and are intentionally never replayed.
      failureStage = "START";
      const start = makeOtaStartRequest();
      result.otaMutationAttempted = true;
      requireOtaAcknowledgement(await transport.transact(start, 8000), start[0]);
      failureStage = "HEADER";
      const header = makeOtaHeaderRequest(component.header);
      requireOtaAcknowledgement(await transport.transact(header, 8000), header[0]);

      const payload = component.payload;
      const totalRecords = Math.ceil(payload.length / 1000);
      let acceptedBytes = 0;
      let retries = 0;
      for (let index = 0; index < totalRecords; index += 1) {
        failureStage = `DATA:${index}`;
        const offset = index * 1000;
        const data = payload.subarray(offset, Math.min(offset + 1000, payload.length));
        const final = index + 1 === totalRecords;
        const request = makeOtaDataRequest(data, final, index & 0xff);
        try {
          const response = await transport.transact(request, 15000);
          requireOtaAcknowledgement(response, 0x54);
        } catch (error) {
          if (!isExplicitTempleDataRejection(error)) throw error;
          this.log(
            `${route}: explicit rejection left DATA record ${index + 1} unadvanced; ending this component attempt so cleanup, reset, and a fresh START can occur without replaying the record.`,
            "warn",
          );
          throw error;
        }
        acceptedBytes += data.length;
        result.acceptedFirmwareBytes = acceptedBytes;
        transport.reportProgress(
          0.08 + ((index + 1) / totalRecords) * 0.78,
          `${route}: ${index + 1}/${totalRecords} main records`,
        );
        const settleMilliseconds =
          templeDataSettleMilliseconds(acceptedBytes, payload.length) *
          dataPacingMultiplier;
        if (settleMilliseconds > 0) {
          await transport.settleTempleStorage(settleMilliseconds);
        }
      }

      const finish = makeOtaFinishRequest();
      failureStage = "FINISH";
      requireOtaAcknowledgement(await transport.transact(finish, 60000), finish[0]);
      transport.completedTransfer = {
        payloadBytes: acceptedBytes,
        records: totalRecords,
      };
      result.transfer = {
        recordsSent: totalRecords,
        payloadBytesSent: acceptedBytes,
        dataRetries: retries,
        hostOnlyKeepalives: transport.hostOnlyKeepalives,
        finishAckReceived: true,
      };
      this.log(
        `${route}: all ${totalRecords.toLocaleString()} records and the finish acknowledgement were accepted.`,
        "success",
      );

      const deadline = Date.now() + 180000;
      failureStage = "POSTFLIGHT";
      let lastVersion = null;
      while (Date.now() < deadline) {
        await delay(2000);
        transport.drainInput();
        try {
          const version = decodeTempleVersion(
            await transport.transact(makeTempleVersionRequest(), 8000),
          );
          lastVersion = version;
          if (
            version.firmware === expectedTargetVersion &&
            version.hardware === preflight.hardware
          ) {
            result.postflightVersion = version;
            break;
          }
        } catch (error) {
          if (!(error instanceof RetryablePogoFlashError)) throw error;
        }
      }
      if (!result.postflightVersion) {
        throw new RetryablePogoFlashError(
          lastVersion
            ? `${route}: postflight reported ${lastVersion.firmware}/hardware ${lastVersion.hardware}.`
            : `${route}: no checksum-valid postflight version arrived within 180 seconds.`,
        );
      }
      transport.reportProgress(0.9, `${route}: postflight liveness verified`);
      this.log(
        `${route}: postflight firmware=${result.postflightVersion.firmware}, hardware=${result.postflightVersion.hardware}.`,
        "success",
      );
    } catch (error) {
      operationError = error;
    } finally {
      try {
        await transport.close();
      } catch (error) {
        cleanupError = error;
      }
      result.caseRestoreVerified = transport.restoreVerified;
      result.caseApplicationVersion = transport.caseReport?.caseVersion ?? null;
      result.routePhaseSetupAttempts = transport.routePhaseSetupAttempts;
      if (transport.retainedResult) {
        result.retainedResult = {
          ...transport.retainedResult,
          baseline: compactHex(transport.retainedResult.baseline),
          selected: compactHex(transport.retainedResult.selected),
          restored: compactHex(transport.retainedResult.restored),
        };
      }
      if (operationError) {
        result.failureStage = failureStage;
        const recoveryBoundary = classifyPogoFlashRecoveryBoundary(
          operationError,
          transport.retainedResult,
          failureStage,
        );
        if (recoveryBoundary) result.recoveryBoundary = recoveryBoundary;
      }
    }

    if (operationError || cleanupError) {
      result.outcome = "failed_or_uncertain";
      if (operationError) result.error = operationError.message;
      if (cleanupError) result.cleanupError = cleanupError.message;
      const details = [
        operationError && `temple transaction: ${operationError.message}`,
        cleanupError && `Case cleanup: ${cleanupError.message}`,
      ].filter(Boolean);
      const error = new PogoFlashSafetyError(`${route}: ${details.join("; ")}`);
      error.routeResult = result;
      throw error;
    }
    result.outcome = "success";
    transport.reportProgress(1, `${route}: route and Case application restored`);
    return result;
  }

  async flashPinnedTempleMain(
    firmware,
    routeSelection = "both",
    {
      mode = "complete",
      differenceSourceFirmware = null,
      sourceProofMode = null,
    } = {},
  ) {
    const { mainComponent: component, target } =
      await assertPinnedTempleFlashCandidate(firmware);
    if (!["complete", "differences"].includes(mode)) {
      throw new PogoFlashSafetyError("Choose complete or differences flashing.");
    }
    let differencePlan = null;
    if (mode === "differences") {
      await assertPinnedTempleFlashCandidate(differenceSourceFirmware);
      differencePlan = buildBundleDifferencePlan(
        differenceSourceFirmware,
        firmware,
      );
      if (!differencePlan.executable) {
        throw new PogoFlashSafetyError(
          "The Stock/CFW difference plan is not an exact one-component transition.",
        );
      }
      this.log(
        `Difference plan verified: ${differencePlan.unchangedComponentCount} identical components omitted; transmitting the one changed, CRC-gated Apollo main.`,
        "success",
      );
    }
    const routes =
      routeSelection === "both"
        ? ["right", "left"]
        : [routeSelection];
    if (!routes.every((route) => ["left", "right"].includes(route))) {
      throw new PogoFlashSafetyError("Choose both, left, or right for temple flashing.");
    }
    // DEB0 always resets both seated temples. Even for a one-route repair,
    // prove that both applications returned before another START and again
    // after the final reset.
    const livenessRoutes = ["right", "left"];

    const audit = {
      schemaVersion: 3,
      startedAt: new Date().toISOString(),
      operation:
        mode === "differences"
          ? "g2_case_usb_bundle_component_differences"
          : "g2_case_usb_pinned_main_only",
      flashMode: mode,
      differencePlan,
      imageSha256: firmware.fileSha256,
      imageLabel: target.label,
      imageHardwareValidated: target.hardwareValidated,
      mainPayloadSha256: component.payloadSha256,
      sourceValidation:
        mode === "differences"
          ? {
              mode:
                sourceProofMode ?? "caller-confirmed-source",
              exactInstalledImageReadbackAvailable: false,
              requiredLiveFirmware: target.version,
              requiredLiveHardware: 5,
              completeTargetMainTransferred: true,
              sparseByteRangesTransferred: false,
              routePreflight: null,
            }
          : null,
      bridgeSha256:
        POGO_FLASH_BRIDGE_SHA256,
      routes,
      routeOrderSetupStops: [],
      supersededSuccessfulRouteResults: [],
      routeComponentRestartAttempts: [],
      routeComponentRestartResets: [],
      componentRestartLimit: POGO_COMPONENT_RESTART_LIMIT,
      bilateralRouteAdaptationLimit: POGO_BILATERAL_ROUTE_ADAPTATION_LIMIT,
      bootloaderAllowed: false,
      preflightCase: null,
      routeResults: [],
      finalResetAndLiveness: null,
      outcome: "started",
    };
    try {
      const preflightCase = await this.readTempleFlashPreflight(routes);
      audit.preflightCase = {
        firmware: preflightCase.caseVersion,
        lidOpen: preflightCase.telemetry?.open ?? null,
        usbPresent: preflightCase.telemetry?.usbPresent ?? null,
        leftPresent: preflightCase.telemetry?.leftPresent ?? null,
        rightPresent: preflightCase.telemetry?.rightPresent ?? null,
      };
      const componentRestartCounts = new Map();
      for (let index = 0; index < routes.length; index += 1) {
        const route = routes[index];
        const componentRestartCount =
          componentRestartCounts.get(route) ?? 0;
        try {
          audit.routeResults.push(
            await this.flashPinnedTempleRoute(
              component,
              target.version,
              route,
              index,
              routes.length,
              componentRestartCount > 0 ? 2 : 1,
            ),
          );
        } catch (error) {
          const phaseCompatibleRoute =
            error.routeResult?.retainedResult?.phaseCompatibleRoute;
          const canAdaptBilateralOrder =
            routeSelection === "both" &&
            index === 0 &&
            ["left", "right"].includes(phaseCompatibleRoute) &&
            phaseCompatibleRoute !== route &&
            audit.routeOrderSetupStops.length <
              POGO_BILATERAL_ROUTE_ADAPTATION_LIMIT &&
            error.routeResult?.retainedResult?.noMutationPhaseStopVerified ===
              true &&
            error.routeResult?.acceptedFirmwareBytes === 0 &&
            error.routeResult?.otaMutationAttempted === false &&
            error.routeResult?.caseRestoreVerified === true &&
            error.routeResult?.caseApplicationVersion === REVIEWED_CASE_VERSION;
          if (canAdaptBilateralOrder) {
            audit.routeOrderSetupStops.push(error.routeResult);
            if (audit.routeResults.length) {
              audit.supersededSuccessfulRouteResults.push(
                ...audit.routeResults,
              );
              audit.routeResults.length = 0;
            }
            const secondRoute =
              phaseCompatibleRoute === "left" ? "right" : "left";
            routes.splice(
              0,
              routes.length,
              phaseCompatibleRoute,
              secondRoute,
            );
            this.log(
              `Bilateral route order adapted to ${phaseCompatibleRoute} then ${secondRoute} from an exact allowlisted, zero-write Case phase proof.`,
              "warn",
            );
            index = -1;
            continue;
          }
          if (
            canRestartFailedTempleComponent(
              error.routeResult,
              componentRestartCount,
            )
          ) {
            audit.routeComponentRestartAttempts.push(error.routeResult);
            audit.routeComponentRestartResets.push(
              await this.resetTempleOtaReceiverForComponentRestart(
                livenessRoutes,
                target.version,
                route,
                index,
                routes.length,
              ),
            );
            componentRestartCounts.set(route, componentRestartCount + 1);
            index -= 1;
            continue;
          }
          if (error.routeResult) audit.routeResults.push(error.routeResult);
          throw error;
        }
      }
      audit.finalResetAndLiveness = await this.finalizeTempleRestore(
        livenessRoutes,
        target.version,
      );
      if (audit.sourceValidation) {
        audit.sourceValidation.routePreflight = Object.fromEntries(
          audit.routeResults.map((result) => [
            result.route,
            {
              firmware: result.preflightVersion?.firmware ?? null,
              hardware: result.preflightVersion?.hardware ?? null,
              checksumValid: Boolean(result.preflightVersion),
              validatedBeforeStart: true,
            },
          ]),
        );
      }
      audit.verification = {
        targetBundleSha256: firmware.fileSha256,
        targetMainSha256: component.payloadSha256,
        targetMainBytes: component.payload.length,
        everyRouteAcceptedExactTargetBytes: audit.routeResults.every(
          (result) =>
            result.transfer?.finishAckReceived &&
            result.transfer.payloadBytesSent === component.payload.length &&
            result.retainedResult?.acceptedSize === component.payload.length,
        ),
        everyRoutePostflightVersionValid: audit.routeResults.every(
          (result) =>
            result.postflightVersion?.firmware === target.version &&
            result.postflightVersion?.hardware === 5,
        ),
        everyRoutePreflightCompatible: audit.routeResults.every(
          (result) =>
            result.preflightVersion?.firmware === target.version &&
            result.preflightVersion?.hardware === 5,
        ),
        finalDualTempleResetVerified:
          audit.finalResetAndLiveness?.resetConfirmed === true,
        postResetLivenessVerified: livenessRoutes.every(
          (route) =>
            audit.finalResetAndLiveness?.versions?.[route]?.firmware ===
              target.version &&
            audit.finalResetAndLiveness?.versions?.[route]?.hardware === 5,
        ),
        installedByteReadbackAvailable: false,
        installedByteReadbackBoundary:
          "The stock Case route exposes the OTA receiver, not installed Apollo MRAM readback; the target is proven by its pinned header/CRC, exact accepted byte count, finish acknowledgement, reboot, and post-reset liveness.",
      };
      if (
        !audit.verification.everyRouteAcceptedExactTargetBytes ||
        !audit.verification.everyRoutePreflightCompatible ||
        !audit.verification.everyRoutePostflightVersionValid ||
        !audit.verification.finalDualTempleResetVerified ||
        !audit.verification.postResetLivenessVerified
      ) {
        throw new PogoFlashSafetyError(
          "The transfer completed but the consolidated verification proof is incomplete.",
        );
      }
      audit.outcome = "success";
      this.progress(1, "Pinned transfer, final reset, and liveness verified");
      return audit;
    } catch (error) {
      audit.outcome = "failed_or_uncertain";
      audit.error = error.message;
      if (
        !audit.finalResetAndLiveness &&
        canRunFinalResetAfterFailure(audit.routeResults)
      ) {
        try {
          audit.finalResetAndLiveness = await this.finalizeTempleRestore(
            livenessRoutes,
            target.version,
          );
          this.log(
            "Transfer remains failed or uncertain; final B0 reset and post-reset liveness nevertheless verified.",
            "warn",
          );
        } catch (resetError) {
          audit.finalResetAndLiveness = {
            outcome: "failed",
            error: resetError.message,
          };
        }
      }
      error.audit = audit;
      throw error;
    } finally {
      audit.finishedAt = new Date().toISOString();
    }
  }

  async stageCaseImage(caseImage, optionSnapshot) {
    const options = decodeOptionBytes(optionSnapshot);
    const pageCount = Math.ceil(caseImage.length / FLASH_PAGE_SIZE);
    const physicalPageStart = options.swapBank ? 128 : 0;
    const pages = Array.from(
      { length: pageCount },
      (_, index) => physicalPageStart + index,
    );
    const loader = new Stm32Bootloader(this.port, this.log);
    try {
      await loader.connect();
      const currentOptions = await loader.readRange(OPTION_BASE, OPTION_SIZE);
      if (!equalBytes(currentOptions, optionSnapshot)) {
        throw new Error(
          "The option bytes changed after analysis. Analyze again before staging.",
        );
      }
      this.log(
        `Erasing ${pageCount} bounded pages in inactive physical bank ${options.inactivePhysicalBank}.`,
      );
      await loader.erasePages(pages);
      this.progress(0.08, "Inactive pages erased");
      await loader.writeRange(INACTIVE_ALIAS, caseImage, (fraction) =>
        this.progress(0.08 + fraction * 0.7, `Writing inactive bank · ${Math.round(fraction * 100)}%`),
      );
      const readback = await loader.readRange(
        INACTIVE_ALIAS,
        caseImage.length,
        (fraction) =>
          this.progress(0.78 + fraction * 0.2, `Verifying inactive bank · ${Math.round(fraction * 100)}%`),
      );
      const sourceSha256 = await sha256Hex(caseImage);
      const readbackSha256 = await sha256Hex(readback);
      if (sourceSha256 !== readbackSha256 || !equalBytes(caseImage, readback)) {
        throw new Error("Inactive-bank readback does not match the selected Case image.");
      }
      this.progress(1, "Inactive bank verified");
      this.log(`Inactive bank staged and verified · ${readbackSha256.slice(0, 16)}…`);
      return { sourceSha256, readbackSha256, pageCount, optionSnapshot };
    } finally {
      await loader.close();
      await this.restoreNormal();
    }
  }

  async activateStagedBank(caseImage, optionSnapshot) {
    const loader = new Stm32Bootloader(this.port, this.log);
    let optionWriteStarted = false;
    try {
      await loader.connect();
      const currentOptions = await loader.readRange(OPTION_BASE, OPTION_SIZE);
      if (!equalBytes(currentOptions, optionSnapshot)) {
        throw new Error(
          "The option bytes changed after staging. Analyze and stage again.",
        );
      }
      const readback = await loader.readRange(
        INACTIVE_ALIAS,
        caseImage.length,
        (fraction) => this.progress(fraction * 0.35, "Rechecking staged bank"),
      );
      if (!equalBytes(readback, caseImage)) {
        throw new Error("The staged bank no longer matches the selected image.");
      }
      const nextOptions = toggledBankOptionBytes(currentOptions);
      this.log("Staged image reverified. Committing the bank-selection option word.");
      optionWriteStarted = true;
      await loader.writeMemory(OPTION_BASE, nextOptions, 8000);
      this.progress(0.72, "Bank selection committed");
    } catch (error) {
      if (!optionWriteStarted) throw error;
      if (/NACK|unexpected 0x/i.test(error?.message ?? "")) throw error;
      this.log(
        "The option-byte write reset the Case before the final acknowledgement; checking the normal application.",
        "warn",
      );
    } finally {
      await loader.close();
    }

    await delay(1200);
    const report = await this.restartAndRecheck();
    this.progress(1, "Activated and restarted");
    return report;
  }
}

export function webSerialSupported() {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

export function isG2CaseSerialPort(port) {
  try {
    const { usbVendorId, usbProductId } = port?.getInfo?.() ?? {};
    return usbVendorId === 0x1a86 && usbProductId === 0x7523;
  } catch {
    return false;
  }
}

export async function requestG2CasePort() {
  if (!webSerialSupported()) {
    throw new Error("Web Serial is not available. Use current Chrome or Edge on desktop.");
  }
  const grantedPorts = await navigator.serial.getPorts();
  const grantedCases = grantedPorts.filter(isG2CaseSerialPort);
  if (grantedCases.length === 1) {
    return grantedCases[0];
  }
  return navigator.serial.requestPort({
    filters: [{ usbVendorId: 0x1a86, usbProductId: 0x7523 }],
  });
}
