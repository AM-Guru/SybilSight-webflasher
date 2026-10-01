// 230.10's read-only identity operation runs before microphone context allocation.
// Standard GATT firmware revision identifies the stock donor, not this patch set.
import { TEMPLE_FLASH_TARGETS } from "./templeFlashTargets.js";

export const G2_CFW_IDENTITY_MARKER = "SybilSight/230.10";
const reviewedMarkers = new Set(TEMPLE_FLASH_TARGETS
  .map((target) => target.requiredCfwMarker).filter(Boolean));
export const G2_CFW_IDENTITY_SERVICE = "00002760-08c2-11e1-9073-0e8ac72e6450";
export const G2_CFW_IDENTITY_NOTIFY = "00002760-08c2-11e1-9073-0e8ac72e6402";

export function makeG2CfwIdentityQuery(nonce) {
  if (!Number.isInteger(nonce) || nonce <= 0 || nonce > 0xffffffff) {
    throw new Error("Identity requires a nonzero uint32 nonce.");
  }
  return Uint8Array.of(0x4d, 0x43, 1, 5,
    nonce & 255, (nonce >>> 8) & 255, (nonce >>> 16) & 255, nonce >>> 24);
}

export function parseG2CfwIdentity(value, { side, nonce, marker }) {
  if (!reviewedMarkers.has(marker) || !["left", "right"].includes(side)) return null;
  if (!Number.isInteger(nonce) || nonce <= 0 || nonce > 0xffffffff) return null;
  const bytes = value instanceof DataView
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : value;
  const expected = new TextEncoder().encode(marker);
  if (!(bytes instanceof Uint8Array) || bytes.length !== 9 + expected.length ||
      bytes[0] !== 0x46 || bytes[1] !== 0x49 || bytes[2] !== 1 ||
      bytes[3] !== (side === "left" ? 2 : 1) || bytes[8] !== expected.length) return null;
  const echo = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (echo !== nonce || !expected.every((byte, i) => bytes[9 + i] === byte)) return null;
  return { marker, side, nonce };
}

// Caller owns/authenticates the physical lens connection. No relay or queued
// responses are accepted. Register before writing to handle immediate replies.
export async function probeG2CfwIdentity({ server, side, marker, writeQuery,
  timeoutMs = 5000, cryptoObject = globalThis.crypto }) {
  if (!reviewedMarkers.has(marker)) throw new Error("Unknown CFW identity contract.");
  const nonce = cryptoObject.getRandomValues(new Uint32Array(1))[0] || 1;
  const service = await server.getPrimaryService(G2_CFW_IDENTITY_SERVICE);
  const notify = await service.getCharacteristic(G2_CFW_IDENTITY_NOTIFY);
  let timer;
  let handler;
  let rejectProof;
  const proof = new Promise((resolve, reject) => {
    rejectProof = reject;
    handler = (event) => {
      const identity = parseG2CfwIdentity(event?.target?.value, { side, nonce, marker });
      if (identity) resolve({ ...identity, provenAt: new Date().toISOString() });
    };
    timer = setTimeout(() => reject(new Error(`${side}: fresh ${marker} identity was not received.`)), timeoutMs);
  });
  // Attach rejection handling before async subscription/write operations.
  proof.catch(() => {});
  notify.addEventListener("characteristicvaluechanged", handler);
  try {
    await notify.startNotifications();
    await writeQuery(makeG2CfwIdentityQuery(nonce));
    return await proof;
  } catch (error) {
    rejectProof(error);
    throw error;
  } finally {
    clearTimeout(timer);
    notify.removeEventListener("characteristicvaluechanged", handler);
    try { await notify.stopNotifications(); } catch { /* Reboot/disconnect. */ }
  }
}
