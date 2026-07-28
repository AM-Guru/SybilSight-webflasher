import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";
import {
  REMOTE_SERIAL_OPERATIONS,
  REMOTE_SUPPORT_PROTOCOL,
  createRemoteSupportServer,
} from "../deploy/homeassistant-addon/server.mjs";

const OPERATOR_KEY = "test-only-operator-key-with-32-characters";

class MessageQueue {
  constructor(socket) {
    this.messages = [];
    this.waiters = [];
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString("utf8"));
      const waiterIndex = this.waiters.findIndex(({ predicate }) =>
        predicate(message),
      );
      if (waiterIndex >= 0) {
        const [{ resolve, timer }] = this.waiters.splice(waiterIndex, 1);
        clearTimeout(timer);
        resolve(message);
      } else {
        this.messages.push(message);
      }
    });
  }

  next(predicate = () => true, timeoutMs = 2000) {
    const index = this.messages.findIndex(predicate);
    if (index >= 0) {
      return Promise.resolve(this.messages.splice(index, 1)[0]);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error("Timed out waiting for a relay message."));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }
}

async function openSocket(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return { socket, queue: new MessageQueue(socket) };
}

test("pairs an authenticated technician with one ephemeral device session", async (t) => {
  const relay = createRemoteSupportServer({
    operatorKey: OPERATOR_KEY,
    host: "127.0.0.1",
    port: 0,
    logger: { warn() {} },
  });
  const address = await relay.listen();
  t.after(() => relay.close());
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const webSocketUrl = `ws://127.0.0.1:${address.port}/remote-support/ws`;

  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  // healthz carries the capability and expiry contract so an outdated relay
  // is detectable with a plain GET, without opening a WebSocket.
  assert.deepEqual(await health.json(), {
    ok: true,
    protocol: REMOTE_SUPPORT_PROTOCOL,
    sessions: 0,
    serialOperations: [...REMOTE_SERIAL_OPERATIONS],
    sessionTtlMs: 24 * 60 * 60 * 1000,
  });

  const device = await openSocket(webSocketUrl);
  t.after(() => device.socket.terminate());
  device.socket.send(
    JSON.stringify({
      type: "hello",
      protocol: REMOTE_SUPPORT_PROTOCOL,
      role: "device",
    }),
  );
  const deviceReady = await device.queue.next(
    ({ type }) => type === "ready",
  );
  assert.match(deviceReady.session.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(typeof deviceReady.resumeToken, "string");
  assert.ok(deviceReady.resumeToken.length >= 32);

  const operator = await openSocket(webSocketUrl);
  t.after(() => operator.socket.terminate());
  operator.socket.send(
    JSON.stringify({
      type: "hello",
      protocol: REMOTE_SUPPORT_PROTOCOL,
      role: "operator",
      code: deviceReady.session.code,
      operatorKey: OPERATOR_KEY,
    }),
  );
  const operatorReady = await operator.queue.next(
    ({ type }) => type === "ready",
  );
  assert.equal(operatorReady.session.code, deviceReady.session.code);
  assert.equal(operatorReady.session.deviceOnline, true);
  assert.equal(
    (await device.queue.next(({ type }) => type === "peer")).online,
    true,
  );

  operator.socket.send(
    JSON.stringify({
      type: "serial_request",
      id: "command_12345678",
      op: "open",
      options: {
        baudRate: 1_000_000,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
        bufferSize: 4096,
      },
    }),
  );
  assert.deepEqual(
    await device.queue.next(({ type }) => type === "serial_request"),
    {
      type: "serial_request",
      id: "command_12345678",
      op: "open",
      options: {
        baudRate: 1_000_000,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
        bufferSize: 4096,
      },
    },
  );
  device.socket.send(
    JSON.stringify({
      type: "serial_result",
      id: "command_12345678",
      ok: true,
      result: { opened: true },
    }),
  );
  assert.deepEqual(
    await operator.queue.next(({ type }) => type === "serial_result"),
    {
      type: "serial_result",
      id: "command_12345678",
      ok: true,
      result: { opened: true },
    },
  );
});

test("rejects a bad technician key and messages outside the serial protocol", async (t) => {
  const relay = createRemoteSupportServer({
    operatorKey: OPERATOR_KEY,
    host: "127.0.0.1",
    port: 0,
    logger: { warn() {} },
  });
  const address = await relay.listen();
  t.after(() => relay.close());
  const url = `ws://127.0.0.1:${address.port}/remote-support/ws`;

  const device = await openSocket(url);
  t.after(() => device.socket.terminate());
  device.socket.send(
    JSON.stringify({
      type: "hello",
      protocol: REMOTE_SUPPORT_PROTOCOL,
      role: "device",
    }),
  );
  const ready = await device.queue.next(({ type }) => type === "ready");

  const rejected = await openSocket(url);
  t.after(() => rejected.socket.terminate());
  rejected.socket.send(
    JSON.stringify({
      type: "hello",
      protocol: REMOTE_SUPPORT_PROTOCOL,
      role: "operator",
      code: ready.session.code,
      operatorKey: "wrong",
    }),
  );
  assert.match(
    (await rejected.queue.next(({ type }) => type === "error")).error,
    /access key is invalid/i,
  );

  const operator = await openSocket(url);
  t.after(() => operator.socket.terminate());
  operator.socket.send(
    JSON.stringify({
      type: "hello",
      protocol: REMOTE_SUPPORT_PROTOCOL,
      role: "operator",
      code: ready.session.code,
      operatorKey: OPERATOR_KEY,
    }),
  );
  await operator.queue.next(({ type }) => type === "ready");
  operator.socket.send(
    JSON.stringify({
      type: "command",
      id: "command_87654321",
      action: "flash_firmware",
    }),
  );
  assert.match(
    (await operator.queue.next(({ type }) => type === "error")).error,
    /single-port serial protocol/i,
  );
});
