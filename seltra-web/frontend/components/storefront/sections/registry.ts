//seltra-web/frontend/components/storefront/sections/registry.ts
import { AnnouncementBar }  from './AnnouncementBar'
import { HeroSection }      from './HeroSection'
import { ProductGrid }      from './ProductGrid'
import { ProductShelf }     from './ProductShelf'
import { TrustBar }         from './TrustBar'
import { CategoryStrip }    from './CategoryStrip'
import { SocialProof }      from './SocialProof'
import { BrandStory }       from './BrandStory'
import { Newsletter }       from './Newsletter'
import { FeaturedDrop }     from './FeaturedDrop'
import { FAQSection }       from './FAQSection'
import { CountdownBanner }  from './CountdownBanner'
import { BeforeAfter }      from './BeforeAfter'
import { FounderStory }     from './FounderStory'
import { IngredientsList }  from './IngredientsList'
import { LookbookGrid }     from './LookbookGrid'
import { TeamProfiles }     from './TeamProfiles'

export const SECTION_REGISTRY = {
  'announcement-bar': AnnouncementBar, 'hero-centered': HeroSection, 'hero-split': HeroSection,
  'hero-editorial': HeroSection, 'hero-fullbleed': HeroSection, 'hero-minimal': HeroSection,
  'trust-bar': TrustBar, 'category-strip': CategoryStrip, 'product-grid': ProductGrid,
  'product-shelf': ProductShelf, 'brand-story': BrandStory, 'social-proof': SocialProof,
  'newsletter': Newsletter, 'featured-drop': FeaturedDrop, 'faq': FAQSection,
  'countdown-banner': CountdownBanner, 'before-after': BeforeAfter, 'founder-story': FounderStory,
  'ingredients-list': IngredientsList, 'lookbook-grid': LookbookGrid, 'team-profiles': TeamProfiles,
} as const

export type RegisteredSectionType = keyof typeof SECTION_REGISTRY