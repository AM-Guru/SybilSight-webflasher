import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  G2_BLE_BEGIN_ATTEMPTS,
  G2_BLE_BLOCK_BYTES,
  G2_BLE_FRAME_PACING_MS,
  G2_BLE_LOSS_RECONNECT_DELAY_MS,
  G2_BLE_POST_UPDATE_RECONNECT_ATTEMPTS,
  G2_BLE_POST_UPDATE_RECONNECT_INTERVAL_MS,
  G2BleAuthenticationRelay,
  G2BleOtaError,
  G2BleOtaSession,
  G2_BLE_AUTH_MAGIC_SEEDS,
  g2BleSelectedHandleUnreachable,
  G2_BLE_POST_UPDATE_STALE_HANDLE_ATTEMPTS,
  applyG2BleReselectionProof,
  g2BleRouteProvenOverBluetooth,
  g2BleExpectedFirmwareRevisions,
  isG2BleStaleHandleError,
  proveG2BleTempleByReselection,
  waitForG2Advertisement,
  assertPinnedG2BleBundle,
  crc16CcittFalse,
  flashG2BleSessionsConcurrently,
  flashG2BleSessionsSequentially,
  findAuthorizedG2BleDevice,
  g2BleDeviceSide,
  g2BleRoutesAwaitingCaseVerification,
  g2BleTargetVersionProof,
  isG2BleConnectionLoss,
  makeBleControlFrames,
  makeBleEnvelopeFrames,
  makeG2BleAuthenticationFrames,
  parseBleAck,
  parseBleResponseEnvelope,
  probeAuthorizedG2BleDevices,
  requestG2BleDevice,
} from "../src/lib/g2BleOta.js";
import {
  EXPECTED_COMPONENTS,
  EXPECTED_COMPONENT_TYPES,
} from "../src/lib/firmware.js";

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

test("probes only previously authorized G2 handles and verifies application GATT", async () => {
  const services = [];
  const makeDevice = (name, id, reachable = true) => ({
    name,
    id,
    gatt: {
      async connect() {
        if (!reachable) throw new Error("not advertising");
        return {
          async getPrimaryService(service) {
            services.push({ id, service });
            return {};
          },
        };
      },
      disconnect() {},
    },
  });
  const bluetooth = {
    async getDevices() {
      return [
        makeDevice("Even G2_32_L_AAAAAA", "left"),
        makeDevice("Even G2_32_R_BBBBBB", "right", false),
        makeDevice("Unrelated", "other"),
      ];
    },
  };
  const result = await probeAuthorizedG2BleDevices({ bluetooth });
  assert.deepEqual(result.authorizedSides, ["left", "right"]);
  assert.deepEqual(result.reachableSides, ["left"]);
  assert.equal(result.bothApplicationsReachable, false);
  assert.equal(result.chooserRequired, false);
  assert.match(result.results.right.error, /not advertising/);
  assert.equal(services.length, 1);
});

test("reuses an exact previously authorized side handle before opening a chooser", async () => {
  const devices = [
    { name: "Even G2_32_L_OTHER", id: "other-left" },
    { name: "Even G2_32_R_8D6E3C", id: "right" },
    { name: "Even G2_32_L_ACD458", id: "remembered-left" },
  ];
  const bluetooth = { async getDevices() { return devices; } };
  assert.equal(
    (await findAuthorizedG2BleDevice("left", {
      bluetooth,
      expectedName: "Even G2_32_L_ACD458",
    }))?.id,
    "remembered-left",
  );
  assert.equal(
    (await findAuthorizedG2BleDevice("right", { bluetooth }))?.id,
    "right",
  );
});

test("keeps the selected component set on the bounded solo retry", async () => {
  const appSource = await readFile(
    new URL("../src/App.jsx", import.meta.url),
    "utf8",
  );
  assert.match(
    appSource,
    /retrySession\.flashBundle\(\s*prepared,\s*bleFlashOptions,?\s*\)/,
  );
});

test("a component selection validates the whole pin but transfers only the selected main", async () => {
  const target = { imageSha256: "b".repeat(64) };
  const firmware = {
    templeFlashEligible: true,
    templeFlashTarget: target,
    fileSha256: target.imageSha256,
    g2Version: "2.2.9.27",
    componentImages: EXPECTED_COMPONENTS.map((name, index) => ({
      name,
      typeId: EXPECTED_COMPONENT_TYPES[index],
      header: new Uint8Array(128),
      payload: Uint8Array.of(index),
      payloadSize: 1,
    })),
  };
  const session = new G2BleOtaSession(
    { name: "Even G2_32_L_ACD458" },
    { side: "left" },
  );
  session.connectForTransfer = async () => {};
  session.startHeartbeat = () => {};
  session.stopHeartbeat = () => {};
  session.beginPackage = async () => 0;
  session.settleFinalUpdate = async () => ({ reconnected: true });
  const transferred = [];
  session.flashComponent = async (component, index, totals) => {
    transferred.push(component.name);
    totals.completedBeforeComponent += component.payload.length;
    totals.highWater = totals.completedBeforeComponent;
    return { name: component.name, payloadBytes: 1, blocks: 1, endStatus: 8 };
  };
  const result = await session.flashBundle(firmware, {
    componentNames: ["ota/s200_firmware_ota.bin"],
  });
  assert.deepEqual(transferred, ["ota/s200_firmware_ota.bin"]);
  assert.equal(result.components.length, 1);
});

test("matches the captured G2 AA21 CRC and envelope vectors", () => {
  assert.equal(crc16CcittFalse(Buffer.from("123456789")), 0x29b1);
  assert.equal(crc16CcittFalse(Uint8Array.of(0)), 0xe1f0);
  assert.deepEqual(
    makeBleControlFrames(0x00, new Uint8Array(), 1).map(hex),
    ["aa2101030101c00000f0e1"],
  );
  assert.deepEqual(
    makeG2BleAuthenticationFrames(2).map(hex),
    ["aa21020c01018000080410021a04080110044e8e"],
  );
});

test("splits a 233-byte payload exactly like the reviewed flasher", () => {
  const frames = makeBleEnvelopeFrames(
    0xc1,
    Uint8Array.from({ length: 233 }, (_, index) => index),
    { sequence: 0xfe },
  );
  assert.equal(frames.length, 2);
  assert.deepEqual(
    [...frames[0].subarray(0, 8)],
    [0xaa, 0x21, 0xfe, 232, 2, 1, 0xc1, 0],
  );
  assert.equal(frames[0][8], 0);
  assert.equal(frames[0].at(-1), 231);
  assert.equal(hex(frames[1]), "aa21fe030202c100e83e4a");
});

test("unwraps AA12 acknowledgement payloads", () => {
  const ack = parseBleAck(
    Uint8Array.from([
      0xaa, 0x12, 0x44, 0x04, 0x01, 0x01, 0xc0, 0x00,
      0x02, 0x07, 0x00, 0x00,
    ]),
  );
  assert.equal(ack.sequence, 0x44);
  assert.equal(ack.sid, 0xc0);
  assert.equal(ack.opcode, 0x02);
  assert.equal(ack.status, 0x07);
  assert.equal(parseBleAck(Uint8Array.of(0xaa, 0x21)), null);
  assert.deepEqual(
    [...parseBleResponseEnvelope(Uint8Array.from([
      0xaa, 0x12, 0x02, 0x08, 0x01, 0x01, 0x80, 0x00,
      0x08, 0x04, 0x10, 0x02, 0x1a, 0x00, 0x00, 0x00,
    ])).payload],
    [0x08, 0x04, 0x10, 0x02, 0x1a, 0x00],
  );
});

