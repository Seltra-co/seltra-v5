import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const jest = resolve('node_modules/jest/bin/jest.js')
const result = spawnSync(process.execPath, [jest, '--runInBand', '--runTestsByPath', 'src/__tests__/engine.live.test.ts'], {
  stdio: 'inherit',
  env: { ...process.env, RUN_LIVE_ENGINE_TESTS: '1' },
})
process.exit(result.status ?? 1)
