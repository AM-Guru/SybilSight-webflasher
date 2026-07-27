import { makeRemoteMessageId } from "./remoteSupport.js";

export const REMOTE_SERIAL_OPERATIONS = Object.freeze([
  "get_info",
  "open",
  "write",
  "set_signals",
  "close",
]);

export const REMOTE_SERIAL_MAX_CHUNK_BYTES = 16 * 1024;

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
        result = { opened: true, options };
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
    this.removeMessageListener = connection.addMessageListener((message) =>
      this.handleMessage(message),
    );
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
    }
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
      await this.request("open", { options: normalized }, OPEN_TIMEOUT_MS);
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
    } finally {
      this.opened = false;
      this.readController = null;
      this.readQueue = [];
      this.readableStream = null;
      this.writableStream = null;
    }
  }

  async dispose() {
    try {
      await this.close();
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
