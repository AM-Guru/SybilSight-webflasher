import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("Caddy serves release-bound firmware from the atomic WebFlasher root", async () => {
  const [caddy, catalog] = await Promise.all([
    readFile(new URL("../deploy/webflasher.caddy", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../public/firmware-updates/source-files/index.json",
        import.meta.url,
      ),
      "utf8",
    ).then(JSON.parse),
  ]);

  assert.match(
    caddy,
    /handle \/firmware-updates\/source-files\/index\.json\s*\{\s*root \* \/share\/webflasher\s+file_server\s*\}/,
  );
  for (const release of catalog.releases.filter(
    (entry) => entry.channel === "custom" && entry.trust === "reviewed-custom",
  )) {
    const route = escapeRegExp(
      `/firmware-updates/source-files/${release.version}/*`,
    );
    assert.match(
      caddy,
      new RegExp(
        `handle ${route}\\s*\\{\\s*root \\* /share/webflasher\\s+file_server\\s*\\}`,
      ),
      `${release.version} must not fall through to the mutable historical archive`,
    );
  }
  assert.match(
    caddy,
    /handle \/firmware-updates\/source-files\/r1\/\*\s*\{\s*root \* \/share\/webflasher\s+file_server\s*\}/,
  );
});
