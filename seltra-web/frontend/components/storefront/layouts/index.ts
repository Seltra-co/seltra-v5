//seltra-web/frontend/components/storefront/layouts/index.ts
export type LayoutKey = 'editorial' | 'conversion' | 'storytelling' | 'catalog' | 'showcase'

export interface LayoutSection { type: string; required: boolean; defaultVariant: string; position: 'top' | 'middle' | 'bottom' }
export interface LayoutTemplate  { name: string; description: string; sections: LayoutSection[] }

export const LAYOUTS: Record<LayoutKey, LayoutTemplate> = {
  editorial:    { name: 'Editorial Commerce',  description: 'Fashion/beauty magazine feel.',
    sections: [
      { type: 'hero',          required: true,  defaultVariant: 'editorial', position: 'top'    },
      { type: 'trust-bar',     required: false, defaultVariant: 'minimal',   position: 'top'    },
      { type: 'product-shelf', required: false, defaultVariant: 'default',   position: 'middle' },
      { type: 'brand-story',   required: true,  defaultVariant: 'text-left', position: 'middle' },
      { type: 'product-grid',  required: true,  defaultVariant: 'uniform',   position: 'middle' },
      { type: 'social-proof',  required: false, defaultVariant: 'cards',     position: 'bottom' },
      { type: 'newsletter',    required: false, defaultVariant: 'default',   position: 'bottom' },
    ]},
  conversion:   { name: 'Conversion Focused',  description: 'Trust signals front and center.',
    sections: [
      { type: 'announcement-bar', required: false, defaultVariant: 'default',        position: 'top'    },
      { type: 'hero',             required: true,  defaultVariant: 'centered',        position: 'top'    },
      { type: 'trust-bar',        required: true,  defaultVariant: 'default',         position: 'top'    },
      { type: 'category-strip',   required: false, defaultVariant: 'default',         position: 'middle' },
      { type: 'product-grid',     required: true,  defaultVariant: 'featured-first',  position: 'middle' },
      { type: 'social-proof',     required: true,  defaultVariant: 'marquee',         position: 'middle' },
      { type: 'newsletter',       required: false, defaultVariant: 'default',         position: 'bottom' },
    ]},
  storytelling: { name: 'Brand Storytelling',  description: 'Why before what.',
    sections: [
      { type: 'hero',          required: true,  defaultVariant: 'split',       position: 'top'    },
      { type: 'brand-story',   required: true,  defaultVariant: 'text-center', position: 'top'    },
      { type: 'product-shelf', required: true,  defaultVariant: 'default',     position: 'middle' },
      { type: 'social-proof',  required: true,  defaultVariant: 'grid',        position: 'middle' },
      { type: 'product-grid',  required: true,  defaultVariant: 'magazine',    position: 'middle' },
      { type: 'newsletter',    required: true,  defaultVariant: 'default',     position: 'bottom' },
    ]},
  catalog:      { name: 'Catalog Browse',      description: 'Browse-first experience.',
    sections: [
      { type: 'hero',           required: true,  defaultVariant: 'minimal', position: 'top'    },
      { type: 'category-strip', required: true,  defaultVariant: 'default', position: 'top'    },
      { type: 'trust-bar',      required: true,  defaultVariant: 'default', position: 'top'    },
      { type: 'product-grid',   required: true,  defaultVariant: 'dense',   position: 'middle' },
      { type: 'social-proof',   required: false, defaultVariant: 'marquee', position: 'bottom' },
    ]},
  showcase:     { name: 'Drop Showcase',        description: 'Scarcity and hype.',
    sections: [
      { type: 'announcement-bar', required: true,  defaultVariant: 'default',   position: 'top'    },
      { type: 'hero',             required: true,  defaultVariant: 'fullbleed',  position: 'top'    },
      { type: 'featured-drop',    required: true,  defaultVariant: 'countdown',  position: 'top'    },
      { type: 'category-strip',   required: false, defaultVariant: 'default',    position: 'middle' },
      { type: 'product-grid',     required: true,  defaultVariant: 'dense',      position: 'middle' },
      { type: 'trust-bar',        required: false, defaultVariant: 'default',     position: 'bottom' },
    ]},
}
