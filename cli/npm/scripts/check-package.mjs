import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const required = [
  ["vendor", "aarch64-apple-darwin", "msctl"],
  ["vendor", "x86_64-unknown-linux-gnu", "msctl"],
  ["vendor", "x86_64-pc-windows-msvc", "msctl.exe"]
];

const missing = [];

for (const parts of required) {
  const path = join(root, ...parts);
  try {
    await access(path, constants.R_OK);
  } catch {
    missing.push(parts.join("/"));
  }
}

if (missing.length > 0) {
  console.error("Missing packaged msctl binaries:");
  for (const path of missing) {
    console.error(`- ${path}`);
  }
  process.exit(1);
}
