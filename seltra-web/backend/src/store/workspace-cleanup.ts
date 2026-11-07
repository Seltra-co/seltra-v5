export async function destroyCoreWorkspace(workspaceKey: string) {
  const baseUrl = (process.env.CORE_PUBLIC_URL ?? '').replace(/\/$/, '')
  const secret = process.env.CORE_SERVICE_SECRET ?? ''
  if (!baseUrl || secret.length < 32) throw Object.assign(new Error('Core workspace destroy is not configured.'), { code: 'CORE_DESTROY_NOT_CONFIGURED' })
  let status = 0
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/internal/workspaces/destroy`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-core-service-secret': secret },
        body: JSON.stringify({ workspaceKey }), signal: AbortSignal.timeout(12_000),
      })
      status = response.status
      if (response.ok) return
    } catch {}
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
  }
  throw Object.assign(new Error(`Core workspace destroy failed (${status || 'network'}).`), { code: `CORE_DESTROY_${status || 'NETWORK'}` })
}
