import { describe, expect, it } from 'vitest'
import { filterChildEnvironment, redactSensitiveText } from '../../server/src/security.js'

describe('gateway publish secret handling', () => {
  it('strips publish infrastructure prefixes from child environments', () => {
    const childEnv = filterChildEnvironment({
      R2_SECRET_ACCESS_KEY: 'r2-secret',
      GITHUB_APP_PRIVATE_KEY_B64: 'github-private-key',
      GITHUB_PRIVATE_KEY: 'github-private-key-legacy-name',
      GITHUB_INSTALLATION_ID: 'github-installation',
      VERCEL_TOKEN: 'vercel-token',
      WORKSPACE_MASTER_KEY: 'workspace-key',
      ALERT_WEBHOOK_URL: 'alert-url',
      PUBLISH_ENABLED: 'true',
      PATH: 'safe-path',
      MODEL_GATEWAY_URL: 'safe-url',
    })
    expect(childEnv).toEqual({ PATH: 'safe-path', MODEL_GATEWAY_URL: 'safe-url' })
  })

  it('redacts infrastructure, payment and private-key material', () => {
    const output = redactSensitiveText([
      'ghs_abc123', 'github_pat_abc123', 'vercel_abc123', 'sk_test_abc123',
      'Bearer secret-token', 'Authorization: Basic abc123', 'api_key=abc123',
      '-----BEGIN RSA PRIVATE KEY-----\nsecret\n-----END RSA PRIVATE KEY-----',
    ].join(' '))
    expect(output).not.toMatch(/ghs_abc123|github_pat_abc123|vercel_abc123|sk_test_abc123|secret-token|Basic abc123|api_key=abc123|secret/)
  })
})
