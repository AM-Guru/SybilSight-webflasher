import { makeRemoteMessageId } from "./remoteSupport.js";

export const REMOTE_SERIAL_OPERATIONS = Object.freeze([
  "get_info",
  "open",
  "write",
  "set_signals",
  "close",
  "exchange_batch",
]);

export const REMOTE_SERIAL_MAX_CHUNK_BYTES = 16 * 1024;

// Capabilities the device browser reports in its `open` result so an operator
// can tell whether the person's build executes batched exchanges locally.
// Old device builds omit the field and old operators ignore it.
export const REMOTE_SERIAL_CAPABILITIES = Object.freeze(["exchange_batch"]);

// A batched exchange runs a bounded, declarative step list on the device
// browser so latency-critical serial loops (flow-control tokens between
// 32-byte flash-bridge chunks) do not pay one relay round trip per step.
// Steps are data, never code, and every dimension is capped.
export const EXCHANGE_BATCH_MAX_STEPS = 640;
export const EXCHANGE_BATCH_MAX_WRITE_BYTES = 64 * 1024;
export const EXCHANGE_BATCH_MAX_READ_BYTES = 32 * 1024;
export const EXCHANGE_BATCH_MAX_EXPECT_BYTES = 64;
export const EXCHANGE_BATCH_MAX_STEP_TIMEOUT_MS = 20_000;
export const EXCHANGE_BATCH_MAX_DELAY_MS = 5_000;
export const EXCHANGE_BATCH_MAX_TOTAL_MS = 120_000;
// The relay socket rejects payloads over 64 KiB, so a serialized batch must
// stay comfortably below it.
export const EXCHANGE_BATCH_MAX_SERIALIZED_CHARS = 48 * 1024;

const OPEN_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 15_000;

function bytesFrom(input) {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError("Remote serial data must be an ArrayBuffer or typed array.");
}

export function encodeRemoteBytes(input) {
  const bytes = bytesFrom(input);
  if (bytes.byteLength > REMOTE_SERIAL_MAX_CHUNK_BYTES) {
    throw new RangeError(
      `Remote serial chunks cannot exceed ${REMOTE_SERIAL_MAX_CHUNK_BYTES} bytes.`,
    );
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
      "base64",
    );
  }
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 0x2000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x2000));
  }
  return btoa(binary);
}

