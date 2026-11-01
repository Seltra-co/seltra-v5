import { spawn } from 'node:child_process';
import { parse } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('.env.web');
const fileEnv = fs.existsSync(envPath) ? parse(fs.readFileSync(envPath)) : {};
const engineUrl = process.env.SELTRA_ENGINE_URL ?? fileEnv.SELTRA_ENGINE_URL;
if (!engineUrl) {
  process.stderr.write('Set SELTRA_ENGINE_URL in .env.web before starting the engine-backed core.\n');
  process.exit(1);
}
const child = spawn(process.execPath, ['scripts/start-supervisor.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, ...fileEnv, SELTRA_ENGINE_URL: engineUrl },
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
