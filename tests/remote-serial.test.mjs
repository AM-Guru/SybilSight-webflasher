import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";
import { createRemoteSupportServer } from "../deploy/homeassistant-addon/server.mjs";
import {
  RemoteSupportConnection,
} from "../src/lib/remoteSupport.js";
import {
  RemoteG2CasePort,
  RemoteSerialDeviceBridge,
  decodeRemoteBytes,
  encodeRemoteBytes,
  normalizeExchangeBatchSteps,
  normalizeRemoteSerialOptions,
} from "../src/lib/remoteSerial.js";

const OPERATOR_KEY = "test-only-remote-serial-key-with-32-characters";

function fakeG2CasePort() {
  return {
    transportKind: "webusb",
    opened: false,
    readable: null,
    writable: null,
    readController: null,
    writes: [],
    signals: [],
    options: null,
    getInfo() {
      return {
        usbVendorId: 0x1a86,
        usbProductId: 0x7523,
      };
    },
    async open(options) {
      this.opened = true;
      this.options = options;
      this.readable = new ReadableStream({
        start: (controller) => {
          this.readController = controller;
        },
        cancel: () => {
          this.readController = null;
        },
      });
      this.writable = new WritableStream({
        write: (chunk) => {
          this.writes.push(Uint8Array.from(chunk));
        },
      });
    },
    async setSignals(signals) {
      this.signals.push({ ...signals });
    },
    async close() {
      this.opened = false;
      this.readController = null;
      this.readable = null;
      this.writable = null;
    },
  };
}

test("encodes bounded serial chunks and only the two G2 line profiles", () => {
  const bytes = Uint8Array.from([0x44, 0x45, 0x41, 0x30, 0x0a]);
  assert.deepEqual(decodeRemoteBytes(encodeRemoteBytes(bytes)), bytes);
  assert.deepEqual(
    normalizeRemoteSerialOptions({
      baudRate: 1_000_000,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    }),
    {
      baudRate: 1_000_000,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
      bufferSize: 4096,
    },
  );
  assert.throws(
    () =>
      normalizeRemoteSerialOptions({
        baudRate: 9_600,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
      }),
    /115200 or 1000000 baud/i,
  );
});

test("carries a serial-compatible G2 Case port through the authenticated relay", async (t) => {
  const relay = createRemoteSupportServer({
    operatorKey: OPERATOR_KEY,
    host: "127.0.0.1",
    port: 0,
    logger: { warn() {} },
  });
  const address = await relay.listen();
  t.after(() => relay.close());
  const url = `ws://127.0.0.1:${address.port}/remote-support/ws`;

  const localPort = fakeG2CasePort();
  let deviceBridge = null;
  const device = new RemoteSupportConnection({
    url,
    WebSocketImpl: WebSocket,
    onMessage: (message) => deviceBridge?.handleMessage(message),
  });
  const operator = new RemoteSupportConnection({
    url,
    WebSocketImpl: WebSocket,
  });
  t.after(async () => {
    await deviceBridge?.close();
    device.close();
    operator.close();
  });

  const ready = await device.startDevice();
  deviceBridge = new RemoteSerialDeviceBridge(device, localPort);
  await operator.joinOperator({
    code: ready.session.code,
    operatorKey: OPERATOR_KEY,
  });

  const remotePort = new RemoteG2CasePort(operator);
  t.after(() => remotePort.dispose());
  await remotePort.open({
    baudRate: 1_000_000,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
    bufferSize: 4096,
  });
  assert.equal(localPort.opened, true);
  assert.equal(localPort.options.baudRate, 1_000_000);

  const writer = remotePort.writable.getWriter();
  await writer.write(Uint8Array.from([0x44, 0x45, 0x41, 0x30, 0x0a]));
  writer.releaseLock();
  assert.deepEqual(
    localPort.writes.map((bytes) => [...bytes]),
    [[0x44, 0x45, 0x41, 0x30, 0x0a]],
  );

  const reader = remotePort.readable.getReader();
  const remoteRead = reader.read();
  localPort.readController.enqueue(Uint8Array.from([0xde, 0xa3, 0x01, 0x0a]));
  const { value, done } = await remoteRead;
  assert.equal(done, false);
  assert.deepEqual([...value], [0xde, 0xa3, 0x01, 0x0a]);
  await reader.cancel();
  reader.releaseLock();

  await remotePort.setSignals({
    dataTerminalReady: false,
    requestToSend: true,
  });
  assert.deepEqual(localPort.signals, [
    {
      dataTerminalReady: false,
      requestToSend: true,
    },
  ]);

  await remotePort.close();
  assert.equal(localPort.opened, false);

  await remotePort.open({
    baudRate: 115_200,
    dataBits: 8,
    stopBits: 1,
    parity: "even",
    flowControl: "none",
    bufferSize: 4096,
  });
  const romWriter = remotePort.writable.getWriter();
  const flashBlock = new Uint8Array(20_000).fill(0xa5);
  await romWriter.write(flashBlock);
  romWriter.releaseLock();
  assert.deepEqual(
    localPort.writes.slice(-2).map((bytes) => bytes.byteLength),
    [16_384, 3_616],
  );
  assert.equal(
    localPort.writes
      .slice(-2)
      .every((bytes) => bytes.every((value) => value === 0xa5)),
    true,
  );
  await remotePort.close();
});