export function decodeRemoteBytes(value) {
  if (typeof value !== "string" || value.length > 24 * 1024) {
    throw new TypeError("The remote serial payload is not a bounded base64 string.");
  }
  let bytes;
  if (typeof Buffer !== "undefined") {
    bytes = new Uint8Array(Buffer.from(value, "base64"));
  } else {
    const binary = atob(value);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  if (bytes.byteLength > REMOTE_SERIAL_MAX_CHUNK_BYTES) {
    throw new RangeError(
      `Remote serial chunks cannot exceed ${REMOTE_SERIAL_MAX_CHUNK_BYTES} bytes.`,
    );
  }
  return bytes;
}

export function normalizeRemoteSerialOptions(options = {}) {
  const normalized = {
    baudRate: Number(options.baudRate),
    dataBits: Number(options.dataBits ?? 8),
    stopBits: Number(options.stopBits ?? 1),
    parity: String(options.parity ?? "none"),
    flowControl: String(options.flowControl ?? "none"),
    bufferSize: Math.max(64, Math.min(64 * 1024, Number(options.bufferSize ?? 4096))),
  };
  if (![115_200, 1_000_000].includes(normalized.baudRate)) {
    throw new RangeError(
      "Remote G2 Case access permits only 115200 or 1000000 baud.",
    );
  }
  if (
    normalized.dataBits !== 8 ||
    normalized.stopBits !== 1 ||
    !["none", "even"].includes(normalized.parity) ||
    normalized.flowControl !== "none" ||
    !Number.isFinite(normalized.bufferSize)
  ) {
    throw new RangeError(
      "The requested line settings are outside the G2 Case serial profile.",
    );
  }
  if (
    (normalized.baudRate === 1_000_000 && normalized.parity !== "none") ||
    (normalized.baudRate === 115_200 && normalized.parity !== "even")
  ) {
    throw new RangeError(
      "The G2 Case uses 1000000/8N1 or STM32 ROM 115200/8E1.",
    );
  }
  return normalized;
}

function normalizeSignals(signals = {}) {
  return {
    dataTerminalReady: Boolean(signals.dataTerminalReady),
    requestToSend: Boolean(signals.requestToSend),
  };
}

function boundedStepTimeout(value, fallback) {
  const timeout = Number(value ?? fallback);
  if (
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > EXCHANGE_BATCH_MAX_STEP_TIMEOUT_MS
  ) {
    throw new RangeError(
      `Exchange steps allow timeouts of 1–${EXCHANGE_BATCH_MAX_STEP_TIMEOUT_MS} ms.`,
    );
  }
  return timeout;
}

// Validates a declarative exchange-batch step list against every cap and
// returns the normalized steps plus the total time budget they may consume.
// Both sides of the relay run this: the operator before sending, the device
// before executing.
export function normalizeExchangeBatchSteps(steps) {
  if (!Array.isArray(steps) || steps.length < 1) {
    throw new TypeError("An exchange batch requires a non-empty step array.");
  }
  if (steps.length > EXCHANGE_BATCH_MAX_STEPS) {
    throw new RangeError(
      `Exchange batches allow at most ${EXCHANGE_BATCH_MAX_STEPS} steps.`,
    );
  }
  const normalized = [];
  let writeBytes = 0;
  let readBytes = 0;
  let budgetMs = 0;
  for (const step of steps) {
    const op = step?.op;
    if (op === "write") {
      const bytes = decodeRemoteBytes(step.data);
      if (!bytes.byteLength) {
        throw new RangeError("Exchange write steps require at least one byte.");
      }
      writeBytes += bytes.byteLength;
      normalized.push({ op, data: encodeRemoteBytes(bytes) });
    } else if (op === "expect") {
      const bytes = decodeRemoteBytes(step.data);
      if (
        !bytes.byteLength ||
        bytes.byteLength > EXCHANGE_BATCH_MAX_EXPECT_BYTES
      ) {
        throw new RangeError(
          `Exchange expect steps compare 1–${EXCHANGE_BATCH_MAX_EXPECT_BYTES} bytes.`,
        );
      }
      const timeoutMs = boundedStepTimeout(step.timeoutMs, 8000);
      readBytes += bytes.byteLength;
      budgetMs += timeoutMs;
      normalized.push({ op, data: encodeRemoteBytes(bytes), timeoutMs });
    } else if (op === "read") {
      const count = Number(step.count);
      if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > REMOTE_SERIAL_MAX_CHUNK_BYTES
      ) {
        throw new RangeError(
          `Exchange read steps capture 1–${REMOTE_SERIAL_MAX_CHUNK_BYTES} bytes.`,
        );
      }
      const timeoutMs = boundedStepTimeout(step.timeoutMs, 8000);
      readBytes += count;
      budgetMs += timeoutMs;
      normalized.push({ op, count, timeoutMs });
    } else if (op === "delay") {
      const ms = Number(step.ms);
      if (!Number.isInteger(ms) || ms < 1 || ms > EXCHANGE_BATCH_MAX_DELAY_MS) {
        throw new RangeError(
          `Exchange delay steps wait 1–${EXCHANGE_BATCH_MAX_DELAY_MS} ms.`,
        );
      }
      budgetMs += ms;
      normalized.push({ op, ms });
    } else if (op === "drain") {
      normalized.push({ op });
    } else {
      throw new TypeError(`Unsupported exchange step ${op ?? "(missing op)"}.`);
    }
  }
  if (writeBytes > EXCHANGE_BATCH_MAX_WRITE_BYTES) {
    throw new RangeError(
      `Exchange batches write at most ${EXCHANGE_BATCH_MAX_WRITE_BYTES} bytes.`,
    );
  }
  if (readBytes > EXCHANGE_BATCH_MAX_READ_BYTES) {
    throw new RangeError(
      `Exchange batches read at most ${EXCHANGE_BATCH_MAX_READ_BYTES} bytes.`,
    );
  }
  if (budgetMs > EXCHANGE_BATCH_MAX_TOTAL_MS) {
    throw new RangeError(
      `Exchange batches allow a total budget of ${EXCHANGE_BATCH_MAX_TOTAL_MS} ms.`,
    );
  }
  if (JSON.stringify(normalized).length > EXCHANGE_BATCH_MAX_SERIALIZED_CHARS) {
    throw new RangeError(
      `Exchange batches serialize to at most ${EXCHANGE_BATCH_MAX_SERIALIZED_CHARS} characters.`,
    );
  }
  return { steps: normalized, writeBytes, readBytes, budgetMs };
}

