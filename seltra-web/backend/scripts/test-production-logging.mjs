import 'dotenv/config'

const accountId =
  process.env.CLOUDFLARE_ACCOUNT_ID ??
  process.env.MODEL_ACCOUNT_ID ??
  process.env.CF_ACCOUNT_ID
const apiToken =
  process.env.CLOUDFLARE_API_TOKEN ??
  process.env.MODEL_API_KEY ??
  process.env.CF_AI_API_TOKEN
const configuredModel =
  process.env.AI_MODEL_DEFAULT ??
  process.env.AI_MODEL_FAST ??
  process.env.AI_MODEL_REASONING

function log(level, event, fields = {}) {
  console[level === 'error' ? 'error' : 'log'](JSON.stringify({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  }))
}

if (!accountId || !apiToken || !configuredModel) {
  log('error', 'production_logging_probe_missing_config', {
    accountConfigured: Boolean(accountId),
    tokenConfigured: Boolean(apiToken),
    modelConfigured: Boolean(configuredModel),
  })
  process.exitCode = 1
} else {
  const run = async (label, model, shouldSucceed) => {
    const requestId = `log-probe-${Date.now()}-${label}`
    const startedAt = Date.now()
    log('info', 'production_logging_probe_started', {
      requestId,
      label,
      model,
    })

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Reply with exactly: LOG PROBE OK' }],
          max_tokens: 16,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    )

    const body = await response.text()
    let providerMessage = ''
    try {
      const parsed = JSON.parse(body)
      providerMessage =
        parsed.errors?.[0]?.message ??
        parsed.result?.response ??
        parsed.result?.choices?.[0]?.message?.content ??
        ''
    } catch {}

    if (!response.ok) {
      log('error', 'production_logging_probe_provider_rejected', {
        requestId,
        label,
        model,
        status: response.status,
        latencyMs: Date.now() - startedAt,
        providerMessage: providerMessage.slice(0, 300),
      })
      return
    }

    if (!shouldSucceed) {
      log('error', 'production_logging_probe_unexpected_success', {
        requestId,
        model,
        status: response.status,
      })
      return
    }

    log('info', 'production_logging_probe_completed', {
      requestId,
      label,
      model,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      providerResponseLength: providerMessage.length,
    })
  }

  await run('configured-success', configuredModel, true)
  await run('intentional-404', '@cf/log-probe/not-a-real-model', false)
}
