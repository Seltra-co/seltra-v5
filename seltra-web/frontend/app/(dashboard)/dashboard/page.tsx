//seltra-web/frontend/app/(dashboard)/dashboard/page.tsx
'use client'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  Send, Plus, LogOut, Package, BarChart3, Home,
  Store as StoreIcon, ShoppingBag, Users, Mail,
  ChevronLeft, ChevronRight,
  TrendingUp, Wallet, Menu, X, Trash2, Copy,
  MessageSquare, Sparkles, ArrowRight, Palette, Megaphone,
  Zap, ShoppingCart, Bell, CreditCard, ShieldCheck, CheckCheck,
  FileText, Bot, UserCircle, HelpCircle, Globe2, Building2, LockKeyhole,
  Eye, Pencil,
} from 'lucide-react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { ThinkingOrb } from 'thinking-orbs'
import { Button } from '@/components/ui/button'
import StorefrontPreview, { type StoreData } from '@/components/storefront/StorefrontPreview'
import { StorefrontShell } from '@/components/storefront/StorefrontShell'
import { AgentBuildStream } from '@/components/storefront/AgentBuildStream'
import { useStore } from '@/context/StoreContext'
import { CURRENT_ANNOUNCEMENT_VERSION, WHATS_NEW } from './config/whats-new'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'seltra.co'

function getToken()  { return typeof window !== 'undefined' ? localStorage.getItem('seltra:token') : null }
function getUser()   { try { const r = localStorage.getItem('seltra:user'); return r ? JSON.parse(r) : null } catch { return null } }
function clearAuth() {
  ['seltra:token','seltra:user','seltra:active_store'].forEach((k) => localStorage.removeItem(k))
  window.dispatchEvent(new Event('seltra:auth-expired'))
}
function announcementStorageKey(user: { id?: string; email?: string }) {
  return `seltra:dismissed_announcements:${user.id ?? user.email ?? 'unknown'}`
}

function hasDismissedAnnouncement(user: { id?: string; email?: string }, version: string) {
  try {
    const dismissed = JSON.parse(localStorage.getItem(announcementStorageKey(user)) ?? '[]')
    return Array.isArray(dismissed) && dismissed.includes(version)
  } catch {
    return false
  }
}

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<{ data: T | null; error: string | null }> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string> ?? {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  try {
    const res  = await fetch(`${API_BASE}${path}`, { ...opts, headers })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { if (res.status === 401) clearAuth(); return { data: null, error: json?.message ?? `HTTP ${res.status}` } }
    return { data: json as T, error: null }
  } catch (e) { return { data: null, error: e instanceof Error ? e.message : 'Network error' } }
}

function storefrontUrl(store: StoreData | null): string {
  if (!store) return ''
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return `${window.location.origin}/store/${store.slug}`
  }
  return `https://${store.slug}.${ROOT_DOMAIN}`
}

const money = (value: string | number | null | undefined, currency = 'GHS') =>
  `${currency} ${Number(value ?? 0).toFixed(2)}`

function shortOrderRef(ref?: string | null) {
  if (!ref) return '—'
  const clean = String(ref).replace(/^#/, '')
  const parts = clean.split('_')
  const tail = parts[parts.length - 1] || clean
  return `#${tail.slice(-8)}`
}

const statusClass = (status: string) => {
  if (/paid|delivered|complete|sent/i.test(status)) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
  if (/credit/i.test(status)) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
  if (/debit/i.test(status)) return 'border-orange-500/30 bg-orange-500/10 text-orange-400'
  if (/cancel|failed|refund/i.test(status)) return 'border-red-500/30 bg-red-500/10 text-red-500'
  return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-500'
}

const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']
const hasConfirmedPayment = (order: OrderRecord) => order.merchantAmount !== null && order.merchantAmount !== undefined
const storeIdOf = (store: StoreData | null) => store?.id ?? store?.slug

async function createConversation(title: string, userId?: string) {
  const { data, error } = await apiFetch<Conversation>('/api/v1/conversations', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId ?? 'merchant', title: title.slice(0, 60) || 'New store' }),
  })
  return { data, error }
}

async function saveMessage(conversationId: string | undefined, role: 'user' | 'assistant', content: string, userId?: string) {
  if (!conversationId) return
  await apiFetch<MessageRecord>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId, user_id: userId ?? 'merchant', role, content }),
  })
}

async function compressImage(file: File, maxPx = 1200, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      // Always output as JPEG for consistent compression
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      resolve(dataUrl.split(',')[1]) // return only the base64 part
    }
    img.onerror = reject
    img.src = objectUrl
  })
}

async function compressAgentImage(file: File, maxPx = 1200, quality = 0.82): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not prepare image'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      const preferredMime = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ? file.type : 'image/jpeg'
      const dataUrl = canvas.toDataURL(preferredMime, preferredMime === 'image/png' ? undefined : quality)
      const [meta, base64] = dataUrl.split(',')
      resolve({ base64, mimeType: meta.match(/^data:([^;]+)/)?.[1] ?? preferredMime })
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not load image'))
    }
    img.src = objectUrl
  })
}

async function uploadImageToCloudinary(file: File, storeId: string): Promise<string | null> {
  try {
    const { base64, mimeType } = await compressAgentImage(file)
    const tempProductId = `composer-${Date.now()}`
    const { data } = await apiFetch<{ url: string }>('/api/v1/seltra/upload/product-image', {
      method: 'POST',
      body: JSON.stringify({ storeId, productId: tempProductId, imageBase64: base64, mimeType }),
    })
    return data?.url ?? null
  } catch {
    return null
  }
}

const NAV_TABS = [
  { id: 'mission',   label: 'Home',      icon: Home       },
  { id: 'store',     label: 'Store',     icon: StoreIcon  },
  { id: 'orders',    label: 'Orders',    icon: ShoppingBag },
  { id: 'products',  label: 'Products',  icon: Package    },
  { id: 'invoices',  label: 'Invoices',  icon: FileText   },
  { id: 'sales',     label: 'Sales',     icon: TrendingUp },
  { id: 'payments',  label: 'Payments',  icon: Wallet     },
  { id: 'customers', label: 'Customers', icon: Users      },
  { id: 'analytics', label: 'Analytics', icon: BarChart3  },
  { id: 'marketing', label: 'Marketing', icon: Megaphone  },
  { id: 'home',      label: 'Agent',     icon: Bot        },
]

type OrbState = 'working' | 'searching' | 'solving' | 'listening' | 'composing' | 'shaping'

interface ActivityStage {
  label: string
  orbState: OrbState
  minMs: number
  maxMs: number
}

const ACTIVITY_STAGES: ActivityStage[] = [
  { label: 'Thinking…',    orbState: 'listening', minMs: 1300, maxMs: 2100 },
  { label: 'Analyzing…',   orbState: 'searching', minMs: 1300, maxMs: 2100 },
  { label: 'Planning…',    orbState: 'shaping',   minMs: 1300, maxMs: 2100 },
  { label: 'Composing…',   orbState: 'composing', minMs: 1300, maxMs: 2100 },
  { label: 'Refactoring…', orbState: 'shaping',   minMs: 1300, maxMs: 2100 },
  { label: 'Refining…',    orbState: 'solving',   minMs: 1300, maxMs: 2100 },
  { label: 'Optimizing…',  orbState: 'working',   minMs: 1300, maxMs: 2100 },
  { label: 'Rendering…',   orbState: 'composing', minMs: 1300, maxMs: 2100 },
  { label: 'Validating…',  orbState: 'solving',   minMs: 1300, maxMs: 2100 },
  { label: 'Launching…',   orbState: 'working',   minMs: 1300, maxMs: 2100 },
]

const ACTIVITY_PHASE_RANGES = {
  waiting: { start: 0, end: 2 },
  streaming: { start: 3, end: 8 },
  building: { start: 0, end: 8 },
} as const

const BUILDING_PHASE_MULTIPLIER = 4

type ActivityPhase = 'waiting' | 'streaming' | 'building'

function deriveActivityStage(
  phase: ActivityPhase,
  tick: number,
  launchStarted: boolean,
): ActivityStage {
  if (phase === 'waiting' || phase === 'streaming') {
    return ACTIVITY_STAGES[0]
  }

  if (phase === 'building' && launchStarted) {
    return ACTIVITY_STAGES[9]
  }

  const range = ACTIVITY_PHASE_RANGES[phase]
  const count = range.end - range.start + 1
  if (phase === 'building') {
    return ACTIVITY_STAGES[range.start + (tick % count)]
  }
  const index = Math.min(range.start + tick, range.end)
  return ACTIVITY_STAGES[index]
}

function getActivityStageDuration(stage: ActivityStage, phase: ActivityPhase): number {
  const base = stage.minMs + Math.floor(Math.random() * (stage.maxMs - stage.minMs + 1))
  return phase === 'building' ? base * BUILDING_PHASE_MULTIPLIER : base
}

// ── Business Planner Agent types (mirrors backend/src/ai/agents/business-planner.agent.ts) ──
type PlannerQuestion = { id: string; question: string; why: string; options?: string[] }
type PlannerResult = { readyToBuild: boolean; questions: PlannerQuestion[]; inferredSummary: string }

type MessageAttachment = {
  type: 'image'
  url: string
  name?: string
}

type PendingAttachment = {
  type: 'image'
  name: string
  url?: string
  previewUrl: string
  uploading?: boolean
  error?: string
}

function revokeAttachmentPreview(attachment?: PendingAttachment | null) {
  if (attachment?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(attachment.previewUrl)
}

function merchantFacingAgentReply(reply: string): string {
  return reply.replace(/\s*\[image:\s*https?:\/\/[^\]\s]+\]\s*/gi, '').trim()
}

// Msg now supports an inline 'planner-question' role so clarifying questions
// render as part of the normal chat thread instead of a blocking modal.
type Msg = { role: 'user' | 'assistant' | 'planner-question'; content: string; question?: PlannerQuestion; attachments?: MessageAttachment[] }

function UserPromptBubble({ content, attachments }: { content: string; attachments?: MessageAttachment[] }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = content.length > 240 || content.split('\n').length > 4

  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-md border border-border/60 bg-card/60 px-4 py-3">
        {attachments?.length ? (
          <div className={content ? 'mb-2 flex flex-wrap justify-end gap-2' : 'flex flex-wrap justify-end gap-2'}>
            {attachments.map((attachment, index) => (
              <div key={`${attachment.url}-${index}`} className="overflow-hidden rounded-xl border border-border bg-muted/40">
                <img src={attachment.url} alt={attachment.name ?? 'Attached image'} className="h-24 w-24 object-cover" />
              </div>
            ))}
          </div>
        ) : null}
        {content && (
          <div className={`whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90 ${isLong && !expanded ? 'line-clamp-6' : ''}`}>
            {content}
          </div>
        )}
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1.5 text-[11px] font-medium text-primary hover:underline"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  )
}

