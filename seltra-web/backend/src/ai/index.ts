//backend/src/ai/agents/index.ts
export { generateBlueprint } from './agents/blueprint.agent'
export { generateProducts } from './agents/product.agent'
export { classifyLayout } from './agents/layout-classifier.agent'
export { generateManifest, deriveManifest } from './agents/manifest.agent'
export { generateHeroNavSources } from './agents/hero-nav-builder.agent'
export type { LayoutVariant, ColorScheme } from './agents/layout-classifier.agent'
export { chat } from './client'
