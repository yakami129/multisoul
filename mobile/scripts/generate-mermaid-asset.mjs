import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'assets', 'generated', 'mermaid.min.js.txt');

mkdirSync(dirname(target), { recursive: true });

let mermaidPackage;
try {
  mermaidPackage = require.resolve('mermaid/package.json');
} catch (error) {
  if (existsSync(target)) {
    console.warn(`Reusing existing ${target}; run pnpm install to refresh it from mermaid.`);
    process.exit(0);
  }

  throw error;
}

const source = join(dirname(mermaidPackage), 'dist', 'mermaid.min.js');
copyFileSync(source, target);

const size = statSync(target).size;
if (size < 1024 * 1024) {
  throw new Error(`Generated Mermaid asset is unexpectedly small: ${size} bytes`);
}

console.warn(`Generated ${target}`);
