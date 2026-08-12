import { unzipSync } from "fflate";
import {
  R1_DFU_SERVICE_UUID,
  flashR1SecureDfu,
  enterR1DfuMode,
} from "./r1Dfu.js";

export const R1_UNLOCK_APPLICATION_VERSION = "2.2.7.0005";
export const R1_UNLOCK_OWNER_KEY_SHA256 =
  "03a3d417e1b0071ae436798fa821f03d2d3458eb24959494516e2a1a7e040d0c";
export const R1_UNLOCK_OWNER_IMAGE_SHA256 =
  "1a70d6e84610591d1f8637e6efd7cb0f364f9ea1cc077c85b11b0dc87678f837";
export const R1_UNLOCK_OPTIONAL_IMAGE_SHA256 =
  "18851ceede792f316df328d935075464a0facfbfec4e64fb32f13812bba85dba";
export const R1_UNLOCK_STOCK_KEY_SHA256 =
  "e3cf089455dd88548fdc8336feb30212ce384deef9c54843313b9226e38c6b13";
export const R1_UNLOCK_OWNER_PUBLIC_KEY_HEX =
  "de65d6353a4b09bb64cd6a09c0e69b3bae1a5aa46b5b04f2d8a7f9fc19a78dc0" +
  "4a0304ccf7730c7a45791ddbd5c143c3529fb70f5eb20e6c3d2fbe2a4682485b";
export const R1_UNLOCK_REVIEW = Object.freeze({
  bootloaderBase: 0xf8000,
  imageBytes: 0x6000,
  publicKeyAddress: 0xfd868,
  publicKeyOffset: 0x5868,
  publicKeyBytes: 64,
  signatureGateAddress: 0xfbd98,
  signatureGateOffset: 0x3d98,
  enforcedGateHex: "04d1", // Thumb: bne 0xfbda4
  optionalGateHex: "00bf", // Thumb: nop
});
export const R1_UNLOCK_ACE_RECORD_SHA256 = Object.freeze({
  "enter-dfu": "8edb2ed70f8298c0a8fb91340f30e19b9734e172811fb2b6e224360aa27aa375",
  "fpb-retention-arm": "39526d8f6d80c0b1e0ad1632ea1ceb29263d146e519e76d7876cff3c37f13615",
  "fpb-retention-check": "1235406488fb504c6a864c2179d886c4e6fc163bddb3a38e367b4fbebc1c12ed",
  "fpb-key-stage": "9dbc5cefe4a3239313a25fb51bfe437e63ac212d060c35cedf2319fbcb77dba2",
  "fpb-key-arm": "f565156350ea5d804fc15a3aa1a1bab4f7b65fcc82e32bc0667a7c803e8dc77b",
  "fpb-key-cleanup": "691c1c26868687edbccd44315061b62c4c4c163951bbd407ad902f5061899cbf",
});

const SERVICE_UUID = "bae80001-4f05-4503-8e65-3af1f7329d1f";
const CHANNEL1_WRITE_UUID = "bae80010-4f05-4503-8e65-3af1f7329d1f";
const EUS_NOTIFY_UUID = "bae80013-4f05-4503-8e65-3af1f7329d1f";
const BOOTLOADER_BASE = R1_UNLOCK_REVIEW.bootloaderBase;
const KEY_ADDRESS = R1_UNLOCK_REVIEW.publicKeyAddress;
const GATE_ADDRESS = R1_UNLOCK_REVIEW.signatureGateAddress;
const STOP_FACTORY_LISTENER = new Uint8Array([0, 0, 0x40, 0]);
const RECORD_BYTES = 244;
const SHELLCODE_OFFSET = 0xa0;

