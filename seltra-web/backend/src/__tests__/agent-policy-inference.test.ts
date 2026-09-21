import { inferredActionsFromMessage, mergeActions, parseActions } from '../agent/agent.service'
import { parseImageChangeIntent } from '../ai/agents/image-intent.agent'
import { applyManifestPatch, deriveManifest, getContrastRatio, type StoreManifest } from '../ai/agents/manifest.agent'
import { scoreKnowledgeChunk, tokenize } from '../ai/retrieval/store-knowledge.service'

describe('policy inference', () => {
  it('emits SET_POLICY for a delivery-time answer in question form', () => {
    const actions = inferredActionsFromMessage('How long does delivery take? The answer should be 4-5 hours', [])
    const policy = actions.find((action: { action: string }) => action.action === 'SET_POLICY')

    expect(policy).toBeDefined()
    expect(policy?.payload).toMatchObject({
      type: 'shipping',
    })
    expect(String((policy?.payload as { content?: string } | undefined)?.content ?? '')).toMatch(/4-5 hours|4\s*-\s*5\s*hours/i)
  })
})

describe('model action parsing diagnostics', () => {
  it('distinguishes an absent action delimiter from malformed action JSON', () => {
    expect(parseActions('Just a reply.')).toEqual({
      reply: 'Just a reply.', actions: [], rawActions: null, parsedSuccessfully: false,
    })
    expect(parseActions('Reply\n---ACTIONS---\n{not json}')).toEqual({
      reply: 'Reply', actions: [], rawActions: '{not json}', parsedSuccessfully: false,
    })
  })

  it('preserves a valid action block for execution and diagnostics', () => {
    expect(parseActions('Updated.\n---ACTIONS---\n[]')).toEqual({
      reply: 'Updated.', actions: [], rawActions: '[]', parsedSuccessfully: true,
    })
  })
})

