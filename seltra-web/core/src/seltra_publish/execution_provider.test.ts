import { describe, expect, it } from 'vitest'
import { CloudflareSandboxProvider, createWorkspaceExecutionProvider, dockerNetworkIsInternal, HostWorkspaceExecutionProvider } from '../../server/src/execution_provider.js'

describe('workspace execution provider selection', () => {
  it('keeps host execution available only outside production', () => {
    expect(createWorkspaceExecutionProvider({ NODE_ENV: 'development', EXECUTION_PROVIDER: 'host' })).toBeInstanceOf(HostWorkspaceExecutionProvider)
    expect(() => createWorkspaceExecutionProvider({ NODE_ENV: 'production', EXECUTION_PROVIDER: 'host' })).toThrow(/not permitted in production/i)
    expect(() => createWorkspaceExecutionProvider({ NODE_ENV: 'development', RENDER: 'true', EXECUTION_PROVIDER: 'host' })).toThrow(/not permitted in production/i)
  })

  it('defaults to Cloudflare and rejects Docker and unknown modes', () => {
    expect(createWorkspaceExecutionProvider({ NODE_ENV: 'production' })).toBeInstanceOf(CloudflareSandboxProvider)
    expect(createWorkspaceExecutionProvider({ NODE_ENV: 'development', RENDER: 'true' })).toBeInstanceOf(CloudflareSandboxProvider)
    expect(() => createWorkspaceExecutionProvider({ NODE_ENV: 'development', EXECUTION_PROVIDER: 'docker' })).toThrow(/must be cloudflare or host/i)
    expect(() => createWorkspaceExecutionProvider({ NODE_ENV: 'development', EXECUTION_PROVIDER: 'remote' })).toThrow(/must be cloudflare or host/i)
  })

  it('accepts only an explicitly internal Docker network', () => {
    expect(dockerNetworkIsInternal('[{"Internal":true}]')).toBe(true)
    expect(dockerNetworkIsInternal('[{"Internal":false}]')).toBe(false)
    expect(dockerNetworkIsInternal('not-json')).toBe(false)
  })
})