const DFU_PROOF = hexBytes(
  "0449b1200870bff34f8f034903480860fee700001c0500400ced00e00400fa05",
);
const PREFIX_READ = hexBytes(
  "82b001200090f42001900b4c0b4d0c4e00272846314601aa3b46a047002803d0002f05d10127f4e74ff000700138fdd1044905480860fee76929050014650020efbeadde0ced00e00400fa05",
);
const PAGE_READ = hexBytes(
  "82b0012000900f4c04f580550e4e0f4ff42001903846214601aa01232b40b047002805d01328f3d0eb0709d40135efe704f1f404ac42ebd34ff000700138fdd103488047efbeadde692905001465002091810300",
);
const FPB_RETENTION_ARM = hexBytes(
  "0b480c4901600c4a0221116050600b49916003211160bff34f8fbff36f8f084800210170bff34f8f064907480860fee700c0032052425046002000e0010010001c0500400ced00e00400fa05",
);
const FPB_RETENTION_CHECK = hexBytes(
  "0e4c00202168c9070bd561680c4a914207d1a168c90704d511680a4b994200d1b120022121600021a16007490870bff34f8f064906480860fee70000002000e000c00320524250461c0500400ced00e00400fa05",
);
const FPB_KEY_STAGE = hexBytes(
  "0d480e490e2250f8043b0b600431013af9d10b48022250f8043b0b600431013af9d108480860084800210170bff34f8f064907480860fee790a1012040c00320e4a101203159454b1c0500400ced00e00400fa05",
);
const FPB_KEY_ARM = hexBytes(
  "0d4d1fcdd0f880608e420ed100f140068661022616605060136203261660bff34f8fbff36f8fb12600e000262670c0cdbff34f8f3760fee790a10120",
);
const FPB_KEY_CLEANUP = hexBytes(
  "094c02212160002020620849212241f8040b013afbd106490870bff34f8f054905480860fee70000002000e000c003201c0500400ced00e00400fa05",
);

const ARTIFACTS = Object.freeze({
  ownerKey: Object.freeze({
    url: "/firmware-updates/local-r1-owner-unlock/r1-owner-public-x-y-le.bin",
    sha256: R1_UNLOCK_OWNER_KEY_SHA256,
    bytes: 64,
  }),
  ownerPackage: Object.freeze({
    url: "/firmware-updates/local-r1-owner-unlock/r1-bootloader-owner-keyed.zip",
    sha256: "dcbb12398e911c57eda88c3e6414b0edb543d1b83b233d9ff4032e9a97c5cea9",
  }),
  optionalPackage: Object.freeze({
    url: "/firmware-updates/local-r1-owner-unlock/r1-bootloader-owner-keyed-signing-optional.zip",
    sha256: "4e64f55d18394627a89db3174fa1c1f824858857c4c344189073ee3e696ab49b",
  }),
});

function hexBytes(hex) {
  return Uint8Array.from(hex.match(/../g).map((value) => Number.parseInt(value, 16)));
}

function putU32(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    offset,
    value >>> 0,
    true,
  );
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function baseRecord(shellcode) {
  if (shellcode.length > RECORD_BYTES - SHELLCODE_OFFSET) {
    throw new Error("The reviewed R1 ACE payload does not fit its pinned record.");
  }
  const record = new Uint8Array(RECORD_BYTES);
  record[2] = 0x40;
  record[3] = 0x04;
  putU32(record, 0x3c, 8);
  putU32(record, 0x40, 0x2001a1d4);
  putU32(record, 0x44, 0x2001a1d4);
  putU32(record, 0x48, 0);
  putU32(record, 0x4c, 0x2001a1ec);
  putU32(record, 0x54, 0);
  record.set(new TextEncoder().encode("acc\0"), 0x60);
  putU32(record, 0x6c, 0x2001a228);
  putU32(record, 0x7c, 1);
  putU32(record, 0x84, 0);
  putU32(record, 0x8c, 0x18);
  putU32(record, 0x90, 0);
  putU32(record, 0x94, 0);
  putU32(record, 0x9c, 0x2001a22d);
  record.set(shellcode, SHELLCODE_OFFSET);
  return record;
}

