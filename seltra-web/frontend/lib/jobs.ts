//seltra-web/frontend/lib/jobs.ts

export type JobStatus = 'open' | 'closed'

export interface RoleAssessment {
  headline: string
  timeframe: string
  instructions: string
  tasks: string[]
  deliverables: string[]
  evaluationCriteria: string[]
  submitTo: string
}

export interface Job {
  slug: string
  team: string
  title: string
  location: string
  type: string
  compensation: string
  summary: string
  mission: string
  responsibilities: string[]
  youAre: string[]
  niceToHave: string[]
  stage: string
  status: JobStatus
  closedNote?: string
  assessment?: RoleAssessment
}

export const JOBS: Job[] = [
  {
    slug: 'founding-gtm-operations-partner',
    team: 'Founding team',
    title: 'Founding GTM & Operations Partner',
    location: 'Accra, Ghana - Remote-friendly',
    type: 'Full-time or part-time',
    compensation: 'Cash + meaningful equity',
    summary:
      'Help us onboard our first merchants, shape go-to-market, and build the operational backbone of an AI-native commerce stack.',
    mission:
      'Own everything that turns Seltra from a product into a movement: getting the first 100 merchants live, shaping our positioning in the African commerce ecosystem, and building the playbooks our future team will run on.',
    responsibilities: [
      'Merchant pipeline, end to end — from outreach and demos to onboarding and activation.',
      'Merchant insight — run weekly merchant interviews and turn what you hear into product, marketing, and pricing decisions.',
      'Go-to-market motion — design and operate the early sales motion across inbound, partnerships, and community.',
      'Internal operations — stand up CRM, support, analytics, and fulfilment workflows the team can run on.',
      'Representation — represent Seltra at events, in communities, and with early partners and investors.',
      'Strategy & storytelling — work directly with the founders on company strategy and how Seltra tells its story.',
    ],
    youAre: [
      'A builder who has shipped real things — businesses, communities, campaigns, or products.',
      'Comfortable speaking with shop owners, traders, and founders every single day.',
      'Structured, fast, and unfazed by ambiguity.',
      'Excited by AI and how it changes the shape of small-business operations.',
    ],
    niceToHave: [
      'Experience in commerce, payments, fintech, or SaaS.',
      'Has started or operated a business of your own.',
      'Strong writing and on-camera comfort.',
    ],
    stage:
      'Interim engagement, transitioning toward a full-time founding role on performance. Reports to Parwar William Ofosu (CEO) and Jerry John Agbofoatsi (CTO).',
    status: 'closed',
    closedNote:
      'This role has been filled. Thank you to everyone who applied — the response was well beyond what we expected for a two-person team in Accra. We are no longer accepting applications for this position, but we are always meeting talent for what comes next.',
  },
  {
    slug: 'founding-software-engineer',
    team: 'Founding team',
    title: 'Founding Software Engineer',
    location: 'Remote — global',
    type: 'Full-time',
    compensation:
      'Cash stipend + founding-engineer equity pool, cap-table position from day one',
    summary:
      'Own the composable storefront architecture — the block system our AI agents assemble every Seltra store from — to a bar that competes globally.',
    mission:
      'Own the architecture that turns Seltra storefront output into a globally competitive product: a composable block system that lets our AI agents assemble stores that look and perform like they came from a world-class studio, not a template engine. You are the engineering counterpart to what Jerry owns on the Ops Center and what William owns on the merchant system.',
    responsibilities: [
      'Storefront block registry — build and maintain the library of production-grade, composable React components (hero, navbar, product grid, PDP, cart, checkout, footer, trust/upsell) that Seltra stores are assembled from.',
      'Theming & design tokens — a token system (color, type, spacing, radius) so one block renders correctly across every merchant brand without forking code per store.',
      'Generation contracts — define the constrained schema our AI agents fill for genuinely unique elements (hero, navbar) so generation stays safe, fast, and on-brand instead of producing raw, failure-prone JSX.',
      'Rendering engine — work inside and extend our deterministic storefront renderer so blocks compose cleanly and never break in production.',
      'Quality bar — sub-2s mobile load times, Lighthouse 85+, accessible by default — storefront quality that holds up against Amboras and any global competitor.',
      'Architecture migration — lead the V4 → V5 migration of existing and new merchant stores onto the new block architecture.',
    ],
    youAre: [
      'A builder who has shipped real UI — ideally a component library, design system, or product used by real customers, not just a personal project.',
      'Strong in TypeScript, React, and Next.js — comfortable in a Turborepo monorepo, consuming and publishing shared packages.',
      'Fluent in Tailwind CSS and token-based theming (CSS variables), and in composable, accessible primitives — the shadcn / Radix school of building UI.',
      'Have an eye for visual quality — you know the difference between a store that looks generated and one that looks designed.',
      'Excited by AI and how constrained generation (not raw code generation) can safely power a product like this.',
      'Structured, fast, and unfazed by ambiguity — comfortable being the first and only engineer on this surface.',
    ],
    niceToHave: [
      'Experience with generative UI, design tools, or AI-assisted interfaces (v0, Lovable, Framer, or similar).',
      'Experience building for commerce — storefronts, checkout, payments UX.',
      'Has started or shipped something of your own.',
    ],
    stage:
      'Interim engagement, transitioning toward a full-time founding role on performance. Reports to Parwar William Ofosu (CEO) and Jerry John Agbofoatsi (CTO).',
    status: 'open',
    assessment: {
      headline: 'Founding Software Engineer — Take-Home Assessment',
      timeframe:
        '3–5 focused hours of work. You have up to 5 days to submit — we care about judgment, not speed.',
      instructions:
        'This is a working sample of the actual problem you would own on day one: making one storefront element themeable and composable, and reasoning about how that scales into a full block registry. Answer as if this were going in front of a global engineering bar, not a school assignment.',
      tasks: [
        'Build a single themeable ProductCard component in React + TypeScript + Tailwind that renders at least two visually distinct brand themes (for example "minimal ivory" and "bold streetwear") purely by swapping design tokens / CSS variables — no per-theme forked components.',
        'Write a one-page architecture note: how would you structure a block registry (hero, navbar, product grid, cart, checkout) so an AI agent can safely assemble a full storefront from it? Include the prop/schema shape you would use for one block.',
        'Record a 5-minute Loom (or a written equivalent if you prefer) walking through your trade-offs and what you would do differently with more time.',
      ],
      deliverables: [
        'A link to a public (or invite-only) GitHub repo with the component.',
        'Your architecture note as Markdown or PDF.',
        'A Loom link or written walkthrough.',
      ],
      evaluationCriteria: [
        'Code quality and composability',
        'Visual and design judgment',
        'Architecture reasoning',
        'Clarity of communication',
        'Taste — would this hold up against a world-class storefront builder',
      ],
      submitTo: 'williamofosu677@gmail.com',
    },
  },
]

export function getJob(slug: string) {
  return JOBS.find((job) => job.slug === slug)
}