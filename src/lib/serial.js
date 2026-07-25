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
  POGO_FLASH_PROOF,
  POGO_FLASH_PROOF_ADDRESS,
  POGO_FLASH_RESULT_ADDRESS,
  POGO_FLASH_RESULT_LENGTH,
  POGO_FLASH_STATUS,
  REVIEWED_CASE_VERSION,
  REVIEWED_CFW_BASE_VERSION,
  RetryablePogoFlashError,
  PogoFlashSafetyError,
  assertPinnedTempleFlashCandidate,
  decodeTempleVersion,
  getVerifiedPogoFlashBridgePayload,
  makeOtaDataRequest,
  makeOtaFinishRequest,
  makeOtaHeaderRequest,
  makeOtaStartRequest,
  makePogoFlashSetup,
  makePogoFlashTransactionHeader,
  makeTempleVersionRequest,
  parsePogoFlashReady,
  parsePogoFlashResponse,
  parsePogoFlashRetainedResult,
  requireOtaAcknowledgement,
} from "./pogoFlashBridge.js";

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

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function compactHex(input) {
  return [...(input ?? [])]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function requireReviewedCaseRom(loader) {
  if (loader.version !== 0x31 || loader.productId !== 0x0467) {
    throw new PogoFlashSafetyError(
      `The case ROM identity differs from the reviewed device (protocol=0x${loader.version
        ?.toString(16)}, product=0x${loader.productId?.toString(16)}).`,
    );
  }
  if (
    loader.commands.length !== REVIEWED_CASE_ROM_COMMANDS.length ||
    !REVIEWED_CASE_ROM_COMMANDS.every((command) =>
      loader.commands.includes(command))
  ) {
    throw new PogoFlashSafetyError(
      `The case ROM command table differs from the reviewed device (${loader.commands
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

  requireCommand(command, label) {
    if (!this.commands.includes(command)) {
      throw new Error(`The case ROM loader does not advertise ${label}.`);
    }
  }

  async sendCommand(command, label) {
    await this.transport.write(new Uint8Array([command, command ^ 0xff]));
    await this.expectAck(label);
  }

  async expectAck(label, timeoutMs = 3000) {
    const value = (await this.transport.readExact(1, timeoutMs, `${label} ACK`))[0];
    if (value === NACK) throw new Error(`The case returned NACK during ${label}.`);
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
    for (let offset = 0; offset < size; offset += 256) {
      const length = Math.min(256, size - offset);
      output.set(await this.readMemory(address + offset, length), offset);
      onProgress?.((offset + length) / size);
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

async function openPogoBridgeHost(port) {
  const transport = new SerialTransport(port);
  await transport.open({
    baudRate: 1_000_000,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
    bufferSize: 4096,
  });
  return transport;
}

async function openPogoFlashBridgeHost(port) {
  const transport = new SerialTransport(port);
  await transport.open({
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
    bufferSize: 65536,
  });
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
      "The case did not confirm the traced B0 left/right temple reset command.",
    );
  }
  return resetOutput;
}

class CasePogoFlashTransport {
  constructor(session, route, { progressBase = 0, progressSpan = 1 } = {}) {
    if (!["left", "right"].includes(route)) {
      throw new PogoFlashSafetyError("The case bridge route must be left or right.");
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
    this.caseReport = null;
    this.completedTransfer = null;
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
        const readback = await this.loader.readMemory(address, chunk.length);
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
      await this.closeTransport("loader");

      this.bridge = await openPogoFlashBridgeHost(this.port);
      await delay(120);
      if (this.bridge.queuedBytes > 0) {
        const banner = await this.bridge.readExact(
          POGO_FLASH_BRIDGE_BANNER.length,
          800,
          "flash bridge banner",
        );
        if (!equalBytes(banner, POGO_FLASH_BRIDGE_BANNER)) {
          throw new PogoFlashSafetyError("The volatile flash bridge banner is invalid.");
        }
      }

      const setup = makePogoFlashSetup(this.route);
      await this.bridge.write(setup);
      const ready = await this.bridge.readExact(13, 10000, "flash bridge ready response");
      parsePogoFlashReady(ready, setup);
      this.active = true;
      this.session.log(
        `${this.route}: verified the 2,872-byte volatile writer and selected the seated route.`,
      );
    } catch (error) {
      await this.closeTransport("loader");
      await this.closeTransport("bridge");
      throw error;
    }
  }

  async readBridgeResponse(timeoutMs) {
    const header = await this.bridge.readExact(
      11,
      Math.max(10000, timeoutMs + 10000),
      "flash bridge response header",
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
      await this.bridge.write(
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
          "No complete temple response arrived through the case bridge.",
        );
      }
      if (response.status !== 0) {
        throw new PogoFlashSafetyError(
          `The case bridge stopped safely: ${POGO_FLASH_STATUS[response.status] ?? `status ${response.status}`}.`,
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

  async requestExit() {
    if (!this.active || !this.bridge) return null;
    this.sequence = (this.sequence + 1) & 0xff;
    await this.bridge.write(makePogoFlashTransactionHeader(this.sequence, 0));
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
        validationError = error;
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
    if (this.bridge) {
      try {
        await this.requestExit();
      } catch (error) {
        errors.push(`bridge exit: ${error.message}`);
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
    try {
      this.caseReport = await this.session.restoreNormal({
        requireVersion: true,
        expectedVersion: REVIEWED_CASE_VERSION,
      });
    } catch (error) {
      errors.push(`case application return: ${error.message}`);
    }
    if (errors.length) {
      throw new PogoFlashSafetyError(errors.join("; "));
    }
  }
}

export class G2CaseSession {
  constructor(port, { log = () => {}, progress = () => {} } = {}) {
    this.port = port;
    this.log = log;
    this.progress = progress;
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
          `The case returned firmware ${report.caseVersion ?? "unknown"}, expected ${expectedVersion}.`,
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
      this.log("Starting a read-only 512 KiB case backup.");
      await loader.connect();
      const flash = await loader.readRange(FLASH_BASE, FLASH_SIZE, (fraction) =>
        reportProgress(
          fraction * 0.96,
          `Backing up case · ${Math.round(fraction * 100)}%`,
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

  async restartAndRecheck() {
    this.log("Starting the traced stock reset for both seated G2 temples.");
    const normal = await openNormalConsole(this.port);
    try {
      const boot = new TextDecoder().decode(await normal.collectFor(3000));
      const resetOutput = await resetTemples(normal);
      this.log("The case confirmed its left/right hardware reset sequence.");
      await delay(6500);
      const telemetry = await queryNormal(normal, 0xa3, 1000);
      return parseConsoleReport(boot, resetOutput, telemetry);
    } finally {
      await normal.close();
    }
  }

  async probeRunningTemple(
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
      const cleanupLoader = new Stm32Bootloader(this.port, this.log);
      try {
        await cleanupLoader.connect();
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
      loader = new Stm32Bootloader(this.port, this.log);
      await loader.connect();
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
        const readback = await loader.readMemory(address, chunk.length);
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
      await loader.close();
      loader = null;

      bridge = await openPogoBridgeHost(this.port);
      // Web Serial changes framing by closing and reopening the port. The CH340
      // may discard the short banner during that transition, so it is optional;
      // when any banner bytes survive, require the complete pinned value.
      await delay(120);
      if (bridge.queuedBytes > 0) {
        const banner = await bridge.readExact(
          POGO_BRIDGE_BANNER.length,
          600,
          "pogo bridge banner",
        );
        if (!equalBytes(banner, POGO_BRIDGE_BANNER)) {
          throw new Error("The volatile pogo bridge banner is invalid.");
        }
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
      loader = new Stm32Bootloader(this.port, this.log);
      await loader.connect();
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
    this.log("Refreshing case firmware and seated-temple telemetry before flashing.");
    const normal = await openNormalConsole(this.port);
    try {
      const bootText = new TextDecoder().decode(await normal.collectFor(2500));
      const telemetryText = await queryNormal(normal, 0xa3, 1000);
      const report = parseConsoleReport(bootText, telemetryText);
      if (report.caseVersion !== REVIEWED_CASE_VERSION) {
        throw new PogoFlashSafetyError(
          `The volatile writer is pinned to case ${REVIEWED_CASE_VERSION}; this case reports ${report.caseVersion ?? "unknown"}.`,
        );
      }
      if (!report.telemetry) {
        throw new PogoFlashSafetyError(
          "Fresh case telemetry was not available before the mutating operation.",
        );
      }
      for (const route of routes) {
        const present =
          route === "left"
            ? report.telemetry.leftPresent
            : report.telemetry.rightPresent;
        if (!present) {
          throw new PogoFlashSafetyError(
            `Fresh case telemetry does not report the ${route} temple as seated.`,
          );
        }
      }
      return report;
    } finally {
      await normal.close();
    }
  }

  async flashReviewedCfwRoute(component, route, routeIndex, routeCount) {
    const progressBase = routeIndex / routeCount;
    const progressSpan = 1 / routeCount;
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
    };
    let operationError = null;
    let cleanupError = null;

    try {
      await transport.open();
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

      // Start and header mutate OTA state and are intentionally never replayed.
      const start = makeOtaStartRequest();
      requireOtaAcknowledgement(await transport.transact(start, 8000), start[0]);
      const header = makeOtaHeaderRequest(component.header);
      requireOtaAcknowledgement(await transport.transact(header, 8000), header[0]);

      const payload = component.payload;
      const totalRecords = Math.ceil(payload.length / 1000);
      let acceptedBytes = 0;
      let retries = 0;
      for (let index = 0; index < totalRecords; index += 1) {
        const offset = index * 1000;
        const data = payload.subarray(offset, Math.min(offset + 1000, payload.length));
        const final = index + 1 === totalRecords;
        const request = makeOtaDataRequest(data, final, index & 0xff);
        for (let attempt = 0; ; attempt += 1) {
          try {
            const response = await transport.transact(request, 8000);
            requireOtaAcknowledgement(response, 0x54);
            break;
          } catch (error) {
            if (!(error instanceof RetryablePogoFlashError) || attempt >= 2) {
              throw error;
            }
            retries += 1;
            transport.drainInput();
            this.log(
              `${route}: retrying exact 0x54 record ${index + 1} after ${error.message}`,
              "warn",
            );
            await delay(50);
          }
        }
        acceptedBytes += data.length;
        transport.reportProgress(
          0.08 + ((index + 1) / totalRecords) * 0.78,
          `${route}: ${index + 1}/${totalRecords} main records`,
        );
        if (acceptedBytes % 6000 === 0 || final) {
          await delay(100);
        }
      }

      const finish = makeOtaFinishRequest();
      requireOtaAcknowledgement(await transport.transact(finish, 60000), finish[0]);
      transport.completedTransfer = {
        payloadBytes: acceptedBytes,
        records: totalRecords,
      };
      result.transfer = {
        recordsSent: totalRecords,
        payloadBytesSent: acceptedBytes,
        dataRetries: retries,
        finishAckReceived: true,
      };
      this.log(
        `${route}: all ${totalRecords.toLocaleString()} records and the finish acknowledgement were accepted.`,
        "success",
      );

      const deadline = Date.now() + 180000;
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
            version.firmware === REVIEWED_CFW_BASE_VERSION &&
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
      if (transport.retainedResult) {
        result.retainedResult = {
          ...transport.retainedResult,
          baseline: compactHex(transport.retainedResult.baseline),
          selected: compactHex(transport.retainedResult.selected),
          restored: compactHex(transport.retainedResult.restored),
        };
      }
    }

    if (operationError || cleanupError) {
      result.outcome = "failed_or_uncertain";
      if (operationError) result.error = operationError.message;
      if (cleanupError) result.cleanupError = cleanupError.message;
      const details = [
        operationError && `temple transaction: ${operationError.message}`,
        cleanupError && `case cleanup: ${cleanupError.message}`,
      ].filter(Boolean);
      const error = new PogoFlashSafetyError(`${route}: ${details.join("; ")}`);
      error.routeResult = result;
      throw error;
    }
    result.outcome = "success";
    transport.reportProgress(1, `${route}: route and case application restored`);
    return result;
  }

  async flashReviewedCfwMain(firmware, routeSelection = "both") {
    const { mainComponent: component, target } =
      await assertPinnedTempleFlashCandidate(firmware);
    const routes =
      routeSelection === "both"
        ? ["right", "left"]
        : [routeSelection];
    if (!routes.every((route) => ["left", "right"].includes(route))) {
      throw new PogoFlashSafetyError("Choose both, left, or right for temple flashing.");
    }

    const audit = {
      schemaVersion: 1,
      startedAt: new Date().toISOString(),
      operation: "g2_case_usb_pinned_main_only",
      imageSha256: firmware.fileSha256,
      imageLabel: target.label,
      imageHardwareValidated: target.hardwareValidated,
      mainPayloadSha256: component.payloadSha256,
      bridgeSha256:
        "08a08f45ac125a1dba6469234e56cacd32147d9e79203327987276d2fb182b02",
      routes,
      bootloaderAllowed: false,
      preflightCase: null,
      routeResults: [],
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
      for (let index = 0; index < routes.length; index += 1) {
        const route = routes[index];
        try {
          audit.routeResults.push(
            await this.flashReviewedCfwRoute(
              component,
              route,
              index,
              routes.length,
            ),
          );
        } catch (error) {
          if (error.routeResult) audit.routeResults.push(error.routeResult);
          throw error;
        }
      }
      audit.outcome = "success";
      this.progress(1, "Reviewed CFW transfer and case restoration verified");
      return audit;
    } catch (error) {
      audit.outcome = "failed_or_uncertain";
      audit.error = error.message;
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
        throw new Error("Inactive-bank readback does not match the selected case image.");
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
        "The option-byte write reset the case before the final acknowledgement; checking the normal application.",
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

export async function requestG2CasePort() {
  if (!webSerialSupported()) {
    throw new Error("Web Serial is not available. Use current Chrome or Edge on desktop.");
  }
  return navigator.serial.requestPort({
    filters: [{ usbVendorId: 0x1a86, usbProductId: 0x7523 }],
  });
}