test("authenticates with jimrandomh's stock 2.2.9 request and exact echoed reply", async () => {
  const written = [];
  const session = new G2BleOtaSession(
    { name: "Even G2_32_L_ACD458" },
    { side: "left", authTimeoutMs: 50 },
  );
  session.controlWrite = {
    async writeValueWithoutResponse(frame) {
      written.push(frame.slice());
      queueMicrotask(() => {
        session.controlNotifyHandler({
          target: {
            value: new DataView(Uint8Array.from([
              0xaa, 0x12, 0x01, 0x08, 0x01, 0x01, 0x80, 0x00,
              0x08, 0x04, 0x10, 0x01, 0x1a, 0x00, 0x00, 0x00,
            ]).buffer),
          },
        });
      });
    },
  };

  await session.authenticate();
  assert.deepEqual(written.map(hex), [
    "aa21010c01018000080410011a0408011004cc56",
  ]);
  assert.equal(session.sequence, 1);
  assert.equal(session.startHeartbeat, undefined);
});

test("every fresh GATT connect authenticates and resets the independent OTA sequence", async () => {
  const listeners = new Set();
  const controlNotify = {
    addEventListener(_name, listener) { listeners.add(listener); },
    removeEventListener(_name, listener) { listeners.delete(listener); },
    async startNotifications() {},
    async stopNotifications() {},
  };
  const authWrites = [];
  const controlWrite = {
    async writeValueWithoutResponse(frame) {
      authWrites.push(frame.slice());
      const magic = frame[2];
      const response = new DataView(Uint8Array.from([
        0xaa, 0x12, magic, 0x08, 0x01, 0x01, 0x80, 0x00,
        0x08, 0x04, 0x10, magic, 0x1a, 0x00, 0x00, 0x00,
      ]).buffer);
      queueMicrotask(() => {
        for (const listener of listeners) listener({ target: { value: response } });
      });
    },
  };
  const dataNotify = {
    addEventListener() {},
    removeEventListener() {},
    async startNotifications() {},
    async stopNotifications() {},
  };
  const dataWrite = { async writeValueWithoutResponse() {} };
  const gatt = {
    connected: true,
    async getPrimaryService(uuid) {
      const control = uuid.endsWith("5450");
      return {
        async getCharacteristic(characteristic) {
          if (control) {
            return characteristic.endsWith("5401")
              ? controlWrite
              : controlNotify;
          }
          return characteristic.endsWith("0001") ? dataWrite : dataNotify;
        },
      };
    },
  };
  const session = new G2BleOtaSession(
    { name: "Even G2_32_R_693CCB", gatt },
    { side: "right", notificationSettleMs: 0, authTimeoutMs: 50 },
  );
  session.sequence = 99;

  await session.connect();
  assert.equal(authWrites.length, 1);
  assert.equal(authWrites[0][6], 0x80);
  assert.equal(session.sequence, 0);
});

test("uses one shared sequence for a block marker and all block fragments", async () => {
  const written = [];
  const characteristic = {
    writeValueWithoutResponse: async (frame) => written.push(frame.slice()),
  };
  const session = new G2BleOtaSession(
    { name: "Even G2_32_R_693CCB" },
    { side: "right" },
  );
  session.dataWrite = characteristic;
  session.waitForAck = async () => 0;
  const status = await session.sendBlock(
    new Uint8Array(G2_BLE_BLOCK_BYTES),
  );
  assert.equal(status, 0);
  assert.equal(written.length, 19);
  assert.equal(written[0][6], 0xc0);
  assert.equal(written[1][6], 0xc1);
  assert.ok(written.every((frame) => frame[2] === 1));
  assert.equal(G2_BLE_FRAME_PACING_MS, 3);
});

test("an explicit block NAK is safely resent in place", async () => {
  const statuses = [3, 0];
  const session = new G2BleOtaSession(
    { name: "Even G2_32_R_693CCB" },
    {
      side: "right",
      componentAttempts: 1,
      blockNakAttempts: 3,
    },
  );
  const controls = [];
  let blockCalls = 0;
  session.sendControl = async (opcode) => {
    controls.push(opcode);
    return opcode === 0x03 ? 8 : 0;
  };
  session.sendBlock = async () => {
    blockCalls += 1;
    return statuses.shift();
  };
  const totals = {
    totalBytes: 4,
    completedBeforeComponent: 0,
    highWater: 0,
  };
  const result = await session.flashComponent(
    {
      name: "firmware/test.bin",
      header: new Uint8Array(128),
      payload: Uint8Array.of(1, 2, 3, 4),
    },
    0,
    totals,
  );
  assert.equal(blockCalls, 2);
  assert.deepEqual(controls, [0x01, 0x03]);
  assert.equal(result.endStatus, 8);
});

test("an ambiguous block timeout restarts the component from FILE_CHECK", async () => {
  const session = new G2BleOtaSession(
    { name: "Even G2_32_R_693CCB" },
    {
      side: "right",
      componentAttempts: 2,
      componentRetrySettleMs: 0,
    },
  );
  const controls = [];
  let blockCalls = 0;
  session.sendControl = async (opcode) => {
    controls.push(opcode);
    return opcode === 0x03 ? 8 : 0;
  };
  session.sendBlock = async () => {
    blockCalls += 1;
    if (blockCalls === 1) {
      throw new G2BleOtaError("lost ack", {
        code: "ACK_TIMEOUT",
        opcode: 0x02,
      });
    }
    return 0;
  };
  await session.flashComponent(
    {
      name: "firmware/test.bin",
      header: new Uint8Array(128),
      payload: Uint8Array.of(1, 2, 3, 4),
    },
    0,
    {
      totalBytes: 4,
      completedBeforeComponent: 0,
      highWater: 0,
    },
  );
  assert.equal(blockCalls, 2);
  assert.deepEqual(controls, [0x01, 0x01, 0x03]);
});

test("a hidden WebFlasher pauses before starting the next BLE block", async () => {
  const listeners = new Set();
  const documentObject = {
    visibilityState: "hidden",
    addEventListener(type, listener) {
      assert.equal(type, "visibilitychange");
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      assert.equal(type, "visibilitychange");
      listeners.delete(listener);
    },
  };
  const written = [];
  const logs = [];
  const session = new G2BleOtaSession(
    { name: "Even G2_32_R_693CCB" },
    {
      side: "right",
      documentObject,
      visibilityResumeSettleMs: 0,
      log: (message, tone) => logs.push({ message, tone }),
    },
  );
  session.dataWrite = {
    writeValueWithoutResponse: async (frame) => written.push(frame.slice()),
  };
  session.waitForAck = async () => 0;

  const pending = session.sendBlock(new Uint8Array(G2_BLE_BLOCK_BYTES));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(written.length, 0);
  assert.equal(listeners.size, 1);
  assert.match(logs[0].message, /paused before the next 4 KB block/);

  documentObject.visibilityState = "visible";
  for (const listener of [...listeners]) listener();
  assert.equal(await pending, 0);
  assert.equal(written.length, 19);
  assert.equal(listeners.size, 0);
  assert.equal(session.foregroundPauses, 1);
  assert.match(logs.at(-1).message, /resuming/);
});

