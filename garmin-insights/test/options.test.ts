import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { externalEnabled, parsePublicUrl, parseSettings, readAddonOptions } from "../src/options.ts";
import { formatLine, parseLevel, resolveLogLevel } from "../src/log.ts";

test("options file: missing or broken JSON means defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "gi-opt-"));
  assert.deepEqual(readAddonOptions(join(dir, "none.json")), {});
  writeFileSync(join(dir, "bad.json"), "{nope");
  assert.deepEqual(readAddonOptions(join(dir, "bad.json")), {});
  writeFileSync(join(dir, "ok.json"), JSON.stringify({ log_level: "debug", sync_interval_minutes: 15 }));
  assert.equal(readAddonOptions(join(dir, "ok.json")).log_level, "debug");
});

test("public URLs: http(s) only, no credentials/query/fragment, trailing slash removed", () => {
  assert.equal(parsePublicUrl("https://ha.example.com/"), "https://ha.example.com");
  assert.equal(parsePublicUrl(" https://ha.example.com:8123 "), "https://ha.example.com:8123");
  for (const bad of ["", "ftp://x.example", "https://u:p@x.example", "https://x.example/?a=1", "https://x.example/#f", "not a url", 5]) assert.equal(parsePublicUrl(bad), null, String(bad));
});

test("settings: external listener needs both URLs; env beats options; invalid values are reported and defaulted", () => {
  assert.equal(externalEnabled(parseSettings({ ha_external_url: "https://ha.example.com" })), false);
  const both = parseSettings({ ha_external_url: "https://ha.example.com", app_external_url: "https://app.example.com/" });
  assert.equal(externalEnabled(both), true);
  assert.equal(both.appExternalUrl, "https://app.example.com");
  assert.equal(both.syncIntervalMinutes, 30);
  assert.equal(parseSettings({ app_external_url: "https://a.example" }, { APP_EXTERNAL_URL: "https://b.example" }).appExternalUrl, "https://b.example");
  const bad = parseSettings({ ha_external_url: "javascript:alert(1)", sync_interval_minutes: 2 });
  assert.deepEqual(bad.invalid.sort(), ["ha_external_url", "sync_interval_minutes"]);
  assert.equal(bad.haExternalUrl, null);
  assert.equal(bad.syncIntervalMinutes, 30);
  assert.equal(parseSettings({ sync_interval_minutes: 60 }).syncIntervalMinutes, 60);
});

test("log: logfmt lines, HA's 'warning' is warn, values with spaces are quoted", () => {
  assert.equal(parseLevel("warning"), "warn");
  assert.deepEqual(resolveLogLevel({ log_level: "loud" }), { level: "info", invalid: "loud" });
  const line = formatLine("info", "sync", "run_done", { ms: 12, note: "a b", skip: undefined }, new Date(2026, 9, 30, 10, 0, 0, 5));
  assert.match(line, /^2026-10-30T10:00:00\.005[+-]\d\d:\d\d INFO sync run_done ms=12 note="a b"$/);
});
