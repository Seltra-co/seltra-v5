import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scanRoots = ['src', 'server/src'].map((entry) => path.join(root, entry));
const ignoredDirectories = new Set(['__tests__', 'testing', 'evals', 'benchmarks']);
const violations = [];

function scan(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) scan(path.join(directory, entry.name));
      continue;
    }
    if (!/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    const source = fs.readFileSync(filePath, 'utf8');
    if (/https:\/\/engine\.dyad\.sh|DYAD_ENGINE_URL\s*(?:\?\?|\|\|)\s*["']https:\/\//i.test(source)) violations.push(path.relative(root, filePath));
  }
}

for (const directory of scanRoots) scan(directory);
if (violations.length) {
  process.stderr.write(`Legacy engine host found in runtime code:\n${violations.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('No hardcoded legacy engine host in runtime code.\n');