test("refuses to bridge any USB serial identity except the selected G2 Case", () => {
  const wrongPort = fakeG2CasePort();
  wrongPort.getInfo = () => ({
    usbVendorId: 0x1234,
    usbProductId: 0x5678,
  });
  assert.throws(
    () =>
      new RemoteSerialDeviceBridge(
        { send() {} },
        wrongPort,
      ),
    /restricted to the selected G2 Case/i,
  );
});

function tokenizingG2CasePort() {
  // A fake local Case whose "bridge" answers every full write with a 0xC3
  // flow-control token, and answers the final checksum byte with a canned
  // response frame — enough to exercise a token-paced exchange end to end.
  const port = fakeG2CasePort();
  port.autoRespond = null;
  const baseOpen = port.open.bind(port);
  port.open = async (options) => {
    await baseOpen(options);
    port.writable = new WritableStream({
      write: (chunk) => {
        const bytes = Uint8Array.from(chunk);
        port.writes.push(bytes);
        const respond = port.autoRespond?.(bytes);
        if (respond?.length) port.readController.enqueue(Uint8Array.from(respond));
      },
    });
  };
  return port;
}

async function relayedPortPair(t) {
  const relay = createRemoteSupportServer({
    operatorKey: OPERATOR_KEY,
    host: "127.0.0.1",
    port: 0,
    logger: { warn() {} },
  });
  const address = await relay.listen();
  t.after(() => relay.close());
  const url = `ws://127.0.0.1:${address.port}/remote-support/ws`;

  const localPort = tokenizingG2CasePort();
  let deviceBridge = null;
  const device = new RemoteSupportConnection({
    url,
    WebSocketImpl: WebSocket,
    onMessage: (message) => deviceBridge?.handleMessage(message),
  });
  const operator = new RemoteSupportConnection({
    url,
    WebSocketImpl: WebSocket,
  });
  t.after(async () => {
    await deviceBridge?.close();
    device.close();
    operator.close();
  });
  const ready = await device.startDevice();
  deviceBridge = new RemoteSerialDeviceBridge(device, localPort);
  const operatorReady = await operator.joinOperator({
    code: ready.session.code,
    operatorKey: OPERATOR_KEY,
  });
  const remotePort = new RemoteG2CasePort(operator);
  t.after(() => remotePort.dispose());
  await remotePort.open({
    baudRate: 1_000_000,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
    bufferSize: 4096,
  });
  return { relay, localPort, device, operator, operatorReady, remotePort };
}