export function buildR1UnlockRecord(mode, { address, ownerKey } = {}) {
  let shellcode;
  switch (mode) {
    case "read-prefix":
      if (!Number.isInteger(address) || address < 0xf8000 || address > 0xfe000 - 244) {
        throw new Error("R1 bootloader prefix read is outside the reviewed range.");
      }
      shellcode = PREFIX_READ.slice();
      putU32(shellcode, 0x40, address);
      break;
    case "read-page":
      if (!Number.isInteger(address) || address < 0xf8000 || address > 0xfd000
          || address % 0x1000 !== 0) {
        throw new Error("R1 bootloader page read is outside the reviewed range.");
      }
      shellcode = PAGE_READ.slice();
      putU32(shellcode, 0x44, address);
      break;
    case "fpb-retention-arm": shellcode = FPB_RETENTION_ARM; break;
    case "fpb-retention-check": shellcode = FPB_RETENTION_CHECK; break;
    case "fpb-key-stage": shellcode = FPB_KEY_STAGE; break;
    case "fpb-key-arm": shellcode = FPB_KEY_ARM; break;
    case "fpb-key-cleanup": shellcode = FPB_KEY_CLEANUP; break;
    case "enter-dfu": shellcode = DFU_PROOF; break;
    default: throw new Error(`Unsupported R1 unlock ACE mode: ${mode}`);
  }
  const record = baseRecord(shellcode);
  if (mode === "fpb-key-stage") {
    if (!(ownerKey instanceof Uint8Array) || ownerKey.length !== 64) {
      throw new Error("The owner key must be exactly 64 bytes.");
    }
    record.set(ownerKey.subarray(0, 56), 0x04);
    record.set(ownerKey.subarray(56), 0x58);
  } else if (mode === "fpb-key-arm") {
    [0x2003c000, 0x4b455931, 0xe0002000, 0x000fa6ed,
      0x4000051c, 0xe000ed0c, 0x05fa0004]
      .forEach((value, index) => putU32(record, 0x04 + index * 4, value));
  }
  return record;
}

async function fetchPinnedArtifact(metadata) {
  const response = await fetch(metadata.url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${metadata.url} returned HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (metadata.bytes && bytes.length !== metadata.bytes) {
    throw new Error(`R1 unlock artifact ${metadata.url} has an unexpected length.`);
  }
  const digest = await sha256Hex(bytes);
  if (digest !== metadata.sha256) {
    throw new Error(`R1 unlock artifact integrity failed for ${metadata.url}.`);
  }
  return bytes;
}

function prepareBootloaderPackage(archive, expectedImageSha256, expectedInitSha256) {
  const files = unzipSync(archive);
  const image = files["bootloader.bin"];
  const initPacket = files["bootloader.dat"];
  if (!image || !initPacket || Object.keys(files).sort().join(",") !==
      "bootloader.bin,bootloader.dat,manifest.json") {
    throw new Error("The R1 owner bootloader archive has unexpected members.");
  }
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
  } catch {
    throw new Error("The R1 owner bootloader manifest is not valid JSON.");
  }
  const entry = manifest?.manifest?.bootloader;
  if (entry?.bin_file !== "bootloader.bin" || entry?.dat_file !== "bootloader.dat") {
    throw new Error("The R1 owner bootloader manifest does not bind the reviewed members.");
  }
  return { application: image, initPacket, expectedImageSha256, expectedInitSha256 };
}

export function validateR1UnlockArtifactStructure(ownerKey, owner, optional) {
  const reviewedKey = hexBytes(R1_UNLOCK_OWNER_PUBLIC_KEY_HEX);
  if (!equalBytes(ownerKey, reviewedKey)) {
    throw new Error("The R1 owner public key bytes do not match the source-visible trust pin.");
  }
  if (owner.application.length !== R1_UNLOCK_REVIEW.imageBytes
      || optional.application.length !== R1_UNLOCK_REVIEW.imageBytes) {
    throw new Error("An R1 owner bootloader image has an unexpected length.");
  }
  const keyStart = R1_UNLOCK_REVIEW.publicKeyOffset;
  const keyEnd = keyStart + R1_UNLOCK_REVIEW.publicKeyBytes;
  if (!equalBytes(owner.application.subarray(keyStart, keyEnd), reviewedKey)
      || !equalBytes(optional.application.subarray(keyStart, keyEnd), reviewedKey)) {
    throw new Error("An R1 owner bootloader does not contain the reviewed public key.");
  }
  const gateStart = R1_UNLOCK_REVIEW.signatureGateOffset;
  const ownerGate = owner.application.subarray(gateStart, gateStart + 2);
  const optionalGate = optional.application.subarray(gateStart, gateStart + 2);
  if (!equalBytes(ownerGate, hexBytes(R1_UNLOCK_REVIEW.enforcedGateHex))
      || !equalBytes(optionalGate, hexBytes(R1_UNLOCK_REVIEW.optionalGateHex))) {
    throw new Error("The R1 signature enforcement patch bytes are not the reviewed bne-to-nop change.");
  }
  const changed = [];
  owner.application.forEach((value, index) => {
    if (value !== optional.application[index]) changed.push(index);
  });
  if (changed.length !== 2 || changed[0] !== gateStart || changed[1] !== gateStart + 1) {
    throw new Error("The signing-optional bootloader contains changes outside the two-byte gate patch.");
  }
}

