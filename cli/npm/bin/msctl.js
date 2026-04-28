#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const targets = {
  "darwin-arm64": ["aarch64-apple-darwin", "msctl"],
  "linux-x64": ["x86_64-unknown-linux-gnu", "msctl"],
  "win32-x64": ["x86_64-pc-windows-msvc", "msctl.exe"]
};

const key = `${process.platform}-${process.arch}`;
const target = targets[key];

if (!target) {
  console.error(`msctl: unsupported platform ${key}`);
  process.exit(1);
}

const binary = join(__dirname, "..", "vendor", target[0], target[1]);

if (!existsSync(binary)) {
  console.error(`msctl: packaged binary not found at ${binary}`);
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), {
  stdio: "inherit",
  windowsHide: false
});

if (result.error) {
  console.error(`msctl: failed to execute ${binary}`);
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