test("executes a token-paced exchange batch on the device in one request", async (t) => {
  const { localPort, operator, operatorReady, remotePort } =
    await relayedPortPair(t);

  assert.deepEqual(remotePort.remoteCapabilities, ["exchange_batch"]);
  assert.ok(operatorReady.serialOperations.includes("exchange_batch"));
  assert.ok(operator.serialOperations.includes("exchange_batch"));
  assert.equal(remotePort.supportsExchangeBatch(), true);

  localPort.autoRespond = (bytes) => {
    if (bytes.length === 1 && bytes[0] === 0x99) {
      // The checksum byte triggers the canned bridge response.
      return [0x47, 0x32, 0x52, 0x58];
    }
    // Like the real bridge, only writes that complete a unit are answered
    // with a flow-control token: the header's first half stays silent.
    if (bytes[0] === 1) return null;
    return [0xc3];
  };

  const reader = remotePort.readable.getReader();
  const pendingRead = reader.read();

  const token = encodeRemoteBytes(Uint8Array.from([0xc3]));
  const result = await remotePort.exchangeBatch([
    { op: "write", data: encodeRemoteBytes(Uint8Array.from([1, 2, 3, 4, 5])) },
    { op: "delay", ms: 5 },
    { op: "write", data: encodeRemoteBytes(Uint8Array.from([6, 7, 8, 9, 10])) },
    { op: "expect", data: token, timeoutMs: 2000 },
    { op: "write", data: encodeRemoteBytes(Uint8Array.from([0xaa, 0xbb])) },
    { op: "expect", data: token, timeoutMs: 2000 },
    { op: "write", data: encodeRemoteBytes(Uint8Array.from([0x99])) },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.completedSteps, 7);
  assert.equal(result.reads.length, 2);
  assert.ok(result.reads.every((read) => read.data === undefined));

  assert.deepEqual(
    localPort.writes.map((bytes) => [...bytes]),
    [
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [0xaa, 0xbb],
      [0x99],
    ],
  );

  // The consumed tokens never reached the operator stream; the response
  // frame written after the batch's last step did.
  const { value } = await pendingRead;
  assert.deepEqual([...value], [0x47, 0x32, 0x52, 0x58]);
  await reader.cancel();
  reader.releaseLock();
});

test("a failed exchange batch reports its step and flushes leftovers to the stream", async (t) => {
  const { localPort, remotePort } = await relayedPortPair(t);

  localPort.autoRespond = (bytes) =>
    bytes[0] === 1 ? [0x55, 0xde, 0xad] : null;

  const reader = remotePort.readable.getReader();
  const pendingRead = reader.read();

  const result = await remotePort.exchangeBatch([
    { op: "write", data: encodeRemoteBytes(Uint8Array.from([1])) },
    {
      op: "expect",
      data: encodeRemoteBytes(Uint8Array.from([0xc3])),
      timeoutMs: 2000,
    },
    { op: "write", data: encodeRemoteBytes(Uint8Array.from([2])) },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.failedStep, 1);
  assert.equal(result.reason, "expect-mismatch");
  assert.deepEqual([...decodeRemoteBytes(result.captured)], [0x55]);
  // The step after the failure never ran.
  assert.deepEqual(
    localPort.writes.map((bytes) => [...bytes]),
    [[1]],
  );
  // Unconsumed bytes go back to the operator stream in arrival order.
  const { value } = await pendingRead;
  assert.deepEqual([...value], [0xde, 0xad]);
  await reader.cancel();
  reader.releaseLock();

  // A timeout names the missing bytes without leaving the port wedged.
  localPort.autoRespond = () => null;
  const timedOut = await remotePort.exchangeBatch([
    { op: "write", data: encodeRemoteBytes(Uint8Array.from([9])) },
    {
      op: "expect",
      data: encodeRemoteBytes(Uint8Array.from([0xc3])),
      timeoutMs: 50,
    },
  ]);
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.reason, "timeout");
  assert.equal(timedOut.expectedBytes, 1);
});

test("exchange batches enforce their declarative bounds on both sides", async (t) => {
  assert.throws(
    () => normalizeExchangeBatchSteps([]),
    /non-empty step array/,
  );
  assert.throws(
    () =>
      normalizeExchangeBatchSteps(
        Array.from({ length: 641 }, () => ({ op: "drain" })),
      ),
    /at most 640 steps/,
  );
  assert.throws(
    () => normalizeExchangeBatchSteps([{ op: "eval", data: "x" }]),
    /Unsupported exchange step/,
  );
  assert.throws(
    () =>
      normalizeExchangeBatchSteps([
        {
          op: "expect",
          data: encodeRemoteBytes(new Uint8Array(65)),
          timeoutMs: 1000,
        },
      ]),
    /compare 1–64 bytes/,
  );
  assert.throws(
    () => normalizeExchangeBatchSteps([{ op: "delay", ms: 6000 }]),
    /wait 1–5000 ms/,
  );
  assert.throws(
    () =>
      normalizeExchangeBatchSteps(
        Array.from({ length: 20 }, () => ({
          op: "read",
          count: 16_384,
          timeoutMs: 10_000,
        })),
      ),
    /read at most/,
  );

  // The relay refuses a technician batch outside the declarative bounds and
  // drops the connection, so malformed steps never reach the device.
  const { operator } = await relayedPortPair(t);
  const closed = new Promise((resolve) => {
    const previous = operator.onState;
    operator.onState = (state) => {
      previous?.(state);
      if (["disconnected", "closed", "error"].includes(state.status)) {
        resolve(state.status);
      }
    };
  });
  operator.send({
    type: "serial_request",
    id: "m1-invalid",
    op: "exchange_batch",
    steps: [{ op: "shell", data: "rm" }],
  });
  assert.ok(await closed);
});