export async function verifyR1OwnerInitPacket(initPacket, ownerKey) {
  const expectedFraming = [
    [0, 0x12], [1, 0x8e], [2, 0x01], [3, 0x0a], [4, 0x48],
    [5, 0x08], [6, 0x01], [7, 0x12], [8, 0x44],
    [77, 0x10], [78, 0x00], [79, 0x1a], [80, 0x40],
  ];
  if (initPacket.length !== 145
      || expectedFraming.some(([offset, value]) => initPacket[offset] !== value)) {
    throw new Error("An R1 owner init packet does not have the reviewed signed-command shape.");
  }
  const publicKey = new Uint8Array(65);
  publicKey[0] = 0x04;
  publicKey.set(ownerKey.slice(0, 32).reverse(), 1);
  publicKey.set(ownerKey.slice(32, 64).reverse(), 33);
  const signature = new Uint8Array(64);
  signature.set(initPacket.slice(81, 113).reverse(), 0);
  signature.set(initPacket.slice(113, 145).reverse(), 32);
  let imported;
  try {
    imported = await crypto.subtle.importKey(
      "raw",
      publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    throw new Error("The R1 owner public key is not a valid P-256 verification key.");
  }
  if (!await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    imported,
    signature,
    initPacket.subarray(9, 77),
  )) {
    throw new Error("An R1 bootloader init packet is not signed by the reviewed owner key.");
  }
}

async function validateR1UnlockACERecords(ownerKey) {
  for (const [mode, expected] of Object.entries(R1_UNLOCK_ACE_RECORD_SHA256)) {
    const record = buildR1UnlockRecord(mode, { ownerKey });
    if (await sha256Hex(record) !== expected) {
      throw new Error(`The compiled ${mode} ACE record differs from the reviewed payload.`);
    }
  }
}

export async function loadR1UnlockArtifacts() {
  const [ownerKey, ownerArchive, optionalArchive] = await Promise.all([
    fetchPinnedArtifact(ARTIFACTS.ownerKey),
    fetchPinnedArtifact(ARTIFACTS.ownerPackage),
    fetchPinnedArtifact(ARTIFACTS.optionalPackage),
  ]);
  const owner = prepareBootloaderPackage(
    ownerArchive,
    R1_UNLOCK_OWNER_IMAGE_SHA256,
    "45acecbd204e009201689a403efe723efd619feac9805537c78374063af58f5c",
  );
  const optional = prepareBootloaderPackage(
    optionalArchive,
    R1_UNLOCK_OPTIONAL_IMAGE_SHA256,
    "93416c51f8a4f04ee7c361abde524f119e757428dd036aebe0e1715c0f38bde1",
  );
  if (await sha256Hex(owner.application) !== owner.expectedImageSha256
      || await sha256Hex(optional.application) !== optional.expectedImageSha256
      || await sha256Hex(owner.initPacket) !== owner.expectedInitSha256
      || await sha256Hex(optional.initPacket) !== optional.expectedInitSha256) {
    throw new Error("An R1 owner bootloader image failed its pinned SHA-256 check.");
  }
  validateR1UnlockArtifactStructure(ownerKey, owner, optional);
  await verifyR1OwnerInitPacket(owner.initPacket, ownerKey);
  await verifyR1OwnerInitPacket(optional.initPacket, ownerKey);
  await validateR1UnlockACERecords(ownerKey);
  return {
    ownerKey,
    owner,
    optional,
  };
}

function waitForDisconnect(device, timeoutMs = 20000) {
  if (!device.gatt?.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      device.removeEventListener("gattserverdisconnected", disconnected);
      reject(new Error("The R1 did not restart after the reviewed ACE phase."));
    }, timeoutMs);
    const disconnected = () => {
      clearTimeout(timeout);
      resolve();
    };
    device.addEventListener("gattserverdisconnected", disconnected, { once: true });
  });
}

