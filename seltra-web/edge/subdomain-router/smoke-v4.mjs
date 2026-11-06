import { readFile, writeFile } from 'node:fs/promises'

const [mode, urlsFile, baselineFile] = process.argv.slice(2)
if (!['capture', 'compare'].includes(mode) || !urlsFile || !baselineFile) {
  process.stderr.write('Usage: node smoke-v4.mjs capture|compare <urls.tsv> <baseline.json>\n')
  process.exit(2)
}

const rows = (await readFile(urlsFile, 'utf8')).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
  const split = line.indexOf('\t')
  if (split < 0) throw new Error('Each input row must contain a URL, a tab, and a marker regex.')
  const url = line.slice(0, split).trim()
  const marker = line.slice(split + 1).trim()
  if (!/^https:\/\//i.test(url) || !marker) throw new Error('Each row needs an HTTPS URL and a non-empty marker regex.')
  return { url, marker }
})
if (!rows.length) throw new Error('The URL list is empty.')

async function inspect({ url, marker }) {
  const expression = new RegExp(marker, 'i')
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
  const body = await response.text()
  const match = body.match(expression)
  return { url, status: response.status, location: response.headers.get('location'), marker: match?.[0] ?? null }
}

const current = []
for (const row of rows) {
  const result = await inspect(row)
  current.push(result)
  if (mode === 'capture') process.stdout.write(`captured ${result.url} status=${result.status} marker=${result.marker ? 'matched' : 'missing'}\n`)
  else process.stdout.write(`checked ${result.url} status=${result.status} marker=${result.marker ? 'matched' : 'missing'}\n`)
}

if (mode === 'capture') {
  const missing = current.filter((row) => !row.marker)
  if (missing.length) throw new Error(`${missing.length} V4 marker(s) were not found; baseline was not saved.`)
  await writeFile(baselineFile, JSON.stringify(current, null, 2), { flag: 'wx' })
  process.stdout.write(`Baseline saved for ${current.length} URLs.\n`)
} else {
  const baseline = JSON.parse(await readFile(baselineFile, 'utf8'))
  const differences = current.filter((row, index) => !baseline[index] || row.url !== baseline[index].url || row.status !== baseline[index].status || row.location !== baseline[index].location || row.marker !== baseline[index].marker)
  if (baseline.length !== current.length || differences.length) {
    for (const row of differences) process.stderr.write(`changed ${row.url} status=${row.status} marker=${row.marker ? 'matched' : 'missing'}\n`)
    process.exitCode = 1
  } else process.stdout.write(`PASS: status, redirect location, and marker matched for ${current.length} URLs.\n`)
}