test("a failed BLE bundle retains every component with verified END evidence", async () => {
  const target = { imageSha256: "a".repeat(64) };
  const firmware = {
    templeFlashEligible: true,
    templeFlashTarget: target,
    fileSha256: target.imageSha256,
    g2Version: "2.2.6.11",
    componentImages: EXPECTED_COMPONENTS.map((name, index) => ({
      name,
      typeId: EXPECTED_COMPONENT_TYPES[index],
      header: new Uint8Array(128),
      payload: Uint8Array.of(index),
      payloadSize: 1,
    })),
  };
  const session = new G2BleOtaSession(
    { name: "Even G2_32_R_693CCB" },
    { side: "right" },
  );
  session.connect = async () => {};
  session.startHeartbeat = () => {};
  session.stopHeartbeat = () => {};
  session.sendControl = async () => 0;
  session.flashComponent = async (component, index, totals) => {
    if (index === 1) {
      throw new G2BleOtaError("component failed", {
        code: "COMPONENT_FAILED",
        componentIndex: index,
        componentName: component.name,
        attempts: 3,
        cause: new G2BleOtaError("block rejected", {
          code: "BLOCK_REJECTED",
          status: 4,
          blockIndex: 14,
          blockAttempts: 3,
        }),
      });
    }
    totals.completedBeforeComponent += component.payload.length;
    totals.highWater = totals.completedBeforeComponent;
    return {
      name: component.name,
      payloadBytes: component.payload.length,
      blocks: 1,
      endStatus: 8,
      attempts: 1,
    };
  };

  let failure;
  try {
    await session.flashBundle(firmware);
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.code, "COMPONENT_FAILED");
  assert.equal(failure.partialResult.outcome, "failed_or_partial");
  assert.equal(failure.partialResult.completedComponentCount, 1);
  assert.equal(failure.partialResult.components[0].name, EXPECTED_COMPONENTS[0]);
  assert.equal(failure.partialResult.components[0].endStatus, 8);
  assert.equal(failure.partialResult.blockAcks, 1);
  assert.equal(failure.partialResult.verifiedPayloadBytes, 1);
  assert.equal(failure.partialResult.failure.componentName, EXPECTED_COMPONENTS[1]);
  assert.deepEqual(failure.partialResult.failure.cause, {
    message: "block rejected",
    code: "BLOCK_REJECTED",
    status: 4,
    blockIndex: 14,
    blockAttempts: 3,
    opcode: null,
  });
});

