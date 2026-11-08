import { spawn } from 'node:child_process'

const databaseUrl = 'postgresql://seltra:seltra_local_only@127.0.0.1:55432/seltra_local?schema=public'
const [operation, ...args] = process.argv.slice(2)
const commands = {
  migrate: ['exec', '--', 'prisma', 'migrate', 'deploy'],
  seed: ['run', 'seed'],
}
if (!commands[operation]) throw new Error('Usage: node scripts/local-db-command.mjs migrate|seed')
const isWindows = process.platform === 'win32'
const executable = isWindows ? 'npm.cmd' : 'npm'
const child = spawn(executable, [...commands[operation], ...args], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
})
child.on('exit', (code) => { process.exitCode = code ?? 1 })