function exactG2CaseInfo(port) {
  const info = port?.getInfo?.() ?? {};
  if (info.usbVendorId !== 0x1a86 || info.usbProductId !== 0x7523) {
    throw new Error(
      "Remote support is restricted to the selected G2 Case CH340 interface.",
    );
  }
  return {
    usbVendorId: info.usbVendorId,
    usbProductId: info.usbProductId,
    transport: port.transportKind ?? info.transport ?? "serial",
  };
}

export class RemoteSerialDeviceBridge {
  constructor(connection, port, { log = () => {} } = {}) {
    exactG2CaseInfo(port);
    this.connection = connection;
    this.port = port;
    this.log = log;
    this.reader = null;
    this.writer = null;
    this.readPump = null;
    this.opened = false;
    this.closing = false;
    this.requestQueue = Promise.resolve();
    this.captureSink = null;
  }

  handleMessage(message) {
    if (message?.type !== "serial_request") return false;
    this.requestQueue = this.requestQueue
      .then(() => this.handleRequest(message))
      .catch((error) => {
        this.log(`Remote serial request failed: ${error.message}`, "error");
      });
    return true;
  }

  async handleRequest(message) {
    const { id, op } = message;
    try {
      let result;
      let startReadPump = false;
      if (op === "get_info") {
        result = exactG2CaseInfo(this.port);
      } else if (op === "open") {
        if (this.opened) {
          throw new DOMException(
            "The remote G2 Case serial port is already open.",
            "InvalidStateError",
          );
        }
        const options = normalizeRemoteSerialOptions(message.options);
        await this.port.open(options);
        if (!this.port.readable || !this.port.writable) {
          throw new Error(
            "The selected G2 Case did not expose readable and writable streams.",
          );
        }
        this.reader = this.port.readable.getReader();
        this.writer = this.port.writable.getWriter();
        this.opened = true;
        result = {
          opened: true,
          options,
          capabilities: [...REMOTE_SERIAL_CAPABILITIES],
        };
        startReadPump = true;
        this.log(
          `Technician opened the selected G2 Case at ${options.baudRate} baud.`,
        );
      } else if (op === "write") {
        if (!this.writer || !this.opened) {
          throw new DOMException(
            "The remote G2 Case serial port is not open.",
            "InvalidStateError",
          );
        }
        const bytes = decodeRemoteBytes(message.data);
        await this.writer.write(bytes);
        result = { bytesWritten: bytes.byteLength };
      } else if (op === "set_signals") {
        if (!this.opened) {
          throw new DOMException(
            "The remote G2 Case serial port is not open.",
            "InvalidStateError",
          );
        }
        const signals = normalizeSignals(message.signals);
        await this.port.setSignals(signals);
        result = signals;
      } else if (op === "exchange_batch") {
        if (!this.writer || !this.opened) {
          throw new DOMException(
            "The remote G2 Case serial port is not open.",
            "InvalidStateError",
          );
        }
        if (this.captureSink) {
          throw new DOMException(
            "Another exchange batch is already executing.",
            "InvalidStateError",
          );
        }
        result = await this.executeExchangeBatch(message.steps);
      } else if (op === "close") {
        await this.closePort();
        result = { opened: false };
      } else {
        throw new Error(`Unsupported remote serial operation ${op}.`);
      }
      this.connection.send({
        type: "serial_result",
        id,
        ok: true,
        result,
      });
      if (startReadPump) this.startReadPump();
    } catch (error) {
      try {
        if (op === "open") await this.closePort();
      } catch {
        // Preserve the original open error.
      }
      this.connection.send({
        type: "serial_result",
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  forwardSerialData(bytes) {
    for (
      let offset = 0;
      offset < bytes.byteLength;
      offset += REMOTE_SERIAL_MAX_CHUNK_BYTES
    ) {
      this.connection.send({
        type: "serial_data",
        data: encodeRemoteBytes(
          bytes.subarray(offset, offset + REMOTE_SERIAL_MAX_CHUNK_BYTES),
        ),
      });
    }
  }

  sinkTake(sink, count) {
    const target = Math.min(count, sink.queuedBytes);
    const result = new Uint8Array(target);
    let written = 0;
    while (written < target) {
      const chunk = sink.queue[0];
      const used = Math.min(target - written, chunk.byteLength);
      result.set(chunk.subarray(0, used), written);
      written += used;
      sink.queuedBytes -= used;
      if (used === chunk.byteLength) sink.queue.shift();
      else sink.queue[0] = chunk.subarray(used);
    }
    return result;
  }

  async sinkReadExact(sink, count, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (sink.queuedBytes < count) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          sink.waiters.delete(onData);
          resolve();
        }, remaining);
        const onData = () => {
          clearTimeout(timer);
          resolve();
        };
        sink.waiters.add(onData);
      });
    }
    return this.sinkTake(sink, count);
  }

  // Runs a validated declarative step list against the local port so paced
  // exchanges do not pay a relay round trip per step. Bytes the steps consume
  // stay in the batch result; anything left over is forwarded to the operator
  // stream in arrival order when the batch ends, so a failed batch leaves the
  // operator-side resynchronization logic with everything the port produced.
  async executeExchangeBatch(steps) {
    const { steps: normalized, budgetMs } = normalizeExchangeBatchSteps(steps);
    const sink = { queue: [], queuedBytes: 0, waiters: new Set() };
    this.captureSink = sink;
    const startedAt = Date.now();
    const deadline = startedAt + Math.min(
      budgetMs + 5_000,
      EXCHANGE_BATCH_MAX_TOTAL_MS,
    );
    const reads = [];
    try {
      for (let index = 0; index < normalized.length; index += 1) {
        if (Date.now() > deadline) {
          return {
            ok: false,
            failedStep: index,
            reason: "budget-exhausted",
            completedSteps: index,
            reads,
            durationMs: Date.now() - startedAt,
          };
        }
        const step = normalized[index];
        if (step.op === "write") {
          await this.writer.write(decodeRemoteBytes(step.data));
        } else if (step.op === "expect") {
          const expected = decodeRemoteBytes(step.data);
          const stepStartedAt = Date.now();
          const captured = await this.sinkReadExact(
            sink,
            expected.byteLength,
            Math.min(step.timeoutMs, Math.max(1, deadline - Date.now())),
          );
          if (!captured) {
            return {
              ok: false,
              failedStep: index,
              reason: "timeout",
              receivedBytes: sink.queuedBytes,
              expectedBytes: expected.byteLength,
              completedSteps: index,
              reads,
              durationMs: Date.now() - startedAt,
            };
          }
          for (let byte = 0; byte < expected.byteLength; byte += 1) {
            if (captured[byte] !== expected[byte]) {
              return {
                ok: false,
                failedStep: index,
                reason: "expect-mismatch",
                captured: encodeRemoteBytes(captured),
                latencyMs: Date.now() - stepStartedAt,
                completedSteps: index,
                reads,
                durationMs: Date.now() - startedAt,
              };
            }
          }
          reads.push({
            step: index,
            latencyMs: Date.now() - stepStartedAt,
          });
        } else if (step.op === "read") {
          const stepStartedAt = Date.now();
          const captured = await this.sinkReadExact(
            sink,
            step.count,
            Math.min(step.timeoutMs, Math.max(1, deadline - Date.now())),
          );
          if (!captured) {
            return {
              ok: false,
              failedStep: index,
              reason: "timeout",
              receivedBytes: sink.queuedBytes,
              expectedBytes: step.count,
              completedSteps: index,
              reads,
              durationMs: Date.now() - startedAt,
            };
          }
          reads.push({
            step: index,
            data: encodeRemoteBytes(captured),
            latencyMs: Date.now() - stepStartedAt,
          });
        } else if (step.op === "delay") {
          await new Promise((resolve) => setTimeout(resolve, step.ms));
        } else if (step.op === "drain") {
          sink.queue.length = 0;
          sink.queuedBytes = 0;
        }
      }
      return {
        ok: true,
        completedSteps: normalized.length,
        reads,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      this.captureSink = null;
      if (sink.queuedBytes) {
        this.forwardSerialData(this.sinkTake(sink, sink.queuedBytes));
      }
    }
  }

  startReadPump() {
    if (!this.reader || this.readPump) return;
    const reader = this.reader;
    this.readPump = (async () => {
      try {
        while (this.opened && this.reader === reader) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value?.byteLength) {
            const bytes = bytesFrom(value);
            if (this.captureSink) {
              this.captureSink.queue.push(bytes);
              this.captureSink.queuedBytes += bytes.byteLength;
              for (const waiter of this.captureSink.waiters) waiter();
              this.captureSink.waiters.clear();
              continue;
            }
            this.forwardSerialData(bytes);
          }
        }
      } catch (error) {
        if (!this.closing) {
          try {
            this.connection.send({
              type: "serial_event",
              event: "read_error",
              error: error instanceof Error ? error.message : String(error),
            });
          } catch {
            // The support session may have ended with the USB read.
          }
        }
      } finally {
        if (this.reader === reader) {
          this.reader = null;
        }
        this.readPump = null;
      }
    })();
  }

  async closePort() {
    if (this.closing) return;
    this.closing = true;
    const reader = this.reader;
    const readPump = this.readPump;
    this.reader = null;
    this.readPump = null;
    try {
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          // USB reset or remote teardown may already have ended the stream.
        }
        try {
          await readPump;
        } catch {
          // A read error is relayed separately.
        }
        try {
          reader.releaseLock();
        } catch {
          // The browser may already have released the stream.
        }
      }
      if (this.writer) {
        try {
          this.writer.releaseLock();
        } catch {
          // The browser may already have released the stream.
        }
        this.writer = null;
      }
      if (this.opened) {
        try {
          await this.port.close();
        } catch {
          // G2 resets can invalidate the local port before cleanup.
        }
      }
    } finally {
      this.opened = false;
      this.closing = false;
    }
  }

  async close() {
    await this.closePort();
  }
}