test("left and right BLE sessions flash concurrently and settle independently", async () => {
  let releaseLeft;
  const leftGate = new Promise((resolve) => {
    releaseLeft = resolve;
  });
  const started = [];
  const disconnected = [];
  const settledSides = [];
  let completed = false;
  const receivedOptions = [];
  const entries = ["left", "right"].map((side) => ({
    side,
    device: { id: `${side}-id`, name: `Even G2_32_${side[0].toUpperCase()}_TEST` },
    session: {
      async flashBundle(_firmware, options) {
        receivedOptions.push(options);
        started.push(side);
        if (side === "left") {
          await leftGate;
          return { side, outcome: "success" };
        }
        throw new G2BleOtaError("right stopped", {
          code: "COMPONENT_FAILED",
          partialResult: {
            side,
            components: [{ name: "firmware/codec.bin", endStatus: 8 }],
            outcome: "failed_or_partial",
          },
        });
      },
      async disconnect() {
        disconnected.push(side);
      },
    },
  }));

  const pending = flashG2BleSessionsConcurrently(entries, {}, {
    flashOptions: { componentNames: ["ota/s200_firmware_ota.bin"] },
    onSettled: ({ side, status }) => settledSides.push({ side, status }),
  }).then((value) => {
    completed = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started.sort(), ["left", "right"]);
  assert.equal(completed, false);
  assert.deepEqual(settledSides, [{ side: "right", status: "rejected" }]);

  releaseLeft();
  const outcomes = await pending;
  assert.equal(completed, true);
  assert.deepEqual(disconnected.sort(), ["left", "right"]);
  assert.equal(outcomes[0].side, "left");
  assert.equal(outcomes[0].status, "fulfilled");
  assert.equal(outcomes[0].value.outcome, "success");
  assert.equal(outcomes[1].side, "right");
  assert.equal(outcomes[1].status, "rejected");
  assert.equal(outcomes[1].reason.message, "right stopped");
  assert.deepEqual(settledSides, [
    { side: "right", status: "rejected" },
    { side: "left", status: "fulfilled" },
  ]);
  assert.equal(
    outcomes[1].reason.partialResult.components[0].endStatus,
    8,
  );
  assert.deepEqual(receivedOptions, [
    { componentNames: ["ota/s200_firmware_ota.bin"] },
    { componentNames: ["ota/s200_firmware_ota.bin"] },
  ]);
});

test("connection-loss recovery waits 10 seconds by default and recognizes Chrome errors", () => {
  const session = new G2BleOtaSession(
    {
      id: "left-id",
      name: "Even G2_32_L_TEST",
      gatt: { connected: true },
    },
    { side: "left" },
  );
  assert.equal(G2_BLE_LOSS_RECONNECT_DELAY_MS, 10_000);
  assert.equal(session.lossReconnectDelayMs, 10_000);
  assert.equal(session.rebootSettleMs, 10_000);
  assert.equal(
    isG2BleConnectionLoss(
      Object.assign(
        new Error("Bluetooth Device is no longer in range."),
        { code: 19 },
      ),
      session.device,
    ),
    true,
  );
  assert.equal(
    isG2BleConnectionLoss(new Error("CRC rejected"), session.device),
    false,
  );
});

test("a lost component connection reuses the selected endpoint and restarts at FILE_CHECK", async () => {
  const device = {
    id: "right-paired-id",
    name: "Even G2_32_R_TEST",
    gatt: { connected: true },
  };
  const session = new G2BleOtaSession(device, {
    side: "right",
    componentAttempts: 2,
    componentRetrySettleMs: 0,
  });
  const controls = [];
  const recoveryContexts = [];
  let blockCalls = 0;
  session.sendControl = async (opcode) => {
    controls.push(opcode);
    return opcode === 0x03 ? 8 : 0;
  };
  session.sendBlock = async () => {
    blockCalls += 1;
    if (blockCalls === 1) {
      device.gatt.connected = false;
      throw Object.assign(
        new Error("Bluetooth Device is no longer in range."),
        { code: 19 },
      );
    }
    return 0;
  };
  session.reconnectAfterLoss = async (context) => {
    recoveryContexts.push(context);
    assert.equal(session.device, device);
    assert.equal(session.selectedDeviceId, "right-paired-id");
    device.gatt.connected = true;
  };

  const result = await session.flashComponent(
    {
      name: "ota/s200_firmware_ota.bin",
      payload: Uint8Array.of(1, 2, 3),
    },
    5,
    { totalBytes: 3, completedBeforeComponent: 0, highWater: 0 },
  );

  assert.equal(result.attempts, 2);
  assert.deepEqual(controls, [0x01, 0x01, 0x03]);
  assert.equal(blockCalls, 2);
  assert.deepEqual(recoveryContexts, [
    "ota/s200_firmware_ota.bin attempt 1/2",
  ]);
});

test("reconnect after loss uses the original paired device ID without a chooser", async () => {
  const logs = [];
  const statuses = [];
  let connectAttempts = 0;
  const device = {
    id: "left-paired-id",
    name: "Even G2_32_L_TEST",
    gatt: {
      connected: false,
      disconnect() {},
    },
  };
  const session = new G2BleOtaSession(device, {
    side: "left",
    lossReconnectDelayMs: 0,
    reconnectIntervalMs: 0,
    reconnectAttempts: 3,
    log: (message, tone) => logs.push({ message, tone }),
    progress: (_fraction, detail, status) =>
      statuses.push({ detail, status }),
  });
  session.disconnect = async () => {};
  session.connect = async () => {
    connectAttempts += 1;
    assert.equal(session.device, device);
    assert.equal(session.device.id, "left-paired-id");
    if (connectAttempts === 1) {
      throw new Error("Bluetooth Device is no longer in range.");
    }
    device.gatt.connected = true;
  };
  session.sendControl = async (opcode) => {
    assert.equal(opcode, 0x00);
    return 0;
  };

  assert.deepEqual(await session.reconnectAfterLoss("test boundary"), {
    attempts: 2,
    deviceId: "left-paired-id",
    beginStatus: 0,
  });
  assert.equal(connectAttempts, 2);
  assert.deepEqual(
    statuses.map(({ status }) => status),
    ["reconnecting", "flashing"],
  );
  assert.match(logs[0].message, /chooser will not reopen/);
  assert.match(logs.at(-1).message, /left-paired-id/);
});

test("an initially unreachable selected temple gets bounded reconnect attempts", async () => {
  const logs = [];
  let connectAttempts = 0;
  let disconnects = 0;
  const session = new G2BleOtaSession(
    {
      name: "Even G2_32_L_ACD458",
      gatt: {
        disconnect() {
          disconnects += 1;
        },
      },
    },
    {
      side: "left",
      initialConnectAttempts: 4,
      reconnectIntervalMs: 0,
      log: (message, tone) => logs.push({ message, tone }),
    },
  );
  session.connect = async () => {
    connectAttempts += 1;
    if (connectAttempts < 3) {
      throw Object.assign(
        new Error("Bluetooth Device is no longer in range."),
        { code: 19 },
      );
    }
  };

  assert.deepEqual(await session.connectForTransfer(), { attempts: 3 });
  assert.equal(connectAttempts, 3);
  assert.equal(disconnects, 2);
  assert.match(logs[0].message, /Waiting for it to advertise/);
  assert.match(logs.at(-1).message, /became reachable again/);
});

test("the post-update reconnect budget outlasts the temple's firmware apply", () => {
  const session = new G2BleOtaSession(
    { name: "Even G2_32_R_693CCB", gatt: {} },
    { side: "right" },
  );
  assert.equal(G2_BLE_POST_UPDATE_RECONNECT_INTERVAL_MS, 5000);
  assert.equal(G2_BLE_POST_UPDATE_RECONNECT_ATTEMPTS, 24);
  assert.equal(G2_BLE_BEGIN_ATTEMPTS, 3);
  assert.equal(session.postUpdateReconnectIntervalMs, 5000);
  assert.equal(session.postUpdateReconnectAttempts, 24);
  assert.equal(session.beginAttempts, 3);
  // The mid-transfer blip budget is deliberately unchanged: a connection that
  // drops during transfer should still resolve or fail quickly.
  assert.equal(session.reconnectAttempts, 8);
  assert.equal(session.reconnectIntervalMs, 2500);
  // END 8 (UPDATING) applies a multi-megabyte staged image; the settle pause
  // plus the reconnect ladder must cover at least two minutes of silence.
  assert.ok(
    session.rebootSettleMs +
      (session.postUpdateReconnectAttempts - 1) *
        session.postUpdateReconnectIntervalMs >=
      120_000,
  );
});

test("a silent BEGIN is retried on a rebuilt link instead of failing the side", async () => {
  const logs = [];
  let rebuilds = 0;
  let disconnects = 0;
  let sends = 0;
  const session = new G2BleOtaSession(
    { name: "Even G2_32_L_BEA504", gatt: { connected: true } },
    { side: "left", log: (message, tone) => logs.push({ message, tone }) },
  );
  session.disconnect = async () => {
    disconnects += 1;
  };
  session.connectForTransfer = async () => {
    rebuilds += 1;
  };
  session.sendControl = async (opcode) => {
    assert.equal(opcode, 0x00);
    sends += 1;
    if (sends === 1) {
      throw new G2BleOtaError("left: no Bluetooth OTA acknowledgement for opcode 0x00.", {
        code: "ACK_TIMEOUT",
        opcode: 0x00,
      });
    }
    return 0;
  };

  assert.equal(await session.beginPackage(), 0);
  assert.equal(sends, 2);
  assert.equal(disconnects, 1);
  assert.equal(rebuilds, 1);
  assert.match(logs[0].message, /BEGIN attempt 2\/3/);
  assert.match(logs[0].message, /safe to resend/);
});

test("a BEGIN that stays silent is bounded and reports before any firmware moved", async () => {
  const session = new G2BleOtaSession(
    { name: "Even G2_32_L_BEA504", gatt: { connected: true } },
    { side: "left", beginAttempts: 2 },
  );
  session.disconnect = async () => {};
  session.connectForTransfer = async () => {};
  session.startHeartbeat = () => {};
  session.sendControl = async () => {
    throw new G2BleOtaError("left: no Bluetooth OTA acknowledgement for opcode 0x00.", {
      code: "ACK_TIMEOUT",
      opcode: 0x00,
    });
  };

  await assert.rejects(session.beginPackage(), (error) => {
    assert.equal(error.code, "BEGIN_FAILED");
    assert.equal(error.attempts, 2);
    assert.equal(error.cause?.code, "ACK_TIMEOUT");
    assert.match(error.message, /no firmware bytes were sent/);
    return true;
  });
});

test("a BEGIN connection loss still routes through the saved-endpoint recovery", async () => {
  const contexts = [];
  const session = new G2BleOtaSession(
    { name: "Even G2_32_L_BEA504", gatt: { connected: false } },
    { side: "left" },
  );
  session.sendControl = async () => {
    throw Object.assign(
      new Error("Bluetooth Device is no longer in range."),
      { code: 19 },
    );
  };
  session.reconnectAfterLoss = async (context) => {
    contexts.push(context);
    return { attempts: 1, beginStatus: 0 };
  };

  assert.equal(await session.beginPackage(), 0);
  assert.deepEqual(contexts, ["the package BEGIN command"]);
});

test("a final END 8 reboot reconnects instead of surfacing the heartbeat disconnect", async () => {
  const target = {
    imageSha256: "a".repeat(64),
  };
  const firmware = {
    templeFlashEligible: true,
    templeFlashTarget: target,
    fileSha256: target.imageSha256,
    g2Version: "2.2.6.11",
    componentImages: EXPECTED_COMPONENTS.map((name, index) => ({
      name,
      typeId: EXPECTED_COMPONENT_TYPES[index],
      header: new Uint8Array(128),
      payload: Uint8Array.of(index),
      payloadSize: 1,
    })),
  };
  const session = new G2BleOtaSession(
    {
      name: "Even G2_32_R_693CCB",
      gatt: { connected: false },
    },
    { side: "right" },
  );
  session.connect = async () => {};
  session.startHeartbeat = () => {};
  session.stopHeartbeat = () => {};
  session.sendControl = async () => 0;
  let finalSettles = 0;
  session.settleFinalUpdate = async (endStatus) => {
    finalSettles += 1;
    assert.equal(endStatus, 8);
    session.heartbeatError = null;
    return {
      expectedReboot: true,
      reconnected: true,
      reconnectAttempts: 2,
    };
  };
  session.flashComponent = async (component, index, totals) => {
    totals.completedBeforeComponent += component.payload.length;
    totals.highWater = totals.completedBeforeComponent;
    if (index === EXPECTED_COMPONENTS.length - 1) {
      session.heartbeatError = new Error(
        "Bluetooth Device is no longer in range.",
      );
    }
    return {
      name: component.name,
      payloadBytes: component.payload.length,
      blocks: 1,
      endStatus: 8,
      attempts: 1,
    };
  };

  const result = await session.flashBundle(firmware);
  assert.equal(result.outcome, "success");
  assert.equal(result.components.length, EXPECTED_COMPONENTS.length);
  assert.equal(finalSettles, 1);
  assert.deepEqual(result.components.at(-1).postUpdate, {
    expectedReboot: true,
    reconnected: true,
    reconnectAttempts: 2,
  });
});

test("an explicit final END preserves the transfer when bounded reboot reconnect is delayed", async () => {
  const logs = [];
  let connectAttempts = 0;
  const device = {
    name: "Even G2_32_R_693CCB",
    gatt: {
      connected: false,
      async connect() {
        connectAttempts += 1;
        throw new Error("Bluetooth Device is no longer in range.");
      },
      disconnect() {},
    },
  };
  const session = new G2BleOtaSession(device, {
    side: "right",
    log: (message, tone) => logs.push({ message, tone }),
    rebootSettleMs: 0,
    postUpdateReconnectIntervalMs: 0,
    postUpdateReconnectAttempts: 3,
  });
  session.writeTail = Promise.reject(
    new Error("Bluetooth Device is no longer in range."),
  );
  session.heartbeatError = new Error(
    "Bluetooth Device is no longer in range.",
  );

  const result = await session.settleFinalUpdate(8);
  assert.equal(connectAttempts, 3);
  assert.equal(result.expectedReboot, true);
  assert.equal(result.rebootObserved, true);
  assert.equal(result.freshReconnectAttempted, true);
  assert.equal(result.reconnected, false);
  assert.equal(result.reconnectAttempts, 3);
  assert.match(result.reconnectError, /no longer in range/);
  assert.match(logs.at(-1).message, /No firmware will be replayed/);
});

test("a completed transfer remains pending when reboot GATT liveness is absent", () => {
  const routes = {
    left: {
      outcome: "success",
      components: [
        {
          postUpdate: {
            freshReconnectAttempted: true,
            reconnected: false,
          },
        },
      ],
    },
    right: {
      outcome: "success",
      components: [
        {
          postUpdate: {
            freshReconnectAttempted: true,
            reconnected: true,
          },
        },
      ],
    },
  };
  assert.deepEqual(g2BleRoutesAwaitingCaseVerification(routes), ["left"]);
  routes.left.skipped = true;
  routes.left.verifiedBy = "fresh-case-version-proof";
  assert.deepEqual(g2BleRoutesAwaitingCaseVerification(routes), []);
});

test("the final reboot reconnect is bounded and succeeds on the selected device handle", async () => {
  let connectAttempts = 0;
  const device = {
    name: "Even G2_32_R_693CCB",
    gatt: {
      connected: false,
      disconnect() {},
    },
  };
  const session = new G2BleOtaSession(device, {
    side: "right",
    rebootSettleMs: 0,
    postUpdateReconnectIntervalMs: 0,
    postUpdateReconnectAttempts: 4,
  });
  session.connect = async () => {
    connectAttempts += 1;
    if (connectAttempts < 3) {
      throw new Error("Bluetooth Device is no longer in range.");
    }
    device.gatt.connected = true;
  };

  const result = await session.settleFinalUpdate(8);
  assert.equal(connectAttempts, 3);
  assert.deepEqual(result, {
    expectedReboot: true,
    rebootObserved: true,
    freshReconnectAttempted: true,
    reconnected: true,
    reconnectAttempts: 3,
  });
});

test("a live final-END link is closed and freshly reconnected without replay", async () => {
  let disconnects = 0;
  let connectAttempts = 0;
  const device = {
    name: "Even G2_32_R_693CCB",
    gatt: { connected: true },
  };
  const session = new G2BleOtaSession(device, {
    side: "right",
    rebootSettleMs: 0,
    postUpdateReconnectIntervalMs: 0,
    postUpdateReconnectAttempts: 3,
  });
  session.disconnect = async () => {
    disconnects += 1;
    device.gatt.connected = false;
  };
  session.connect = async () => {
    connectAttempts += 1;
    device.gatt.connected = true;
  };

  const result = await session.settleFinalUpdate(8);
  assert.equal(disconnects, 1);
  assert.equal(connectAttempts, 1);
  assert.deepEqual(result, {
    expectedReboot: true,
    rebootObserved: false,
    freshReconnectAttempted: true,
    reconnected: true,
    reconnectAttempts: 1,
  });
});

test("the direct BLE writer accepts only the complete pinned topology", () => {
  const target = {
    imageSha256: "a".repeat(64),
  };
  const firmware = {
    templeFlashEligible: true,
    templeFlashTarget: target,
    fileSha256: target.imageSha256,
    componentImages: EXPECTED_COMPONENTS.map((name, index) => ({
      name,
      typeId: EXPECTED_COMPONENT_TYPES[index],
      header: new Uint8Array(128),
      payload: Uint8Array.of(index),
      payloadSize: 1,
    })),
  };
  assert.equal(assertPinnedG2BleBundle(firmware), firmware);
  assert.throws(
    () =>
      assertPinnedG2BleBundle({
        ...firmware,
        componentImages: firmware.componentImages.slice(1),
      }),
    /complete 6-component/,
  );
});

test("the chooser rejects a temple from the wrong side", async () => {
  let disconnected = false;
  const bluetooth = {
    requestDevice: async () => ({
      name: "Even G2_32_L_693CCB",
      gatt: {
        disconnect() {
          disconnected = true;
        },
      },
    }),
  };
  let failure;
  try {
    await requestG2BleDevice("right", bluetooth);
  } catch (caught) {
    failure = caught;
  }
  assert.match(failure?.message ?? "", /Select the right temple/);
  assert.equal(failure.code, "WRONG_G2_SIDE");
  assert.equal(failure.requestedSide, "right");
  assert.equal(failure.observedSide, "left");
  assert.equal(failure.deviceName, "Even G2_32_L_693CCB");
  assert.equal(disconnected, true);
});

test("recognizes relaxed Chrome/CoreBluetooth G2 side-name variants", () => {
  assert.equal(g2BleDeviceSide("Even G2_32_L_693CCB"), "left");
  assert.equal(g2BleDeviceSide("Even G2 32 Right 693CCB"), "right");
  assert.equal(g2BleDeviceSide("G2_7_r_00A19F "), "right");
  assert.equal(g2BleDeviceSide("Even G2"), null);
  assert.equal(g2BleDeviceSide("Even G2_32_L_RIGHT_693CCB"), null);
  assert.equal(g2BleDeviceSide("Unrelated_L_device"), null);
});

test("fresh restored Case proof skips a Bluetooth rewrite only at the exact target", () => {
  const observedAt = "2026-07-30T21:00:00.000Z";
  const results = {
    version: {
      decoded: {
        firmwareVersion: "2.2.6.11",
      },
      transportProof: {
        restoredMask: 0x3ff,
      },
      observedAt,
    },
    lastProbeFailure: null,
  };
  const now = Date.parse(observedAt) + 5 * 60 * 1000;
  assert.equal(
    g2BleTargetVersionProof(results, "2.2.6.11", { now }),
    true,
  );
  assert.equal(
    g2BleTargetVersionProof(results, "2.2.6.10", { now }),
    false,
  );
  assert.equal(
    g2BleTargetVersionProof(
      {
        ...results,
        version: {
          ...results.version,
          transportProof: { restoredMask: 0 },
        },
      },
      "2.2.6.11",
      { now },
    ),
    false,
  );
  assert.equal(
    g2BleTargetVersionProof(
      {
        ...results,
        lastProbeFailure: { message: "no reply" },
      },
      "2.2.6.11",
      { now },
    ),
    false,
  );
  assert.equal(
    g2BleTargetVersionProof(results, "2.2.6.11", {
      now: Date.parse(observedAt) + 16 * 60 * 1000,
    }),
    false,
  );
});

test("requires an explicit matching side marker after the chooser", async () => {
  const device = {
    name: "Even G2",
    id: "shortened-corebluetooth-id",
    gatt: {
      disconnect() {},
    },
  };
  let options = null;
  await assert.rejects(
    requestG2BleDevice("right", {
      requestDevice: async (value) => {
        options = value;
        return device;
      },
    }),
    /without one unambiguous Left\/Right marker.*explicitly identifies the right side/,
  );
  // The chooser is now restricted to the requested side. The rejection above
  // is still what makes the guarantee hold: these prefixes are built from the
  // observed name-token list, so a G2 advertising an unrecorded token falls
  // back to pair-wide filters that cannot express the side at all.
  assert.deepEqual(
    options.filters.map((filter) => filter.namePrefix),
    ["Even G2_32_R_", "G2_32_R_"],
  );
  // The chooser requests the two services required by the OTA transport plus
  // the standard Device Information service, which the post-update
  // re-selection proof reads for the firmware revision.
  assert.deepEqual(
    options.optionalServices,
    [
      "00002760-08c2-11e1-9073-0e8ac72e1001",
      "00002760-08c2-11e1-9073-0e8ac72e5450",
      "device_information",
    ],
  );
});

test("accepts only the requested explicit side", async () => {
  const left = {
    name: "Even G2_32_L_693CCB",
    id: "left-id",
  };
  assert.equal(
    await requestG2BleDevice("left", {
      requestDevice: async () => left,
    }),
    left,
  );
  await assert.rejects(
    requestG2BleDevice("right", {
      requestDevice: async () => left,
    }),
    /identifies the left temple.*right pairing accepts only/,
  );
});


function authReply(magic) {
  return new DataView(Uint8Array.from([
    0xaa, 0x12, 0x01, 0x08, 0x01, 0x01, 0x80, 0x00,
    0x08, 0x04, 0x10, magic, 0x1a, 0x00, 0x00, 0x00,
  ]).buffer);
}

test("a left authentication reply that egresses over the right link is attributed by its magic", async () => {
  const logs = [];
  const left = new G2BleOtaSession(
    { name: "Even G2_32_L_ACD458" },
    { side: "left", authTimeoutMs: 200, log: (m) => logs.push(m) },
  );
  const right = new G2BleOtaSession(
    { name: "Even G2_32_R_8D6E3C" },
    { side: "right", authTimeoutMs: 200, log: (m) => logs.push(m) },
  );
  const relay = new G2BleAuthenticationRelay();
  relay.attach(left);
  relay.attach(right);
  assert.equal(left.authMagicSeed, G2_BLE_AUTH_MAGIC_SEEDS.left);
  assert.equal(right.authMagicSeed, G2_BLE_AUTH_MAGIC_SEEDS.right);

  const written = { left: [], right: [] };
  // The pair answers the LEFT request on the RIGHT temple's control notify
  // (2.2.7+ authority-relayed egress); the right answers on its own link.
  left.controlWrite = {
    async writeValueWithoutResponse(frame) {
      written.left.push(frame.slice());
      const magic = frame[11];
      queueMicrotask(() => right.controlNotifyHandler({ target: { value: authReply(magic) } }));
    },
  };
  right.controlWrite = {
    async writeValueWithoutResponse(frame) {
      written.right.push(frame.slice());
      const magic = frame[11];
      queueMicrotask(() => right.controlNotifyHandler({ target: { value: authReply(magic) } }));
    },
  };

  await Promise.all([left.authenticate(), right.authenticate()]);
  assert.equal(written.left[0][11], G2_BLE_AUTH_MAGIC_SEEDS.left + 1);
  assert.equal(written.right[0][11], G2_BLE_AUTH_MAGIC_SEEDS.right + 1);
  assert.equal(left.relayedAuthentications, 1);
  assert.equal(right.relayedAuthentications, 0);
  assert.ok(logs.some((m) => /left: authentication reply arrived over the right temple's link/.test(m)));
  assert.deepEqual(right.authenticationQueue, []);
});

test("a relayed reply that lands before the waiter exists is still consumed", async () => {
  const left = new G2BleOtaSession({ name: "Even G2_32_L_ACD458" }, { side: "left", authTimeoutMs: 100 });
  const right = new G2BleOtaSession({ name: "Even G2_32_R_8D6E3C" }, { side: "right", authTimeoutMs: 100 });
  const relay = new G2BleAuthenticationRelay();
  relay.attach(left);
  relay.attach(right);
  // The right link delivers the left's reply synchronously inside the write,
  // i.e. before waitForAuthentication has registered a waiter.
  left.controlWrite = {
    async writeValueWithoutResponse(frame) {
      right.controlNotifyHandler({ target: { value: authReply(frame[11]) } });
    },
  };
  await left.authenticate();
  assert.equal(left.relayedAuthentications, 1);
  assert.deepEqual(left.authenticationQueue, []);
  assert.deepEqual(right.authenticationQueue, []);
  // A reply nobody owns stays with the link that heard it.
  right.controlNotifyHandler({ target: { value: authReply(0x05) } });
  assert.equal(right.authenticationQueue.length, 1);
  assert.equal(left.authenticationQueue.length, 0);
});

test("a single session without a relay keeps the historical sequence-based magic", async () => {
  const session = new G2BleOtaSession({ name: "Even G2_32_L_ACD458" }, { side: "left", authTimeoutMs: 50 });
  const written = [];
  session.controlWrite = {
    async writeValueWithoutResponse(frame) {
      written.push(frame.slice());
      queueMicrotask(() => session.controlNotifyHandler({ target: { value: authReply(frame[11]) } }));
    },
  };
  await session.authenticate();
  assert.equal(written[0][11], 1);
  assert.equal(session.sequence, 1);
});

test("a saved handle that never comes back in range is reported for reselection", () => {
  const dead = new G2BleOtaError("left: selected temple did not become reachable after 8 bounded Bluetooth connection attempts: Bluetooth Device is no longer in range.", {
    code: "INITIAL_CONNECT_FAILED",
    cause: Object.assign(new Error("Bluetooth Device is no longer in range."), { name: "NetworkError" }),
  });
  assert.equal(g2BleSelectedHandleUnreachable(dead), true);
  const authTimeout = new G2BleOtaError("left: selected temple did not become reachable after 8 bounded Bluetooth connection attempts: left: no G2 authentication response arrived on the control channel.", {
    code: "INITIAL_CONNECT_FAILED",
    cause: new G2BleOtaError("left: no G2 authentication response arrived on the control channel.", { code: "AUTH_TIMEOUT" }),
  });
  assert.equal(g2BleSelectedHandleUnreachable(authTimeout), false, "an auth timeout on a live link is retryable");
  assert.equal(g2BleSelectedHandleUnreachable(new Error("Bluetooth Device is no longer in range.")), false, "only a bounded connect failure qualifies");
  assert.equal(g2BleSelectedHandleUnreachable(new G2BleOtaError("x", { code: "COMPONENT_FAILED" })), false);
});

test("the concurrent runner attaches one relay to real sessions and staggers the second start", async () => {
  const left = new G2BleOtaSession({ id: "l", name: "Even G2_32_L_ACD458" }, { side: "left" });
  const right = new G2BleOtaSession({ id: "r", name: "Even G2_32_R_8D6E3C" }, { side: "right" });
  const starts = {};
  for (const session of [left, right]) {
    session.flashBundle = async () => { starts[session.side] = Date.now(); return { outcome: "success" }; };
    session.disconnect = async () => {};
  }
  await flashG2BleSessionsConcurrently(
    [{ side: "left", device: left.device, session: left }, { side: "right", device: right.device, session: right }],
    {},
    { startStaggerMs: 40 },
  );
  assert.ok(left.authenticationRelay && left.authenticationRelay === right.authenticationRelay);
  assert.ok(left.ownsAuthenticationMagic(G2_BLE_AUTH_MAGIC_SEEDS.left + 3));
  assert.equal(left.ownsAuthenticationMagic(G2_BLE_AUTH_MAGIC_SEEDS.right + 3), false);
  assert.ok(starts.right - starts.left >= 35, `right started ${starts.right - starts.left} ms after left`);
});


test("the sequential runner holds both authenticated links first, then flashes right before left", async () => {
  const events = [];
  const makeSession = (side, { failHold = false } = {}) => ({
    async holdLink() {
      events.push(`hold:${side}`);
      if (failHold) throw new G2BleOtaError(`${side}: selected temple did not become reachable after 8 bounded Bluetooth connection attempts: no longer in range`, { code: "INITIAL_CONNECT_FAILED" });
      return { attempts: 1 };
    },
    async flashBundle(_firmware, options) {
      events.push(`flash:${side}:${options.componentNames.join(",")}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`done:${side}`);
      return { side, outcome: "success" };
    },
    async disconnect() {
      events.push(`disconnect:${side}`);
    },
  });
  const held = [];
  const settled = [];
  const outcomes = await flashG2BleSessionsSequentially(
    [
      { side: "left", device: { id: "l" }, session: makeSession("left") },
      { side: "right", device: { id: "r" }, session: makeSession("right") },
    ],
    {},
    {
      flashOptions: { componentNames: ["ota/s200_firmware_ota.bin"] },
      onLinkHeld: ({ side }) => held.push(side),
      onSettled: ({ side, status }) => settled.push(`${side}:${status}`),
    },
  );
  assert.deepEqual(held, ["right", "left"]);
  assert.deepEqual(events, [
    "hold:right", "hold:left",
    "flash:right:ota/s200_firmware_ota.bin", "done:right", "disconnect:right",
    "flash:left:ota/s200_firmware_ota.bin", "done:left", "disconnect:left",
  ]);
  assert.deepEqual(settled, ["right:fulfilled", "left:fulfilled"]);
  // Outcomes keep the caller's entry order and the concurrent runner's shape.
  assert.deepEqual(outcomes.map((o) => [o.side, o.status, o.value.outcome]), [["left", "fulfilled", "success"], ["right", "fulfilled", "success"]]);
});

test("a side whose link cannot be held is reported without blocking the other side", async () => {
  const events = [];
  const good = { async holdLink() { events.push("hold:right"); return { attempts: 1 }; }, async flashBundle() { events.push("flash:right"); return { outcome: "success" }; }, async disconnect() { events.push("disconnect:right"); } };
  const bad = { async holdLink() { events.push("hold:left"); throw new G2BleOtaError("left: selected temple did not become reachable after 8 bounded Bluetooth connection attempts: Bluetooth Device is no longer in range.", { code: "INITIAL_CONNECT_FAILED", cause: Object.assign(new Error("Bluetooth Device is no longer in range."), { name: "NetworkError" }) }); }, async flashBundle() { events.push("flash:left"); throw new Error("must not run"); }, async disconnect() { events.push("disconnect:left"); } };
  const settled = [];
  const outcomes = await flashG2BleSessionsSequentially(
    [{ side: "left", device: { id: "l" }, session: bad }, { side: "right", device: { id: "r" }, session: good }],
    {},
    {
      flashOptions: { componentNames: ["ota/s200_firmware_ota.bin"] },
      onSettled: ({ side, status }) => settled.push(`${side}:${status}`),
    },
  );
  // The failed hold is settled (and its link closed) before the other side's
  // transfer starts, not after it — run 5 on hardware showed the left side
  // sitting on "connecting" for the whole four-minute right transfer.
  assert.deepEqual(events, ["hold:right", "hold:left", "disconnect:left", "flash:right", "disconnect:right"]);
  assert.deepEqual(settled, ["left:rejected", "right:fulfilled"]);
  assert.equal(outcomes[0].status, "rejected");
  assert.equal(g2BleSelectedHandleUnreachable(outcomes[0].reason), true);
  assert.equal(outcomes[1].status, "fulfilled");
});

test("a held, authenticated link is reused by the transfer without a second authentication", async () => {
  let authentications = 0;
  const gatt = { connected: true };
  const device = { id: "l", name: "Even G2_32_L_ACD458", gatt };
  const session = new G2BleOtaSession(device, { side: "left", notificationSettleMs: 0 });
  const characteristic = () => ({ async startNotifications() {}, async stopNotifications() {}, addEventListener() {}, removeEventListener() {}, async writeValueWithoutResponse() {} });
  gatt.connect = async () => gatt;
  gatt.getPrimaryService = async () => ({ getCharacteristic: async () => characteristic() });
  gatt.disconnect = () => { gatt.connected = false; };
  session.authenticate = async () => { authentications += 1; };
  await session.holdLink();
  assert.equal(authentications, 1);
  assert.equal(session.linkAuthenticated, true);
  const reused = await session.connectForTransfer();
  assert.deepEqual(reused, { attempts: 0, reused: true });
  assert.equal(authentications, 1);
  await session.disconnect();
  assert.equal(session.linkAuthenticated, false);
});

// Every hardware run to date exhausted all 24 post-END attempts with Chrome's
// stale-cache refusal ("no longer in range") while the rebooted temple was
// advertising the whole time; without watchAdvertisements a page cannot make
// Chrome look again, so the loop must stop early and ask for a re-selection.
test("the post-END reconnect stops after consecutive stale-handle refusals when advertisements cannot be watched", async () => {
  const logs = [];
  let connectAttempts = 0;
  const device = {
    id: "right-paired-id",
    name: "Even G2_32_R_TEST",
    gatt: { connected: false, disconnect() {} },
  };
  const session = new G2BleOtaSession(device, {
    side: "right",
    rebootSettleMs: 0,
    postUpdateReconnectIntervalMs: 0,
    log: (message, tone) => logs.push({ message, tone }),
  });
  session.disconnect = async () => {};
  session.connect = async () => {
    connectAttempts += 1;
    throw new Error("Bluetooth Device is no longer in range.");
  };
  assert.equal(G2_BLE_POST_UPDATE_STALE_HANDLE_ATTEMPTS, 4);
  const postUpdate = await session.settleFinalUpdate(8);
  assert.equal(connectAttempts, 4);
  assert.equal(postUpdate.reconnected, false);
  assert.equal(postUpdate.staleHandle, true);
  assert.equal(postUpdate.reselectionRequired, true);
  assert.equal(postUpdate.reconnectAttempts, 4);
  assert.match(logs.at(-1).message, /re-select the right temple from the chooser/);
  assert.ok(
    !logs.some(({ message }) => /within 24 bounded attempts/.test(message)),
  );
  // The route is still flagged for proof: the early exit changes how long the
  // operator waits, not what counts as verified.
  const routes = {
    right: {
      outcome: "success",
      components: [{ name: "ota/s200_firmware_ota.bin", postUpdate }],
    },
  };
  assert.deepEqual(g2BleRoutesAwaitingCaseVerification(routes), ["right"]);
  assert.equal(isG2BleStaleHandleError(new Error("Bluetooth Device is no longer in range.")), true);
  assert.equal(isG2BleStaleHandleError(new Error("GATT operation failed")), false);
});

test("a non-stale post-END failure keeps the full bounded budget", async () => {
  let connectAttempts = 0;
  const session = new G2BleOtaSession(
    { id: "left-id", name: "Even G2_32_L_TEST", gatt: { connected: false, disconnect() {} } },
    {
      side: "left",
      rebootSettleMs: 0,
      postUpdateReconnectIntervalMs: 0,
      postUpdateReconnectAttempts: 6,
    },
  );
  session.disconnect = async () => {};
  session.connect = async () => {
    connectAttempts += 1;
    throw new Error("GATT Server is disconnected.");
  };
  const postUpdate = await session.settleFinalUpdate(8);
  assert.equal(connectAttempts, 6);
  assert.equal(postUpdate.staleHandle, false);
  assert.equal(postUpdate.reconnectAttempts, 6);
});

test("with watchAdvertisements the post-END reconnect fires on the rebooted temple's advertisement", async () => {
  const listeners = new Map();
  let watches = 0;
  let connectAttempts = 0;
  const device = {
    id: "right-paired-id",
    name: "Even G2_32_R_TEST",
    gatt: { connected: false, disconnect() {} },
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type) => listeners.delete(type),
    watchAdvertisements: async () => {
      watches += 1;
      // The rebooted temple is heard on the second watch.
      if (watches === 2) {
        setTimeout(() => listeners.get("advertisementreceived")?.({}), 0);
      }
    },
  };
  const session = new G2BleOtaSession(device, {
    side: "right",
    rebootSettleMs: 0,
    postUpdateReconnectIntervalMs: 50,
  });
  session.disconnect = async () => {};
  session.connect = async () => {
    connectAttempts += 1;
    if (connectAttempts < 3) {
      throw new Error("Bluetooth Device is no longer in range.");
    }
    device.gatt.connected = true;
  };
  const postUpdate = await session.settleFinalUpdate(8);
  assert.equal(postUpdate.reconnected, true);
  assert.equal(postUpdate.reconnectAttempts, 3);
  assert.equal(watches, 2);
  assert.equal(listeners.size, 0);
  assert.equal(
    await waitForG2Advertisement({ name: "no api" }, { timeoutMs: 1 }),
    false,
  );
});

// Measured on hardware 2026-09-13: a chooser re-pick reached a temple that had
// just rebooted into reviewed CFW 2.2.10.12 in 4.4 s on the same device ID, and
// its Device Information reported firmware "2.2.10.10" (the stock base), model
// "S200". The proof therefore accepts the base version as well as the
// package's reported version.
test("a chooser re-selection proves the rebooted temple and clears the Case-proof requirement", async () => {
  const logs = [];
  let disconnects = 0;
  const encode = (text) => new DataView(new TextEncoder().encode(text).buffer);
  const characteristics = {
    firmware_revision_string: encode("2.2.10.10"),
    hardware_revision_string: encode("2.2.10.10"),
    model_number_string: encode("S200"),
  };
  const server = {
    getPrimaryService: async (uuid) => {
      assert.equal(uuid, "device_information");
      return {
        getCharacteristic: async (uuid) => {
          if (uuid === "serial_number_string") {
            throw Object.assign(new Error("blocklisted"), { name: "SecurityError" });
          }
          if (!characteristics[uuid]) throw new Error(`no ${uuid}`);
          return { readValue: async () => characteristics[uuid] };
        },
      };
    },
  };
  const device = {
    id: "JPQyNH7efUgUIX7xWKJvbg==",
    name: "Even G2_32_R_8D6E3C",
    gatt: {
      connected: false,
      connect: async () => server,
      disconnect: () => {
        disconnects += 1;
      },
    },
  };
  const requests = [];
  const bluetooth = {
    requestDevice: async (options) => {
      requests.push(options);
      return device;
    },
  };
  const proof = await proveG2BleTempleByReselection("right", {
    bluetooth,
    expectedFirmwareRevisions: ["2.2.10.10", "2.2.10.12"],
    log: (message, tone) => logs.push({ message, tone }),
  });
  assert.equal(requests.length, 1);
  assert.ok(requests[0].optionalServices.includes("device_information"));
  assert.equal(proof.firmwareRevision, "2.2.10.10");
  assert.equal(proof.modelNumber, "S200");
  assert.equal(proof.matchesExpected, true);
  assert.equal(proof.deviceId, "JPQyNH7efUgUIX7xWKJvbg==");
  assert.equal(disconnects, 1);

  const routes = {
    left: {
      outcome: "success",
      components: [{ name: "ota/s200_firmware_ota.bin", postUpdate: { freshReconnectAttempted: true, reconnected: false, staleHandle: true } }],
    },
    right: {
      outcome: "success",
      components: [{ name: "ota/s200_firmware_ota.bin", postUpdate: { freshReconnectAttempted: true, reconnected: false, staleHandle: true } }],
    },
  };
  assert.deepEqual(g2BleRoutesAwaitingCaseVerification(routes), ["left", "right"]);
  const proven = applyG2BleReselectionProof(routes, "right", proof);
  assert.deepEqual(g2BleRoutesAwaitingCaseVerification(proven), ["left"]);
  assert.equal(proven.right.verifiedBy, "fresh-chooser-reselection");
  assert.equal(g2BleRouteProvenOverBluetooth(proven.right), true);
  assert.equal(g2BleRouteProvenOverBluetooth(routes.right), false);
  assert.equal(g2BleRouteProvenOverBluetooth({ ...proven.right, skipped: true }), false);
  assert.equal(g2BleRouteProvenOverBluetooth({ outcome: "failed_before_transfer", components: [] }), false);
  assert.equal(proven.right.components[0].postUpdate.reconnectedBy, "chooser-reselection");
  assert.equal(proven.right.components[0].postUpdate.reselectionProof.firmwareRevision, "2.2.10.10");
  // The input is not mutated and the untouched side is shared as-is.
  assert.equal(routes.right.components[0].postUpdate.reconnected, false);
  assert.equal(proven.left, routes.left);

  const mismatch = await proveG2BleTempleByReselection("right", {
    bluetooth,
    expectedFirmwareRevisions: ["2.2.9.22"],
  });
  assert.equal(mismatch.matchesExpected, false);
  const wrongSide = { ...device, name: "Even G2_32_L_ACD458" };
  await assert.rejects(
    proveG2BleTempleByReselection("right", {
      bluetooth: { requestDevice: async () => wrongSide },
    }),
    /Select the right temple/,
  );
});

// Run 6 on hardware: the left proof read "2.2.10.10" and was rejected because
// the expected list held only the package version. The base version belongs
// in the list, deduplicated, and a stock image yields just its own version.
test("the expected firmware revisions include the CFW's stock base", () => {
  assert.deepEqual(
    g2BleExpectedFirmwareRevisions({
      g2Version: "2.2.10.12",
      templeFlashTarget: { reportedVersion: "2.2.10.12", baseVersion: "2.2.10.10" },
    }),
    ["2.2.10.10", "2.2.10.12"],
  );
  assert.deepEqual(
    g2BleExpectedFirmwareRevisions({
      g2Version: "2.2.10.10",
      templeFlashTarget: { reportedVersion: "2.2.10.10" },
    }),
    ["2.2.10.10"],
  );
  assert.deepEqual(g2BleExpectedFirmwareRevisions(null), []);
});