function AgentReply({ content, stage }: { content: string; stage?: ActivityStage }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = content.length > 500 || content.split('\n').length > 6

  return (
    <div className="max-w-[92%] rounded-2xl border border-border/60 bg-card/20 px-4 py-3 text-[13px] leading-relaxed text-foreground/90">
      {stage && (
        <div className="mb-2 flex items-center gap-2 rounded-full border border-border/60 bg-card/10 px-3 py-1 text-[11px] text-muted-foreground">
          <ThinkingOrb state={stage.orbState} size={20} aria-label={stage.label} />
          <span>{stage.label}</span>
        </div>
      )}
      <div className={`whitespace-pre-wrap ${isLong && !expanded ? 'line-clamp-6' : ''}`}>
        {content}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-[11px] font-medium text-primary hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

type UserRecord = {
  id?: string
  email: string
  name?: string
  created_at?: string
  createdAt?: string
  plan?: 'free' | 'premium'
  user_metadata?: Record<string, string | undefined>
}
type Conversation = { id: string; title: string; created_at?: string; updated_at?: string; user_id?: string }
type MessageRecord = { id: string; conversation_id: string; role: 'user' | 'assistant'; content: string; created_at: string; user_id: string }

type OrderRecord = {
  id: string; customerEmail: string; customerName?: string; customerPhone?: string | null
  shippingAddress?: string | null; shippingCity?: string | null; shippingCountry?: string | null
  totalAmount: string | number; currency: string; status: string; paystackRef?: string
  items: Array<{ productId?: string; productName?: string; quantity: number; price: string | number }>
  merchantAmount?: string | number | null; seltraFee?: string | number | null; createdAt: string
}
type CustomerRecord = {
  id: string; name?: string | null; email: string; phone?: string | null; address?: string | null
  city?: string | null; country?: string | null; marketingOptIn: boolean; orderCount: number
  totalSpent: string | number; currency: string; lastOrderAt?: string | null; isRecurring: boolean
}
type LedgerTransaction = {
  id: string
  type: string
  amount: string | number
  currency: string
  description?: string
  createdAt: string
  meta?: { provider?: string; account?: string; accountName?: string; reference?: string; [key: string]: unknown } | null
}
type Ledger = { balance: string | number; currency: string; transactions: LedgerTransaction[]; total?: number; page?: number; perPage?: number }
type PayoutOption = { label: string; code: string }
type InvoiceRecord = {
  id: string; number: string; customerName: string; customerEmail: string
  subtotal: string | number; tax: string | number; discount: string | number; total: string | number
  currency: string; status: string; dueDate?: string | null; pdfUrl?: string | null; createdAt: string
  items: Array<{ id: string; description: string; quantity: number; unitPrice: string | number; total: string | number }>
}
type NotificationRecord = {
  id: string
  type: 'order' | 'payment' | 'security' | 'announcement'
  title: string
  body: string
  createdAt: string
  meta?: Record<string, unknown>
}
type Paginated<T> = { data: T[]; total: number; page: number; perPage: number }
type MarketingHistoryRecord = {
  id: string
  channel: 'email' | 'sms'
  audience: 'single' | 'bulk'
  subject?: string
  message?: string
  recipientCount?: number
  sent?: number
  failed?: number
  status?: string
  customerName?: string
  createdAt: string
}
type MarketingTemplateRecord = {
  id: string
  channel: 'email' | 'sms'
  name: string
  subject?: string | null
  message: string
  createdAt: string
  updatedAt: string
}
type ProductRecord = {
  id: string
  name: string
  description?: string | null
  price: string | number
  currency: string
  category?: string | null
  images?: { url: string; isPrimary: boolean }[]
  variants?: { id?: string; name: string; value: string }[]
}

const GHANA_TELCOS: PayoutOption[] = [
  { label: 'MTN Mobile Money', code: '1' },
  { label: 'Telecel Cash', code: '6' },
  { label: 'AT Money', code: '7' },
]

const GHANA_BANKS: PayoutOption[] = [
  { label: 'GCB Bank', code: 'gcb' },
  { label: 'Ecobank Ghana', code: 'ecobank' },
  { label: 'Absa Bank Ghana', code: 'absa' },
  { label: 'Stanbic Bank Ghana', code: 'stanbic' },
  { label: 'Standard Chartered Bank Ghana', code: 'standard-chartered' },
  { label: 'Fidelity Bank Ghana', code: 'fidelity' },
  { label: 'CalBank', code: 'calbank' },
  { label: 'Republic Bank Ghana', code: 'republic' },
  { label: 'Access Bank Ghana', code: 'access' },
  { label: 'Zenith Bank Ghana', code: 'zenith' },
  { label: 'United Bank for Africa Ghana', code: 'uba' },
]

function buildFeedback(store?: StoreData | null): string {
  const safeStore = store ?? {
    name: 'Your store',
    slug: 'your-store',
    targetAudience: 'your customers',
    products: [],
  } as StoreData
  const c = (safeStore as unknown as { canonical: Record<string, unknown> }).canonical ?? {}
  const cats = Array.isArray(c.productCategories) ? (c.productCategories as string[]).join(', ') : 'your catalog'
  const prodCount = Array.isArray(safeStore.products) ? safeStore.products.length : 0
  return [
    `**${safeStore.name}** is ready.`,
    `Positioned for ${safeStore.targetAudience ?? 'your customers'} with ${prodCount} products across ${cats}.`,
    `Payment is wired for checkout. Your store is live at \`${safeStore.slug}.seltra.co\`.`,
    `Ask me to add products, update colors, refine copy, or attach a logo file.`,
  ].join('\n\n')
}

// ── Merges the merchant's planner answers back into a single enriched prompt string.
// Mirrors mergeAnswersIntoPrompt() in the backend planner agent, kept client-side so
// the enriched prompt can be sent straight into the existing /store/build endpoint
// with zero backend changes. ──
function mergeAnswersIntoPrompt(originalPrompt: string, answers: Record<string, string>): string {
  const lines = Object.values(answers)
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
  if (lines.length === 0) return originalPrompt
  return `${originalPrompt}\n\nAdditional details from merchant:\n${lines.join('\n')}`
}

type SidebarSharedProps = {
  user: { id?: string; email: string; name: string; avatar: string; joinedAt?: string; plan?: 'free' | 'premium' } | null
  tab: string
  setTab: (t: string) => void
  onSignOut: () => void
  onNewStore: () => void
  open: boolean
  onToggle: () => void
  conversations: Conversation[]
  activeConversationId: string | undefined
  onLoadConversation: (c: Conversation) => void
  onDeleteConversation: (id: string) => void
}

function WhatsNewBanner({ onDismiss }: { onDismiss: () => void }) {
  const announcement = WHATS_NEW[CURRENT_ANNOUNCEMENT_VERSION]
  if (!announcement) return null
  return (
    <section className="relative mx-4 mt-4 overflow-hidden rounded-2xl border border-primary/50 bg-primary/75 px-5 py-5 text-primary-foreground shadow-lg shadow-primary/10 sm:mx-6 sm:px-6">
      <div className="flex gap-4 pr-8">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/10 text-primary-foreground">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{announcement.title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-primary-foreground/85">{announcement.body}</p>
        </div>
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss announcement" className="absolute right-3 top-3 rounded-lg p-1.5 text-primary-foreground/70 transition hover:bg-black/10 hover:text-primary-foreground">
        <X className="h-4 w-4" />
      </button>
    </section>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const { activeStore, setActiveStore } = useStore()

  const [user, setUser] = useState<{ id?: string; email: string; name: string; avatar: string; joinedAt?: string; plan?: 'free' | 'premium' } | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [activityTick, setActivityTick] = useState(0)
  const [buildId, setBuildId] = useState<string | null>(null)
  const [buildLaunchStarted, setBuildLaunchStarted] = useState(false)
  const activityPhase: 'idle' | ActivityPhase = buildId
    ? 'building'
    : !sending
      ? 'idle'
      : msgs[msgs.length - 1]?.role === 'user'
        ? 'waiting'
        : 'streaming'
  const activityStage = activityPhase === 'idle' ? null : deriveActivityStage(activityPhase, activityTick, buildLaunchStarted)
  const [tab, setTab] = useState('home')
  const [rev, setRev] = useState(0)
  const [convId, setConvId] = useState<string | undefined>()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileSidebar, setMobileSidebar] = useState(false)
  const [mobileView, setMobileView] = useState<'chat' | 'store'>('chat')
  const [stores, setStores] = useState<StoreData[]>([])
  const [announcementVisible, setAnnouncementVisible] = useState(false)
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null)
  const pendingAttachmentRef = useRef<PendingAttachment | null>(null)
  const [credits, setCredits] = useState<{ used: number; limit: number; resetsAt: string } | null>(null)
  const [buildConversationId, setBuildConversationId] = useState<string | undefined>()

  // ── Business Planner Agent state — an inline chat thread that asks one
  // clarifying question at a time (Claude-style), instead of a blocking modal. ──
  const [plannerQueue, setPlannerQueue] = useState<PlannerQuestion[]>([])
  const [plannerIndex, setPlannerIndex] = useState(0)
  const [plannerPrompt, setPlannerPrompt] = useState('')
  const [plannerAnswers, setPlannerAnswers] = useState<Record<string, string>>({})

  useEffect(() => {
    pendingAttachmentRef.current = pendingAttachment
  }, [pendingAttachment])

  useEffect(() => {
    return () => revokeAttachmentPreview(pendingAttachmentRef.current)
  }, [])

  const clearPendingAttachment = useCallback(() => {
    setPendingAttachment((current) => {
      revokeAttachmentPreview(current)
      return null
    })
  }, [])

  useEffect(() => { if (sending) setSidebarOpen(false) }, [sending])

  useEffect(() => {
    if (activityPhase === 'idle') {
      setActivityTick(0)
      return
    }
    setActivityTick(0)
  }, [activityPhase])

  useEffect(() => {
    if (activityPhase === 'idle') return
    if (!activityStage) return

    const timeout = window.setTimeout(
      () => setActivityTick((tick) => tick + 1),
      getActivityStageDuration(activityStage, activityPhase as ActivityPhase),
    )

    return () => window.clearTimeout(timeout)
  }, [activityPhase, activityTick, activityStage])

  const scrollRef = useRef<HTMLDivElement>(null)

  // Asks the planner agent whether the prompt needs clarifying questions before build.
  // Returns null when nothing needs asking (ready to build immediately), or the
  // PlannerResult (with questions) when the merchant should be prompted first.
  const runPlanner = useCallback(async (prompt: string): Promise<PlannerResult | null> => {
    const { data } = await apiFetch<PlannerResult>('/api/v1/seltra/store/plan', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    })
    if (!data || data.readyToBuild || data.questions.length === 0) return null
    return data
  }, [])

  useEffect(() => {
    if (!getToken()) { router.replace('/auth'); return }

    const u = getUser() as UserRecord | null
    let resolvedUser: typeof user = null
    if (u) {
      const m = u.user_metadata ?? {}
      resolvedUser = {
        id: u.id, email: u.email,
        name: m.full_name || m.name || u.email?.split('@')[0] || '',
        avatar: m.avatar_url || m.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.email}`,
        joinedAt: u.created_at || u.createdAt,
        plan: (u.plan === 'premium' ? 'premium' : 'free') as 'free' | 'premium',
      }
      setUser(resolvedUser)
      setAnnouncementVisible(!hasDismissedAnnouncement(resolvedUser, CURRENT_ANNOUNCEMENT_VERSION))
    }

    const pending = sessionStorage.getItem('seltra:pending_prompt')
    if (pending) sessionStorage.removeItem('seltra:pending_prompt')

    const init = async () => {
      await loadConversations()
      const { data } = await apiFetch<StoreData[]>('/api/v1/seltra/store')
      const existing = data ?? []
      setStores(existing)

      if (existing.length > 0) {
        const current = activeStore && existing.find((store) => store.id === activeStore.id || store.slug === activeStore.slug)
        setActiveStore(current ?? existing[0])
      } else if (pending) {
        setSending(true)
        const { data: conv } = await createConversation(pending, resolvedUser?.id)
        if (conv) { setConvId(conv.id); setConversations((c) => [conv, ...c]) }
        setMsgs([{ role: 'user', content: pending }])
        await saveMessage(conv?.id, 'user', pending, resolvedUser?.id)

        const plan = await runPlanner(pending)
        if (plan) {
          beginPlannerThread(pending, plan)
        } else {
          await beginBuild(pending, conv?.id)
        }
      }
    }

    void init()
  }, [router]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs])

  useEffect(() => {
  let cancelled = false
  const loadCredits = async () => {
    const id = storeIdOf(activeStore)
    if (!id) { setCredits(null); return }
    const { data } = await apiFetch<{ used: number; limit: number; resetsAt: string }>(
      `/api/v1/seltra/agent/${encodeURIComponent(id)}/credits`
    )
    if (!cancelled && data) setCredits(data)
  }
  void loadCredits()
  return () => { cancelled = true }
}, [activeStore])

  const loadStores = useCallback(async () => {
    const { data } = await apiFetch<StoreData[]>('/api/v1/seltra/store')
    const stores = data ?? []
    setStores(stores)
    if (stores.length === 0) return

    const current = activeStore && stores.find((store) => store.id === activeStore.id || store.slug === activeStore.slug)
    if (current) {
      setActiveStore(current)
    } else if (!activeStore) {
      setActiveStore(stores[0])
    }
  }, [activeStore])

  const dismissAnnouncement = useCallback(() => {
    setAnnouncementVisible(false)
    const currentUser = user
    if (!currentUser) return
    const key = announcementStorageKey(currentUser)
    let dismissed: string[] = []
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? '[]')
      if (Array.isArray(stored)) dismissed = stored.filter((version): version is string => typeof version === 'string')
    } catch {
      dismissed = []
    }
    if (!dismissed.includes(CURRENT_ANNOUNCEMENT_VERSION)) {
      localStorage.setItem(key, JSON.stringify([...dismissed, CURRENT_ANNOUNCEMENT_VERSION]))
    }
  }, [user])

  const loadConversations = async () => {
    const { data } = await apiFetch<Conversation[]>('/api/v1/conversations?order=updated_at:desc')
    setConversations(data ?? [])
  }

  const loadConversationMessages = async (conversation: Conversation) => {
    const { data, error } = await apiFetch<MessageRecord[]>(
      `/api/v1/conversations/${encodeURIComponent(conversation.id)}/messages?order=created_at:asc`
    )
    if (error) { toast.error(error); return }
    setConvId(conversation.id)
    setMsgs((data ?? []).map((m) => ({ role: m.role, content: m.content })))
    setTab('home')
  }

  // beginBuild now accepts an optional plannerAnswersSnapshot so structured
  // planner answers (fulfillment mode, delivery tiers, variants, etc.) reach the backend
  // as real fields on CreateStoreDto.plannerAnswers, not just folded into prose.
  const beginBuild = useCallback(async (prompt: string, conversationId?: string, plannerAnswersSnapshot?: Record<string, string>) => {
    setBuildId(null)
    setBuildConversationId(conversationId)
    const { data, error } = await apiFetch<{ buildId: string }>('/api/v1/seltra/store/build', {
      method: 'POST',
      body: JSON.stringify({
        name: prompt.slice(0, 48),
        prompt,
        plannerAnswers: plannerAnswersSnapshot ? {
          fulfillment_mode: plannerAnswersSnapshot['fulfillment_mode'],
          contact_number: plannerAnswersSnapshot['contact_number'],
          delivery_tiers: plannerAnswersSnapshot['delivery_tiers'],
          product_variants: plannerAnswersSnapshot['product_variants'],
        } : undefined,
      }),
    })
    if (error || !data?.buildId) {
      toast.error(error || 'Could not start build')
      setSending(false)
      setTimeout(() => setSidebarOpen(true), 1200)
      return
    }
    setBuildId(data.buildId)
  }, [])

  const deleteConversation = async (conversationId: string) => {
    const { error } = await apiFetch<{ success: boolean }>(`/api/v1/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' })
    if (error) { toast.error(error); return }
    setConversations((c) => c.filter((x) => x.id !== conversationId))
    if (convId === conversationId) { setConvId(undefined); setMsgs([]) }
    toast.success('Conversation deleted')
  }

  const appendChunk = (chunk: string) => {
    setMsgs((prev) => {
      const last = prev[prev.length - 1]
      if (!last || last.role !== 'assistant') return [...prev, { role: 'assistant', content: chunk }]
      return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: m.content + chunk } : m)
    })
  }

  const sendToAgent = useCallback(async (storeId: string, message: string, options?: { hasAttachments?: boolean; operation?: 'image-update' | 'generic' }) => {
    const token = getToken()
    setMsgs((prev) => [...prev, { role: 'assistant', content: '' }])
    let streamedReply = ''
    try {
      const res = await fetch(`${API_BASE}/api/v1/seltra/agent/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ storeId, message, conversationId: convId, hasAttachments: options?.hasAttachments }),
      })
      if (res.ok && res.body) {
        const reader = res.body.getReader(); const dec = new TextDecoder()
        while (true) {
          const { value, done } = await reader.read(); if (done) break
          for (const line of dec.decode(value, { stream: true }).split(/\r?\n/).filter(Boolean)) {
            const norm = line.startsWith('data:') ? line.slice(5).trim() : line
            if (!norm || norm === '[DONE]') continue
            try {
              const j = JSON.parse(norm)
              if (j.conversationId) setConvId(j.conversationId)
              if (j.credits) setCredits(j.credits)
              const chunk = j.chunk ?? j.delta ?? j.text ?? j.reply ?? j.message ?? ''
              if (chunk) { streamedReply += chunk; appendChunk(chunk) }
              if (Array.isArray(j.actions)) j.actions.forEach((a: { action: string }) => {
                  if (a.action === 'ADD_PRODUCT' || a.action === 'SET_HERO_TEXT' || a.action === 'REFETCH_STOREFRONT') { setRev((v) => v + 1); void loadStores() }
              })
            } catch { streamedReply += norm; appendChunk(norm) }
          }
        }
        const safeReply = merchantFacingAgentReply(streamedReply)
        if (safeReply !== streamedReply) {
          setMsgs((prev) => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: safeReply } : m))
        }
        return safeReply
      }
    } catch { /* fall through */ }
    const { data } = await apiFetch<{ reply?: string; message?: string; conversationId?: string }>(
      '/api/v1/seltra/agent/message',
      { method: 'POST', body: JSON.stringify({ storeId, message, conversationId: convId, hasAttachments: options?.hasAttachments }) }
    )
   if (data?.conversationId) setConvId(data.conversationId)
    if ((data as { credits?: typeof credits })?.credits) setCredits((data as { credits?: typeof credits }).credits!)
    const reply = merchantFacingAgentReply(data?.reply ?? data?.message ?? '')
    setMsgs((prev) => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: reply } : m))
    return reply
  }, [convId])

  // ── Runs the planner before kicking off a fresh build. If the planner comes
  // back with questions, we start the inline planner thread and wait for the
  // merchant to answer (or skip) before calling beginBuild. ──
  const startConv = async (prompt: string) => {
    const limitCheck = await apiFetch<{ allowed: boolean; reason?: string }>('/api/v1/seltra/store/check-limit')
    if (!limitCheck.data?.allowed) {
      toast.error(limitCheck.data?.reason || 'Store limit reached for your plan')
      setSending(false)
      return
    }

    setSending(true)
    const { data: conversation } = await createConversation(prompt, user?.id)
    if (conversation) { setConvId(conversation.id); setConversations((c) => [conversation, ...c]) }
    setMsgs([{ role: 'user', content: prompt }])
    await saveMessage(conversation?.id, 'user', prompt, user?.id)

    const plan = await runPlanner(prompt)
    if (plan) {
      beginPlannerThread(prompt, plan)
      return
    }
    await beginBuild(prompt, conversation?.id)
  }

  // ── Planner thread: pushes the summary + first question into the message
  // list, then advances one question at a time as the merchant answers. ──
  const beginPlannerThread = (prompt: string, result: PlannerResult) => {
    setPlannerPrompt(prompt)
    setPlannerQueue(result.questions)
    setPlannerIndex(0)
    setPlannerAnswers({})
    setMsgs((prev) => [
      ...prev,
      { role: 'assistant', content: result.inferredSummary },
      { role: 'planner-question', content: '', question: result.questions[0] },
    ])
    setSending(false)
  }

  const answerPlannerQuestion = async (value: string) => {
    const q = plannerQueue[plannerIndex]
    if (!q) return
    const updatedAnswers = { ...plannerAnswers, [q.id]: value }
    setPlannerAnswers(updatedAnswers)
    // Replace the just-answered question bubble with the merchant's answer,
    // exactly like a normal chat turn.
    setMsgs((prev) => [...prev.slice(0, -1), { role: 'user', content: value }])

    const nextIndex = plannerIndex + 1
    if (nextIndex < plannerQueue.length) {
      setPlannerIndex(nextIndex)
      setMsgs((prev) => [...prev, { role: 'planner-question', content: '', question: plannerQueue[nextIndex] }])
    } else {
      setPlannerQueue([])
      setPlannerIndex(0)
      const enriched = mergeAnswersIntoPrompt(plannerPrompt, updatedAnswers)
      setSending(true)
      await beginBuild(enriched, convId, updatedAnswers)
    }
  }

  const skipPlannerThread = async () => {
    if (!plannerPrompt) return
    setPlannerQueue([])
    setPlannerIndex(0)
    setSending(true)
    await beginBuild(plannerPrompt, convId)
  }

const send = async () => {
  const text = input.trim()
  if ((!text && !pendingAttachment) || sending) return
  if (pendingAttachment?.uploading) {
    toast.message('Image is still uploading.')
    return
  }
  if (activeStore && pendingAttachment?.error) {
    toast.error(pendingAttachment.error)
    return
  }

  const displayText = text
  const attachments = pendingAttachment
    ? [{ type: 'image' as const, url: pendingAttachment.url ?? pendingAttachment.previewUrl, name: pendingAttachment.name }]
    : undefined
  const messageToSend = pendingAttachment?.url
    ? `${text || 'Use this image for the requested change.'}\n[image: ${pendingAttachment.url}]`
    : text
  const imageOperation = Boolean(pendingAttachment?.url)

  setInput('')
  clearPendingAttachment()
  setSending(true)

  if (!activeStore) { await startConv(displayText || messageToSend); setSending(false); return }

  let activeConversationId = convId
  if (!activeConversationId) {
    const { data: conversation } = await createConversation(
      displayText.slice(0, 60) || (attachments?.length ? 'Image update' : 'New conversation'),
      user?.id,
    )
    if (conversation) {
      activeConversationId = conversation.id
      setConvId(conversation.id)
      setConversations((c) => [conversation, ...c])
    }
  }

  setMsgs((prev) => [...prev, { role: 'user', content: displayText, attachments }])
  await saveMessage(activeConversationId, 'user', displayText, user?.id)
  const reply = await sendToAgent(activeStore.id ?? activeStore.slug, messageToSend, {
    hasAttachments: imageOperation,
    operation: imageOperation ? 'image-update' : 'generic',
  })
  if (reply) await saveMessage(activeConversationId, 'assistant', reply, user?.id)
  setSending(false)
  setRev((v) => v + 1)
  void loadStores()
}

  const newStore = () => {
    setActiveStore(null); setMsgs([]); setConvId(undefined); setStores([])
    setRev((v) => v + 1); setTab('home'); setSidebarOpen(true); void loadStores()
  }

  const signOut = () => { clearAuth(); setActiveStore(null); router.push('/auth') }

  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const hasStore = mounted && (Boolean(activeStore) || msgs.length > 0)
  const storeTitle = activeStore?.name ?? msgs[0]?.content?.slice(0, 40) ?? 'My Store'
  const normalizeSlug = useCallback((value: string) =>
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30)
      .replace(/^-+|-+$/g, '') || 'my-store'
  , [])

  const storeSlug = useMemo(
    () => activeStore?.slug ?? normalizeSlug(storeTitle),
    [activeStore?.slug, normalizeSlug, storeTitle]
  )
  const previewKey = `${storeSlug}:${rev}:${activeStore?.id ?? 'pending'}:${activeStore?.heroSource ? 'hero' : 'no-hero'}:${activeStore?.manifest ? 'manifest' : 'no-manifest'}`
  const handleBuildPreview = useCallback((store?: StoreData | null) => {
    setBuildLaunchStarted(true)
    if (!store) return
    setActiveStore(store)
    setStores((prev) => [store, ...prev.filter((item) => item.id !== store.id && item.slug !== store.slug)])
    setRev((v) => v + 1)
  }, [])

  const handleBuildLaunchStart = useCallback(() => {
    setBuildLaunchStarted(true)
  }, [])

  const handleBuildDone = useCallback(async (store?: StoreData | null) => {
    setBuildLaunchStarted(true)
    let confirmedStore = store ?? null
    const hasGeneratedAssets = (candidate?: StoreData | null) =>
      Boolean(candidate?.manifest && candidate.heroSource && candidate.navSource)

    for (let attempt = 0; attempt < 6 && !hasGeneratedAssets(confirmedStore); attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
      try {
        const { data } = await apiFetch<StoreData[]>('/api/v1/seltra/store')
        const list = data ?? []
        const match = confirmedStore
          ? list.find((item) => item.id === confirmedStore!.id || item.slug === confirmedStore!.slug)
          : list[0]
        if (hasGeneratedAssets(match)) confirmedStore = match ?? null
        else if (match && !confirmedStore) confirmedStore = match
      } catch {
        // retry until generated assets are visible or we run out of attempts.
      }
    }

    if (confirmedStore) {
      setActiveStore(confirmedStore)
      setStores((prev) => [confirmedStore!, ...prev.filter((item) => item.id !== confirmedStore!.id && item.slug !== confirmedStore!.slug)])
    }

    setRev((v) => v + 1)
    const reply = buildFeedback(confirmedStore)
    setMsgs((prev) => [...prev, { role: 'assistant', content: reply }])
    await saveMessage(buildConversationId ?? convId, 'assistant', reply, user?.id)
    setSending(false)
    setBuildId(null)
    setBuildLaunchStarted(false)
    setBuildConversationId(undefined)
    setTimeout(() => setSidebarOpen(true), 1200)
    void loadStores()
  }, [buildConversationId, convId, user?.id])

  const handleBuildError = useCallback((message: string) => {
    toast.error(message)
    setSending(false)
    setBuildId(null)
    setBuildLaunchStarted(false)
    setBuildConversationId(undefined)
    setTimeout(() => setSidebarOpen(true), 1200)
  }, [])

  // ── Shared attach handler for the agent panel (with Cloudinary upload) ──
const handleAgentAttach = async (f: File) => {
  const previewUrl = URL.createObjectURL(f)
  const localAttachment: PendingAttachment = {
    type: 'image',
    name: f.name,
    previewUrl,
    uploading: Boolean(activeStore),
  }

  setPendingAttachment((current) => {
    revokeAttachmentPreview(current)
    return localAttachment
  })

  if (!activeStore) return

  const url = await uploadImageToCloudinary(f, activeStore.id ?? activeStore.slug)
  setPendingAttachment((current) => {
    if (current?.previewUrl !== previewUrl) return current
    if (!url) return { ...current, uploading: false, error: "Couldn't upload the image. Try again." }
    return { ...current, url, uploading: false, error: undefined }
  })
  if (!url) toast.error("Couldn't upload the image. Try again.")
}

  const sidebarProps: SidebarSharedProps = {
    user,
    tab,
    setTab,
    onSignOut: signOut,
    onNewStore: newStore,
    open: sidebarOpen,
    onToggle: () => setSidebarOpen((p) => !p),
    conversations,
    activeConversationId: convId,
    onLoadConversation: loadConversationMessages,
    onDeleteConversation: deleteConversation,
  }

  if (tab !== 'home') {
    return (
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <SidebarDesktop {...sidebarProps} />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <MobileHeader storeName={activeStore?.name} onMenuOpen={() => setMobileSidebar(true)} onSignOut={signOut} />
          <DashboardTopBar activeStore={activeStore} />   {/* ← was <DashboardNotifications .../> */}
        <TabContent
            tab={tab} activeStore={activeStore} stores={stores}
            onSelectStore={(s) => { setActiveStore(s); setTab('mission'); setRev((v) => v + 1) }}
            onStoreDeleted={(id) => { /* unchanged */ }}
            onStoreUpdated={(store) => { /* unchanged */ }}
            reloadStores={loadStores} user={user}
            credits={credits}
          />
        </main>
        <MobileSidebarDrawer
          open={mobileSidebar}
          onClose={() => setMobileSidebar(false)}
          user={sidebarProps.user}
          tab={tab}
          setTab={(t) => { setTab(t); setMobileSidebar(false) }}
          onSignOut={signOut}
          onNewStore={newStore}
          conversations={conversations}
          activeConversationId={convId}
          onLoadConversation={(c) => { void loadConversationMessages(c); setMobileSidebar(false) }}
          onDeleteConversation={deleteConversation}
        />
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <SidebarDesktop {...sidebarProps} />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <MobileHeader storeName={activeStore?.name} onMenuOpen={() => setMobileSidebar(true)} onSignOut={signOut} />
         <DashboardTopBar activeStore={activeStore} />  
        {announcementVisible && <WhatsNewBanner onDismiss={dismissAnnouncement} />}
        {!hasStore ? (
          <EmptyState
            input={input} setInput={setInput} send={send} sending={sending} name={user?.name ?? ''}
            pendingAttachment={pendingAttachment}
            onClearAttachment={clearPendingAttachment}
            conversations={conversations}
            onLoadConversation={loadConversationMessages}
            stores={stores}
            hasHistory={conversations.length > 0 || stores.length > 0}
            onAttach={handleAgentAttach}
          />
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[5fr_7fr]">
            <div className="flex flex-shrink-0 border-b border-border lg:hidden">
              <button
                type="button"
                onClick={() => setMobileView('chat')}
                className={`flex-1 py-2.5 text-center text-xs font-mono uppercase tracking-wider transition-colors ${
                  mobileView === 'chat' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'
                }`}
              >
                Agent
              </button>
              <button
                type="button"
                onClick={() => setMobileView('store')}
                className={`flex-1 py-2.5 text-center text-xs font-mono uppercase tracking-wider transition-colors ${
                  mobileView === 'store' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'
                }`}
              >
                Store preview
              </button>
            </div>

            {/* ── Agent panel ── */}
            <section className={`flex min-h-0 flex-col overflow-hidden border-r border-border bg-background ${
              mobileView === 'store' ? 'hidden lg:flex' : 'flex'
            }`}>
              {/* Header */}
              <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
                <span className="font-mono text-xs text-primary">{`// agent${activeStore ? ` · ${activeStore.name}` : ''}`}</span>
               <div className="flex items-center gap-2">
                   {credits && (
                     <span
                       title={`Resets ${new Date(credits.resetsAt).toLocaleTimeString()}`}
                       className={`rounded-full border px-2.5 py-1 font-mono text-[10px] ${credits.used >= credits.limit ? 'border-red-500/30 text-red-400' : 'border-border text-muted-foreground'}`}
                     >
                       {credits.used}/{credits.limit} credits
                     </span>
                   )}
                 </div>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 text-[13px]">
                {msgs.length === 0 && !sending && (
                  <div className="rounded-2xl border border-border bg-card/30 p-4 text-sm text-muted-foreground">
                    {activeStore
                      ? `Tell me what to change in ${activeStore.name}. Products, colors, copy, or attach a logo.`
                      : 'Describe your store and your agent will build it in seconds.'}
                  </div>
                )}
                {msgs.map((m, i) => {
                  if (m.role === 'planner-question' && m.question) {
                    const isLatest = i === msgs.length - 1
                    const q = m.question
                    return (
                      <div key={i} className="max-w-[92%] rounded-2xl border border-border/60 bg-card/20 p-4">
                        <div className="text-[13px] font-medium text-foreground">{q.question}</div>
                        <p className="mt-1 text-xs text-muted-foreground">{q.why}</p>
                        {isLatest && (
                          <>
                            {q.options && q.options.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {q.options.map((opt) => (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() => void answerPlannerQuestion(opt)}
                                    className="rounded-full border border-border bg-background/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                                  >
                                    {opt}
                                  </button>
                                ))}
                              </div>
                            )}
                            <div className="mt-2 flex items-center gap-2">
                              <input
                                className="flex-1 rounded-xl border border-border bg-background px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                                placeholder="Type your answer…"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                    void answerPlannerQuestion(e.currentTarget.value.trim())
                                  }
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => void skipPlannerThread()}
                                className="flex-shrink-0 text-xs text-muted-foreground hover:text-foreground"
                              >
                                Skip all
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  }

                  if (m.role === 'user') {
                    return <UserPromptBubble key={i} content={m.content} attachments={m.attachments} />
                  }

                  const isActiveStreaming = sending && i === msgs.length - 1
                  return (
                    <AgentReply
                      key={i}
                      content={m.content}
                      stage={isActiveStreaming ? activityStage ?? undefined : undefined}
                    />
                  )
                })}
                {(buildId || (sending && msgs[msgs.length - 1]?.role === 'user')) && activityStage && (
                  <div className="flex justify-start">
                    <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/20 px-3 py-2 text-[13px] text-foreground/90">
                      <ThinkingOrb state={activityStage.orbState} size={20} aria-label={activityStage.label} />
                      <span>{activityStage.label}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Input — pinned at bottom, uses Cloudinary upload handler */}
              <div className="flex-shrink-0">
               <ChatInput
                    input={input} setInput={setInput} send={send} sending={sending} compact
                    onAttach={handleAgentAttach}
                    pendingAttachment={pendingAttachment}
                    onClearAttachment={clearPendingAttachment}
                  />
              </div>
            </section>

            <div className={mobileView === 'chat' ? 'hidden lg:block' : 'block'}>
              <StorefrontShell slug={storeSlug} isStream={Boolean(buildId)}>
                {buildId ? (
                  <AgentBuildStream storeName={storeTitle} buildId={buildId} onPreview={handleBuildPreview} onLaunchStart={handleBuildLaunchStart} onDone={handleBuildDone} onError={handleBuildError} />
                ) : (
                  <StorefrontPreview key={previewKey} storeSlug={storeSlug} suppressFallback={!activeStore} rev={rev} />
                )}
              </StorefrontShell>
            </div>
          </div>
        )}
      </main>

      <MobileSidebarDrawer
        open={mobileSidebar}
        onClose={() => setMobileSidebar(false)}
        user={sidebarProps.user}
        tab={tab}
        setTab={(t) => { setTab(t); setMobileSidebar(false) }}
        onSignOut={signOut}
        onNewStore={newStore}
        conversations={conversations}
        activeConversationId={convId}
        onLoadConversation={(c) => { void loadConversationMessages(c); setMobileSidebar(false) }}
        onDeleteConversation={deleteConversation}
      />
    </div>
  )
}

function NotificationBell({ activeStore }: { activeStore: StoreData | null }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationRecord[]>([])
  const [readIds, setReadIds] = useState<string[]>([])
  const tenantId = storeIdOf(activeStore)

  useEffect(() => {
    try {
      setReadIds(JSON.parse(localStorage.getItem('seltra:read_notifications') || '[]'))
    } catch {
      setReadIds([])
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const path = `/api/v1/notifications${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`
      const { data } = await apiFetch<NotificationRecord[]>(path)
      if (!cancelled) setItems(data ?? [])
    }
    void load()
    const timer = window.setInterval(() => void load(), 45_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [tenantId])

  const unreadCount = items.filter((item) => !readIds.includes(item.id)).length
  const markAllRead = () => {
    const next = Array.from(new Set([...readIds, ...items.map((item) => item.id)]))
    setReadIds(next)
    localStorage.setItem('seltra:read_notifications', JSON.stringify(next))
  }

  return (
    <div className="relative z-40">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative grid h-10 w-10 place-items-center rounded-xl border border-border bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
        aria-label="Open notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-primary px-1 font-mono text-[10px] font-semibold text-primary-foreground">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <div className="text-sm font-semibold">Notifications</div>
              <div className="font-mono text-[10px] text-muted-foreground">{unreadCount} unread</div>
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-8 rounded-full text-xs" onClick={markAllRead}>
              <CheckCheck className="h-3.5 w-3.5" /> Read
            </Button>
          </div>
          <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">Orders, payments, logins, security alerts, and announcements will appear here.</div>
            ) : items.map((item) => {
              const Icon = item.type === 'order' ? ShoppingBag : item.type === 'payment' ? CreditCard : item.type === 'security' ? ShieldCheck : Megaphone
              const unread = !readIds.includes(item.id)
              return (
                <div key={item.id} className={`flex gap-3 px-4 py-3 text-sm ${unread ? 'bg-primary/5' : ''}`}>
                  <div className="mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-xl border border-border bg-background text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate font-medium">{item.title}</div>
                      {unread && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground/70">{new Date(item.createdAt).toLocaleString()}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function DashboardTopBar({ activeStore }: { activeStore: StoreData | null }) {
  return (
    <div className="relative z-40 flex flex-shrink-0 items-center justify-end border-b border-border bg-background/80 px-4 py-2 backdrop-blur lg:px-6">
      <NotificationBell activeStore={activeStore} />
    </div>
  )
}

// ── Sidebar (desktop) ──────────────────────────────────────────────────────────
function SidebarDesktop({
  user, tab, setTab, onSignOut, onNewStore, open, onToggle,
  conversations, activeConversationId, onLoadConversation, onDeleteConversation,
}: SidebarSharedProps) {
  const [profileOpen, setProfileOpen] = useState(false)
  const profileItems = [
    { id: 'account', label: 'Account', icon: UserCircle },
    { id: 'billing', label: 'Billing', icon: CreditCard },
    { id: 'domains', label: 'Domains', icon: Globe2 },
    { id: 'help', label: 'Get Help', icon: HelpCircle },
  ]

  return (
    <motion.aside
      animate={{ width: open ? 260 : 68 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className="hidden flex-col border-r border-border bg-card/50 lg:flex overflow-hidden flex-shrink-0"
    >
      <div className="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-border px-4">
        <AnimatePresence>
          {open && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2.5 overflow-hidden">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-primary/20">
                <img src="https://res.cloudinary.com/dfmsaarli/image/upload/v1782364695/ICON_large_ngiv41.png" alt="Seltra" className="h-7 w-7 rounded-md" />
              </div>
              <span className="whitespace-nowrap font-mono text-[15px] font-semibold tracking-tight">seltra</span>
              <span className="flex-shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] text-muted-foreground">beta</span>
            </motion.div>
          )}
        </AnimatePresence>
        <button onClick={onToggle} className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors">
          {open ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      <div className="border-b border-border p-3">
        <button
          onClick={onNewStore}
          title={!open ? 'New store' : undefined}
          className={`flex w-full items-center gap-2.5 rounded-full border border-border bg-muted/30 px-3.5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 ${!open ? 'justify-center' : ''}`}
        >
          <Plus className="h-[15px] w-[15px] flex-shrink-0 text-primary" />
          <AnimatePresence>
            {open && (
              <motion.span initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }} className="overflow-hidden whitespace-nowrap text-[13px]">
                New store
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 min-h-0">
        {open && <div className="mb-2 px-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">Workspace</div>}
        <div className="space-y-0.5">
          {NAV_TABS.map((t) => (
            <button
              key={t.id} onClick={() => setTab(t.id)} title={!open ? t.label : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors ${!open ? 'justify-center' : ''} ${
                tab === t.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
            >
              <t.icon className={`flex-shrink-0 ${open ? 'h-[17px] w-[17px]' : 'h-[18px] w-[18px]'}`} />
              <AnimatePresence>
                {open && (
                  <motion.span initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }} className="overflow-hidden whitespace-nowrap">
                    {t.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          ))}
        </div>
      </nav>

      <div className="border-t border-border px-3 py-3" style={{ maxHeight: 130, overflow: 'hidden' }}>
        {open && <div className="mb-2 px-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">History</div>}
        <div className="space-y-0.5 overflow-y-auto" style={{ maxHeight: open ? 190 : 150 }}>
          {conversations.length === 0
            ? open && <p className="px-2.5 py-2 text-xs leading-relaxed text-muted-foreground/60">Your agent conversations will appear here.</p>
            : conversations.slice(0, open ? 8 : 4).map((conv) => (
              <div key={conv.id} className={`group flex items-center gap-1 rounded-xl ${activeConversationId === conv.id ? 'bg-primary/10' : 'hover:bg-muted/50'}`}>
                <button type="button" onClick={() => onLoadConversation(conv)} title={conv.title}
                  className={`min-w-0 flex-1 px-2.5 py-2 text-left text-xs ${activeConversationId === conv.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {open ? (
                    <>
                      <div className="truncate font-medium">{conv.title || 'Conversation'}</div>
                      <div className="truncate font-mono text-[9px] opacity-50">{conv.updated_at ? new Date(conv.updated_at).toLocaleDateString() : 'agent chat'}</div>
                    </>
                  ) : <MessageSquare className="mx-auto h-4 w-4" />}
                </button>
                {open && (
                  <button type="button" onClick={() => onDeleteConversation(conv.id)}
                    className="mr-1 hidden h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:flex"
                    aria-label={`Delete ${conv.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))
          }
        </div>
      </div>

      {profileOpen && user && (
        <div className={`fixed bottom-[78px] z-50 w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl ${open ? 'left-4' : 'left-[78px]'}`}>
          <div className="border-b border-border px-4 py-3">
            <div className="truncate text-sm font-semibold">{user.name || 'Merchant'}</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">{user.email}</div>
          </div>
          <div className="p-2">
            {profileItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setTab(item.id); setProfileOpen(false) }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={onSignOut}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}

      {user && (
        <div className={`flex flex-shrink-0 items-center gap-2.5 border-t border-border px-4 py-3.5 ${!open ? 'justify-center' : ''}`}>
          <button type="button" onClick={() => setProfileOpen((current) => !current)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl text-left outline-none transition-opacity hover:opacity-90">
            <Image src={user.avatar} alt={user.name} width={32} height={32} className="flex-shrink-0 rounded-full border border-border" unoptimized />
            <AnimatePresence>
              {open && (
                <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }} className="min-w-0 flex-1 overflow-hidden">
                  {user.name && <div className="truncate text-xs font-medium">{user.name}</div>}
                  <div className="truncate font-mono text-[10px] text-muted-foreground">{user.email}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </button>
          <AnimatePresence>
            {open && (
              <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }} className="overflow-hidden">
                <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-xl" onClick={() => setProfileOpen((current) => !current)}>
                  <ChevronRight className={`h-3.5 w-3.5 transition-transform ${profileOpen ? 'rotate-90' : ''}`} />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.aside>
  )
}

// ── Mobile header ──────────────────────────────────────────────────────────────
function MobileHeader({ storeName, onMenuOpen, onSignOut }: { storeName?: string; onMenuOpen: () => void; onSignOut: () => void }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-border bg-card/50 px-4 lg:hidden">
      <button onClick={onMenuOpen} className="text-muted-foreground hover:text-foreground"><Menu className="h-5 w-5" /></button>
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/20">
          <span className="font-mono text-[10px] font-bold text-primary">S</span>
        </div>
        <span className="font-mono text-sm font-semibold">seltra</span>
        {mounted && storeName && <span className="text-xs text-muted-foreground">· {storeName}</span>}
      </div>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onSignOut}><LogOut className="h-4 w-4" /></Button>
    </header>
  )
}

// ── Mobile sidebar drawer ──────────────────────────────────────────────────────
function MobileSidebarDrawer({
  open, onClose, user, tab, setTab, onSignOut, onNewStore,
  conversations, activeConversationId, onLoadConversation, onDeleteConversation,
}: {
  open: boolean
  onClose: () => void
  user: SidebarSharedProps['user']
  tab: string
  setTab: (t: string) => void
  onSignOut: () => void
  onNewStore: () => void
  conversations: Conversation[]
  activeConversationId?: string
  onLoadConversation: (c: Conversation) => void
  onDeleteConversation: (id: string) => void
}) {
  const [profileOpen, setProfileOpen] = useState(false)
  const profileItems = [
    { id: 'account', label: 'Account', icon: UserCircle },
    { id: 'billing', label: 'Billing', icon: CreditCard },
    { id: 'domains', label: 'Domains', icon: Globe2 },
    { id: 'help', label: 'Get Help', icon: HelpCircle },
  ]

  useEffect(() => { if (!open) setProfileOpen(false) }, [open])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" onClick={onClose} />
          <motion.div initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="fixed left-0 top-0 z-50 flex h-full w-[272px] flex-col border-r border-border bg-card lg:hidden"
          >
            <div className="flex h-[60px] items-center justify-between border-b border-border px-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/20">
                  <img src="https://res.cloudinary.com/dfmsaarli/image/upload/v1782364695/ICON_large_ngiv41.png" alt="Seltra" className="h-7 w-7 rounded-md" />
                </div>
                <span className="font-mono text-[15px] font-semibold">seltra</span>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <div className="border-b border-border p-3">
              <button onClick={() => { onNewStore(); onClose() }}
                className="flex w-full items-center gap-2.5 rounded-full border border-border bg-muted/30 px-3.5 py-2.5 text-[13px] font-medium text-foreground hover:bg-primary/5">
                <Plus className="h-[15px] w-[15px] text-primary" /> New store
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-3">
              <div className="mb-2 px-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">Workspace</div>
              <div className="space-y-0.5">
                {NAV_TABS.map((t) => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors ${tab === t.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}>
                    <t.icon className="h-[17px] w-[17px] flex-shrink-0" /> {t.label}
                  </button>
                ))}
              </div>
              <div className="mt-4 border-t border-border pt-4">
                <div className="mb-2 px-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">History</div>
                {conversations.length === 0
                  ? <p className="px-2.5 py-2 text-xs text-muted-foreground/60">Your agent conversations will appear here.</p>
                  : conversations.slice(0, 8).map((conv) => (
                    <div key={conv.id} className={`group flex items-center gap-1 rounded-xl ${activeConversationId === conv.id ? 'bg-primary/10' : ''}`}>
                      <button type="button" onClick={() => onLoadConversation(conv)}
                        className={`min-w-0 flex-1 px-2.5 py-2 text-left text-xs ${activeConversationId === conv.id ? 'text-primary' : 'text-muted-foreground'}`}>
                        <div className="truncate font-medium">{conv.title || 'Conversation'}</div>
                        <div className="font-mono text-[9px] opacity-50">{conv.updated_at ? new Date(conv.updated_at).toLocaleDateString() : 'agent chat'}</div>
                      </button>
                      <button type="button" onClick={() => onDeleteConversation(conv.id)}
                        className="mr-1 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Delete ${conv.title}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                }
              </div>
            </nav>
            {user && (
              <div className="relative flex-shrink-0 border-t border-border">
                <AnimatePresence>
                  {profileOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                      className="absolute inset-x-3 bottom-[68px] z-10 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
                    >
                      <div className="border-b border-border px-4 py-3">
                        <div className="truncate text-sm font-semibold">{user.name || 'Merchant'}</div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">{user.email}</div>
                      </div>
                      <div className="p-2">
                        {profileItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => { setTab(item.id); setProfileOpen(false) }}
                            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                          >
                            <item.icon className="h-4 w-4" />
                            <span>{item.label}</span>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="flex items-center gap-2.5 px-4 py-3.5">
                  <button
                    type="button"
                    onClick={() => setProfileOpen((current) => !current)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl text-left outline-none"
                  >
                    <Image src={user.avatar} alt={user.name} width={32} height={32} className="flex-shrink-0 rounded-full border border-border" unoptimized />
                    <div className="min-w-0 flex-1">
                      {user.name && <div className="truncate text-xs font-medium">{user.name}</div>}
                      <div className="truncate font-mono text-[10px] text-muted-foreground">{user.email}</div>
                    </div>
                    <ChevronRight className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform ${profileOpen ? 'rotate-90' : ''}`} />
                  </button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-xl" onClick={onSignOut}><LogOut className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────────
function EmptyState({ input, setInput, send, sending, name, onAttach, pendingAttachment, onClearAttachment, conversations, onLoadConversation, stores, hasHistory }: {
  input: string; setInput: (v: string) => void; send: () => void
  sending: boolean; name: string; onAttach: (f: File) => void
  pendingAttachment?: PendingAttachment | null; onClearAttachment?: () => void
  conversations: Conversation[]; onLoadConversation: (c: Conversation) => void
  stores: StoreData[]; hasHistory: boolean
}) {
  const GETTING_STARTED = [
    {
      icon: Sparkles,
      title: 'Build a skincare brand',
      desc: 'Generate a luxury store for young women in Accra and Lagos — complete with products and checkout.',
      prompt: 'A luxury skincare brand for young women in Accra and Lagos',
    },
    {
      icon: Palette,
      title: 'Launch a streetwear label',
      desc: 'AI builds your Afrocentric fashion store with Kente-inspired street silhouettes and Moolre checkout.',
      prompt: 'A contemporary African streetwear brand blending Kente with street silhouettes',
    },
    {
      icon: Zap,
      title: 'Open a wellness store',
      desc: 'Candles, self-care, and handmade goods — your agent sets everything up in seconds.',
      prompt: 'A handmade candle and wellness store for urban professionals',
    },
  ]

  const QUICK_ACTIONS = [
    {
      icon: ShoppingCart,
      title: 'Sell digital products',
      desc: 'Notion templates, e-books, courses',
      prompt: 'A digital product store selling Notion templates for entrepreneurs',
    },
    {
      icon: Megaphone,
      title: 'Launch a food brand',
      desc: 'Snacks, sauces, or meal kits with delivery',
      prompt: 'An artisan food brand selling Ghanaian snacks and sauces online',
    },
    {
      icon: Package,
      title: 'Start a fashion line',
      desc: 'Ready-to-wear, accessories, or custom pieces',
      prompt: 'A contemporary African fashion brand selling ready-to-wear clothing',
    },
  ]

  const firstName = name?.split(' ')[0] || ''
  const welcomeHeadline = firstName ? `Welcome back, ${firstName}.` : 'Welcome back.'
  const welcomeSubline = stores.length === 0
    ? 'Pick up a previous conversation, or describe a new store to get started.'
    : stores.length === 1
      ? `${stores[0]?.name || 'Your store'} is live with ${stores[0]?.products?.length ?? 0} products. What should we work on next?`
      : `You have ${stores.length} stores live. Select one, or tell your agent what to build next.`

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-8 py-12">
          <div className="mb-10">
            <h1 className="text-[28px] font-bold tracking-tight">
              {hasHistory ? welcomeHeadline : (firstName ? `Welcome to Seltra, ${firstName}.` : 'Welcome to Seltra.')}
            </h1>
            <p className="mt-1.5 text-[15px] text-muted-foreground">
              {hasHistory ? welcomeSubline : 'Describe your business and your agent builds the store, products, and checkout in seconds.'}
            </p>
          </div>

          {hasHistory ? (
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-2xl border border-border bg-card/40 p-5">
                <div className="mb-4 text-[13px] font-semibold text-foreground">Pick up where you left off</div>
                <div className="space-y-2.5">
                  {stores.length > 0 ? stores.slice(0, 4).map((store) => (
                    <div key={store.id ?? store.slug} className="rounded-2xl border border-border bg-background/60 p-3">
                      <div className="text-sm font-semibold">{store.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{store.slug}.seltra.co • {store.products?.length ?? 0} products</div>
                    </div>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-border bg-background/50 p-4 text-sm text-muted-foreground">
                      You have conversations but no active store yet. Start a new build to create one.
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-card/40 p-5">
                <div className="mb-4 text-[13px] font-semibold text-foreground">Recent chats</div>
                {conversations.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-card/20 px-5 py-6 text-center">
                    <p className="text-xs text-muted-foreground">Start a chat to brainstorm, draft, and build with your agent.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {conversations.slice(0, 4).map((conv) => (
                      <button
                        key={conv.id}
                        onClick={() => onLoadConversation(conv)}
                        className="group flex w-full items-center gap-3 rounded-2xl border border-border bg-card/40 px-4 py-3 text-left transition-all hover:border-primary/40 hover:bg-card/70"
                      >
                        <MessageSquare className="h-4 w-4 flex-shrink-0 text-muted-foreground group-hover:text-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium">{conv.title || 'Conversation'}</div>
                          <div className="font-mono text-[10px] text-muted-foreground opacity-60">
                            {conv.updated_at ? new Date(conv.updated_at).toLocaleDateString() : 'agent chat'}
                          </div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
              <div>
                <div className="mb-4">
                  <span className="text-[13px] font-semibold text-foreground">Getting started</span>
                </div>
                <div className="space-y-2.5">
                  {GETTING_STARTED.map((item) => (
                    <button
                      key={item.title}
                      onClick={() => setInput(item.prompt)}
                      className="group flex w-full items-start gap-3.5 rounded-2xl border border-border bg-card/40 p-4 text-left transition-all hover:border-primary/40 hover:bg-card/70"
                    >
                      <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:bg-primary/5 group-hover:text-primary">
                        <item.icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-semibold">{item.title}</span>
                          <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-4">
                  <span className="text-[13px] font-semibold text-foreground">Quick launches</span>
                </div>
                <div className="space-y-2.5">
                  {QUICK_ACTIONS.map((item) => (
                    <button
                      key={item.title}
                      onClick={() => setInput(item.prompt)}
                      className="group flex w-full items-center gap-3.5 rounded-2xl border border-border bg-card/40 p-4 text-left transition-all hover:border-primary/40 hover:bg-card/70"
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:bg-primary/5 group-hover:text-primary">
                        <item.icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-semibold">{item.title}</span>
                          <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="mt-6">
                  <div className="mb-3 text-[13px] font-semibold">Recent chats</div>
                  {conversations.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border bg-card/20 px-5 py-6 text-center">
                      <p className="text-xs text-muted-foreground">Start a chat to brainstorm, draft, and build with your agent.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {conversations.slice(0, 4).map((conv) => (
                        <button
                          key={conv.id}
                          onClick={() => onLoadConversation(conv)}
                          className="group flex w-full items-center gap-3 rounded-2xl border border-border bg-card/40 px-4 py-3 text-left transition-all hover:border-primary/40 hover:bg-card/70"
                        >
                          <MessageSquare className="h-4 w-4 flex-shrink-0 text-muted-foreground group-hover:text-primary" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium">{conv.title || 'Conversation'}</div>
                            <div className="font-mono text-[10px] text-muted-foreground opacity-60">
                              {conv.updated_at ? new Date(conv.updated_at).toLocaleDateString() : 'agent chat'}
                            </div>
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-border bg-card/40 backdrop-blur">
        <div className="mx-auto max-w-[900px] px-8 py-4">
          <ChatInput
            input={input}
            setInput={setInput}
            send={send}
            sending={sending}
            onAttach={onAttach}
            pendingAttachment={pendingAttachment}
            onClearAttachment={onClearAttachment}
          />
        </div>
      </div>
    </div>
  )
}

// ── Chat input ─────────────────────────────────────────────────────────────────
function ChatInput({ input, setInput, send, sending, onAttach, compact = false, pendingAttachment, onClearAttachment }: {
  input: string; setInput: (v: string) => void; send: () => void
  sending: boolean; onAttach: (f: File) => void; compact?: boolean
  pendingAttachment?: PendingAttachment | null
  onClearAttachment?: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, compact ? 120 : 160)}px`
  }, [input, compact])

  return (
    <div className={compact ? 'border-t border-border bg-card/40 backdrop-blur p-3' : ''}>
      {pendingAttachment && (
        <div className="mb-3 flex px-1">
          <div className="group relative h-16 w-16 overflow-hidden rounded-xl border border-border bg-muted">
            <img
              src={pendingAttachment.previewUrl}
              alt={pendingAttachment.name}
              className="h-full w-full object-cover"
            />
            {(pendingAttachment.uploading || pendingAttachment.error) && (
              <div className={`absolute inset-0 grid place-items-center px-1 text-center text-[10px] font-medium ${pendingAttachment.error ? 'bg-destructive/80 text-destructive-foreground' : 'bg-black/45 text-white'}`}>
                {pendingAttachment.error ? 'Failed' : 'Uploading'}
              </div>
            )}
            <button
              type="button"
              onClick={onClearAttachment}
              className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white opacity-90 transition-opacity hover:opacity-100"
              aria-label="Remove attachment"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 rounded-[28px] border border-border bg-card/60 px-3 py-2 shadow-sm transition-all focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
        <label className="flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-primary">
          <Plus className="h-[18px] w-[18px]" />
          <input type="file" className="hidden" accept="image/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onAttach(f); e.target.value = '' }} />
        </label>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          rows={1}
          wrap="off"
          placeholder={pendingAttachment ? 'Describe what to do with this image...' : 'Message your agent...'}
          className="flex-1 resize-none bg-transparent py-1.5 px-1 text-sm outline-none placeholder:text-muted-foreground leading-[1.5] overflow-x-auto whitespace-pre composer-textarea"
          style={{ minHeight: 36, maxHeight: compact ? 120 : 160, overflowY: 'auto' }}
        />
        <button
          onClick={send} disabled={sending || pendingAttachment?.uploading || (!input.trim() && !pendingAttachment)}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-35"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ── Tab content router ─────────────────────────────────────────────────────────
function TabContent({
  tab, activeStore, stores, onSelectStore, onStoreDeleted, onStoreUpdated, reloadStores, user, credits,
}: {
  tab: string; activeStore: StoreData | null; stores: StoreData[]
  onSelectStore: (s: StoreData) => void; onStoreDeleted: (id: string) => void
  onStoreUpdated: (s: StoreData) => void; reloadStores: () => Promise<void>
  user: { email: string; name: string; avatar: string; joinedAt?: string } | null
  credits: { used: number; limit: number; resetsAt: string } | null
}) {
  if (tab === 'store') return <StoreTab stores={stores} activeStore={activeStore} onSelectStore={onSelectStore} onStoreDeleted={onStoreDeleted} reloadStores={reloadStores} />
  if (tab === 'mission') return <MissionControlTab activeStore={activeStore} />
  if (tab === 'orders') return <OrdersTab activeStore={activeStore} />
  if (tab === 'sales') return <SalesTab activeStore={activeStore} />
  if (tab === 'payments') return <PaymentsTab activeStore={activeStore} />
  if (tab === 'products') return <ProductsTab activeStore={activeStore} />
  if (tab === 'invoices') return <InvoicesTab activeStore={activeStore} />
  if (tab === 'customers' || tab === 'marketing') return <CustomersTab activeStore={activeStore} mode={tab} />
  if (tab === 'analytics') return <AnalyticsTab activeStore={activeStore} />
  if (['account', 'billing', 'domains', 'help'].includes(tab)) {
    return (
      <ProfileCenterTab
        mode={tab as 'account' | 'billing' | 'domains' | 'help'}
        activeStore={activeStore}
        user={user}
        stores={stores}
        credits={credits}
        onStoreUpdated={onStoreUpdated}
      />
    )
  }
  return null
}

// ── Shared primitives ──────────────────────────────────────────────────────────
function PageHeader({ tab, title, subtitle }: { tab: string; title: string; subtitle: string }) {
  return (
    <div className="mb-8">
      <div className="mb-2 font-mono text-[11px] text-primary">{`// ${tab}`}</div>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/40 p-5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2.5 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`rounded-full border px-2.5 py-1 font-mono text-[10px] ${statusClass(status)}`}>{status}</span>
}

function GridHeader({ cols, items }: { cols: string; items: string[] }) {
  return (
    <div className={`grid ${cols} gap-3 border-b border-border px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground`}>
      {items.map((item) => <div key={item}>{item}</div>)}
    </div>
  )
}

function EmptyRows({ text }: { text: string }) {
  return <div className="p-10 text-center text-sm text-muted-foreground">{text}</div>
}

function PaginationControls({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
      <span>Page {page} of {pages}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="h-8 rounded-full" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </Button>
        <Button size="sm" variant="outline" className="h-8 rounded-full" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
function OrderList({ rows, amountField }: { rows: OrderRecord[]; amountField?: 'merchant' | 'total' }) {
  return (
    <>
      <GridHeader cols="grid-cols-[.8fr_1.4fr_.7fr_.8fr_.8fr]" items={['order ref', 'customer', 'items', 'amount', 'date']} />
      <div className="divide-y divide-border">
        {rows.map((order) => {
          const ref = order.paystackRef ?? order.id
          return (
            <div key={order.id} className="grid grid-cols-[.8fr_1.4fr_.7fr_.8fr_.8fr] gap-3 px-5 py-4 text-sm">
              <div className="min-w-0 truncate font-mono text-xs" title={ref}>{shortOrderRef(ref)}</div>
              <div className="min-w-0 truncate">{order.customerName || order.customerEmail}</div>
              <div>{order.items?.length ?? 0} items</div>
              <div>{money(amountField === 'merchant' ? order.merchantAmount ?? order.totalAmount : order.totalAmount, order.currency)}</div>
              <div className="text-muted-foreground">{new Date(order.createdAt).toLocaleDateString()}</div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── Tab components ─────────────────────────────────────────────────────────────
function MissionControlTab({ activeStore }: { activeStore: StoreData | null }) {
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const tenantId = storeIdOf(activeStore)
      if (!tenantId) { setOrders([]); setCustomers([]); setInvoices([]); return }
      const search = new URLSearchParams({ page: '1', perPage: '100', tenantId })
      const [o, c, i] = await Promise.all([
        apiFetch<Paginated<OrderRecord>>(`/api/v1/orders?${search.toString()}`),
        apiFetch<Paginated<CustomerRecord>>(`/api/v1/payment/customers?tenantId=${encodeURIComponent(tenantId)}&page=1&perPage=100`),
        apiFetch<Paginated<InvoiceRecord>>(`/api/v1/invoices?tenantId=${encodeURIComponent(tenantId)}&page=1&perPage=100`),
      ])
      if (cancelled) return
      setOrders(o.data?.data ?? [])
      setCustomers(c.data?.data ?? [])
      setInvoices(i.data?.data ?? [])
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore])

  const paid = orders.filter(hasConfirmedPayment)
  const pending = orders.filter((order) => order.status === 'pending')
  const revenue = paid.reduce((s, o) => s + Number(o.merchantAmount ?? o.totalAmount ?? 0), 0)
  const dueInvoices = invoices.filter((invoice) => !/paid/i.test(invoice.status))
  const topProduct = useMemo(() => {
    const counts = new Map<string, number>()
    orders.forEach((order) => order.items?.forEach((item) => {
      const name = item.productName || item.productId || 'Product'
      counts.set(name, (counts.get(name) ?? 0) + Number(item.quantity || 1))
    }))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'No sales yet'
  }, [orders])
  const optedIn = customers.filter((c) => c.marketingOptIn).length

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <PageHeader tab="home" title="Mission Control" subtitle="Revenue, fulfillment, invoices, customer signals, and agent recommendations." />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard label="today revenue" value={money(revenue)} />
          <MetricCard label="pending orders" value={String(pending.length)} />
          <MetricCard label="customers" value={String(customers.length)} />
          <MetricCard label="invoices due" value={String(dueInvoices.length)} />
        </div>
        <div className="mt-6 grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
          <section className="overflow-hidden rounded-2xl border border-border bg-card/30">
            <div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">Latest orders</h2></div>
            {orders.length === 0 ? <EmptyRows text={activeStore ? 'Orders will appear here after checkout.' : 'Select or create a store first.'} /> : <OrderList rows={orders.slice(0, 5)} />}
          </section>
          <section className="rounded-2xl border border-border bg-card/30 p-5">
            <h2 className="text-sm font-semibold">Agent suggestions</h2>
            <div className="mt-4 space-y-3">
              {[pending.length ? `${pending.length} pending orders need fulfillment.` : 'No pending orders right now.', dueInvoices.length ? `${dueInvoices.length} invoices are still open.` : 'Invoices are clear.', optedIn ? `${optedIn} customers can receive marketing updates.` : 'Collect opt-ins at checkout before bulk marketing.'].map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-xl border border-border bg-background/60 p-3 text-sm">
                  <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" /><span className="leading-relaxed">{item}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-xl border border-border bg-background/60 p-3 text-sm">
              <div className="font-mono text-[10px] uppercase text-muted-foreground">top product signal</div>
              <div className="mt-1 font-medium">{topProduct}</div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function InvoicesTab({ activeStore }: { activeStore: StoreData | null }) {
  const [rows, setRows] = useState<InvoiceRecord[]>([])
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [form, setForm] = useState({
    customerName: '',
    customerEmail: '',
    dueDate: '',
    tax: '',
    discount: '',
    items: [{ description: '', quantity: '1', unitPrice: '' }],
  })
  const tenantId = storeIdOf(activeStore)
  const pageSize = 6
  const visibleRows = rows

  const load = useCallback(async () => {
    if (!tenantId) { setRows([]); setTotal(0); return }
    const { data, error } = await apiFetch<Paginated<InvoiceRecord>>(`/api/v1/invoices?tenantId=${encodeURIComponent(tenantId)}&page=${page}&perPage=${pageSize}`)
    if (error) { toast.error(error); return }
    setRows(data?.data ?? [])
    setTotal(data?.total ?? 0)
  }, [tenantId, page])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setPage(1) }, [tenantId])

  const create = async () => {
    if (!tenantId || saving) return
    const items = form.items
      .map((item) => ({ description: item.description || 'Invoice item', quantity: Number(item.quantity || 1), unitPrice: Number(item.unitPrice || 0) }))
      .filter((item) => item.unitPrice > 0 && item.quantity > 0)
    if (!form.customerName.trim() || !form.customerEmail.trim() || items.length === 0) {
      toast.error('Customer name, email, and at least one priced item are required')
      return
    }
    setSaving(true)
    const { error } = await apiFetch<InvoiceRecord>('/api/v1/invoices', {
      method: 'POST',
      body: JSON.stringify({
        tenantId,
        customerName: form.customerName,
        customerEmail: form.customerEmail,
        dueDate: form.dueDate || undefined,
        tax: Number(form.tax || 0),
        discount: Number(form.discount || 0),
        items,
      }),
    })
    setSaving(false)
    if (error) { toast.error(error); return }
    setForm({ customerName: '', customerEmail: '', dueDate: '', tax: '', discount: '', items: [{ description: '', quantity: '1', unitPrice: '' }] })
    setModalOpen(false)
    toast.success('Invoice created')
    setPage(1)
    void load()
  }

  const updateItem = (index: number, key: 'description' | 'quantity' | 'unitPrice', value: string) => {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, idx) => idx === index ? { ...item, [key]: value } : item),
    }))
  }

  const addItem = () => setForm((current) => ({ ...current, items: [...current.items, { description: '', quantity: '1', unitPrice: '' }] }))
  const removeItem = (index: number) => setForm((current) => ({ ...current, items: current.items.filter((_, idx) => idx !== index) }))

  const runInvoiceAction = async (id: string, action: 'send' | 'paid') => {
    const path = action === 'send' ? `/api/v1/invoices/${encodeURIComponent(id)}/send` : `/api/v1/invoices/${encodeURIComponent(id)}/paid`
    const { error } = await apiFetch<InvoiceRecord>(path, { method: action === 'send' ? 'POST' : 'PATCH', body: JSON.stringify({ tenantId }) })
    if (error) { toast.error(error); return }
    toast.success(action === 'send' ? 'Invoice sent' : 'Invoice marked paid')
    void load()
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <PageHeader tab="invoices" title="Invoices" subtitle="Create, send, download, and mark invoices as paid." />
          <Button onClick={() => setModalOpen(true)} disabled={!tenantId} className="rounded-full"><Plus className="h-4 w-4" /> Create invoice</Button>
        </div>
        <section className="overflow-hidden rounded-2xl border border-border bg-card/30">
          <div className="hidden md:block">
            <GridHeader cols="grid-cols-[.8fr_1.3fr_.8fr_.7fr_.8fr_1fr]" items={['number', 'customer', 'total', 'status', 'due', 'actions']} />
          </div>
          {rows.length === 0 ? <EmptyRows text={activeStore ? 'No invoices yet.' : 'Select or create a store first.'} /> : (
            <div className="divide-y divide-border">
              {visibleRows.map((invoice) => (
                <div key={invoice.id} className="grid gap-3 px-4 py-4 text-sm md:grid-cols-[.8fr_1.3fr_.8fr_.7fr_.8fr_1fr] md:px-5">
                  <div className="flex items-center justify-between gap-3 md:block">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground md:hidden">number</span>
                    <span className="font-mono text-xs">{invoice.number}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{invoice.customerName}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{invoice.customerEmail}</div>
                  </div>
                  <div className="flex items-center justify-between gap-3 md:block">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground md:hidden">total</span>
                    <span className="font-semibold">{money(invoice.total, invoice.currency)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 md:block">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground md:hidden">status</span>
                    <StatusBadge status={invoice.status} />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-muted-foreground md:block">
                    <span className="font-mono text-[10px] uppercase md:hidden">due</span>
                    <span>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'On receipt'}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap">
                    <Button size="sm" variant="outline" className="h-8 rounded-full px-2" onClick={() => window.open(`${API_BASE}${invoice.pdfUrl || `/api/v1/invoices/${invoice.number}/pdf`}`, '_blank')}>PDF</Button>
                    <Button size="sm" variant="outline" className="h-8 rounded-full px-2" onClick={() => void runInvoiceAction(invoice.id, 'send')}>Send</Button>
                    <Button size="sm" className="h-8 rounded-full px-2" onClick={() => void runInvoiceAction(invoice.id, 'paid')}>Paid</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <PaginationControls page={page} total={total} pageSize={pageSize} onPage={setPage} />
        </section>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm">
          <div className="flex min-h-full items-start justify-center p-4 sm:items-center">
            <div className="my-8 w-full max-w-xl overflow-x-hidden rounded-2xl border border-border bg-card p-4 shadow-2xl sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold">Create invoice</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">Add one or more invoice items, then send or download it from the list.</p>
                </div>
                <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>

              <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-medium text-muted-foreground">Customer name
                  <input value={form.customerName} onChange={(e) => setForm((current) => ({ ...current, customerName: e.target.value }))} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
                </label>
                <label className="grid gap-1 text-xs font-medium text-muted-foreground">Customer email
                  <input type="email" value={form.customerEmail} onChange={(e) => setForm((current) => ({ ...current, customerEmail: e.target.value }))} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
                </label>
              </div>

              <div className="mt-2.5 grid grid-cols-3 gap-2.5">
                <label className="grid gap-1 text-xs font-medium text-muted-foreground">Due date
                  <input type="date" value={form.dueDate} onChange={(e) => setForm((current) => ({ ...current, dueDate: e.target.value }))} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
                </label>
                <label className="grid gap-1 text-xs font-medium text-muted-foreground">Tax
                  <div className="relative">
                    <input type="number" min="0" value={form.tax} onChange={(e) => setForm((current) => ({ ...current, tax: e.target.value }))} className="w-full rounded-lg border border-border bg-background py-1.5 pl-2.5 pr-6 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                </label>
                <label className="grid gap-1 text-xs font-medium text-muted-foreground">Discount
                  <div className="relative">
                    <input type="number" min="0" value={form.discount} onChange={(e) => setForm((current) => ({ ...current, discount: e.target.value }))} className="w-full rounded-lg border border-border bg-background py-1.5 pl-2.5 pr-6 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                </label>
              </div>

              <div className="mt-5 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line items</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <div className="mt-2.5 space-y-2">
                {form.items.map((item, index) => (
                  <div key={index} className="grid grid-cols-2 gap-1.5 sm:grid-cols-[minmax(0,1fr)_3.5rem_5.5rem_1.75rem] sm:items-end">
                    <label className="grid gap-1 text-[11px] text-muted-foreground">
                      {index === 0 && 'Item'}
                      <input value={item.description} onChange={(e) => updateItem(index, 'description', e.target.value)} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
                    </label>
                    <label className="grid gap-1 text-[11px] text-muted-foreground">
                      {index === 0 && 'Qty'}
                      <input type="number" min="1" value={item.quantity} onChange={(e) => updateItem(index, 'quantity', e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
                    </label>
                    <label className="grid gap-1 text-[11px] text-muted-foreground">
                      {index === 0 && 'Unit price'}
                      <div className="relative">
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₵</span>
                        <input type="number" min="0" value={item.unitPrice} onChange={(e) => updateItem(index, 'unitPrice', e.target.value)} className="w-full rounded-lg border border-border bg-background py-1.5 pl-5 pr-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
                      </div>
                    </label>
                    <Button type="button" variant="outline" size="sm" className="h-8 w-8 rounded-lg p-0" disabled={form.items.length === 1} onClick={() => removeItem(index)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={addItem}><Plus className="h-3.5 w-3.5" /> Add item</Button>
              </div>

              <Button onClick={() => void create()} disabled={!tenantId || saving} className="mt-5 w-full rounded-full">{saving ? 'Creating...' : 'Create invoice'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StoreTab({ stores, activeStore, onSelectStore, onStoreDeleted, reloadStores }: {
  stores: StoreData[]; activeStore: StoreData | null
  onSelectStore: (s: StoreData) => void; onStoreDeleted: (id: string) => void; reloadStores: () => Promise<void>
}) {
  const [storeToDelete, setStoreToDelete] = useState<StoreData | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [storePage, setStorePage] = useState(1)
  const storePageSize = 6
  const canDelete = confirmName.trim() === storeToDelete?.name
  const visibleStores = activeStore && !stores.some((s) => s.id === activeStore.id || s.slug === activeStore.slug) ? [activeStore, ...stores] : stores
  const paginatedStores = visibleStores.slice((storePage - 1) * storePageSize, storePage * storePageSize)

  useEffect(() => { setStorePage(1) }, [activeStore, stores.length])

  const confirmDelete = async () => {
    if (!storeToDelete || !canDelete || deleting) return
    const id = storeToDelete.id ?? storeToDelete.slug
    setDeleting(true)
    const { error } = await apiFetch<{ success: boolean }>(`/api/v1/seltra/store/${encodeURIComponent(id)}`, { method: 'DELETE' })
    setDeleting(false)
    if (error) { toast.error(error); return }
    onStoreDeleted(id); setStoreToDelete(null); setConfirmName('')
    toast.success(`${storeToDelete.name} deleted`)
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-start justify-between gap-4">
          <PageHeader tab="store" title="Store" subtitle="Your merchant storefronts and generated catalogs." />
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => void reloadStores()}>Refresh</Button>
        </div>
        {visibleStores.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/30 p-12 text-center">
            <p className="text-sm text-muted-foreground">Launch a store from Home to start customizing.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {paginatedStores.map((store) => {
              const providers = (store as StoreData & { paymentProviders?: { provider: string }[] }).paymentProviders?.map((p) => p.provider).join(' / ') || 'Moolre'
              const active = activeStore?.id === store.id || activeStore?.slug === store.slug
              return (
                <div key={store.id ?? store.slug} className={`rounded-2xl border p-5 transition-colors hover:border-primary/50 ${active ? 'border-primary/60 bg-primary/5' : 'border-border bg-card/40'}`}>
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <button type="button" onClick={() => onSelectStore(store)} className="min-w-0 flex-1 text-left">
                      <h2 className="truncate text-[15px] font-semibold">{store.name}</h2>
                      <p className="font-mono text-[11px] text-primary">{store.slug}.seltra.co</p>
                    </button>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] text-muted-foreground">{(store as StoreData & { status?: string }).status ?? 'active'}</span>
                      <Button type="button" variant="ghost" size="icon" onClick={() => { setStoreToDelete(store); setConfirmName('') }}
                        className="h-8 w-8 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete ${store.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <button type="button" onClick={() => onSelectStore(store)} className="w-full text-left">
                    <p className="line-clamp-2 text-sm text-muted-foreground">{store.targetAudience || store.businessType || 'AI-generated Seltra storefront'}</p>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-xl bg-background/60 p-2.5">
                        <div className="font-mono text-[10px] text-muted-foreground">products</div>
                        <div className="mt-0.5 font-semibold">{Array.isArray(store.products) ? store.products.length : 0}</div>
                      </div>
                      <div className="rounded-xl bg-background/60 p-2.5">
                        <div className="font-mono text-[10px] text-muted-foreground">payments</div>
                        <div className="mt-0.5 truncate font-semibold">{providers}</div>
                      </div>
                    </div>
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <PaginationControls page={storePage} total={visibleStores.length} pageSize={storePageSize} onPage={setStorePage} />
      </div>
      {storeToDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <h2 className="text-lg font-semibold">Delete {storeToDelete.name}</h2>
            <p className="mt-2 text-sm text-muted-foreground">This removes the storefront, catalog, images, payment setup, and orders. To confirm, type the store name exactly.</p>
            <div className="mt-4 rounded-xl border border-border bg-muted/30 px-3 py-2 font-mono text-sm">{storeToDelete.name}</div>
            <label className="mt-4 grid gap-1.5 text-sm">Store name
              <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={storeToDelete.name}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" className="rounded-full" onClick={() => { setStoreToDelete(null); setConfirmName('') }} disabled={deleting}>Keep store</Button>
              <Button type="button" variant="destructive" className="rounded-full" onClick={() => void confirmDelete()} disabled={!canDelete || deleting}>{deleting ? 'Deleting…' : 'Delete store'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Order detail modal ──────────────────────────────────────────────────────────
function OrderDetailModal({ order, productImages, updating, onStatusChange, onClose }: {
  order: OrderRecord
  productImages: Record<string, string>
  updating: boolean
  onStatusChange: (status: string) => void
  onClose: () => void
}) {
  const items = Array.isArray(order.items) ? order.items : []
  const isPaid = hasConfirmedPayment(order)
  const shippingParts = [order.shippingAddress, order.shippingCity, order.shippingCountry].filter(Boolean)

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm">
      <div className="flex min-h-full items-start justify-center p-3 sm:items-center sm:p-4">
        <div className="my-4 w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl sm:my-8">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">Order {order.paystackRef ?? order.id}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleString()}</p>
            </div>
            <button type="button" onClick={onClose} className="flex-shrink-0 rounded-xl p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[75vh] overflow-y-auto px-5 py-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-background/60 p-3">
                <div className="font-mono text-[10px] uppercase text-muted-foreground">Customer</div>
                <div className="mt-1 truncate text-sm font-medium">{order.customerName || 'Unnamed customer'}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">{order.customerEmail}</div>
                {order.customerPhone && <div className="mt-1 font-mono text-xs text-muted-foreground">{order.customerPhone}</div>}
              </div>
              <div className="rounded-xl border border-border bg-background/60 p-3">
                <div className="font-mono text-[10px] uppercase text-muted-foreground">Shipping</div>
                <div className="mt-1 text-sm">{shippingParts.length ? shippingParts.join(', ') : 'No shipping address provided'}</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatusBadge status={isPaid ? 'paid' : 'awaiting'} />
              <select
                value={order.status}
                disabled={updating}
                onChange={(e) => onStatusChange(e.target.value)}
                className="h-8 rounded-lg border border-border bg-background px-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                {!ORDER_STATUSES.includes(order.status) && <option value={order.status}>{order.status}</option>}
                {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="font-mono text-[11px] text-muted-foreground">Ref: {order.paystackRef ?? order.id}</span>
            </div>

            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items ({items.length})</div>
              <div className="space-y-2">
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No item details recorded for this order.</p>
                ) : items.map((item, index) => {
                  const image = item.productId ? productImages[item.productId] : undefined
                  const lineTotal = Number(item.price || 0) * Number(item.quantity || 1)
                  return (
                    <div key={`${item.productId ?? item.productName ?? 'item'}-${index}`} className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
                      <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-card/60">
                        {image ? (
                          <img src={image} alt={item.productName || 'Product'} className="h-full w-full object-cover" />
                        ) : (
                          <div className="grid h-full w-full place-items-center text-muted-foreground/30">
                            <Package className="h-6 w-6" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{item.productName || 'Product'}</div>
                        <div className="text-xs text-muted-foreground">Qty {item.quantity} · {money(item.price, order.currency)} each</div>
                      </div>
                      <div className="flex-shrink-0 text-sm font-semibold">{money(lineTotal, order.currency)}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-5 space-y-1.5 rounded-xl border border-border bg-background/60 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Order total</span>
                <span className="font-semibold">{money(order.totalAmount, order.currency)}</span>
              </div>
              {order.seltraFee != null && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Seltra fee</span>
                  <span>{money(order.seltraFee, order.currency)}</span>
                </div>
              )}
              {order.merchantAmount != null && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Merchant proceeds</span>
                  <span>{money(order.merchantAmount, order.currency)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function OrdersTab({ activeStore }: { activeStore: StoreData | null }) {
  const [rows, setRows] = useState<OrderRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [viewingOrder, setViewingOrder] = useState<OrderRecord | null>(null)
  const [productImages, setProductImages] = useState<Record<string, string>>({})
  const pageSize = 8
  const visibleRows = rows

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const search = new URLSearchParams({ page: String(page), perPage: String(pageSize) })
      const tenantId = storeIdOf(activeStore)
      if (tenantId) search.set('tenantId', tenantId)
      const { data } = await apiFetch<Paginated<OrderRecord>>(`/api/v1/orders?${search.toString()}`)
      if (!cancelled) { setRows(data?.data ?? []); setTotal(data?.total ?? 0); setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore, page])
  useEffect(() => { setPage(1) }, [activeStore])

  // Load product images once per store so the order detail modal can show product photos.
  useEffect(() => {
    let cancelled = false
    const loadImages = async () => {
      const tenantId = storeIdOf(activeStore)
      if (!tenantId) { setProductImages({}); return }
      const { data } = await apiFetch<Paginated<ProductRecord>>(`/api/v1/seltra/store/${encodeURIComponent(tenantId)}/products?page=1&perPage=500`)
      if (cancelled) return
      const map: Record<string, string> = {}
      ;(data?.data ?? []).forEach((product) => {
        const image = product.images?.find((i) => i.isPrimary)?.url ?? product.images?.[0]?.url
        if (image) map[product.id] = image
      })
      setProductImages(map)
    }
    void loadImages()
    return () => { cancelled = true }
  }, [activeStore])

  const updateOrderStatus = async (order: OrderRecord, status: string) => {
    setUpdatingId(order.id)
    const { data, error } = await apiFetch<OrderRecord>(`/api/v1/orders/${encodeURIComponent(order.id)}/status`, {
      method: 'PATCH', body: JSON.stringify({ status, tenantId: storeIdOf(activeStore) }),
    })
    setUpdatingId(null)
    if (error) { toast.error(error); return }
    setRows((c) => c.map((item) => item.id === order.id ? { ...item, status: data?.status ?? status } : item))
    setViewingOrder((current) => current && current.id === order.id ? { ...current, status: data?.status ?? status } : current)
    toast.success('Order status updated')
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <PageHeader tab="orders" title="Orders" subtitle="Every checkout your agent has processed." />
        <section className="overflow-hidden rounded-2xl border border-border bg-card/30">
          <div className="hidden md:block">
            <GridHeader cols="grid-cols-[.9fr_1.3fr_.6fr_.8fr_1.1fr_.7fr]" items={['order ref', 'customer', 'items', 'amount', 'status', '']} />
          </div>
          {loading ? <EmptyRows text="Loading orders…" /> : rows.length === 0 ? (
            <EmptyRows text={activeStore ? 'Orders appear after your first sale.' : 'Select or create a store first.'} />
          ) : (
            <div className="divide-y divide-border">
              {visibleRows.map((order) => {
                const ref = order.paystackRef ?? order.id
                return (
                  <div key={order.id} className="px-4 py-4 text-sm md:grid md:grid-cols-[.9fr_1.3fr_.6fr_.8fr_1.1fr_.7fr] md:items-center md:gap-3 md:px-5">
                    {/* ── Mobile card layout ── */}
                    <div className="flex items-start justify-between gap-3 md:hidden">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{order.customerName || order.customerEmail}</div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">{order.customerEmail}</div>
                      </div>
                      <span className="flex-shrink-0 font-mono text-xs text-muted-foreground" title={ref}>{shortOrderRef(ref)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground md:hidden">
                      <span>{order.items?.length ?? 0} items</span>
                      <span className="font-semibold text-foreground">{money(order.totalAmount, order.currency)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 md:hidden">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={hasConfirmedPayment(order) ? 'paid' : 'awaiting'} />
                        <select value={order.status} disabled={updatingId === order.id}
                          onChange={(e) => void updateOrderStatus(order, e.target.value)}
                          className="h-8 rounded-lg border border-border bg-background px-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50">
                          {!ORDER_STATUSES.includes(order.status) && <option value={order.status}>{order.status}</option>}
                          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-full px-3" onClick={() => setViewingOrder(order)}>
                        <Eye className="h-3.5 w-3.5" /> View
                      </Button>
                    </div>

                    {/* ── Desktop grid cells ── */}
                    <div className="hidden min-w-0 md:block">
                      <span className="truncate font-mono text-xs" title={ref}>{shortOrderRef(ref)}</span>
                    </div>
                    <div className="hidden min-w-0 md:block">
                      <div className="truncate font-medium">{order.customerName || order.customerEmail}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">{order.customerEmail}</div>
                    </div>
                    <div className="hidden md:block">{order.items?.length ?? 0} items</div>
                    <div className="hidden font-semibold md:block">{money(order.totalAmount, order.currency)}</div>
                    <div className="hidden min-w-0 md:flex md:flex-col md:items-start md:gap-1.5">
                      <StatusBadge status={hasConfirmedPayment(order) ? 'paid' : 'awaiting'} />
                      <select value={order.status} disabled={updatingId === order.id}
                        onChange={(e) => void updateOrderStatus(order, e.target.value)}
                        className="h-8 w-full max-w-[130px] rounded-lg border border-border bg-background px-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50">
                        {!ORDER_STATUSES.includes(order.status) && <option value={order.status}>{order.status}</option>}
                        {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="hidden md:flex md:items-center md:justify-end">
                      <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-full px-3" onClick={() => setViewingOrder(order)}>
                        <Eye className="h-3.5 w-3.5" /> View
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <PaginationControls page={page} total={total} pageSize={pageSize} onPage={setPage} />
        </section>
      </div>
      {viewingOrder && (
        <OrderDetailModal
          order={viewingOrder}
          productImages={productImages}
          updating={updatingId === viewingOrder.id}
          onStatusChange={(status) => void updateOrderStatus(viewingOrder, status)}
          onClose={() => setViewingOrder(null)}
        />
      )}
    </div>
  )
}

function SalesTab({ activeStore }: { activeStore: StoreData | null }) {
  const [range, setRange] = useState('Last 7 days')
  const [rows, setRows] = useState<OrderRecord[]>([])
  const [ledgerBalance, setLedgerBalance] = useState(0)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 8

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const tenantId = storeIdOf(activeStore)
      const search = new URLSearchParams({ page: String(page), perPage: String(pageSize) })
      if (tenantId) search.set('tenantId', tenantId)
      const [s, l] = await Promise.all([
        apiFetch<Paginated<OrderRecord>>(`/api/v1/payment/sales?${search.toString()}`),
        apiFetch<Ledger>(`/api/v1/payment/ledger${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`),
      ])
      if (cancelled) return
      setRows(s.data?.data ?? [])
      setTotal(s.data?.total ?? 0)
      setLedgerBalance(Number(l.data?.balance ?? 0))
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore, page])
  useEffect(() => { setPage(1) }, [activeStore])

  const filteredRows = useMemo(() => {
    if (range === 'All time') return rows
    const days = range === 'Last 7 days' ? 7 : range === '30 days' ? 30 : 90
    const cutoff = Date.now() - days * 86400000
    return rows.filter((o) => new Date(o.createdAt).getTime() >= cutoff)
  }, [range, rows])
  const revenue = filteredRows.reduce((s, o) => s + Number(o.merchantAmount ?? o.totalAmount ?? 0), 0)
  const average = filteredRows.length ? revenue / filteredRows.length : 0
  const storeUrl = storefrontUrl(activeStore)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <PageHeader tab="sales" title="Sales" subtitle="Paid orders, revenue, and merchant proceeds." />
          <div className="flex flex-wrap gap-2">
            {['Last 7 days', '30 days', '90 days', 'All time'].map((item) => (
              <Button key={item} size="sm" className="rounded-full" variant={range === item ? 'default' : 'outline'} onClick={() => setRange(item)}>{item}</Button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Total Revenue" value={money(revenue)} />
          <MetricCard label="Orders Count" value={String(filteredRows.length)} />
          <MetricCard label="Avg Order Value" value={money(average)} />
          <MetricCard label="Pending Disbursement" value={money(ledgerBalance)} />
        </div>
        <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card/30">
          {filteredRows.length === 0 ? (
            <div className="grid min-h-72 place-items-center px-6 py-10 text-center">
              <div>
                <p className="font-medium">Your first sale is coming. Share your store link to get started.</p>
                {storeUrl && (
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    <code className="rounded-xl border border-border bg-background px-2 py-1 text-xs">{storeUrl}</code>
                    <Button size="sm" variant="outline" className="rounded-full" onClick={() => void navigator.clipboard.writeText(storeUrl).then(() => toast.success('Store URL copied'))}>
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : <OrderList rows={filteredRows} amountField="merchant" />}
          <PaginationControls page={page} total={total} pageSize={pageSize} onPage={setPage} />
        </section>
      </div>
    </div>
  )
}

function PaymentsTab({ activeStore }: { activeStore: StoreData | null }) {
  const [balance, setBalance] = useState(0)
  const [currency, setCurrency] = useState('GHS')
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [step, setStep] = useState<'amount' | 'otp'>('amount')
  const [amount, setAmount] = useState('')
  const [disbursementId, setDisbursementId] = useState('')
  const [otp, setOtp] = useState('')
  const [processing, setProcessing] = useState(false)
  const [txPage, setTxPage] = useState(1)
  const [txTotal, setTxTotal] = useState(0)
  const txPageSize = 8

  const loadLedger = useCallback(async () => {
      const tenantId = storeIdOf(activeStore)
      const search = new URLSearchParams({ page: String(txPage), perPage: String(txPageSize) })
      if (tenantId) search.set('tenantId', tenantId)
      const { data } = await apiFetch<Ledger>(`/api/v1/payment/ledger?${search.toString()}`)
      if (!data) return
      setBalance(Number(data.balance ?? 0)); setCurrency(data.currency ?? 'GHS'); setTransactions(data.transactions ?? []); setTxTotal(data.total ?? 0)
  }, [activeStore, txPage])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      await loadLedger()
      if (cancelled) return
    }
    void load()
    return () => { cancelled = true }
  }, [loadLedger])
  useEffect(() => { setTxPage(1) }, [activeStore])

  const requestDisbursement = async () => {
    const tenantId = storeIdOf(activeStore)
    if (!tenantId || processing) return
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) { toast.error('Enter the amount you want to disburse'); return }
    if (balance - numericAmount < 50) { toast.error('At least GHS 50.00 must remain in your Seltra balance'); return }
    setProcessing(true)
    const { data, error } = await apiFetch<{ success: boolean; disbursementId: string }>('/api/v1/payment/disbursement/request', {
      method: 'POST',
      body: JSON.stringify({ tenantId, amount: numericAmount.toFixed(2) }),
    })
    setProcessing(false)
    if (error || !data?.disbursementId) { toast.error(error || 'Could not request disbursement'); return }
    setDisbursementId(data.disbursementId)
    setStep('otp')
    toast.success('Disbursement OTP sent')
  }

  const confirmDisbursement = async () => {
    const tenantId = storeIdOf(activeStore)
    if (!tenantId || !disbursementId || !otp || processing) return
    setProcessing(true)
    const { error } = await apiFetch('/api/v1/payment/disbursement/confirm', {
      method: 'POST',
      body: JSON.stringify({ tenantId, disbursementId, otp }),
    })
    setProcessing(false)
    if (error) { toast.error(error); return }
    setModalOpen(false); setDisbursementId(''); setOtp(''); setAmount(''); setStep('amount')
    await loadLedger()
    toast.success('Disbursement sent and ledger debited')
  }

  const openDisbursementModal = () => {
    const max = Math.max(0, balance - 50)
    setAmount(max > 0 ? max.toFixed(2) : '')
    setOtp('')
    setDisbursementId('')
    setStep('amount')
    setModalOpen(true)
  }

  const visibleTransactions = transactions

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <PageHeader tab="payments" title="Payments" subtitle="Subsidiary ledger balance and transaction history." />
        <section className="rounded-2xl border border-emerald-500/20 bg-zinc-950 p-6 text-white">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm text-zinc-400">Merchant Balance</div>
              <div className="mt-2 font-mono text-3xl font-semibold text-emerald-400">{money(balance, currency)}</div>
              <div className="mt-1 text-xs text-zinc-500">subsidiary account</div>
            </div>
            <Button disabled={!activeStore || balance <= 50 || processing} onClick={openDisbursementModal} className="rounded-full">
              {processing ? 'Working...' : 'Request Disbursement'} <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </section>
        <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card/30">
          <GridHeader cols="grid-cols-[.75fr_.65fr_1.2fr_1.35fr_.85fr_.8fr]" items={['date', 'type', 'description', 'payout to', 'amount', 'balance']} />
          {transactions.length === 0 ? <EmptyRows text="No ledger transactions yet." /> : (
            <div className="divide-y divide-border">
              {visibleTransactions.map((tx) => {
                const meta = (tx as { meta?: { accountName?: string; provider?: string; account?: string; reference?: string; disbursementId?: string } | null }).meta
                const payoutLabel = tx.type === 'debit' && meta
                  ? [meta.accountName, meta.provider, meta.account].filter(Boolean).join(' · ')
                  : '—'
                const reference = String(meta?.reference || meta?.disbursementId || '')
                const description = tx.type === 'debit'
                  ? 'Disbursement paid'
                  : tx.description?.replace(/\s*\(.+\)\s*$/, '') || 'Order payment credited'
                return (
                  <div key={tx.id} className="grid grid-cols-[.75fr_.65fr_1.2fr_1.35fr_.85fr_.8fr] gap-3 px-5 py-4 text-sm">
                    <div>{new Date(tx.createdAt).toLocaleDateString()}</div>
                    <StatusBadge status={tx.type} />
                    <div className="min-w-0">
                      <div className="truncate">{description}</div>
                      {reference && <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={reference}>{reference}</div>}
                    </div>
                    <div className="min-w-0 truncate text-muted-foreground" title={payoutLabel}>{payoutLabel}</div>
                    <div className={tx.type === 'credit' ? 'text-emerald-500' : 'text-red-500'}>{tx.type === 'credit' ? '+' : '-'}{money(tx.amount, tx.currency)}</div>
                    <div className="font-mono">{money(balance, currency)}</div>
                  </div>
                )
              })}
            </div>
          )}
          <PaginationControls page={txPage} total={txTotal} pageSize={txPageSize} onPage={setTxPage} />
        </section>
      </div>
      {modalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{step === 'amount' ? 'Request disbursement' : 'Confirm disbursement'}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {step === 'amount' ? `Choose an amount. ${money(50, currency)} must remain in your balance.` : `Enter the OTP sent by SMS to release ${money(Number(amount || 0), currency)}.`}
                </p>
              </div>
              <button type="button" onClick={() => { setModalOpen(false); setStep('amount') }} className="rounded-xl p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            {step === 'amount' ? (
              <>
                <label className="mt-4 grid gap-1.5 text-sm">Amount to disburse
                  <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                    inputMode="decimal" className="rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring" />
                </label>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Available: {money(balance, currency)}</span>
                  <span>Maximum: {money(Math.max(0, balance - 50), currency)}</span>
                </div>
                <Button onClick={() => void requestDisbursement()} disabled={processing || !amount} className="mt-5 w-full rounded-full">
                  {processing ? 'Sending OTP...' : 'Send OTP'}
                </Button>
              </>
            ) : (
              <>
                <label className="mt-4 grid gap-1.5 text-sm">Disbursement OTP
                  <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                    className="rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring" />
                </label>
                <Button onClick={() => void confirmDisbursement()} disabled={processing || otp.length < 6} className="mt-5 w-full rounded-full">
                  {processing ? 'Sending...' : 'Confirm and send money'}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ProductsTab({ activeStore }: { activeStore: StoreData | null }) {
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [loading, setLoading]   = useState(false)
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null)
  const [editBuf, setEditBuf]   = useState<Partial<ProductRecord>>({})
  const [saving, setSaving]     = useState(false)
  const [uploading, setUploading] = useState(false)
  const [adding, setAdding]     = useState(false)
  const [newProduct, setNewProduct] = useState({ name: '', price: '', description: '', category: '' })
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 9

  const storeId = storeIdOf(activeStore)

  const load = useCallback(async () => {
    if (!storeId) { setProducts([]); setTotal(0); return }
    setLoading(true)
    const { data } = await apiFetch<Paginated<ProductRecord>>(`/api/v1/seltra/store/${encodeURIComponent(storeId)}/products?page=${page}&perPage=${pageSize}`)
    setLoading(false)
    setProducts(data?.data ?? [])
    setTotal(data?.total ?? 0)
  }, [page, pageSize, storeId])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setPage(1) }, [activeStore])

  const startEdit = (p: ProductRecord) => {
    setEditingProduct(p)
    setEditBuf({
      name: p.name,
      price: p.price,
      description: p.description ?? '',
      category: p.category ?? '',
      variants: p.variants?.map((variant) => ({ id: variant.id, name: variant.name, value: variant.value })) ?? [],
    })
  }
  const cancelEdit = () => { setEditingProduct(null); setEditBuf({}) }

  const saveEdit = async () => {
    if (!storeId || !editingProduct) return
    setSaving(true)
    const { data, error } = await apiFetch<ProductRecord>(`/api/v1/seltra/store/${encodeURIComponent(storeId)}/products/${encodeURIComponent(editingProduct.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: editBuf.name,
        price: String(editBuf.price),
        description: editBuf.description,
        category: editBuf.category,
        ...(editBuf.variants !== undefined && {
          variants: editBuf.variants
            .filter((variant) => variant.name?.trim() && variant.value?.trim())
            .map(({ id, ...variant }) => ({
              name: variant.name,
              value: variant.value,
            })),
        }),
      }),
    })
    setSaving(false)
    if (error || !data) { toast.error(error || 'Could not save product'); return }
    setProducts(prev => prev.map((p) => p.id === editingProduct.id ? data : p))
    setEditingProduct(null)
    toast.success('Product updated')
  }

const uploadImage = async (productId: string, file: File) => {
  if (!storeId) return
  setUploading(true)
  try {
    const base64 = await compressImage(file)
    const { data, error } = await apiFetch<{ url: string }>('/api/v1/seltra/upload/product-image', {
      method: 'POST',
      body: JSON.stringify({ storeId, productId, imageBase64: base64, mimeType: 'image/jpeg' }),
    })
    if (error || !data?.url) { toast.error(error || 'Upload failed'); return }
    setProducts(prev => prev.map(p => p.id === productId
      ? { ...p, images: [{ url: data.url, isPrimary: true }] }
      : p
    ))
    setEditingProduct((current) => current?.id === productId
      ? { ...current, images: [{ url: data.url, isPrimary: true }] }
      : current
    )
    toast.success('Image updated')
  } catch {
    toast.error('Upload failed')
  } finally {
    setUploading(false)
  }
}

  const deleteProduct = async (id: string, name: string) => {
    if (!storeId || !confirm(`Delete "${name}"? This cannot be undone.`)) return
    const { error } = await apiFetch<{ success: boolean }>(`/api/v1/seltra/store/${encodeURIComponent(storeId)}/products/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (error) { toast.error(error); return }
    setProducts(prev => prev.filter(p => p.id !== id))
    toast.success('Product deleted')
  }

  const addProduct = async () => {
    if (!storeId || !newProduct.name || !newProduct.price) { toast.error('Name and price are required'); return }
    setSaving(true)
    const { data, error } = await apiFetch<ProductRecord>(`/api/v1/seltra/store/${encodeURIComponent(storeId)}/products`, {
      method: 'POST',
      body: JSON.stringify({ name: newProduct.name, price: newProduct.price, description: newProduct.description, category: newProduct.category, currency: 'GHS' }),
    })
    setSaving(false)
    if (error || !data) { toast.error(error || 'Could not add product'); return }
    setProducts(prev => [data, ...prev])
    setTotal((current) => current + 1)
    setNewProduct({ name: '', price: '', description: '', category: '' })
    setAdding(false)
    toast.success('Product added')
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-start justify-between gap-4">
          <PageHeader tab="products" title="Products" subtitle="Your agent-generated product catalog. Edit inline or ask the agent." />
          <Button size="sm" className="rounded-full gap-1.5" onClick={() => setAdding(true)} disabled={!storeId}>
            <Plus className="h-3.5 w-3.5" /> Add product
          </Button>
        </div>

        {adding && (
          <div className="mb-6 rounded-2xl border border-primary/30 bg-card/50 p-5">
            <h3 className="mb-4 text-sm font-semibold">New product</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: 'Name *', key: 'name', placeholder: 'Product name' },
                { label: 'Price (GHS) *', key: 'price', placeholder: '0.00' },
                { label: 'Category', key: 'category', placeholder: 'e.g. Skincare' },
                { label: 'Description', key: 'description', placeholder: 'Short product description' },
              ].map(({ label, key, placeholder }) => (
                <label key={key} className="grid gap-1.5 text-sm">{label}
                  <input value={newProduct[key as keyof typeof newProduct]}
                    onChange={e => setNewProduct(p => ({ ...p, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </label>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Button size="sm" className="rounded-full" onClick={() => void addProduct()} disabled={saving}>{saving ? 'Adding…' : 'Add product'}</Button>
              <Button size="sm" variant="outline" className="rounded-full" onClick={() => { setAdding(false); setNewProduct({ name: '', price: '', description: '', category: '' }) }}>Cancel</Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Loading products…</div>
        ) : products.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/30 p-12 text-center text-sm text-muted-foreground">
            No products yet. Ask your agent to generate them or add one above.
          </div>
        ) : (
          <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => {
              const image = product.images?.find(i => i.isPrimary)?.url ?? product.images?.[0]?.url
              return (
                <div key={product.id} className="overflow-hidden rounded-2xl border border-border bg-card/40 flex flex-col">
                  <div className="relative aspect-[16/10] bg-card/60 overflow-hidden">
                    {image
                      ? <img src={image} alt={product.name} className="h-full w-full object-cover" />
                      : <div className="flex h-full w-full items-center justify-center text-muted-foreground/30">
                          <Package className="h-10 w-10" />
                        </div>
                    }
                  </div>

                  <div className="p-4 flex-1 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="font-semibold text-sm leading-tight truncate">{product.name}</h2>
                        {product.description && <p className="line-clamp-2 text-xs text-muted-foreground">{product.description}</p>}
                        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{product.category ?? 'catalog'}</div>
                      </div>
                      <span className="font-mono text-xs text-primary flex-shrink-0">{money(product.price, product.currency ?? 'GHS')}</span>
                    </div>
                    <div className="flex gap-1.5 mt-auto pt-2">
                      <Button size="sm" variant="outline" className="rounded-full h-7 text-xs px-3 flex-1" onClick={() => startEdit(product)}>Edit</Button>
                      <Button size="sm" variant="ghost" className="rounded-full h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => void deleteProduct(product.id, product.name)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <PaginationControls page={page} total={total} pageSize={pageSize} onPage={setPage} />

          {editingProduct && (
            <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 py-5 backdrop-blur-sm">
              <div className="w-full max-w-3xl max-h-[calc(100vh-3rem)] overflow-y-auto rounded-3xl border border-border bg-card p-5 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">Edit product</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Update the product details and image in one modal.</p>
                  </div>
                  <button type="button" onClick={cancelEdit} className="rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-6 grid gap-6 grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,320px)]">
                  <div className="min-w-0 space-y-4">
                    <div className="overflow-hidden rounded-3xl border border-border bg-card/70">
                      {editingProduct.images?.[0]?.url ? (
                        <div className="relative aspect-[16/10] w-full overflow-hidden">
                          <img src={editingProduct.images[0].url} alt={editingProduct.name} className="h-full w-full object-cover" />
                        </div>
                      ) : (
                        <div className="flex aspect-[16/10] items-center justify-center bg-muted/10 text-muted-foreground">
                          No image yet
                        </div>
                      )}
                    </div>
                    <label className="grid gap-2 rounded-2xl border border-border bg-background/80 p-4 text-sm">
                      <span className="font-medium">Change image</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file && editingProduct) void uploadImage(editingProduct.id, file)
                          e.target.value = ''
                        }}
                        className="w-full min-w-0 text-sm"
                      />
                      {uploading && <span className="text-xs text-muted-foreground">Uploading image…</span>}
                    </label>
                  </div>

                  <div className="min-w-0 space-y-4">
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium">Name</span>
                      <input
                        value={editBuf.name ?? ''}
                        onChange={(e) => setEditBuf((b) => ({ ...b, name: e.target.value }))}
                        className="h-11 w-full min-w-0 rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium">Price (GHS)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={editBuf.price ?? ''}
                        onChange={(e) => setEditBuf((b) => ({ ...b, price: e.target.value }))}
                        className="h-11 w-full min-w-0 rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium">Category</span>
                      <input
                        value={editBuf.category ?? ''}
                        onChange={(e) => setEditBuf((b) => ({ ...b, category: e.target.value }))}
                        className="h-11 w-full min-w-0 rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium">Description</span>
                      <textarea
                        rows={4}
                        value={editBuf.description ?? ''}
                        onChange={(e) => setEditBuf((b) => ({ ...b, description: e.target.value }))}
                        className="min-h-[9rem] w-full min-w-0 resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                    </label>
                  </div>
                </div>

                {editBuf.variants?.length ? (
                  <div className="mt-6 rounded-3xl border border-border bg-background/80 p-5">
                    <div className="mb-4">
                      <p className="text-sm font-semibold">Variants</p>
                      <p className="text-xs text-muted-foreground">Edit existing variant options only.</p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {editBuf.variants.map((variant, index) => (
                        <div key={`${variant.id ?? variant.name}-${index}`} className="grid gap-3">
                          <label className="grid gap-2 text-sm">
                            <span className="font-medium">Option</span>
                            <input
                              value={variant.name}
                              onChange={(e) => setEditBuf((buf) => ({
                                ...buf,
                                variants: (buf.variants ?? []).map((item, idx) => idx === index ? { ...item, name: e.target.value } : item),
                              }))}
                              className="h-11 rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
                            />
                          </label>
                          <label className="grid gap-2 text-sm">
                            <span className="font-medium">Value</span>
                            <input
                              value={variant.value}
                              onChange={(e) => setEditBuf((buf) => ({
                                ...buf,
                                variants: (buf.variants ?? []).map((item, idx) => idx === index ? { ...item, value: e.target.value } : item),
                              }))}
                              className="h-11 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-6 flex items-center justify-end gap-3">
                  <Button size="sm" variant="outline" className="rounded-full" onClick={cancelEdit}>Cancel</Button>
                  <Button size="sm" className="rounded-full" onClick={() => void saveEdit()} disabled={saving || uploading}>
                    {saving ? 'Saving…' : 'Save changes'}
                  </Button>
                </div>
              </div>
            </div>
          )}
          </>
        )}
      </div>
    </div>
  )
}

function CustomersTab({ activeStore, mode }: { activeStore: StoreData | null; mode: string }) {
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [history, setHistory] = useState<MarketingHistoryRecord[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const [templates, setTemplates] = useState<MarketingTemplateRecord[]>([])
  const [templatesTotal, setTemplatesTotal] = useState(0)
  const [templatesPage, setTemplatesPage] = useState(1)
  const [marketingView, setMarketingView] = useState<'customers' | 'history' | 'templates'>('customers')
  const [composeOpen, setComposeOpen] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [compose, setCompose] = useState({
    channel: 'email' as 'email' | 'sms',
    audience: 'single' as 'single' | 'bulk',
    customerId: '',
    marketingOnly: true,
    subject: '',
    message: '',
    saveAsTemplate: false,
    templateName: '',
  })
  const pageSize = 8
  const historyPageSize = 8
  const templatesPageSize = 9

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const tenantId = storeIdOf(activeStore)
      if (!tenantId) { setCustomers([]); setTotal(0); return }
      setLoading(true)
      const { data, error } = await apiFetch<Paginated<CustomerRecord>>(`/api/v1/payment/customers?tenantId=${encodeURIComponent(tenantId)}&page=${page}&perPage=${pageSize}`)
      if (cancelled) return
      setLoading(false)
      if (error) { toast.error(error); return }
      setCustomers(data?.data ?? [])
      setTotal(data?.total ?? 0)
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore, page])

  const loadMarketing = useCallback(async () => {
    const tenantId = storeIdOf(activeStore)
    if (!tenantId || mode !== 'marketing') return
    const [h, t] = await Promise.all([
      apiFetch<Paginated<MarketingHistoryRecord>>(`/api/v1/marketing/history?tenantId=${encodeURIComponent(tenantId)}&page=${historyPage}&perPage=${historyPageSize}`),
      apiFetch<Paginated<MarketingTemplateRecord>>(`/api/v1/marketing/templates?tenantId=${encodeURIComponent(tenantId)}&page=${templatesPage}&perPage=${templatesPageSize}`),
    ])
    if (h.error) toast.error(h.error)
    if (t.error) toast.error(t.error)
    setHistory(h.data?.data ?? [])
    setHistoryTotal(h.data?.total ?? 0)
    setTemplates(t.data?.data ?? [])
    setTemplatesTotal(t.data?.total ?? 0)
  }, [activeStore, mode, historyPage, templatesPage])

  useEffect(() => { void loadMarketing() }, [loadMarketing])
  useEffect(() => { setPage(1); setHistoryPage(1); setTemplatesPage(1); setSelectedIds([]) }, [activeStore, mode])

  const totalRevenue = customers.reduce((s, c) => s + Number(c.totalSpent || 0), 0)
  const currency = customers[0]?.currency || 'GHS'
  const selectedCustomers = customers.filter((customer) => selectedIds.includes(customer.id))
  const selectedCount = selectedCustomers.length
  const searchableCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase()
    if (!q) return customers
    return customers.filter((customer) =>
      [customer.name, customer.email, customer.phone].filter(Boolean).some((value) => String(value).toLowerCase().includes(q)),
    )
  }, [customers, customerSearch])

  const openCompose = (patch: Partial<typeof compose> = {}) => {
    const firstSelected = selectedCustomers[0]
    setCompose((current) => ({
      ...current,
      customerId: firstSelected?.id || current.customerId || customers[0]?.id || '',
      audience: selectedCount > 1 ? 'bulk' : 'single',
      ...patch,
    }))
    setComposeOpen(true)
  }

  const useTemplate = (template: Pick<MarketingTemplateRecord, 'channel' | 'subject' | 'message' | 'name'>) => {
    openCompose({
      channel: template.channel,
      subject: template.subject || '',
      message: template.message,
      templateName: template.name,
      saveAsTemplate: false,
    })
  }

  const sendMarketingMessage = async () => {
    const tenantId = storeIdOf(activeStore)
    if (!tenantId || sendingMessage) return
    if (compose.channel === 'email' && !compose.subject.trim()) { toast.error('Email subject is required'); return }
    if (!compose.message.trim()) { toast.error('Message is required'); return }
    setSendingMessage(true)
    const selectedCustomer = selectedCustomers[0]
    const { error } = await apiFetch('/api/v1/marketing/send', {
      method: 'POST',
      body: JSON.stringify({
        tenantId,
        channel: compose.channel,
        audience: compose.audience,
        customerId: compose.audience === 'single' ? (compose.customerId || selectedCustomer?.id) : undefined,
        marketingOnly: compose.marketingOnly,
        subject: compose.subject,
        message: compose.message,
        saveAsTemplate: compose.saveAsTemplate,
        templateName: compose.templateName,
      }),
    })
    setSendingMessage(false)
    if (error) { toast.error(error); return }
    setComposeOpen(false)
    setMarketingView('history')
    toast.success('Message sent')
    void loadMarketing()
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <PageHeader
            tab={mode === 'marketing' ? 'marketing' : 'customers'}
            title={mode === 'marketing' ? 'Messaging' : 'Customers'}
            subtitle={mode === 'marketing' ? 'Email and SMS-ready customer contacts for transactional and marketing work.' : 'Know who bought, what they paid, and when they last ordered.'}
          />
          {mode === 'marketing' && (
            <div className="flex flex-wrap gap-2">
              {selectedCount > 0 && <Button variant="outline" className="rounded-full" onClick={() => openCompose({ audience: selectedCount > 1 ? 'bulk' : 'single' })}><Mail className="h-4 w-4" /> Message selected</Button>}
              <Button className="rounded-full" disabled={!activeStore} onClick={() => openCompose({ audience: 'bulk' })}><Plus className="h-4 w-4" /> New message</Button>
            </div>
          )}
        </div>
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="customers" value={String(total || customers.length)} />
          <MetricCard label="revenue" value={money(totalRevenue, currency)} />
          <MetricCard label="email contacts" value={String(customers.filter((c) => c.email).length)} />
          <MetricCard label="phone contacts" value={String(customers.filter((c) => c.phone).length)} />
        </div>
        {mode === 'marketing' && (
          <div className="mb-4 flex flex-wrap gap-2">
            {(['customers', 'history', 'templates'] as const).map((view) => (
              <Button key={view} size="sm" variant={marketingView === view ? 'default' : 'outline'} className="rounded-full capitalize" onClick={() => setMarketingView(view)}>{view}</Button>
            ))}
          </div>
        )}
        {mode === 'marketing' && marketingView === 'history' ? (
          <section className="overflow-hidden rounded-2xl border border-border bg-card/40">
            <GridHeader cols="grid-cols-[.65fr_.9fr_1.35fr_1fr_.65fr_1fr]" items={['channel', 'audience', 'message', 'sent', 'status', 'action']} />
            {history.length === 0 ? <EmptyRows text="Sent campaigns and transactional messages will appear here." /> : (
              <div className="divide-y divide-border">
                {history.map((item) => (
                  <div key={item.id} className="grid grid-cols-[.65fr_.9fr_1.35fr_1fr_.65fr_1fr] gap-3 px-5 py-4 text-sm">
                    <StatusBadge status={item.channel} />
                    <div>{item.audience === 'bulk' ? `Bulk - ${item.recipientCount ?? 0} recipients` : item.customerName || 'Single customer'}</div>
                    <div className="min-w-0">
                      {item.subject && <div className="truncate font-medium">{item.subject}</div>}
                      <div className="truncate text-muted-foreground">{item.message}</div>
                    </div>
                    <div className="text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</div>
                    <StatusBadge status={item.status || (item.failed ? 'partial' : 'sent')} />
                    <Button size="sm" variant="outline" className="h-8 rounded-full px-3" onClick={() => useTemplate({ channel: item.channel, subject: item.subject, message: item.message || '', name: item.subject || 'Previous message' })}>Use as template</Button>
                  </div>
                ))}
              </div>
            )}
            <PaginationControls page={historyPage} total={historyTotal} pageSize={historyPageSize} onPage={setHistoryPage} />
          </section>
        ) : mode === 'marketing' && marketingView === 'templates' ? (
          <section>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card/40 p-8 text-sm text-muted-foreground">Saved templates will appear here.</div>
            ) : templates.map((template) => (
              <button key={template.id} type="button" onClick={() => useTemplate(template)} className="rounded-2xl border border-border bg-card/40 p-4 text-left transition hover:border-primary/50">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="truncate text-sm font-semibold">{template.name}</h2>
                  <StatusBadge status={template.channel} />
                </div>
                {template.subject && <p className="mt-3 truncate text-sm">{template.subject}</p>}
                <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{template.message}</p>
              </button>
            ))}
            </div>
            <PaginationControls page={templatesPage} total={templatesTotal} pageSize={templatesPageSize} onPage={setTemplatesPage} />
          </section>
        ) : (
        <section className="overflow-hidden rounded-2xl border border-border bg-card/40">
          <GridHeader cols={mode === 'marketing' ? "grid-cols-[.25fr_1.35fr_.7fr_.7fr_.8fr_1fr]" : "grid-cols-[1.4fr_.7fr_.7fr_.8fr_1fr]"} items={mode === 'marketing' ? ['', 'customer', 'spent', 'orders', 'last bought', 'contact'] : ['customer', 'spent', 'orders', 'last bought', 'contact']} />
          {loading ? <EmptyRows text="Loading customers…" /> : customers.length === 0 ? (
            <EmptyRows text={activeStore ? 'Checkout customers will appear here after their first order.' : 'Select or create a store first.'} />
          ) : (
            <div className="divide-y divide-border">
              {customers.map((customer) => (
                <div key={customer.id} className={`grid ${mode === 'marketing' ? 'grid-cols-[.25fr_1.35fr_.7fr_.7fr_.8fr_1fr]' : 'grid-cols-[1.4fr_.7fr_.7fr_.8fr_1fr]'} gap-3 px-5 py-4 text-sm`}>
                  {mode === 'marketing' && (
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(customer.id)}
                      onChange={(e) => setSelectedIds((current) => e.target.checked ? [...current, customer.id] : current.filter((id) => id !== customer.id))}
                      className="mt-1 h-4 w-4 accent-primary"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-medium">{customer.name || customer.email}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{customer.email}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{[customer.city, customer.country].filter(Boolean).join(', ') || customer.address || 'No location yet'}</div>
                  </div>
                  <div className="font-semibold">{money(customer.totalSpent, customer.currency)}</div>
                  <div><span className="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] text-muted-foreground">{customer.orderCount} {customer.isRecurring ? 'repeat' : 'new'}</span></div>
                  <div className="text-muted-foreground">{customer.lastOrderAt ? new Date(customer.lastOrderAt).toLocaleDateString() : 'Never'}</div>
                  <div className="min-w-0 text-xs text-muted-foreground">
                    <div className="truncate">{customer.phone || 'No phone'}</div>
                    <div className={customer.marketingOptIn ? 'text-primary' : ''}>{customer.marketingOptIn ? 'marketing ok' : 'transactional only'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <PaginationControls page={page} total={total} pageSize={pageSize} onPage={setPage} />
        </section>
        )}
        {composeOpen && (
          <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">New message</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Compose an email or SMS for one customer or a bulk audience.</p>
                </div>
                <button type="button" onClick={() => setComposeOpen(false)} className="rounded-xl p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm">Channel
                  <select value={compose.channel} onChange={(e) => setCompose((current) => ({ ...current, channel: e.target.value as 'email' | 'sms' }))} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm">Audience
                  <select value={compose.audience} onChange={(e) => setCompose((current) => ({ ...current, audience: e.target.value as 'single' | 'bulk' }))} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                    <option value="single">Single customer</option>
                    <option value="bulk">Bulk</option>
                  </select>
                </label>
                {compose.audience === 'single' ? (
                  <label className="grid gap-1.5 text-sm sm:col-span-2">Customer
                    <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Search by name, email, or phone" className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
                    <select value={compose.customerId} onChange={(e) => setCompose((current) => ({ ...current, customerId: e.target.value }))} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                      {searchableCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name || customer.email}</option>)}
                    </select>
                    {searchableCustomers.length === 0 && <span className="text-xs text-muted-foreground">No matching customers on this page.</span>}
                  </label>
                ) : (
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input type="checkbox" checked={compose.marketingOnly} onChange={(e) => setCompose((current) => ({ ...current, marketingOnly: e.target.checked }))} className="h-4 w-4 accent-primary" />
                    Send only to marketing opt-in contacts
                  </label>
                )}
                {compose.channel === 'email' && (
                  <label className="grid gap-1.5 text-sm sm:col-span-2">Subject
                    <input value={compose.subject} onChange={(e) => setCompose((current) => ({ ...current, subject: e.target.value }))} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
                  </label>
                )}
                <label className="grid gap-1.5 text-sm sm:col-span-2">Message
                  <textarea value={compose.message} onChange={(e) => setCompose((current) => ({ ...current, message: e.target.value }))} rows={6} className="resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={compose.saveAsTemplate} onChange={(e) => setCompose((current) => ({ ...current, saveAsTemplate: e.target.checked }))} className="h-4 w-4 accent-primary" />
                  Save as template
                </label>
                {compose.saveAsTemplate && (
                  <input value={compose.templateName} onChange={(e) => setCompose((current) => ({ ...current, templateName: e.target.value }))} placeholder="Template name" className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
                )}
              </div>
              <Button onClick={() => void sendMarketingMessage()} disabled={sendingMessage || !activeStore} className="mt-5 w-full rounded-full">{sendingMessage ? 'Sending...' : 'Send message'}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AnalyticsTab({ activeStore }: { activeStore: StoreData | null }) {
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [customers, setCustomers] = useState<CustomerRecord[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const tenantId = storeIdOf(activeStore)
      const search = new URLSearchParams({ page: '1', perPage: '100' })
      if (tenantId) search.set('tenantId', tenantId)
      const [o, c] = await Promise.all([
        apiFetch<Paginated<OrderRecord>>(`/api/v1/orders?${search.toString()}`),
        tenantId ? apiFetch<Paginated<CustomerRecord>>(`/api/v1/payment/customers?tenantId=${encodeURIComponent(tenantId)}&page=1&perPage=100`) : Promise.resolve({ data: { data: [], total: 0, page: 1, perPage: 100 } as Paginated<CustomerRecord>, error: null }),
      ])
      if (cancelled) return
      setOrders(o.data?.data ?? []); setCustomers(c.data?.data ?? [])
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore])

  const paid = orders.filter(hasConfirmedPayment)
  const revenue = paid.reduce((s, o) => s + Number(o.merchantAmount ?? o.totalAmount ?? 0), 0)
  const conversionHint = customers.length ? Math.min(18, Math.max(2, Math.round((paid.length / customers.length) * 100))) : 0

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <PageHeader tab="analytics" title="Analytics" subtitle="Revenue, customer, catalog, and conversion signals." />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard label="paid revenue" value={money(revenue)} />
          <MetricCard label="paid orders" value={String(paid.length)} />
          <MetricCard label="customers" value={String(customers.length)} />
          <MetricCard label="catalog items" value={String(activeStore?.products?.length ?? 0)} />
        </div>
        <div className="mt-6 rounded-2xl border border-border bg-card/40 p-5">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Estimated checkout conversion</span>
            <span className="font-mono text-primary">{conversionHint}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${conversionHint}%` }} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">This becomes more accurate as storefront visits and checkout events accumulate.</p>
        </div>
      </div>
    </div>
  )
}

function ProfileCenterTab({ mode, activeStore, user, stores, credits, onStoreUpdated }: {
  mode: 'account' | 'billing' | 'domains' | 'help'
  activeStore: StoreData | null
  user: { email: string; name: string; avatar: string; joinedAt?: string; plan?: 'free' | 'premium' } | null
  stores: StoreData[]
  credits: { used: number; limit: number; resetsAt: string } | null
  onStoreUpdated: (s: StoreData) => void
}) {
  const [name, setName] = useState(activeStore?.name ?? '')
  const [businessType, setBusinessType] = useState(activeStore?.businessType ?? '')
  const [targetAudience, setTargetAudience] = useState(activeStore?.targetAudience ?? '')
  const [region, setRegion] = useState('Africa')
  const [country, setCountry] = useState('Ghana')
  const [language, setLanguage] = useState('English')
  const [payout, setPayout] = useState({ method: 'mobile_money', account: '', providerCode: '1', accountName: '' })
  const [saving, setSaving] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [payoutError, setPayoutError] = useState('')
  const [accountStoresPage, setAccountStoresPage] = useState(1)
  const accountStoresPageSize = 4

  // ── Editable subdomain state (now edited via modal) ──
  const [domainSlug, setDomainSlug] = useState(activeStore?.slug ?? '')
  const [savingDomain, setSavingDomain] = useState(false)
  const [domainError, setDomainError] = useState('')
  const [editDomainOpen, setEditDomainOpen] = useState(false)

  useEffect(() => {
    setName(activeStore?.name ?? '')
    setBusinessType(activeStore?.businessType ?? '')
    setTargetAudience(activeStore?.targetAudience ?? '')
    setRegion(activeStore?.preferences?.region ?? 'Africa')
    setCountry(activeStore?.country ?? 'Ghana')
    setLanguage(activeStore?.preferences?.language ?? 'English')
    setPayout({
      method: activeStore?.payoutMethod ?? 'mobile_money',
      account: activeStore?.payoutAccount ?? '',
      providerCode: activeStore?.payoutProviderCode ?? '1',
      accountName: activeStore?.payoutAccountName ?? '',
    })
    setPayoutError('')
    setDomainSlug(activeStore?.slug ?? '')
    setDomainError('')
    setEditDomainOpen(false)
  }, [activeStore])

  // ── Plan / tier (dynamic) ──────────────────────────────────────────────
  const plan: 'free' | 'premium' = user?.plan === 'premium' ? 'premium' : 'free'
  const storeLimit = plan === 'premium' ? 3 : 1
  const productLimit = plan === 'premium' ? 100 : 50
  const payoutOptions = payout.method === 'bank' ? GHANA_BANKS : GHANA_TELCOS
  const accountStores = stores.slice((accountStoresPage - 1) * accountStoresPageSize, accountStoresPage * accountStoresPageSize)
  useEffect(() => { setAccountStoresPage(1) }, [stores.length])

  const creditsExhausted = Boolean(credits && credits.used >= credits.limit)

  const saveAccount = async () => {
    const id = storeIdOf(activeStore)
    if (!id || saving) return
    setSaving(true)
    let accountName = payout.accountName
    if (payout.account) {
      setPayoutError('')
      const validation = await apiFetch<{ accountName?: string }>(`/api/v1/payment/payout/validate`, {
        method: 'POST',
        body: JSON.stringify({ tenantId: id, method: payout.method, providerCode: payout.providerCode, account: payout.account }),
      })
      if (validation.error || !validation.data?.accountName) {
        setSaving(false)
        const message = validation.error || 'Could not validate payout account'
        setPayoutError(message)
        toast.error(message)
        return
      }
      accountName = validation.data.accountName
      setPayout((current) => ({ ...current, accountName }))
    }
    const selectedProvider = payoutOptions.find((item) => item.code === payout.providerCode)
    const { data, error } = await apiFetch<StoreData>(`/api/v1/seltra/store/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name, businessType, targetAudience, region, country, language,
        payoutMethod: payout.method,
        payoutProvider: selectedProvider?.label,
        payoutProviderCode: payout.providerCode,
        payoutAccount: payout.account,
      }),
    })
    setSaving(false)
    if (error || !data) { toast.error(error || 'Could not save account'); return }
    onStoreUpdated(data)
    toast.success(accountName ? `Account updated for ${accountName}` : 'Account updated')
  }

  // ── Save the merchant's chosen subdomain from the edit modal. Only touches
  // slug/storeUrl on the tenant — products, orders, payments stay untouched. ──
  const saveDomainSlug = async () => {
    const id = storeIdOf(activeStore)
    if (!id || savingDomain) return
    const normalized = domainSlug.trim().toLowerCase()

    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(normalized)) {
      setDomainError('Use lowercase letters, numbers, and hyphens only — no leading, trailing, or double hyphens.')
      return
    }
    if (normalized.length < 3 || normalized.length > 63) {
      setDomainError('Subdomain must be between 3 and 63 characters.')
      return
    }
    if (normalized === activeStore?.slug) {
      setDomainError('')
      setEditDomainOpen(false)
      return
    }

    setDomainError('')
    setSavingDomain(true)
    const { data, error } = await apiFetch<StoreData>(`/api/v1/seltra/store/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ slug: normalized }),
    })
    setSavingDomain(false)
    if (error || !data) {
      setDomainError(error || 'Could not update subdomain')
      toast.error(error || 'Could not update subdomain')
      return
    }
    setDomainSlug(data.slug)
    onStoreUpdated(data)
    setEditDomainOpen(false)
    toast.success('Subdomain updated')
  }

  const title = mode === 'billing' ? 'Billing' : mode === 'domains' ? 'Domains' : mode === 'help' ? 'Get Help' : 'Account'
  const subtitle = mode === 'billing'
    ? 'Plan, credits, and billing controls for your Seltra workspace.'
    : mode === 'domains'
      ? 'View and manage domains connected to your Seltra stores.'
      : mode === 'help'
        ? 'Support options for launch, payments, domains, and store operations.'
        : 'Merchant profile, workspace details, stores, region, and payout preferences.'

  return (
    <div className={mode === 'account' ? 'flex-1 overflow-hidden' : 'flex-1 overflow-y-auto'}>
      <div className={`mx-auto max-w-6xl px-6 ${mode === 'account' ? 'h-full py-6' : 'py-10'}`}>
        <PageHeader tab={mode} title={title} subtitle={subtitle} />

        {mode === 'account' && (
          <div className="grid min-h-0 gap-5 lg:h-[calc(100%-5.5rem)] lg:grid-cols-[.85fr_1.15fr]">
            <section className="min-h-0 overflow-hidden rounded-2xl border border-border bg-card/40 p-4">
              <div className="flex items-center gap-4">
                {user?.avatar && <img src={user.avatar} alt={user.name || 'Merchant'} className="h-14 w-14 rounded-full border border-border bg-muted object-cover" />}
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">{user?.name || 'Merchant'}</h2>
                  <p className="truncate font-mono text-xs text-muted-foreground">{user?.email || 'No email'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Joined {user?.joinedAt ? new Date(user.joinedAt).toLocaleDateString() : 'recently'}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <MetricCard label="stores used" value={`${stores.length}/${storeLimit}`} />
                <MetricCard label="plan" value={plan === 'premium' ? 'premium' : 'free trial'} />
              </div>
              <div className="mt-4 space-y-2">
                {stores.length === 0 ? <p className="text-sm text-muted-foreground">No stores yet.</p> : accountStores.map((store) => (
                  <button key={store.id ?? store.slug} type="button" className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-background/60 p-3 text-left">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{store.name}</span>
                      <span className="block truncate font-mono text-[11px] text-primary">{store.slug}.seltra.co</span>
                    </span>
                    <Building2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  </button>
                ))}
                <PaginationControls page={accountStoresPage} total={stores.length} pageSize={accountStoresPageSize} onPage={setAccountStoresPage} />
              </div>
            </section>

            <section className="min-h-0 overflow-y-auto rounded-2xl border border-border bg-card/40 p-4">
              <h2 className="text-sm font-semibold">Workspace Details</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm">Store name
                  <input value={name} onChange={(e) => setName(e.target.value)} disabled={!activeStore}
                    className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
                </label>
                <label className="grid gap-1.5 text-sm">Business type
                  <input value={businessType} onChange={(e) => setBusinessType(e.target.value)} disabled={!activeStore}
                    className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
                </label>
                <label className="grid gap-1.5 text-sm">Language
                  <select value={language} onChange={(e) => setLanguage(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                    {['English', 'French', 'Arabic'].map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm">Region
                  <select value={region} onChange={(e) => setRegion(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                    {['Africa', 'EU', 'USA'].map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm">Country
                  <input value={country} onChange={(e) => setCountry(e.target.value)}
                    className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </label>
                <label className="grid gap-1.5 text-sm">Payout method
                  <select value={payout.method} onChange={(e) => setPayout((current) => ({ ...current, method: e.target.value, providerCode: e.target.value === 'bank' ? GHANA_BANKS[0].code : GHANA_TELCOS[0].code, accountName: '' }))} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                    <option value="mobile_money">Mobile money</option>
                    <option value="bank">Bank transfer</option>
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm">Provider / bank
                  <select value={payout.providerCode} onChange={(e) => setPayout((current) => ({ ...current, providerCode: e.target.value, accountName: '' }))} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                    {payoutOptions.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                  </select>
                  <span className="min-h-4 font-mono text-[11px] text-transparent">verified</span>
                </label>
                <label className="grid gap-1.5 text-sm">{payout.method === 'bank' ? 'Bank account number' : 'MoMo number'}
                  <input value={payout.account} onChange={(e) => setPayout((current) => ({ ...current, account: e.target.value }))}
                    inputMode="numeric" className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
                  <span className={`min-h-4 font-mono text-[11px] ${payoutError ? 'text-red-500' : 'text-primary'}`}>
                    {payoutError || (payout.accountName ? `VERIFIED ${payout.accountName}` : 'Verify on save')}
                  </span>
                </label>
                <label className="grid gap-1.5 text-sm sm:col-span-2">Target audience
                  <textarea value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} disabled={!activeStore} rows={3}
                    className="resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
                </label>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Changing payout details will require phone OTP verification before disbursement.</p>
              <Button onClick={() => void saveAccount()} disabled={!activeStore || saving} className="mt-4 rounded-full">{saving ? 'Saving...' : 'Save account'}</Button>
            </section>
          </div>
        )}

        {mode === 'billing' && (
          <div className="grid gap-5 lg:grid-cols-[1fr_.9fr]">
            <section className="rounded-2xl border border-border bg-card/40 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{plan === 'premium' ? 'Premium' : 'Free Trial'}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {plan === 'premium'
                      ? 'AI credit usage for the current window.'
                      : 'Default monthly merchant credit limit for MVP operations.'}
                  </p>
                </div>
                {plan === 'free' && (
                  <div className="rounded-full border border-border px-3 py-1 font-mono text-xs text-muted-foreground">
                    30 day trial
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-xs text-primary">
                  {plan === 'premium' ? '100 credits / month' : '100 credits / month'}
                </span>
                {credits && (
                  <span className={`rounded-full border px-3 py-1 font-mono text-xs ${creditsExhausted ? 'border-red-500/30 text-red-400' : 'border-border text-muted-foreground'}`}>
                    {credits.used}/{credits.limit} credits used
                  </span>
                )}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <MetricCard label="used" value={credits ? String(credits.used) : '—'} />
                <MetricCard label="limit" value={credits ? String(credits.limit) : '—'} />
                <MetricCard label="resets" value={credits ? new Date(credits.resetsAt).toLocaleTimeString() : '—'} />
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <MetricCard label="free tier" value="$0/m" />
                <MetricCard label="premium" value="$10/m" />
                <MetricCard label="trial" value="30 days" />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <MetricCard label="stores used" value={`${stores.length}/${storeLimit}`} />
                <MetricCard label="products per store" value={String(productLimit)} />
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card/40 p-5">
              <h2 className="text-sm font-semibold">Premium Unlocks</h2>
              <div className="mt-4 grid gap-2 text-sm text-muted-foreground">
                {['3 stores', '100 product upgrades for each store', 'User roles and permissions', 'Custom domains', 'Remove the Seltra badge', 'ChatBot on stores', 'Instant and priority support', 'Unused credits rollover', 'On-demand credit top-ups'].map((item) => (
                  <div key={item} className="flex items-center gap-2"><CheckCheck className="h-4 w-4 text-primary" /> {item}</div>
                ))}
              </div>
              {plan === 'premium' ? (
                <div className="mt-5 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-500">
                  <CheckCheck className="h-4 w-4" /> You&apos;re on Premium
                </div>
              ) : (
                <Button className="mt-5 w-full rounded-full" onClick={() => setUpgradeOpen(true)}>Upgrade to Premium</Button>
              )}
            </section>
          </div>
        )}

        {mode === 'domains' && (
          <section className="rounded-2xl border border-border bg-card/40 p-5">
            <div>
              <h2 className="text-sm font-semibold">Your Seltra subdomain</h2>
              <p className="mt-1 text-sm text-muted-foreground">Every store gets a free, permanent subdomain the moment it launches.</p>
            </div>

            {activeStore ? (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Globe2 className="h-4 w-4 flex-shrink-0 text-primary" />
                    <a
                    href={storefrontUrl(activeStore)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate font-mono text-sm text-primary hover:underline"
                  >
                    {activeStore.slug}.{ROOT_DOMAIN}
                  </a>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 rounded-full p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => { setDomainSlug(activeStore.slug); setDomainError(''); setEditDomainOpen(true) }}
                    aria-label="Edit subdomain"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => {
                      void navigator.clipboard.writeText(storefrontUrl(activeStore))
                      toast.success('Subdomain copied')
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-border bg-background/50 p-6 text-center text-sm text-muted-foreground">
                Create a store to get your subdomain.
              </div>
            )}

            <div className="mt-6 border-t border-border pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Custom domains</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Buy a domain here or connect one you already own.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" className="rounded-full" onClick={() => setUpgradeOpen(true)}>Transfer in</Button>
                  <Button className="rounded-full" onClick={() => setUpgradeOpen(true)}>Buy a domain</Button>
                </div>
              </div>
              <div className="mt-5 grid min-h-40 place-items-center rounded-2xl border border-dashed border-border bg-background/50 p-8 text-center">
                <div>
                  <LockKeyhole className="mx-auto h-8 w-8 text-primary" />
                  <p className="mt-3 text-sm font-medium">Custom domains require Premium.</p>
                  <p className="mt-1 text-xs text-muted-foreground">Your subdomain above keeps working either way.</p>
                </div>
              </div>
            </div>
          </section>
        )}

        {mode === 'help' && (
          <div className="grid gap-4 md:grid-cols-2">
            {[
              ['Launch support', 'Store setup, products, storefront polish, and checkout readiness.'],
              ['Payments', 'Moolre, Paystack, ledger, payout, and failed payment help.'],
              ['Domains', 'Buying, connecting, and transferring custom domains.'],
              ['Security', 'Login, account access, and sensitive business setting changes.'],
            ].map(([heading, body]) => (
              <section key={heading} className="rounded-2xl border border-border bg-card/40 p-5">
                <HelpCircle className="h-5 w-5 text-primary" />
                <h2 className="mt-3 text-sm font-semibold">{heading}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                <Button variant="outline" className="mt-4 rounded-full">Contact support</Button>
              </section>
            ))}
          </div>
        )}
      </div>

      {editDomainOpen && activeStore && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Change subdomain</h2>
                <p className="mt-1 text-sm text-muted-foreground">Your products, orders, and settings stay exactly the same — only the link changes.</p>
              </div>
              <button
                type="button"
                onClick={() => { setEditDomainOpen(false); setDomainSlug(activeStore.slug); setDomainError('') }}
                className="rounded-xl p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-5 grid gap-1.5 text-sm">Subdomain
              <div className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
                <input
                  value={domainSlug}
                  onChange={(e) => { setDomainSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setDomainError('') }}
                  className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none"
                  placeholder="your-store-name"
                  maxLength={63}
                  autoFocus
                />
                <span className="flex-shrink-0 font-mono text-xs text-muted-foreground">.{ROOT_DOMAIN}</span>
              </div>
            </label>
            {domainError ? (
              <p className="mt-2 text-xs text-red-500">{domainError}</p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens only. 3–63 characters.</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => { setEditDomainOpen(false); setDomainSlug(activeStore.slug); setDomainError('') }}
                disabled={savingDomain}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-full"
                onClick={() => void saveDomainSlug()}
                disabled={savingDomain || !domainSlug.trim() || domainSlug.trim().toLowerCase() === activeStore.slug}
              >
                {savingDomain ? 'Saving…' : 'Save subdomain'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {upgradeOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15"><LockKeyhole className="h-5 w-5 text-primary" /></div>
                <div>
                  <h2 className="text-lg font-semibold">Upgrade to Premium</h2>
                  <p className="font-mono text-xs text-muted-foreground">$10 due today</p>
                </div>
              </div>
              <button type="button" onClick={() => setUpgradeOpen(false)} className="rounded-xl p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-5 space-y-2 text-sm text-muted-foreground">
              {['3 stores', '100 product upgrades for each store', 'User roles and permissions', 'Custom domains', 'Remove the Seltra badge', 'ChatBot on stores for customer assistance', 'Instant and priority support', 'Unused credits rollover', 'On-demand credit top-ups'].map((item) => (
                <div key={item} className="flex items-center gap-2"><CheckCheck className="h-4 w-4 text-primary" /> {item}</div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Your plan will update to $10 / month for 100 credits. Downgrade or cancel at any time. By upgrading you agree to our terms.</p>
            <Button className="mt-5 w-full rounded-full" onClick={() => { setUpgradeOpen(false); toast.success('Premium checkout coming online for MVP') }}>Upgrade to Premium</Button>
          </div>
        </div>
      )}
    </div>
  )
}