export class RemoteG2CasePort {
  constructor(connection) {
    this.connection = connection;
    this.transportKind = "remote";
    this.pending = new Map();
    this.readController = null;
    this.readQueue = [];
    this.readError = null;
    this.opened = false;
    this.readableStream = null;
    this.writableStream = null;
    this.remoteCapabilities = [];
    this.linkRttMs = null;
    this.removeMessageListener = connection.addMessageListener((message) =>
      this.handleMessage(message),
    );
  }

  // The batched-exchange fast path needs every hop to understand the op: the
  // device build advertises it in the open result, and the relay advertises
  // its forwardable operations in the ready message. Old builds simply omit
  // the fields, so this degrades to per-operation round trips, never a probe.
  supportsExchangeBatch() {
    return (
      this.opened &&
      this.remoteCapabilities.includes("exchange_batch") &&
      Array.isArray(this.connection?.serialOperations) &&
      this.connection.serialOperations.includes("exchange_batch")
    );
  }

  async exchangeBatch(steps) {
    if (!this.opened) {
      throw new DOMException(
        "The remote G2 Case serial port is not open.",
        "InvalidStateError",
      );
    }
    const { steps: normalized, budgetMs } = normalizeExchangeBatchSteps(steps);
    return this.request(
      "exchange_batch",
      { steps: normalized },
      Math.min(budgetMs, EXCHANGE_BATCH_MAX_TOTAL_MS) + 15_000,
    );
  }

