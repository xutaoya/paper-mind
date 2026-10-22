import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

// Scaffold 0.8.5 starts an update probe even in CI and leaves its rejection
// unhandled. Its normal one-day cache disables that advisory network request
// without changing the locked build tools or suppressing build/test failures.
if (process.env.CI && process.platform === "linux") {
  const cacheDir = join(
    process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
    "tiny-update-notifier",
  );
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, "zotero-plugin-scaffold"), String(Date.now()));
}
