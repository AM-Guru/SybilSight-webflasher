import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  R1_PINNED_RELEASE,
  R1_PINNED_RELEASES,
  R1SecureDfuSession,
  assertPinnedR1Release,
  crc32,
  parseDfuResponse,
  prepareR1DfuPackage,
} from "../src/lib/r1Dfu.js";

const archivePath = new URL(
  "../public/firmware-updates/source-files/r1/2.2.7.0005/r1-2.2.7.0005-be359b28954f8fe4a94ec21a58415d59.zip",
  import.meta.url,
);

test("reviewed R1 archive and both Nordic DFU components verify exactly", async () => {
  const archive = await readFile(archivePath);
  const prepared = await prepareR1DfuPackage(archive, R1_PINNED_RELEASE);
  assert.equal(R1_PINNED_RELEASE.version, "2.2.7.0005");
  assert.equal(prepared.application.length, 649376);
  assert.equal(prepared.initPacket.length, 141);
});

test("the previous pinned R1 release remains available for recovery", async () => {
  const previous = R1_PINNED_RELEASES[1];
  const previousPath = new URL(
    `../public/firmware-updates/source-files/r1/${previous.version}/${previous.fileName}`,
    import.meta.url,
  );
  const prepared = await prepareR1DfuPackage(await readFile(previousPath), previous);
  assert.equal(prepared.application.length, 646408);
  assert.equal(prepared.initPacket.length, 141);
});

test("R1 release trust cannot be widened by the catalog", () => {
  assert.throws(
    () => assertPinnedR1Release({ ...R1_PINNED_RELEASE, version: "9.9.9" }),
    /did not match/,
  );
});

test("Nordic CRC32 and Secure DFU response parsing match the wire contract", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const response = new DataView(Uint8Array.from([0x60, 0x06, 0x01, 0xaa]).buffer);
  assert.deepEqual([...parseDfuResponse(response, 0x06)], [0xaa]);
  assert.throws(
    () => parseDfuResponse(new DataView(Uint8Array.from([0x60, 0x04, 0x05]).buffer), 0x04),
    /rejected operation/,
  );
});

class RecordingDfuSession extends R1SecureDfuSession {
  constructor(selection) {
    super({});
    this.selection = selection;
    this.events = [];
  }

  async selectObject(type) {
    this.events.push(["select", type]);
    return this.selection;
  }

  async createObject(type, size) {
    this.events.push(["create", type, size]);
  }

  async writePackets(bytes) {
    this.events.push(["write", [...bytes]]);
  }

  async verifyOffset(offset, crc) {
    this.events.push(["verify", offset, crc]);
  }

  async command(bytes) {
    this.events.push(["command", [...bytes]]);
    return new Uint8Array();
  }
}

test("R1 DFU resumes a matching init packet at its recorded offset", async () => {
  const packet = Uint8Array.from([1, 2, 3, 4, 5]);
  const session = new RecordingDfuSession({
    maximumSize: 256,
    offset: 3,
    crc: crc32(packet.subarray(0, 3)),
  });

  await session.transferInitPacket(packet);

  assert.deepEqual(session.events, [
    ["select", 1],
    ["write", [4, 5]],
    ["verify", 5, crc32(packet)],
    ["command", [0x04]],
  ]);
});

test("R1 DFU commits a matching boundary before creating the next data object", async () => {
  const application = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const session = new RecordingDfuSession({
    maximumSize: 4,
    offset: 4,
    crc: crc32(application.subarray(0, 4)),
  });

  await session.transferApplication(application);

  assert.deepEqual(session.events, [
    ["select", 2],
    ["command", [0x04]],
    ["create", 2, 4],
    ["write", [5, 6, 7, 8]],
    ["verify", 8, crc32(application)],
    ["command", [0x04]],
  ]);
});