async function connectACE(device, notify) {
  if (!/^(EVEN R1|BCL60)/i.test(device?.name ?? "")) {
    throw new Error("The selected application device is not an R1 ring.");
  }
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);
  const write = await service.getCharacteristic(CHANNEL1_WRITE_UUID);
  if (!write.properties.writeWithoutResponse) {
    throw new Error("The R1 channel-1 characteristic is not write-without-response.");
  }
  const notifications = notify
    ? await service.getCharacteristic(EUS_NOTIFY_UUID)
    : null;
  return { write, notifications };
}

async function sendRecord(device, record, { expectedBytes = 0, timeoutMs = 20000 } = {}) {
  const { write, notifications } = await connectACE(device, expectedBytes > 0);
  const chunks = [];
  let received = 0;
  let finishRead;
  let failRead;
  const read = expectedBytes > 0
    ? new Promise((resolve, reject) => { finishRead = resolve; failRead = reject; })
    : null;
  const onValue = (event) => {
    const value = new Uint8Array(
      event.target.value.buffer,
      event.target.value.byteOffset,
      event.target.value.byteLength,
    );
    if (value.length !== RECORD_BYTES) return;
    chunks.push(value.slice());
    received += value.length;
    if (received >= expectedBytes) finishRead();
  };
  let timeout;
  if (notifications) {
    notifications.addEventListener("characteristicvaluechanged", onValue);
    await notifications.startNotifications();
    timeout = setTimeout(() => failRead(new Error("Timed out waiting for ACE readback.")), timeoutMs);
  }
  await write.writeValueWithoutResponse(STOP_FACTORY_LISTENER);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const disconnected = waitForDisconnect(device, timeoutMs);
  await write.writeValueWithoutResponse(record);
  if (read) {
    await read;
    if (timeout) clearTimeout(timeout);
  }
  await disconnected;
  if (timeout) clearTimeout(timeout);
  if (notifications) notifications.removeEventListener("characteristicvaluechanged", onValue);
  if (!read) return null;
  const combined = new Uint8Array(chunks.length * RECORD_BYTES);
  chunks.forEach((chunk, index) => combined.set(chunk, index * RECORD_BYTES));
  return combined.subarray(0, expectedBytes);
}

export async function readR1BootloaderChunk(device, address) {
  return sendRecord(device, buildR1UnlockRecord("read-prefix", { address }), {
    expectedBytes: RECORD_BYTES,
  });
}

export async function classifyR1BootloaderState(device, artifacts) {
  const keyChunk = await readR1BootloaderChunk(device, KEY_ADDRESS);
  const gateChunk = await readR1BootloaderChunk(device, GATE_ADDRESS);
  const ownerKey = artifacts.ownerKey;
  const ownerImage = artifacts.owner.application;
  const optionalImage = artifacts.optional.application;
  const keyOffset = KEY_ADDRESS - BOOTLOADER_BASE;
  const gateOffset = GATE_ADDRESS - BOOTLOADER_BASE;
  const liveKey = keyChunk.subarray(0, 64);
  const liveGate = gateChunk.subarray(0, 2);
  const ownerGate = ownerImage.subarray(gateOffset, gateOffset + 2);
  const optionalGate = optionalImage.subarray(gateOffset, gateOffset + 2);
  if (equalBytes(liveKey, ownerKey) && equalBytes(liveGate, optionalGate)) {
    return "owner-optional";
  }
  if (equalBytes(liveKey, ownerKey) && equalBytes(liveGate, ownerGate)) {
    return "owner-enforced";
  }
  // Fail closed on the byte-exact trust anchor recovered from the reviewed stock image.
  // Merely finding an unknown non-owner key must never authorize a destructive transition.
  if (await sha256Hex(liveKey) === R1_UNLOCK_STOCK_KEY_SHA256
      && equalBytes(liveGate, ownerGate)) {
    return "stock-enforced";
  }
  throw new Error(
    `Unknown R1 bootloader state (key ${await sha256Hex(liveKey)}, gate ${[...liveGate]
      .map((value) => value.toString(16).padStart(2, "0")).join("")}); no flash was started.`,
  );
}

export async function verifyR1BootloaderImage(device, expected) {
  const pages = [];
  for (let address = 0xf8000; address < 0xfe000; address += 0x1000) {
    pages.push(await sendRecord(device, buildR1UnlockRecord("read-page", { address }), {
      expectedBytes: 0x1000,
      timeoutMs: 30000,
    }));
  }
  const image = new Uint8Array(0x6000);
  pages.forEach((page, index) => image.set(page, index * 0x1000));
  const digest = await sha256Hex(image);
  if (digest !== expected) {
    throw new Error(`R1 bootloader readback was ${digest}, expected ${expected}.`);
  }
  return digest;
}

