import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSOLE_TRANSCRIPT_TAB_ID_KEY,
  LEGACY_CONSOLE_TRANSCRIPT_STORAGE_KEY,
  consoleTranscriptStorageKey,
  pruneConsoleTranscripts,
  readConsoleTranscript,
  resolveConsoleTranscriptTabId,
  writeConsoleTranscript,
} from "../src/lib/consoleTranscript.js";

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function transcript(entries, savedAt) {
  return JSON.stringify({
    savedAt,
    entries: entries.map((message) => ({ time: "10:00:00 AM", message })),
  });
}

test("each tab keeps its own transcript so two tabs cannot overwrite each other", () => {
  const session1 = fakeStorage();
  const session2 = fakeStorage();
  const local = fakeStorage();

  let counter = 0;
  const makeId = () => `tab-${(counter += 1)}`;
  const key1 = consoleTranscriptStorageKey(
    resolveConsoleTranscriptTabId(session1, makeId),
  );
  const key2 = consoleTranscriptStorageKey(
    resolveConsoleTranscriptTabId(session2, makeId),
  );
  assert.notEqual(key1, key2);

  // A remote flash in tab 1 and a local analysis in tab 2 both save.
  writeConsoleTranscript(local, key1, [{ time: "1", message: "flashing" }], "a");
  writeConsoleTranscript(local, key2, [{ time: "2", message: "local" }], "b");

  assert.deepEqual(
    readConsoleTranscript(local, key1).entries.map((e) => e.message),
    ["flashing"],
  );
  assert.deepEqual(
    readConsoleTranscript(local, key2).entries.map((e) => e.message),
    ["local"],
  );
});

test("a tab keeps its transcript id across its own reload", () => {
  const session = fakeStorage();
  const first = resolveConsoleTranscriptTabId(session, () => "generated");
  assert.equal(session.getItem(CONSOLE_TRANSCRIPT_TAB_ID_KEY), "generated");
  const afterReload = resolveConsoleTranscriptTabId(session, () => "different");
  assert.equal(afterReload, first);
});

test("a tab without sessionStorage still gets a usable transcript key", () => {
  const blocked = {
    getItem() {
      throw new Error("sessionStorage is unavailable");
    },
    setItem() {
      throw new Error("sessionStorage is unavailable");
    },
  };
  assert.equal(resolveConsoleTranscriptTabId(blocked), "shared");
});

test("an in-progress legacy transcript is adopted exactly once", () => {
  const local = fakeStorage({
    [LEGACY_CONSOLE_TRANSCRIPT_STORAGE_KEY]: transcript(
      ["mid-transfer"],
      "2026-07-28T16:00:00.000Z",
    ),
  });
  const key = consoleTranscriptStorageKey("tab-a");

  const adopted = readConsoleTranscript(local, key);
  assert.deepEqual(
    adopted.entries.map((e) => e.message),
    ["mid-transfer"],
  );
  // Moved under this tab's key, and gone from the shared one.
  assert.equal(local.getItem(LEGACY_CONSOLE_TRANSCRIPT_STORAGE_KEY), null);
  assert.ok(local.getItem(key));

  // A second tab loading afterwards does not inherit it.
  assert.equal(readConsoleTranscript(local, consoleTranscriptStorageKey("tab-b")), null);
});

test("pruning drops abandoned transcripts but never the live ones", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  const current = consoleTranscriptStorageKey("current");
  const local = fakeStorage({
    [current]: transcript(["mine"], new Date(now - 30 * day).toISOString()),
    [consoleTranscriptStorageKey("stale")]: transcript(
      ["old"],
      new Date(now - 30 * day).toISOString(),
    ),
    [consoleTranscriptStorageKey("recent")]: transcript(
      ["other tab, still working"],
      new Date(now - 60_000).toISOString(),
    ),
    "g2wf.temple-data-pacing.v2": "{}",
  });

  const removed = pruneConsoleTranscripts(local, current, { now });
  assert.deepEqual(removed, [consoleTranscriptStorageKey("stale")]);
  // The current tab's own transcript survives even though it is old.
  assert.ok(local.getItem(current));
  // A recently-saved transcript belongs to a tab that may be mid-flash.
  assert.ok(local.getItem(consoleTranscriptStorageKey("recent")));
  // Unrelated keys are untouched.
  assert.equal(local.getItem("g2wf.temple-data-pacing.v2"), "{}");
});

test("pruning bounds how many transcripts accumulate", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");
  const current = consoleTranscriptStorageKey("current");
  const entries = { [current]: transcript(["mine"], new Date(now).toISOString()) };
  for (let index = 0; index < 12; index += 1) {
    entries[consoleTranscriptStorageKey(`tab-${index}`)] = transcript(
      [`tab ${index}`],
      new Date(now - index * 1000).toISOString(),
    );
  }
  const local = fakeStorage(entries);
  pruneConsoleTranscripts(local, current, { now, maxStored: 4 });

  const remaining = [...local.map.keys()].filter((key) =>
    key.startsWith("g2wf.console-transcript.v2."),
  );
  assert.equal(remaining.length, 4);
  assert.ok(remaining.includes(current));
  // The survivors are the most recently saved.
  assert.ok(remaining.includes(consoleTranscriptStorageKey("tab-0")));
  assert.ok(!remaining.includes(consoleTranscriptStorageKey("tab-11")));
});
