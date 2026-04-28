import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const targets = {
  "darwin-arm64": ["aarch64-apple-darwin", "msctl"],
  "linux-x64": ["x86_64-unknown-linux-gnu", "msctl"],
  "win32-x64": ["x86_64-pc-windows-msvc", "msctl.exe"]
};

const key = `${process.platform}-${process.arch}`;
const target = targets[key];

if (!target) {
  console.log(`Skipping smoke test on unsupported platform ${key}`);
  process.exit(0);
}

const binary = join(root, "vendor", target[0], target[1]);
await mkdir(dirname(binary), { recursive: true });

if (process.platform === "win32") {
  await writeFile(binary, "@echo off\r\necho msctl smoke\r\n", "utf8");
} else {
  await writeFile(binary, "#!/usr/bin/env sh\necho msctl smoke\n", "utf8");
  await chmod(binary, 0o755);
}

const result = spawnSync(process.execPath, [join(root, "bin", "msctl.js")], {
  encoding: "utf8"
});

await rm(join(root, "vendor"), { recursive: true, force: true });

if (result.status !== 0) {
  console.error(result.stderr);
  process.exit(result.status ?? 1);
}

if (!result.stdout.includes("msctl smoke")) {
  console.error(`Unexpected stdout: ${result.stdout}`);
  process.exit(1);
}