async function runACEPhase(device, mode, artifacts) {
  await sendRecord(
    device,
    buildR1UnlockRecord(mode, { ownerKey: artifacts.ownerKey }),
  );
}

export function assertMatchingR1DfuIdentity(applicationDevice, dfuDevice) {
  const suffix = applicationDevice?.name?.match(/_([0-9a-f]+)$/i)?.[1];
  if (!suffix || !dfuDevice?.name) {
    throw new Error("The application and DFU identities do not expose a comparable R1 suffix.");
  }
  const expected = ((Number.parseInt(suffix, 16) + 1) & ((16 ** suffix.length) - 1))
    .toString(16).toUpperCase().padStart(suffix.length, "0");
  if (!dfuDevice.name.toUpperCase().includes("DFU")
      || !dfuDevice.name.toUpperCase().endsWith(expected)) {
    throw new Error(
      `The authorized DFU device ${dfuDevice.name} does not match ${applicationDevice.name}; no flash was started.`,
    );
  }
  return dfuDevice;
}

export async function unlockR1Bootloader({
  applicationDevice,
  requestDfuDevice,
  vendorFirmware,
  onProgress = () => {},
}) {
  if (!applicationDevice || typeof requestDfuDevice !== "function") {
    throw new Error("Select the exact R1 application device before unlocking.");
  }
  const artifacts = await loadR1UnlockArtifacts();
  const dfuFor = async (checkpoint) => assertMatchingR1DfuIdentity(
    applicationDevice,
    await requestDfuDevice(checkpoint),
  );
  onProgress(0.03, "Reading the live R1 bootloader trust state");
  const state = await classifyR1BootloaderState(applicationDevice, artifacts);
  if (state === "stock-enforced") {
    if (!vendorFirmware?.application || !vendorFirmware?.initPacket) {
      throw new Error("The exact signed R1 2.2.7.0005 recovery package is required.");
    }
    onProgress(0.08, "Checking warm-reset FPB retention");
    await runACEPhase(applicationDevice, "fpb-retention-arm", artifacts);
    await runACEPhase(applicationDevice, "fpb-retention-check", artifacts);
    let dfu = await dfuFor("retention check");
    await flashR1SecureDfu(dfu, vendorFirmware, { onProgress: () => {} });

    onProgress(0.22, "Staging the owner key in retained SRAM");
    await runACEPhase(applicationDevice, "fpb-key-stage", artifacts);
    await runACEPhase(applicationDevice, "fpb-key-arm", artifacts);
    dfu = await dfuFor("owner-key transition");
    await flashR1SecureDfu(dfu, artifacts.owner, { onProgress: () => {} });
    await runACEPhase(applicationDevice, "fpb-key-cleanup", artifacts);
    onProgress(0.52, "Verifying the complete owner-keyed bootloader");
    await verifyR1BootloaderImage(applicationDevice, R1_UNLOCK_OWNER_IMAGE_SHA256);
  } else if (state === "owner-enforced") {
    onProgress(0.35, "Verifying the existing owner-keyed bootloader");
    await verifyR1BootloaderImage(applicationDevice, R1_UNLOCK_OWNER_IMAGE_SHA256);
  }

  if (state !== "owner-optional") {
    onProgress(0.66, "Entering Secure DFU under the persistent owner key");
    await enterR1DfuMode(applicationDevice);
    const dfu = await dfuFor("signing-optional transition");
    await flashR1SecureDfu(dfu, artifacts.optional, { onProgress: () => {} });
  }
  onProgress(0.82, "Verifying signing-optional decisive bytes and whole image");
  const finalState = await classifyR1BootloaderState(applicationDevice, artifacts);
  if (finalState !== "owner-optional") {
    throw new Error(`R1 final bootloader state is ${finalState}; expected owner-optional.`);
  }
  const digest = await verifyR1BootloaderImage(
    applicationDevice,
    R1_UNLOCK_OPTIONAL_IMAGE_SHA256,
  );
  onProgress(1, "R1 bootloader unlocked and byte-exactly verified");
  return { initialState: state, finalState, imageSha256: digest };
}

export { R1_DFU_SERVICE_UUID };
