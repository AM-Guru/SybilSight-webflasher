import assert from "node:assert/strict";
import test from "node:test";
import {
  WebFlasherReleaseIntegrityError,
  assertCurrentWebFlasherRelease,
} from "../src/lib/releaseIntegrity.js";

const RUNNING_SHA = "a".repeat(40);
const DEPLOYED_SHA = "b".repeat(40);

function response(manifest, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => manifest,
  };
}

test("permits mutation only when the running and cache-busted deployed releases match", async () => {
  const requests = [];
  const result = await assertCurrentWebFlasherRelease({
    currentBuildSha: RUNNING_SHA,
    cacheToken: 42,
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      return response({ schemaVersion: 1, buildSha: RUNNING_SHA });
    },
  });

  assert.deepEqual(result, {
    schemaVersion: 1,
    runningSha: RUNNING_SHA,
    deployedSha: RUNNING_SHA,
    verified: true,
  });
  assert.equal(requests.length, 1);
  assert.match(requests[0][0], /running=aaaaaaaa/);
  assert.match(requests[0][0], /fresh=42/);
  assert.equal(requests[0][1].cache, "no-store");
});

test("blocks a stale open tab before any device mutation", async () => {
  await assert.rejects(
    () =>
      assertCurrentWebFlasherRelease({
        currentBuildSha: RUNNING_SHA,
        fetchImpl: async () =>
          response({ schemaVersion: 1, buildSha: DEPLOYED_SHA }),
      }),
    (error) => {
      assert.equal(error instanceof WebFlasherReleaseIntegrityError, true);
      assert.equal(error.releaseIntegrity.stale, true);
      assert.equal(error.releaseIntegrity.runningSha, RUNNING_SHA);
      assert.equal(error.releaseIntegrity.deployedSha, DEPLOYED_SHA);
      assert.match(error.message, /Reload this page/);
      assert.match(error.message, /No device mutation was started/);
      return true;
    },
  );
});

test("blocks mutation when deployment identity cannot be proven", async () => {
  await assert.rejects(
    () =>
      assertCurrentWebFlasherRelease({
        currentBuildSha: RUNNING_SHA,
        fetchImpl: async () => response({}, { ok: false, status: 503 }),
      }),
    /HTTP 503.*No device mutation was started/,
  );
  await assert.rejects(
    () =>
      assertCurrentWebFlasherRelease({
        currentBuildSha: "development",
        fetchImpl: async () =>
          response({ schemaVersion: 1, buildSha: RUNNING_SHA }),
      }),
    /valid 40-character Git commit identity.*No device mutation was started/,
  );
});
