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
