import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const logDir = path.join(root, '.logs')
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run web:dev through npm so its package runner can be located.')

fs.mkdirSync(logDir, { recursive: true })
const services = [
  { name: 'next', cwd: path.join(root, 'seltra-web', 'frontend'), script: 'dev' },
  { name: 'core', cwd: path.join(root, 'seltra-web', 'core'), script: 'web:dev' },
  { name: 'backend', cwd: path.join(root, 'seltra-web', 'backend'), script: 'dev' },
]
const children = []
const redact = (text) => text
  .replace(/("(?:authorization|cookie|[^"\s]*(?:secret|token|api.?key|password|credential)[^"\s]*)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[redacted]"')
  .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
  .replace(/\b([A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|DATABASE_URL|PASSWORD|CREDENTIAL)[A-Z0-9_]*)=([^\s]+)/gi, '$1=[redacted]')
  .replace(/\b(?:sk_seltra_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, '[redacted]')

function recordLine(service, stream, rawLine) {
  const line = redact(rawLine)
  let parsed
  try { parsed = JSON.parse(line) } catch { parsed = undefined }
  const record = parsed?.service && parsed?.timestamp
    ? line
    : JSON.stringify({ timestamp: new Date().toISOString(), service, requestId: parsed?.requestId ?? parsed?.request_id ?? parsed?.traceId ?? randomUUID(), message: line })
  stream.write(record + '\n')
  process.stdout.write(record + '\n')
}

function tee(service, source, stream) {
  let buffered = ''
  source.setEncoding('utf8')
  source.on('data', (chunk) => {
    buffered += chunk
    const lines = buffered.split(/\r?\n/)
    buffered = lines.pop() ?? ''
    for (const line of lines) if (line) recordLine(service, stream, line)
  })
  source.on('end', () => { if (buffered) recordLine(service, stream, buffered) })
}

for (const service of services) {
  const output = fs.createWriteStream(path.join(logDir, `${service.name}.log`), { flags: 'a' })
  const child = spawn(process.execPath, [npmCli, 'run', service.script], {
    cwd: service.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  children.push({ ...service, child, output })
  tee(service.name, child.stdout, output)
  tee(service.name, child.stderr, output)
}

let stopping = false
function stopAll() {
  if (stopping) return
  stopping = true
  for (const { child } of children) {
    if (child.exitCode !== null || child.killed) continue
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    else if (child.pid) { try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') } }
  }
  for (const { output } of children) output.end()
}

process.once('SIGINT', stopAll)
process.once('SIGTERM', stopAll)
await Promise.race(children.map(({ child }) => new Promise((resolve) => child.once('exit', (code) => resolve(code ?? 1)))))
stopAll()