describe('merchant action inference', () => {
  it('keeps only the deterministic image action for an attached upload', () => {
    const actions = mergeActions([
      { action: 'SET_LOGO', payload: { url: 'https://example.com/logo.png' } },
      { action: 'SET_HERO_IMAGE', payload: { url: 'https://example.com/hero.jpg' } },
      { action: 'UPDATE_STORE_META', payload: { name: 'Unrelated model update' } },
    ], [
      { action: 'SET_STORY_IMAGE', payload: { url: 'https://example.com/story.jpg' } },
      { action: 'UPDATE_STORE_META', payload: { name: 'Unrelated inferred update' } },
    ], true)

    expect(actions).toEqual([
      { action: 'SET_STORY_IMAGE', payload: { url: 'https://example.com/story.jpg' } },
    ])
  })

  it('allows model image actions when no deterministic upload target exists', () => {
    const action = { action: 'GENERATE_HERO_IMAGE' as const, payload: { prompt: 'vibrant market scene' } }
    expect(mergeActions([action], [], false)).toEqual([action])
  })

  it('infers a quoted hero title change as SET_HERO_TEXT', () => {
    expect(inferredActionsFromMessage('Change my hero title to "Taste the sweetness for everyday living"', [])).toContainEqual({
      action: 'SET_HERO_TEXT',
      payload: { headline: 'Taste the sweetness for everyday living' },
    })
  })

  it('maps title to headline and leaves value-less title commands without an action', () => {
    expect(inferredActionsFromMessage('change my title', [])).not.toContainEqual(expect.objectContaining({ action: 'SET_HERO_TEXT' }))
    expect(inferredActionsFromMessage('change my title to "New headline"', [])).toContainEqual({
      action: 'SET_HERO_TEXT',
      payload: { headline: 'New headline' },
    })
  })

  it.each([
    ['Change the hero eyebrow to "Taste the sweetness for African living"', 'eyebrow', 'Taste the sweetness for African living'],
    ['Change the hero tagline to "Thoughtfully crafted for modern routines"', 'tagline', 'Thoughtfully crafted for modern routines'],
    ['Change the hero description to "Snacks, Sauces, Spices & Beverages"', 'subtext', 'Snacks, Sauces, Spices & Beverages'],
    ['Change the primary hero button to "Savor Flavors"', 'ctaLabel', 'Savor Flavors'],
    ['Change the secondary hero button to "Browse all"', 'secondaryCtaLabel', 'Browse all'],
  ])('infers %s', (message, key, value) => {
    expect(inferredActionsFromMessage(message, [])).toContainEqual({ action: 'SET_HERO_TEXT', payload: { [key]: value } })
  })

  it('routes logo requests to logo actions before hero/product inference', () => {
    expect(inferredActionsFromMessage('use this for my store logo\n[image: https://example.com/logo.png]', [])).toContainEqual({
      action: 'SET_LOGO',
      payload: { url: 'https://example.com/logo.png' },
    })
    expect(parseImageChangeIntent('change my logo', []).target).toBe('logo')
  })

  it('routes story image generation to the story target', () => {
    expect(parseImageChangeIntent('generate a brand story image local craft', []).target).toBe('story')
    expect(inferredActionsFromMessage('generate a brand story image local craft', [])).toContainEqual({
      action: 'GENERATE_STORY_IMAGE',
      payload: { prompt: 'local craft' },
    })
  })

  it('does not add a duplicate category strip to fallback manifests', () => {
    const manifest = deriveManifest({ businessName: 'Test Shop', businessType: 'online store', productCategories: ['Shoes'] } as any)
    expect(manifest.sections.some((section) => section.type === 'category-strip')).toBe(false)
  })

  it('routes plain delivery-time changes without quoting the old policy', () => {
    expect(inferredActionsFromMessage('change the delivery time to 24 hours', [])).toContainEqual({
      action: 'SET_POLICY',
      payload: { type: 'shipping', content: '24 hours' },
    })
  })

  it('resolves move as mauve through PATCH_MANIFEST', () => {
    const actions = inferredActionsFromMessage('change the orange colors to move', [])
    expect(actions).toContainEqual({
      action: 'PATCH_MANIFEST',
      payload: { updatePalette: { accent: '#8b5cf6' } },
    })
  })

  it('turns a gold color request into a complete readable palette', () => {
    const actions = inferredActionsFromMessage('Change my store colors to gold', [])
    const action = actions.find((item) => item.action === 'PATCH_MANIFEST')

    expect(action?.payload.updatePalette).toMatchObject({
      bg: '#fffaf0',
      surface: '#ffffff',
      text: '#1f1603',
      accent: '#b8860b',
      accentSoft: '#f8e7b8',
    })
    expect(getContrastRatio(action?.payload.updatePalette?.bg ?? '', action?.payload.updatePalette?.text ?? '')).toBeGreaterThanOrEqual(4.5)
  })

  it('uses exact requested fonts from the valid font list', () => {
    const actions = inferredActionsFromMessage('change the font to poppins and inter', [])
    expect(actions).toContainEqual({
      action: 'PATCH_MANIFEST',
      payload: { updateTypography: { headingFont: 'Poppins', bodyFont: 'Inter' } },
    })
  })

  it('infers scoped undo for hero image requests', () => {
    const actions = inferredActionsFromMessage('undo the hero image', [])
    expect(actions).toEqual([{ action: 'UNDO_LAST_CHANGE', payload: { scope: 'hero_image' } }])
  })

  it('infers nav and CTA overrides', () => {
    expect(inferredActionsFromMessage('add a Contact tab to the nav', [])).toContainEqual({
      action: 'PATCH_NAV',
      payload: { addItem: 'Contact' },
    })
    expect(inferredActionsFromMessage('make the add to cart button green', [])).toContainEqual({
      action: 'PATCH_CTA',
      payload: { scope: 'add_to_cart', color: '#16a34a' },
    })
  })

  it('does not infer hero image generation for hero button color requests', () => {
    const actions = inferredActionsFromMessage('Change the color button of the hero to green', [])
    expect(actions).toContainEqual({
      action: 'PATCH_CTA',
      payload: { scope: 'hero_primary', color: '#16a34a' },
    })
    expect(actions.some((action) => action.action === 'GENERATE_HERO_IMAGE' || action.action === 'SET_HERO_IMAGE')).toBe(false)
  })

  it('infers exact product price updates from colloquial product references', () => {
    const actions = inferredActionsFromMessage('the red one should be 120', [
      { id: 'p1', name: 'Red Polo Shirt' },
      { id: 'p2', name: 'Blue Polo Shirt' },
    ])
    expect(actions).toContainEqual({
      action: 'UPDATE_PRODUCT',
      payload: { id: 'p1', price: 120 },
    })
  })

  it('does not infer product prices when the merchant only asks for cheaper pricing', () => {
    const actions = inferredActionsFromMessage('make it cheaper', [{ id: 'p1', name: 'Red Polo Shirt' }])
    expect(actions.some((action) => action.action === 'UPDATE_PRODUCT' || action.action === 'UPDATE_PRODUCTS')).toBe(false)
  })

  it('does not infer all-product price increases without a supplied percentage', () => {
    const actions = inferredActionsFromMessage('increase all prices', [{ id: 'p1', name: 'Red Polo Shirt' }])
    expect(actions.some((action) => action.action === 'UPDATE_PRODUCTS')).toBe(false)
  })

  it('infers all-product price increases only when the percentage is supplied', () => {
    const actions = inferredActionsFromMessage('increase all prices by 10%', [{ id: 'p1', name: 'Red Polo Shirt' }])
    expect(actions).toContainEqual({
      action: 'UPDATE_PRODUCTS',
      payload: { operation: 'increase_prices_percent', percent: 10 },
    })
  })

  it('marks attachment-less generic product image requests as unclear', () => {
    const intent = parseImageChangeIntent('For the first picture use this', [{ id: 'p1', name: 'Signature Bundle' }])
    expect(intent.target).toBe('unclear')
  })

  it('allows URL image requests with a clear hero target to be inferred', () => {
    const actions = inferredActionsFromMessage('replace the hero banner with https://cdn.example.com/hero.jpg', [])
    expect(actions).toContainEqual({
      action: 'SET_HERO_IMAGE',
      payload: { url: 'https://cdn.example.com/hero.jpg' },
    })
  })
})

