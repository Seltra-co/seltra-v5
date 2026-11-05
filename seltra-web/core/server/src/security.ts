const CHILD_SECRET_PREFIX = /^(?:R2_|GITHUB_|VERCEL_|WORKSPACE_MASTER|ALERT_|PUBLISH_)/i

export function filterChildEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !CHILD_SECRET_PREFIX.test(name)),
  )
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, '[redacted private key]')
    .replace(/\b(?:ghs|ghp|ghu|gho|ghr)_[A-Za-z0-9_]+\b/g, '[redacted GitHub token]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, '[redacted GitHub token]')
    .replace(/\bvercel_[A-Za-z0-9_-]+\b/gi, '[redacted Vercel token]')
    .replace(/\bsk_(?:live|test)_[A-Za-z0-9_-]+\b/gi, '[redacted payment key]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(authorization\s*[:=]\s*)\S+/gi, '$1[redacted]')
    .replace(/((?:token|secret|key|access[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
}
