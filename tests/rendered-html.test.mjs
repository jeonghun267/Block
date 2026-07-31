import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("bundles development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  const bundle = await readFile(workerUrl, "utf8");
  assert.match(bundle, /["']codex-preview["']\s*:\s*["']development["']/);
  assert.match("<meta name=\"codex-preview\" content=\"development\">", developmentPreviewMeta);
});