describe('manifest patch validation', () => {
  const manifest: StoreManifest = {
    sections: [],
    palette: {
      bg: '#fbfbfa',
      surface: '#ffffff',
      border: '#e7e7e5',
      text: '#17181a',
      muted: '#6b6d72',
      accent: '#3b5bfd',
      accentText: '#ffffff',
      accentSoft: '#ecf0ff',
    },
    typography: { headingFont: 'Inter', bodyFont: 'Inter' },
  }

  it('applies similar background and surface colors instead of rejecting merchant intent', () => {
    const result = applyManifestPatch(manifest, {
      updatePalette: { bg: '#fffaf0', surface: '#fff8e6', text: '#1f1603', accent: '#b8860b' },
    })

    expect(result.applied).toBe(true)
    expect(result.reason).toBeUndefined()
    expect(result.after?.palette.surface).toBe('#fff8e6')
  })

  it('auto-repairs identical background and surface colors without asking the merchant to pick again', () => {
    const result = applyManifestPatch(manifest, {
      updatePalette: { bg: '#fffaf0', surface: '#fffaf0', text: '#1f1603', accent: '#b8860b' },
    })

    expect(result.applied).toBe(true)
    expect(result.reason).toBeUndefined()
    expect(result.after?.palette.surface).toBe('#ffffff')
  })

  it('reorders sections while preserving sections omitted from the requested order', () => {
    const result = applyManifestPatch({ ...manifest, sections: [
      { type: 'newsletter', headline: 'News', subtext: 'Updates' },
      { type: 'trust-bar', items: ['Fast delivery'] },
      { type: 'product-grid', columns: 3, style: 'uniform' },
    ] }, { reorderSections: ['product-grid', 'newsletter'] })
    expect(result.applied).toBe(true)
    expect(result.after?.sections.map((section) => section.type)).toEqual(['product-grid', 'newsletter', 'trust-bar'])
  })

  it('scores relevant knowledge tokens and ignores short noise tokens', () => {
    expect(tokenize('What is my shipping policy?')).toEqual(['what', 'shipping', 'policy'])
    expect(scoreKnowledgeChunk({ kind: 'policy', content: 'Shipping takes 2 business days', updatedAt: new Date(0) }, 'shipping time')).toBe(1)
    expect(scoreKnowledgeChunk({ kind: 'policy', content: 'Shipping takes 2 business days', updatedAt: new Date(0) }, 'returns')).toBe(0)
  })
})
