import assert from "node:assert/strict";
import test from "node:test";
import { releaseSelectedLocalCasePort } from "../src/lib/casePortLifecycle.js";

test("releases the selected local Case before another chooser can reuse it", async () => {
  const calls = [];
  const portRef = { current: {
    async close() {
      calls.push([portRef.current, sessionRef.current]);
    },
  } };
  const sessionRef = { current: { port: portRef.current } };
  const remotePortRef = { current: null };
  assert.equal(await releaseSelectedLocalCasePort({
    portRef, sessionRef, remotePortRef,
  }), true);
  assert.deepEqual(calls, [[null, null]]);
  assert.equal(portRef.current, null);
  assert.equal(sessionRef.current, null);
});

test("a disconnected Case still loses its stale authorization after close fails", async () => {
  const portRef = { current: { close: async () => { throw new Error("USB gone"); } } };
  const sessionRef = { current: { port: portRef.current } };
  const remotePortRef = { current: null };
  await assert.rejects(releaseSelectedLocalCasePort({
    portRef, sessionRef, remotePortRef,
  }), /USB gone/);
  assert.equal(portRef.current, null);
  assert.equal(sessionRef.current, null);
});

test("an already-closed browser serial port is a successful release", async () => {
  const portRef = { current: {
    close: async () => { throw new DOMException(
      "Failed to execute 'close' on 'SerialPort': The port is already closed.",
      "InvalidStateError",
    ); },
  } };
  const sessionRef = { current: { port: portRef.current } };
  assert.equal(await releaseSelectedLocalCasePort({
    portRef, sessionRef, remotePortRef: { current: null },
  }), true);
  assert.equal(portRef.current, null);
  assert.equal(sessionRef.current, null);
});

test("remote Case ownership is left to the remote-support cleanup", async () => {
  let closed = false;
  const remote = { close: async () => { closed = true; } };
  const portRef = { current: remote };
  const sessionRef = { current: { port: remote } };
  const remotePortRef = { current: remote };
  assert.equal(await releaseSelectedLocalCasePort({
    portRef, sessionRef, remotePortRef,
  }), false);
  assert.equal(portRef.current, remote);
  assert.equal(closed, false);
});