  // Median of a few get_info round trips; the pacing controller subtracts
  // this from ACK latencies so link distance is not mistaken for temple
  // congestion.
  async measureLinkRtt(samples = 3) {
    const measured = [];
    for (let index = 0; index < samples; index += 1) {
      const startedAt = Date.now();
      try {
        await this.request("get_info", {}, 5_000);
      } catch {
        return this.linkRttMs;
      }
      measured.push(Date.now() - startedAt);
    }
    measured.sort((a, b) => a - b);
    this.linkRttMs = measured[Math.floor(measured.length / 2)];
    return this.linkRttMs;
  }

  getInfo() {
    return {
      usbVendorId: 0x1a86,
      usbProductId: 0x7523,
      transport: "remote",
    };
  }

  get readable() {
    return this.opened ? this.readableStream : null;
  }

  get writable() {
    return this.opened ? this.writableStream : null;
  }

  handleMessage(message) {
    if (message?.type === "serial_result") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error || "Remote serial request failed."));
      return;
    }
    if (message?.type === "serial_data") {
      try {
        const bytes = decodeRemoteBytes(message.data);
        if (this.readController) this.readController.enqueue(bytes);
        else this.readQueue.push(bytes);
      } catch (error) {
        this.failReadable(error);
      }
      return;
    }
    if (message?.type === "serial_event" && message.event === "read_error") {
      this.failReadable(new Error(message.error || "The remote USB read failed."));
      return;
    }
    if (message?.type === "relay_closed") {
      this.failPending(
        new Error(message.reason || "The remote-support relay disconnected."),
      );
    }
  }

  // No reply can arrive once the relay is gone, so waiting out each request's
  // timeout only delays an accurate error. Reject everything in flight with
  // the real reason and end the read stream the same way.
  failPending(error) {
    this.remoteCapabilities = [];
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.failReadable(error);
  }

  failReadable(error) {
    this.readError = error;
    if (this.readController) {
      try {
        this.readController.error(error);
      } catch {
        // The consumer may already have canceled the stream.
      }
      this.readController = null;
    }
  }

  request(op, fields = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const id = makeRemoteMessageId();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Remote serial ${op} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.connection.send({
          type: "serial_request",
          id,
          op,
          ...fields,
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async open(options) {
    if (this.opened) {
      throw new DOMException(
        "The remote G2 Case serial port is already open.",
        "InvalidStateError",
      );
    }
    const normalized = normalizeRemoteSerialOptions(options);
    this.readQueue = [];
    this.readError = null;
    this.readableStream = new ReadableStream({
      start: (controller) => {
        this.readController = controller;
        for (const bytes of this.readQueue.splice(0)) controller.enqueue(bytes);
        if (this.readError) controller.error(this.readError);
      },
      cancel: () => {
        this.readController = null;
        this.readQueue = [];
      },
    });
    this.writableStream = new WritableStream({
      write: async (chunk) => {
        const bytes = bytesFrom(chunk);
        for (
          let offset = 0;
          offset < bytes.byteLength;
          offset += REMOTE_SERIAL_MAX_CHUNK_BYTES
        ) {
          await this.request("write", {
            data: encodeRemoteBytes(
              bytes.subarray(offset, offset + REMOTE_SERIAL_MAX_CHUNK_BYTES),
            ),
          });
        }
      },
    });
    try {
      const result = await this.request(
        "open",
        { options: normalized },
        OPEN_TIMEOUT_MS,
      );
      this.remoteCapabilities = Array.isArray(result?.capabilities)
        ? result.capabilities.filter((value) => typeof value === "string")
        : [];
      this.opened = true;
    } catch (error) {
      this.readableStream = null;
      this.writableStream = null;
      this.readController = null;
      throw error;
    }
  }

  async setSignals(signals) {
    if (!this.opened) {
      throw new DOMException(
        "The remote G2 Case serial port is not open.",
        "InvalidStateError",
      );
    }
    await this.request("set_signals", {
      signals: normalizeSignals(signals),
    });
  }

  async close() {
    if (!this.opened) return;
    try {
      await this.request("close");
    } catch (error) {
      // The port is closed either way once the relay or the person's browser
      // is gone; surfacing this as a rejection produced an unhandled
      // "Remote serial close timed out" during teardown.
      this.lastCloseError = error;
    } finally {
      this.opened = false;
      this.readController = null;
      this.readQueue = [];
      this.readableStream = null;
      this.writableStream = null;
      this.remoteCapabilities = [];
    }
  }

  async dispose() {
    try {
      await this.close();
    } catch {
      // Disposal is best-effort: the support session (and with it the relay
      // socket) may already be gone, which is exactly when disposal runs.
    } finally {
      this.removeMessageListener?.();
      this.removeMessageListener = null;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("The remote serial port was disposed."));
      }
      this.pending.clear();
    }
  }
}
