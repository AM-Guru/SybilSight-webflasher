import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";
import { createRemoteSupportServer } from "../deploy/homeassistant-addon/server.mjs";
import {
  RemoteSupportConnection,
  remoteJsonValue,
  remoteSupportAllowsDirectWebUsb,
  remoteSupportWebSocketUrl,
} from "../src/lib/remoteSupport.js";

const OPERATOR_KEY = "test-only-client-operator-key-32-characters";

function messageInbox() {
  const messages = [];
  const waiters = [];
  return {
    messages,
    receive(message) {
      const index = waiters.findIndex(({ predicate }) => predicate(message));
      if (index >= 0) {
        const [{ resolve, timer }] = waiters.splice(index, 1);
        clearTimeout(timer);
        resolve(message);
      } else {
        messages.push(message);
      }
    },
    next(predicate = () => true) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            reject(new Error("Timed out waiting for browser relay message."));
          }, 2000),
        };
        waiters.push(waiter);
      });
    },
  };
}

test("builds same-origin secure and local relay URLs", () => {
  assert.equal(
    remoteSupportWebSocketUrl({
      protocol: "https:",
      host: "webflasher.sybilsight.com",
    }),
    "wss://webflasher.sybilsight.com/remote-support/ws",
  );
  assert.equal(
    remoteSupportWebSocketUrl({
      protocol: "http:",
      host: "localhost:3000",
    }),
    "ws://localhost:3000/remote-support/ws",
  );
});

test("shows direct WebUSB only for an enabled device-side support session", () => {
  assert.equal(
    remoteSupportAllowsDirectWebUsb(
      { status: "connected", role: "device" },
      true,
    ),
    true,
  );
  for (const supportState of [
    { status: "idle", role: "device" },
    { status: "connecting", role: "device" },
    { status: "disconnected", role: "device" },
    { status: "connected", role: "operator" },
    null,
  ]) {
    assert.equal(
      remoteSupportAllowsDirectWebUsb(supportState, true),
      false,
    );
  }
  assert.equal(
    remoteSupportAllowsDirectWebUsb(
      { status: "connected", role: "device" },
      false,
    ),
    false,
  );
});

test("serializes diagnostic byte arrays and cycles safely", () => {
  const value = {
    frame: Uint8Array.from([0x5a, 0xa5, 0xff]),
  };
  value.self = value;
  assert.deepEqual(remoteJsonValue(value), {
    frame: {
      type: "bytes",
      byteLength: 3,
      hex: "5aa5ff",
    },
    self: "[circular]",
  });
});

test("browser clients exchange only authenticated relay messages", async (t) => {
  const relay = createRemoteSupportServer({
    operatorKey: OPERATOR_KEY,
    host: "127.0.0.1",
    port: 0,
    logger: { warn() {} },
  });
  const address = await relay.listen();
  t.after(() => relay.close());
  const url = `ws://127.0.0.1:${address.port}/remote-support/ws`;
  const deviceInbox = messageInbox();
  const operatorInbox = messageInbox();
  const device = new RemoteSupportConnection({
    url,
    WebSocketImpl: WebSocket,
    onMessage: deviceInbox.receive,
  });
  const operator = new RemoteSupportConnection({
    url,
    WebSocketImpl: WebSocket,
    onMessage: operatorInbox.receive,
  });
  t.after(() => {
    device.close();
    operator.close();
  });

  const deviceReady = await device.startDevice();
  await operator.joinOperator({
    code: deviceReady.session.code,
    operatorKey: OPERATOR_KEY,
  });
  await deviceInbox.next(
    ({ type, role, online }) =>
      type === "peer" && role === "operator" && online,
  );

  const id = "serial_request_12345678";
  operator.send({
    type: "serial_request",
    id,
    op: "set_signals",
    signals: {
      dataTerminalReady: false,
      requestToSend: true,
    },
  });
  assert.deepEqual(
    await deviceInbox.next(({ type }) => type === "serial_request"),
    {
      type: "serial_request",
      id,
      op: "set_signals",
      signals: {
        dataTerminalReady: false,
        requestToSend: true,
      },
    },
  );
  device.send({
    type: "serial_result",
    id,
    ok: true,
    result: {
      dataTerminalReady: false,
      requestToSend: true,
    },
  });
  assert.deepEqual(
    await operatorInbox.next(({ type }) => type === "serial_result"),
    {
      type: "serial_result",
      id,
      ok: true,
      result: {
        dataTerminalReady: false,
        requestToSend: true,
      },
    },
  );

  const taskPromise = operator.requestTask("bluetooth_probe", {});
  const taskRequest = await deviceInbox.next(
    ({ type }) => type === "task_request",
  );
  assert.equal(taskRequest.task, "bluetooth_probe");
  assert.deepEqual(taskRequest.args, {});
  device.sendTaskEvent(taskRequest.id, "started", {
    executedOn: "requester-browser",
  });
  device.sendTaskResult(taskRequest.id, {
    ok: true,
    result: { bothApplicationsReachable: true },
  });
  assert.deepEqual(await taskPromise, { bothApplicationsReachable: true });
});
