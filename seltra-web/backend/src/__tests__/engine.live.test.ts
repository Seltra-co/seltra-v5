const live = process.env.RUN_LIVE_ENGINE_TESTS === '1' && Boolean(process.env.SELTRA_ENGINE_URL && process.env.SELTRA_ENGINE_API_KEY)

describe('Seltra Engine live smoke', () => {
  (live ? it : it.skip)('generates a valid image and returns structured vision analysis', async () => {
    const base = process.env.SELTRA_ENGINE_URL!.replace(/\/$/, '')
    const headers = { Authorization: `Bearer ${process.env.SELTRA_ENGINE_API_KEY}`, 'Content-Type': 'application/json' }
    const imageResponse = await fetch(`${base}/images/generations`, { method: 'POST', headers, body: JSON.stringify({ prompt: 'A simple blue circle on a white background', model: 'dyad/image-gen' }) })
    if (!imageResponse.ok) throw new Error(`image endpoint failed (${imageResponse.status}): ${(await imageResponse.clone().text()).slice(0, 300)}`)
    const image = await imageResponse.json() as any
    const bytes = Buffer.from(image.data[0].b64_json, 'base64')
    expect(bytes.subarray(0, 3).toString('hex')).toMatch(/^(89504e|ffd8ff)$/)
    const mime = bytes.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'image/jpeg' : 'image/png'
    const visionResponse = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model: 'seltra-vision', max_tokens: 800, messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe this image briefly.' }, { type: 'image_url', image_url: { url: `data:${mime};base64,${bytes.toString('base64')}` } }] }] }) })
    if (!visionResponse.ok) throw new Error(`vision endpoint failed (${visionResponse.status}): ${(await visionResponse.clone().text()).slice(0, 300)}`)
    const vision = await visionResponse.json() as any
    const parsed = JSON.parse(vision.choices[0].message.content)
    expect(parsed).toMatchObject({ summary: expect.any(String), findings: expect.any(Array) })
  }, 180_000)
})
