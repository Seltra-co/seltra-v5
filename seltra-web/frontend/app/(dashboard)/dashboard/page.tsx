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
  Sparkles, ArrowRight, Megaphone,
  Bell, CreditCard, ShieldCheck, CheckCheck,
  FileText, UserCircle, HelpCircle, Globe2, Building2, LockKeyhole,
  Eye, Pencil, Mic, ChevronDown, PanelLeft, Search, UserRound,
  MoreHorizontal, Expand, MessageSquare, Monitor, Smartphone, Asterisk,
} from 'lucide-react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { Aurora } from '@/components/marketing/Aurora'
import { TypewriterPlaceholder } from '@/components/marketing/TypewriterPlaceholder'
import { cn } from '@/lib/utils'
import { ThinkingOrb } from 'thinking-orbs'
import { Button } from '@/components/ui/button'
import StorefrontPreview, { type StoreData } from '@/components/storefront/StorefrontPreview'
import { StorefrontShell } from '@/components/storefront/StorefrontShell'
import { AgentBuildStream, type BuildProgress } from '@/components/storefront/AgentBuildStream'
import { useStore } from '@/context/StoreContext'
import { CURRENT_ANNOUNCEMENT_VERSION, WHATS_NEW } from './config/whats-new'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'seltra.co'

const DEV_PREVIEW = process.env.NODE_ENV === 'development'

const DEV_PREVIEW_STORES: StoreData[] = [
  { id: 'preview-pay-mirror', name: 'Seltra Pay Mirror', slug: 'seltra-pay-mirror', heroSource: '/seltra/dashboard-storefront.png' },
  { id: 'preview-deyogo', name: 'De-Yogo Bar Boost', slug: 'de-yogo-bar-boost', heroSource: '/seltra/deyogo-bar.jpg' },
  { id: 'preview-deyogo-2', name: 'De-Yogo Bar Boost', slug: 'de-yogo-bar', heroSource: '/seltra/deyogo-bar.jpg' },
]

function getToken()  { return typeof window !== 'undefined' ? localStorage.getItem('seltra:token') : null }
function getUser()   { try { const r = localStorage.getItem('seltra:user'); return r ? JSON.parse(r) : null } catch { return null } }

function rememberRecentStore(store: StoreData) {
  if (typeof window === 'undefined') return
  const id = store.id ?? store.slug
  const current = readRecentStoreIds().filter((item) => item !== id)
  localStorage.setItem('seltra:recent_store_ids', JSON.stringify([id, ...current].slice(0, 12)))
}

function readRecentStoreIds() {
  if (typeof window === 'undefined') return [] as string[]
  try {
    const parsed = JSON.parse(localStorage.getItem('seltra:recent_store_ids') ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return [] as string[]
  }
}

function imageUrl(value?: string | null) {
  if (!value) return ''
  return /^https?:\/\//.test(value) || value.startsWith('/') ? value : ''
}

function editedLabel(iso?: string) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'Edited today'
  if (days === 1) return 'Edited yesterday'
  if (days < 30) return `Edited ${days} days ago`
  return `Edited ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function ensureDevPreview() {
  if (!DEV_PREVIEW || typeof window === 'undefined' || getToken()) return
  const previewUser = {
    id: 'dev-preview',
    email: 'william@seltra.co',
    plan: 'free',
    user_metadata: {
      full_name: 'William Ofosu-Parwar',
      avatar_url: '/seltra/william.png',
    },
  }
  localStorage.setItem('seltra:token', 'dev-preview')
  localStorage.setItem('seltra:user', JSON.stringify(previewUser))
  localStorage.setItem(announcementStorageKey(previewUser), JSON.stringify([CURRENT_ANNOUNCEMENT_VERSION]))
}
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

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<{ data: T | null; error: string | null; aborted?: boolean }> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string> ?? {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  try {
    const res  = await fetch(`${API_BASE}${path}`, { ...opts, headers })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { if (res.status === 401) clearAuth(); return { data: null, error: json?.message ?? `HTTP ${res.status}` } }
    return { data: json as T, error: null }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return { data: null, error: null, aborted: true }
    return { data: null, error: e instanceof Error ? e.message : 'Network error' }
  }
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

async function createConversation(title: string, userId?: string, signal?: AbortSignal) {
  const { data, error, aborted } = await apiFetch<Conversation>('/api/v1/conversations', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId ?? 'merchant', title: title.slice(0, 60) || 'New store' }),
    signal,
  })
  return { data, error, aborted }
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
  { id: 'home',      label: 'Agent',     icon: UserRound  },
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
type Msg = { role: 'user' | 'assistant' | 'planner-question' | 'stopped'; content: string; question?: PlannerQuestion; attachments?: MessageAttachment[]; createdAt?: string; dismissed?: boolean }

function formatChatTime(iso?: string) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay ? `Today at ${time}` : `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${time}`
}

function UserPromptBubble({ content, attachments, createdAt, onEdit }: { content: string; attachments?: MessageAttachment[]; createdAt?: string; onEdit?: (value: string) => void }) {
  const time = formatChatTime(createdAt)

  return (
    <div className="flex justify-end">
      <div className="max-w-[min(100%,520px)]">
        {attachments?.length ? (
          <div className="mb-2 flex flex-wrap justify-end gap-2">
            {attachments.map((attachment, index) => (
              <img key={`${attachment.url}-${index}`} src={attachment.url} alt={attachment.name ?? 'Attached image'} className="h-20 w-20 rounded-xl object-cover" />
            ))}
          </div>
        ) : null}
        {content && (
          <div className="rounded-2xl border border-white/15 bg-white/[0.03] px-4 py-2.5 text-[14.5px] leading-relaxed text-white">
            {content}
          </div>
        )}
        <div className="mt-1.5 flex items-center justify-end gap-2 text-[12px] text-white/40">
          <button type="button" className="grid h-6 w-6 place-items-center rounded-md hover:bg-white/5 hover:text-white" aria-label="Copy message" onClick={() => void navigator.clipboard.writeText(content)}>
            <Copy className="h-3.5 w-3.5" />
          </button>
          {onEdit && (
            <button type="button" className="grid h-6 w-6 place-items-center rounded-md hover:bg-white/5 hover:text-white" aria-label="Edit message" onClick={() => onEdit(content)}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {time && <span>{time}</span>}
        </div>
      </div>
    </div>
  )
}

function AgentReply({ content, thoughtSeconds, waiting }: { content: string; thoughtSeconds?: number | null; waiting?: boolean }) {
  return (
    <div className="max-w-[640px] text-[15px] leading-relaxed text-white/90">
      {thoughtSeconds ? <div className="mb-2 text-[13px] text-white/40">Thought for {thoughtSeconds}s</div> : null}
      {content ? <div className="whitespace-pre-wrap">{content}</div> : null}
      {waiting ? null : null}
    </div>
  )
}

function PlannerQuestionCard({
  question,
  index,
  total,
  onSubmit,
  onSkip,
}: {
  question: PlannerQuestion
  index: number
  total: number
  onSubmit: (value: string) => void
  onSkip: () => void
}) {
  const [open, setOpen] = useState(true)
  const [selected, setSelected] = useState(question.options?.[0] ?? '')
  const [custom, setCustom] = useState('')

  useEffect(() => {
    setSelected(question.options?.[0] ?? '')
    setCustom('')
    setOpen(true)
  }, [question.id])

  return (
    <div className="max-w-[640px]">
      <button type="button" onClick={() => setOpen((current) => !current)} className="mb-3 inline-flex items-center gap-1 text-[14px] text-white/55 hover:text-white">
        Waiting for answers
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="rounded-2xl border border-white/10 bg-[#1a1c1b] px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[15px] font-semibold text-white">{question.question}</div>
              <p className="mt-1 text-[13px] text-white/45">{question.why}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-white/35 hover:text-white" aria-label="Collapse question">
              <X className="h-4 w-4" />
            </button>
          </div>
          {question.options && question.options.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {question.options.map((option) => {
                const active = selected === option
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSelected(option)}
                    className={cn('flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[14px] text-white/85', active ? 'bg-white/10' : 'hover:bg-white/5')}
                  >
                    <span className={cn('grid h-4 w-4 place-items-center rounded-full border', active ? 'border-[#3ddc84]' : 'border-white/25')}>
                      {active && <span className="h-2 w-2 rounded-full bg-[#3ddc84]" />}
                    </span>
                    {option}
                  </button>
                )
              })}
            </div>
          ) : (
            <input
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              placeholder={/phone/i.test(question.question) ? 'Phone number' : 'Type your answer…'}
              className="mt-3 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none"
            />
          )}
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-1 text-white/35">
              <span className="grid h-7 w-7 place-items-center rounded-lg"><ChevronLeft className="h-4 w-4" /></span>
              <span className="grid h-7 w-7 place-items-center rounded-lg"><ChevronRight className="h-4 w-4" /></span>
              {total > 1 && <span className="ml-1 text-[11px]">{index + 1}/{total}</span>}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={onSkip} className="text-[13px] text-white/55 hover:text-white">Skip</button>
              <button
                type="button"
                onClick={() => onSubmit((question.options?.length ? selected : custom).trim())}
                disabled={!(question.options?.length ? selected : custom).trim()}
                className="rounded-full bg-[#22c55e] px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-[#16a34a] disabled:opacity-40"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function BuildFlow({ progress, onOpenPreview, onRetry }: { progress: BuildProgress; onOpenPreview: () => void; onRetry?: () => void }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [cardOpen, setCardOpen] = useState(true)
  const failed = progress.phase === 'error'
  return (
    <div className="max-w-[640px] space-y-4">
      {cardOpen && (
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#1a1c1b] px-4 py-3 shadow-[inset_3px_0_0_#22c55e]">
          <div className="flex items-start justify-between gap-3 pl-2">
            <div className={cn('text-[15px] font-medium', failed ? 'text-[#f07178]' : 'text-white')}>{progress.cardTitle}</div>
            <button type="button" onClick={() => setCardOpen(false)} className="text-white/35 hover:text-white" aria-label="Dismiss status"><X className="h-4 w-4" /></button>
          </div>
          <div className={cn('mt-3 flex items-center pl-2', failed ? 'justify-end' : 'justify-between')}>
            {!failed && (
              <div className="flex items-center gap-1 text-white/30">
                <ChevronLeft className="h-4 w-4" />
                <ChevronRight className="h-4 w-4" />
              </div>
            )}
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setDetailsOpen((current) => !current)} className="text-[13px] text-white/70 hover:text-white">View Details</button>
              {failed ? (
                <button type="button" onClick={onRetry} className="rounded-full bg-[#22c55e] px-3.5 py-1.5 text-[13px] font-semibold text-white">Retry</button>
              ) : (
                <button type="button" onClick={onOpenPreview} className="rounded-full bg-[#22c55e] px-3.5 py-1.5 text-[13px] font-semibold text-white">Preview</button>
              )}
            </div>
          </div>
          {detailsOpen && <p className="mt-2 pl-2 text-[13px] text-white/50">{failed ? (progress.detail || progress.cardTitle) : (progress.previewLabel || progress.cardTitle)}</p>}
        </div>
      )}
      {failed ? (
        <p className="text-[15px] leading-relaxed text-white/85">The build failed. You can try again.</p>
      ) : (
        <p className="text-[15px] leading-relaxed text-white/85">Alright. I&apos;ll proceed build the storefront itself.</p>
      )}
      {progress.galleryTitle && progress.images.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-[#1a1c1b] p-3">
          <div className="px-1 text-[14px] font-medium text-white">{progress.galleryTitle}</div>
          <div className="mt-2 overflow-hidden rounded-xl border border-black/10 bg-[#f6f4ef]">
            <div className="flex items-center gap-2 border-b border-black/5 px-3 py-2">
              <Search className="h-3.5 w-3.5 text-black/30" />
              <div className="h-5 flex-1 rounded-md bg-white" />
            </div>
            <div className="flex gap-1.5 p-2">
              {progress.images.slice(0, 4).map((url) => (
                <img key={url} src={url} alt="" className="h-28 flex-1 rounded-md object-cover" />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function failureStoreName(name: string) {
  const clean = name.trim()
  if (!clean || clean === 'New chat' || clean === 'My Store') return 'store'
  return clean.charAt(0).toLowerCase() + clean.slice(1)
}

function BuildFailedPreview({ storeName, onRetry }: { storeName: string; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-[#ef4444] text-3xl font-semibold text-white shadow-[0_0_36px_rgba(239,68,68,0.45)]">!</div>
      <h2 className="mt-6 text-[28px] font-semibold tracking-tight text-white">Build failed</h2>
      <p className="mt-3 max-w-[320px] text-[14px] leading-relaxed text-white/55">
        We couldn&apos;t build your {failureStoreName(storeName)}. Try again, or contact support if the problem continues.
      </p>
      <button type="button" onClick={onRetry} className="mt-6 rounded-xl border border-white/25 px-5 py-2 text-[14px] text-white hover:bg-white/5">
        Retry build
      </button>
    </div>
  )
}

function StoppedCard({ onDismiss, onOpenPreview }: { onDismiss: () => void; onOpenPreview: () => void }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  return (
    <div className="relative max-w-[640px] overflow-hidden rounded-2xl border border-white/10 bg-[#1a1c1b] px-4 py-3 shadow-[inset_3px_0_0_#22c55e]">
      <div className="flex items-start justify-between gap-3 pl-2">
        <div className="text-[15px] font-medium text-white">Stopped</div>
        <button type="button" onClick={onDismiss} className="text-white/35 hover:text-white" aria-label="Dismiss stopped status">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex items-center justify-end gap-3 pl-2">
        <button type="button" onClick={() => setDetailsOpen((current) => !current)} className="text-[13px] text-white/70 hover:text-white">View Details</button>
        <button type="button" onClick={onOpenPreview} className="rounded-full bg-[#22c55e] px-3.5 py-1.5 text-[13px] font-semibold text-white">Preview</button>
      </div>
      {detailsOpen && <p className="mt-2 pl-2 text-[13px] text-white/50">Seltra stopped before this step finished.</p>}
    </div>
  )
}

type LinkState = 'online' | 'reconnecting' | 'offline'

function ConnectionPill({ state, onDismiss }: { state: Exclude<LinkState, 'online'>; onDismiss: () => void }) {
  const offline = state === 'offline'
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[90] flex justify-center">
      <div className={cn(
        'pointer-events-auto inline-flex items-center gap-2.5 rounded-full border bg-[#141615]/95 px-3.5 py-1.5 text-[13px] font-medium shadow-[0_10px_30px_rgba(0,0,0,0.45)]',
        offline ? 'border-[#ef4444] text-[#f87171]' : 'border-[#f59e0b] text-[#fbbf24]',
      )}>
        <span>{offline ? 'No connection' : 'Reconnecting'}</span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss connection status" className="text-current">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function ConnectionCanvas() {
  const bar = 'rounded-full bg-white/10'
  return (
    <div className="absolute inset-0 z-30 flex gap-3 bg-[#1c1e1d] p-3" aria-hidden>
      <div className="flex min-w-0 flex-1 flex-col px-8 py-6">
        <div className="ml-auto h-10 w-72 rounded-2xl bg-white/10" />
        <div className="mt-8 h-3 w-28 rounded-full bg-white/[0.08]" />
        <div className={`mt-4 h-3 w-[340px] max-w-full ${bar}`} />
        <div className={`mt-2 h-3 w-56 ${bar}`} />
        <div className={`mt-6 h-3 w-36 ${bar}`} />
        <div className="mt-6 h-44 w-full max-w-[520px] rounded-2xl bg-white/[0.06]" />
        <div className="mt-auto h-[72px] w-full max-w-[520px] rounded-[22px] bg-white/[0.06]" />
      </div>
      <div className="hidden min-h-0 w-[min(460px,44%)] flex-col rounded-[22px] border border-white/10 lg:flex">
        <div className="flex items-center justify-between px-3 py-3">
          <div className="h-4 w-4 rounded bg-white/10" />
          <div className="flex gap-2">
            <div className="h-7 w-16 rounded-lg bg-white/10" />
            <div className="h-7 w-24 rounded-lg bg-white/10" />
          </div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="h-16 w-16 rounded-2xl bg-white/10" />
          <div className="h-3 w-40 rounded-full bg-white/10" />
        </div>
      </div>
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
  const [previewOpen, setPreviewOpen] = useState(true)
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [chatMenuOpen, setChatMenuOpen] = useState(false)
  const [thoughtSeconds, setThoughtSeconds] = useState<number | null>(null)
  const [buildProgress, setBuildProgress] = useState<BuildProgress | null>(null)
  const [connection, setConnection] = useState<LinkState>('online')
  const [pillDismissed, setPillDismissed] = useState(false)
  const connectionRef = useRef<LinkState>('online')
  const browserOffline = useRef(false)
  const reconnectSource = useRef<'browser' | 'stream'>('browser')
  const setLink = useCallback((next: LinkState) => {
    if (connectionRef.current !== next) setPillDismissed(false)
    connectionRef.current = next
    setConnection(next)
  }, [])
  const reportConnection = useCallback((next: LinkState) => {
    if (browserOffline.current) {
      setLink('offline')
      return
    }
    reconnectSource.current = 'stream'
    setLink(next)
  }, [setLink])
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
  const runPlanner = useCallback(async (prompt: string, signal?: AbortSignal): Promise<PlannerResult | null> => {
    const { data, aborted } = await apiFetch<PlannerResult>('/api/v1/seltra/store/plan', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
      signal,
    })
    if (aborted || signal?.aborted) return null
    if (!data || data.readyToBuild || data.questions.length === 0) return null
    return data
  }, [])

  useEffect(() => {
    ensureDevPreview()
    if (!getToken()) { router.replace('/auth'); return }

    const u = getUser() as UserRecord | null
    let resolvedUser: typeof user = null
    if (u) {
      const m = u.user_metadata ?? {}
      resolvedUser = {
        id: u.id, email: u.email,
        name: m.full_name || m.name || u.name || u.email?.split('@')[0] || '',
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
      const fromApi = data ?? []
      const showPreviewStores = DEV_PREVIEW && fromApi.length === 0 && new URLSearchParams(window.location.search).get('preview') === 'stores'
      const existing = showPreviewStores ? DEV_PREVIEW_STORES : fromApi
      setStores(existing)

      if (existing.length > 0) {
        const current = activeStore && existing.find((store) => store.id === activeStore.id || store.slug === activeStore.slug)
        setActiveStore(current ?? existing[0])
      } else if (pending) {
        setSending(true)
        const { data: conv } = await createConversation(pending, resolvedUser?.id)
        if (conv) { setConvId(conv.id); setConversations((c) => [conv, ...c]) }
        setMsgs([{ role: 'user', content: pending, createdAt: new Date().toISOString() }])
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
    setMsgs((data ?? []).map((m) => ({ role: m.role, content: m.content, createdAt: m.created_at })))
    setTab('home')
  }

  // beginBuild now accepts an optional plannerAnswersSnapshot so structured
  // planner answers (fulfillment mode, delivery tiers, variants, etc.) reach the backend
  // as real fields on CreateStoreDto.plannerAnswers, not just folded into prose.
  const workAbortRef = useRef<AbortController | null>(null)
  const stoppedRef = useRef(false)
  const buildRequestRef = useRef<{ prompt: string; conversationId?: string; answers?: Record<string, string> } | null>(null)
  const armWork = useCallback(() => {
    workAbortRef.current?.abort()
    stoppedRef.current = false
    const controller = new AbortController()
    workAbortRef.current = controller
    return controller.signal
  }, [])
  const stopGeneration = useCallback(() => {
    stoppedRef.current = true
    workAbortRef.current?.abort()
    workAbortRef.current = null
    setSending(false)
    setBuildId(null)
    setBuildProgress(null)
    setBuildLaunchStarted(false)
    setBuildConversationId(undefined)
    setMsgs((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (last?.role === 'assistant' && !last.content.trim()) next.pop()
      next.push({ role: 'stopped', content: 'Stopped' })
      return next
    })
  }, [])

  // beginBuild now accepts an optional plannerAnswersSnapshot so structured
  // planner answers (fulfillment mode, delivery tiers, variants, etc.) reach the backend
  // as real fields on CreateStoreDto.plannerAnswers, not just folded into prose.
  const beginBuild = useCallback(async (prompt: string, conversationId?: string, plannerAnswersSnapshot?: Record<string, string>, signal?: AbortSignal) => {
    buildRequestRef.current = { prompt, conversationId, answers: plannerAnswersSnapshot }
    setBuildProgress(null)
    setBuildId(null)
    setBuildConversationId(conversationId)
    const { data, error, aborted } = await apiFetch<{ buildId: string }>('/api/v1/seltra/store/build', {
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
      signal,
    })
    if (aborted || signal?.aborted || stoppedRef.current) {
      setSending(false)
      return
    }
    if (error || !data?.buildId) {
      setSending(false)
      setBuildId(null)
      setBuildLaunchStarted(false)
      setBuildProgress({
        phase: 'error',
        cardTitle: 'Application build failed',
        previewLabel: 'Build failed',
        images: [],
        galleryTitle: '',
        detail: error || 'Could not start the build.',
      })
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

  const sendToAgent = useCallback(async (storeId: string, message: string, options?: { hasAttachments?: boolean; operation?: 'image-update' | 'generic'; signal?: AbortSignal }) => {
    const token = getToken()
    const signal = options?.signal
    if (signal?.aborted || stoppedRef.current) return ''
    setMsgs((prev) => [...prev, { role: 'assistant', content: '' }])
    let streamedReply = ''
    try {
      const res = await fetch(`${API_BASE}/api/v1/seltra/agent/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ storeId, message, conversationId: convId, hasAttachments: options?.hasAttachments }),
        signal,
      })
      if (signal?.aborted || stoppedRef.current) return ''
      if (res.ok && res.body) {
        const reader = res.body.getReader(); const dec = new TextDecoder()
        while (true) {
          if (signal?.aborted || stoppedRef.current) {
            await reader.cancel()
            return ''
          }
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
        if (stoppedRef.current) return ''
        const safeReply = merchantFacingAgentReply(streamedReply)
        if (safeReply !== streamedReply) {
          setMsgs((prev) => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: safeReply } : m))
        }
        return safeReply
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return ''
    }
    if (signal?.aborted || stoppedRef.current) return ''
    const { data, aborted } = await apiFetch<{ reply?: string; message?: string; conversationId?: string }>(
      '/api/v1/seltra/agent/message',
      { method: 'POST', body: JSON.stringify({ storeId, message, conversationId: convId, hasAttachments: options?.hasAttachments }), signal }
    )
    if (aborted || stoppedRef.current) return ''
   if (data?.conversationId) setConvId(data.conversationId)
    if ((data as { credits?: typeof credits })?.credits) setCredits((data as { credits?: typeof credits }).credits!)
    const reply = merchantFacingAgentReply(data?.reply ?? data?.message ?? '')
    setMsgs((prev) => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: reply } : m))
    return reply
  }, [convId])

  // ── Runs the planner before kicking off a fresh build. If the planner comes
  // back with questions, we start the inline planner thread and wait for the
  // merchant to answer (or skip) before calling beginBuild. ──
  const startConv = async (prompt: string, signal?: AbortSignal) => {
    const limitCheck = await apiFetch<{ allowed: boolean; reason?: string }>('/api/v1/seltra/store/check-limit', { signal })
    if (limitCheck.aborted || signal?.aborted || stoppedRef.current) return
    if (!limitCheck.data?.allowed) {
      toast.error(limitCheck.data?.reason || 'Store limit reached for your plan')
      setSending(false)
      return
    }

    setSending(true)
    const { data: conversation, aborted } = await createConversation(prompt, user?.id, signal)
    if (aborted || signal?.aborted || stoppedRef.current) return
    if (conversation) { setConvId(conversation.id); setConversations((c) => [conversation, ...c]) }
    setMsgs([{ role: 'user', content: prompt, createdAt: new Date().toISOString() }])
    await saveMessage(conversation?.id, 'user', prompt, user?.id)
    if (signal?.aborted || stoppedRef.current) return

    const plan = await runPlanner(prompt, signal)
    if (signal?.aborted || stoppedRef.current) return
    if (plan) {
      beginPlannerThread(prompt, plan)
      return
    }
    await beginBuild(prompt, conversation?.id, undefined, signal)
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
    setMsgs((prev) => [...prev.slice(0, -1), { role: 'user', content: value, createdAt: new Date().toISOString() }])

    const nextIndex = plannerIndex + 1
    if (nextIndex < plannerQueue.length) {
      setPlannerIndex(nextIndex)
      setMsgs((prev) => [...prev, { role: 'planner-question', content: '', question: plannerQueue[nextIndex] }])
    } else {
      setPlannerQueue([])
      setPlannerIndex(0)
      const enriched = mergeAnswersIntoPrompt(plannerPrompt, updatedAnswers)
      const signal = armWork()
      setSending(true)
      await beginBuild(enriched, convId, updatedAnswers, signal)
    }
  }

  const skipPlannerThread = async () => {
    if (!plannerPrompt) return
    setPlannerQueue([])
    setPlannerIndex(0)
    const signal = armWork()
    setSending(true)
    await beginBuild(plannerPrompt, convId, undefined, signal)
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
  const signal = armWork()

  setInput('')
  clearPendingAttachment()
  setSending(true)

  if (!activeStore) { await startConv(displayText || messageToSend, signal); if (!stoppedRef.current) setSending(false); return }

  let activeConversationId = convId
  if (!activeConversationId) {
    const { data: conversation, aborted } = await createConversation(
      displayText.slice(0, 60) || (attachments?.length ? 'Image update' : 'New conversation'),
      user?.id,
      signal,
    )
    if (aborted || signal.aborted || stoppedRef.current) return
    if (conversation) {
      activeConversationId = conversation.id
      setConvId(conversation.id)
      setConversations((c) => [conversation, ...c])
    }
  }

  setMsgs((prev) => [...prev, { role: 'user', content: displayText, attachments, createdAt: new Date().toISOString() }])
  await saveMessage(activeConversationId, 'user', displayText, user?.id)
  if (signal.aborted || stoppedRef.current) return
  const reply = await sendToAgent(activeStore.id ?? activeStore.slug, messageToSend, {
    hasAttachments: imageOperation,
    operation: imageOperation ? 'image-update' : 'generic',
    signal,
  })
  if (stoppedRef.current) return
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
    if (stoppedRef.current) return
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

    if (stoppedRef.current) return

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
    if (stoppedRef.current) return
    setSending(false)
    setBuildId(null)
    setBuildLaunchStarted(false)
    setBuildConversationId(undefined)
    setBuildProgress({
      phase: 'error',
      cardTitle: 'Application build failed',
      previewLabel: 'Build failed',
      images: [],
      galleryTitle: '',
      detail: message || 'The build failed before the storefront was ready.',
    })
  }, [])

  const retryBuild = useCallback(() => {
    const request = buildRequestRef.current
    if (!request) return
    const signal = armWork()
    setSending(true)
    void beginBuild(request.prompt, request.conversationId, request.answers, signal)
  }, [armWork, beginBuild])

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

  useEffect(() => {
    if (!buildId) return
    setBuildProgress({
      phase: 'planning',
      cardTitle: 'Planning your application...',
      previewLabel: 'Planning your storefront',
      images: [],
      galleryTitle: '',
    })
  }, [buildId])
  const showAgentHome = msgs.length === 0 && !sending && !buildId
  const chatTitle = conversations.find((item) => item.id === convId)?.title
    || msgs.find((item) => item.role === 'user')?.content?.slice(0, 48)
    || activeStore?.name
    || 'New chat'
  const waitingOnPlanner = msgs.some((item) => item.role === 'planner-question')
  const storeHref = activeStore ? storefrontUrl(activeStore) : ''

  useEffect(() => {
    if (DEV_PREVIEW) {
      const preview = new URLSearchParams(window.location.search).get('connection')
      if (preview === 'offline' || preview === 'reconnecting') {
        reconnectSource.current = 'stream'
        setLink(preview)
      }
    }
    const goOffline = () => {
      browserOffline.current = true
      setLink('offline')
    }
    const goOnline = () => {
      browserOffline.current = false
      reconnectSource.current = 'browser'
      setLink('reconnecting')
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      browserOffline.current = true
      setLink('offline')
    }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [setLink])

  useEffect(() => {
    if (connection !== 'reconnecting' || reconnectSource.current !== 'browser') return
    const timer = window.setTimeout(() => {
      setLink(navigator.onLine ? 'online' : 'offline')
    }, 1400)
    return () => window.clearTimeout(timer)
  }, [connection, setLink])

  const dismissConnection = useCallback(() => {
    if (!DEV_PREVIEW) {
      setPillDismissed(true)
      return
    }
    const params = new URLSearchParams(window.location.search)
    if (params.get('connection') === 'offline' || params.get('connection') === 'reconnecting') {
      params.delete('connection')
      const query = params.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
      setLink('online')
      return
    }
    setPillDismissed(true)
  }, [setLink])

  useEffect(() => {
    if (!sending && !buildId) {
      setThoughtSeconds(null)
      return
    }
    const started = Date.now()
    const timer = window.setInterval(() => {
      setThoughtSeconds(Math.max(1, Math.round((Date.now() - started) / 1000)))
    }, 500)
    return () => window.clearInterval(timer)
  }, [sending, buildId])

  if (tab !== 'home') {
    return (
      <DashboardFrame
        sidebarProps={sidebarProps}
        mobileOpen={mobileSidebar}
        setMobileOpen={setMobileSidebar}
        connection={connection}
        pillDismissed={pillDismissed}
        onDismissConnection={dismissConnection}
        chatSkeleton={false}
      >
        <main className="dash-canvas relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <DashboardTopBar
            activeStore={activeStore}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((p) => !p)}
            onMenu={() => setMobileSidebar(true)}
          />
          <TabContent
            tab={tab} activeStore={activeStore} stores={stores}
            onSelectStore={(s) => { setActiveStore(s); setTab('mission'); setRev((v) => v + 1) }}
            onStoreDeleted={(id) => { /* unchanged */ }}
            onStoreUpdated={(store) => { /* unchanged */ }}
            reloadStores={loadStores} user={user}
            credits={credits}
          />
        </main>
      </DashboardFrame>
    )
  }

  return (
    <DashboardFrame
      sidebarProps={sidebarProps}
      mobileOpen={mobileSidebar}
      setMobileOpen={setMobileSidebar}
      connection={connection}
      pillDismissed={pillDismissed}
      onDismissConnection={dismissConnection}
      chatSkeleton={!showAgentHome}
    >
      <main className={cn('dash-canvas relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', showAgentHome ? 'is-wash' : 'is-chat')}>
        {showAgentHome ? (
          <>
            {announcementVisible && <WhatsNewBanner onDismiss={dismissAnnouncement} />}
            <EmptyState
              input={input} setInput={setInput} send={send} sending={sending} name={user?.name ?? ''}
              pendingAttachment={pendingAttachment}
              onClearAttachment={clearPendingAttachment}
              stores={stores}
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen((p) => !p)}
              onMenu={() => setMobileSidebar(true)}
              onUpgrade={() => setTab('billing')}
              showUpgrade={user?.plan !== 'premium'}
              activeStore={activeStore}
              onOpenStore={(store) => { rememberRecentStore(store); setActiveStore(store); setTab('store') }}
              onSeeAllStores={() => setTab('store')}
              onAttach={handleAgentAttach}
            />
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-5 sm:px-6 lg:px-7">
              <div className="flex min-w-0 items-center gap-2">
                <button type="button" onClick={() => setMobileSidebar(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-white lg:hidden" aria-label="Open menu">
                  <Menu className="h-4 w-4" />
                </button>
                {!sidebarOpen && (
                  <>
                    <button type="button" onClick={() => setSidebarOpen(true)} className="hidden h-10 w-10 place-items-center rounded-xl border border-white/10 text-white lg:grid" aria-label="Open sidebar">
                      <PanelLeft className="h-4 w-4" />
                    </button>
                    <div className="relative">
                      <button type="button" onClick={() => setChatMenuOpen((current) => !current)} className="flex max-w-[240px] items-center gap-1.5 rounded-xl px-1 py-1 text-[14px] font-medium text-white">
                        <span className="truncate">{chatTitle}</span>
                        <ChevronDown className="h-4 w-4 flex-shrink-0 text-white/50" />
                      </button>
                      {chatMenuOpen && (
                        <div className="absolute left-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-xl border border-white/10 bg-[#262826] py-1 shadow-2xl">
                          {conversations.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-white/40">No conversations yet.</p>
                          ) : conversations.slice(0, 8).map((conversation) => (
                            <button
                              key={conversation.id}
                              type="button"
                              onClick={() => { void loadConversationMessages(conversation); setChatMenuOpen(false) }}
                              className="block w-full truncate px-3 py-2 text-left text-[13px] text-white/80 hover:bg-white/5"
                            >
                              {conversation.title || 'Conversation'}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <NotificationBell activeStore={activeStore} />
                {!previewOpen && (
                  <button type="button" onClick={() => setPreviewOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-white/80 hover:text-white" aria-label="Open store preview">
                    <Expand className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 gap-4 px-3 pb-4 sm:gap-5 sm:px-5 sm:pb-5">
              {buildId && (
                <AgentBuildStream
                  headless
                  storeName={storeTitle}
                  buildId={buildId}
                  onPreview={handleBuildPreview}
                  onLaunchStart={handleBuildLaunchStart}
                  onDone={handleBuildDone}
                  onError={handleBuildError}
                  onProgress={setBuildProgress}
                  onConnection={reportConnection}
                />
              )}
              <section className={cn('flex min-h-0 min-w-0 flex-1 flex-col', mobileView === 'store' && 'hidden lg:flex')}>
                <div ref={scrollRef} className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col gap-6 overflow-y-auto px-3 py-6 sm:px-4">
                  {msgs.map((message, index) => {
                    if (message.role === 'planner-question' && message.question) {
                      const isLatest = index === msgs.length - 1
                      if (!isLatest) return null
                      return (
                        <PlannerQuestionCard
                          key={message.question.id}
                          question={message.question}
                          index={plannerIndex}
                          total={plannerQueue.length}
                          onSubmit={(value) => void answerPlannerQuestion(value)}
                          onSkip={() => void skipPlannerThread()}
                        />
                      )
                    }
                    if (message.role === 'stopped') {
                      if (message.dismissed) return <p key={`stopped-${index}`} className="text-[15px] text-white/80">Stopped</p>
                      return (
                        <StoppedCard
                          key={`stopped-${index}`}
                          onDismiss={() => setMsgs((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, dismissed: true } : item))}
                          onOpenPreview={() => setPreviewOpen(true)}
                        />
                      )
                    }
                    if (message.role === 'user') {
                      return (
                        <UserPromptBubble
                          key={`${message.createdAt ?? index}`}
                          content={message.content}
                          attachments={message.attachments}
                          createdAt={message.createdAt}
                          onEdit={setInput}
                        />
                      )
                    }
                    const isLatestAssistant = index === msgs.map((item) => item.role).lastIndexOf('assistant')
                    return (
                      <AgentReply
                        key={`${message.createdAt ?? index}-assistant`}
                        content={message.content}
                        thoughtSeconds={isLatestAssistant ? thoughtSeconds : null}
                      />
                    )
                  })}
                  {(buildProgress && (buildId || buildProgress.phase === 'ready' || buildProgress.phase === 'error')) && (
                    <BuildFlow
                      key={buildProgress.phase === 'error' ? 'failed' : (buildId ?? 'done')}
                      progress={buildProgress}
                      onOpenPreview={() => setPreviewOpen(true)}
                      onRetry={retryBuild}
                    />
                  )}
                  {(sending || buildId) && !buildProgress && (
                    <p className="text-[15px] text-white/80">Thinking...</p>
                  )}
                </div>
                <div className="mx-auto w-full max-w-[760px] px-3 pb-3 sm:px-4">
                  <ChatInput
                    input={input}
                    setInput={setInput}
                    send={send}
                    sending={sending || Boolean(buildId)}
                    busy={sending || Boolean(buildId)}
                    onStop={stopGeneration}
                    variant="chat"
                    placeholder={waitingOnPlanner ? 'Ask seltra what to do instead...' : 'Ask seltra what to do next...'}
                    onAttach={handleAgentAttach}
                    pendingAttachment={pendingAttachment}
                    onClearAttachment={clearPendingAttachment}
                  />
                </div>
              </section>

              {previewOpen && (
                <aside className={cn('min-h-0 w-full flex-col lg:flex lg:w-[min(520px,42%)]', mobileView === 'chat' ? 'hidden lg:flex' : 'flex')}>
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px] border border-white/10 bg-[#141615]">
                    <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                      <button type="button" onClick={() => setPreviewOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-white/50 hover:bg-white/5 hover:text-white" aria-label="Close preview">
                        <X className="h-4 w-4" />
                      </button>
                      <div className="flex items-center gap-1.5">
                        <button type="button" className="grid h-8 w-8 place-items-center rounded-lg bg-[#1b8a45] text-white" aria-label="Preview notes" onClick={() => setPreviewDevice('desktop')}>
                          <MessageSquare className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => setPreviewDevice('mobile')} className={cn('grid h-8 w-8 place-items-center rounded-lg text-white/55 hover:text-white', previewDevice === 'mobile' && 'bg-white/10 text-white')} aria-label="Phone preview">
                          <Smartphone className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => setPreviewDevice('desktop')} className={cn('grid h-8 w-8 place-items-center rounded-lg text-white/55 hover:text-white', previewDevice === 'desktop' && 'bg-white/10 text-white')} aria-label="Desktop preview">
                          <Monitor className="h-3.5 w-3.5" />
                        </button>
                        {storeHref ? (
                          <a href={storeHref} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1.5 rounded-lg bg-[#1b8a45] px-2.5 py-1.5 text-[12px] font-medium text-white">
                            Open Store
                          </a>
                        ) : (
                          <span className="ml-1 inline-flex items-center rounded-lg bg-white/5 px-2.5 py-1.5 text-[12px] text-white/35">Open Store</span>
                        )}
                      </div>
                    </div>
                    <div className="min-h-0 flex-1">
                      {buildProgress?.phase === 'error' ? (
                        <BuildFailedPreview storeName={chatTitle} onRetry={retryBuild} />
                      ) : buildId && buildProgress?.phase !== 'ready' ? (
                        <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
                          <img src="/assets/brand/mark.png" alt="" className="h-16 w-16 object-contain" />
                          <div className="flex items-center gap-2 text-[15px] text-white/80">
                            <Asterisk className="h-4 w-4 text-white" strokeWidth={2.4} />
                            <span>{buildProgress?.previewLabel || 'Planning your storefront'}</span>
                          </div>
                        </div>
                      ) : activeStore ? (
                        <StorefrontShell slug={storeSlug} isStream={false} showToolbar={false} device={previewDevice} onDeviceChange={setPreviewDevice}>
                          <StorefrontPreview key={previewKey} storeSlug={storeSlug} suppressFallback={!activeStore} rev={rev} />
                        </StorefrontShell>
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                          <img src="/assets/brand/mark.png" alt="" className="h-16 w-16 object-contain" />
                          <p className="text-[15px] text-white/70">Your store will appear here</p>
                        </div>
                      )}
                    </div>
                  </div>
                </aside>
              )}
            </div>
            <div className="flex border-t border-white/10 lg:hidden">
              <button type="button" onClick={() => setMobileView('chat')} className={cn('flex-1 py-2.5 text-xs', mobileView === 'chat' ? 'text-white' : 'text-white/40')}>Agent</button>
              <button type="button" onClick={() => { setPreviewOpen(true); setMobileView('store') }} className={cn('flex-1 py-2.5 text-xs', mobileView === 'store' ? 'text-white' : 'text-white/40')}>Preview</button>
            </div>
          </div>
        )}
      </main>
    </DashboardFrame>
  )
}

function NotificationBell({ activeStore, tone = 'dark' }: { activeStore: StoreData | null; tone?: 'dark' | 'wash' }) {
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
        className={cn(
          'relative grid h-10 w-10 place-items-center rounded-xl transition-colors',
          tone === 'wash'
            ? 'bg-[#1c1e1d] text-white shadow-[0_10px_24px_-14px_rgba(0,0,0,0.55)] hover:bg-[#111312]'
            : 'border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white',
        )}
        aria-label="Open notifications"
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-[#22c55e] px-1 font-mono text-[10px] font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-[#161817] text-left text-white shadow-[0_24px_60px_-24px_rgba(0,0,0,0.65)]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-white">Notifications</div>
              <div className="mt-0.5 text-[11px] text-white/50">{unreadCount} unread</div>
            </div>
            <button type="button" onClick={markAllRead} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-white/70 transition-colors hover:bg-white/5 hover:text-white">
              <CheckCheck className="h-3.5 w-3.5" /> Read
            </button>
          </div>
          <div className="max-h-[420px] divide-y divide-white/10 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-5 text-[13px] leading-relaxed text-white/65">Orders, payments, logins, security alerts, and announcements will appear here.</div>
            ) : items.map((item) => {
              const Icon = item.type === 'order' ? ShoppingBag : item.type === 'payment' ? CreditCard : item.type === 'security' ? ShieldCheck : Megaphone
              const unread = !readIds.includes(item.id)
              return (
                <div key={item.id} className={cn('flex gap-3 px-4 py-3 text-sm', unread && 'bg-white/[0.04]')}>
                  <div className="mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-xl bg-[#1b8a45]/20 text-[#4ade80]">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate font-medium text-white">{item.title}</div>
                      {unread && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#4ade80]" />}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-white/60">{item.body}</p>
                    <div className="mt-1 text-[10px] text-white/40">{new Date(item.createdAt).toLocaleString()}</div>
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

function DashboardTopBar({
  activeStore, sidebarOpen, onToggleSidebar, onMenu,
}: {
  activeStore: StoreData | null
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onMenu: () => void
}) {
  return (
    <div className="relative z-40 flex flex-shrink-0 items-center justify-between px-4 py-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onMenu} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-white lg:hidden" aria-label="Open menu">
          <Menu className="h-4 w-4" />
        </button>
        {!sidebarOpen && (
          <button type="button" onClick={onToggleSidebar} className="hidden h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-white lg:grid" aria-label="Open sidebar">
            <PanelLeft className="h-4 w-4" />
          </button>
        )}
      </div>
      <NotificationBell activeStore={activeStore} />
    </div>
  )
}

function DashboardFrame({
  sidebarProps, mobileOpen, setMobileOpen, children, connection, pillDismissed, onDismissConnection, chatSkeleton,
}: {
  sidebarProps: SidebarSharedProps
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
  children: React.ReactNode
  connection: LinkState
  pillDismissed: boolean
  onDismissConnection: () => void
  chatSkeleton: boolean
}) {
  const disconnected = connection !== 'online'
  return (
    <div className="dash-app flex h-screen overflow-hidden">
      <SidebarDesktop {...sidebarProps} />
      <div className="relative flex min-h-0 min-w-0 flex-1 p-1.5 sm:p-2">
        {children}
        {disconnected && (chatSkeleton ? <ConnectionCanvas /> : <div className="absolute inset-0 z-30 bg-[#141615]/80" />)}
      </div>
      {disconnected && !pillDismissed && <ConnectionPill state={connection} onDismiss={onDismissConnection} />}
      <MobileSidebarDrawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        user={sidebarProps.user}
        tab={sidebarProps.tab}
        setTab={(next) => { sidebarProps.setTab(next); setMobileOpen(false) }}
        onSignOut={sidebarProps.onSignOut}
        onNewStore={sidebarProps.onNewStore}
        conversations={sidebarProps.conversations}
        activeConversationId={sidebarProps.activeConversationId}
        onLoadConversation={(conversation) => { sidebarProps.onLoadConversation(conversation); setMobileOpen(false) }}
        onDeleteConversation={sidebarProps.onDeleteConversation}
      />
    </div>
  )
}

// ── Sidebar (desktop) ──────────────────────────────────────────────────────────
function SidebarDesktop({
  user, tab, setTab, onSignOut, onNewStore, open, onToggle,
  conversations, activeConversationId, onLoadConversation, onDeleteConversation,
}: SidebarSharedProps) {
  const [profileOpen, setProfileOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(true)
  const profileItems = [
    { id: 'account', label: 'Account', icon: UserCircle },
    { id: 'billing', label: 'Billing', icon: CreditCard },
    { id: 'domains', label: 'Domains', icon: Globe2 },
    { id: 'help', label: 'Get Help', icon: HelpCircle },
  ]

  return (
    <aside className={cn('dash-sidebar landing-menu hidden h-full flex-shrink-0 flex-col overflow-hidden transition-[width] duration-200 lg:flex', open ? 'w-[216px]' : 'w-0')}>
      <div className="flex h-[60px] flex-shrink-0 items-center justify-between px-3.5">
        <img src="/assets/brand/logo.png" alt="seltra" className="h-7 w-auto" />
        <button type="button" onClick={onToggle} className="grid h-8 w-8 place-items-center rounded-lg text-white/55 transition-colors hover:bg-white/5 hover:text-white" aria-label="Collapse sidebar">
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onNewStore}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.06]"
        >
          <Plus className="h-4 w-4 text-[#3ddc84]" />
          New store
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-2">
        <button
          type="button"
          onClick={() => setWorkspaceOpen((current) => !current)}
          className="flex w-full items-center justify-between px-2.5 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/40"
        >
          Workspace
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', workspaceOpen ? '' : '-rotate-90')} />
        </button>
        {workspaceOpen && (
          <div className="mt-1 space-y-1">
            {NAV_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn('dash-nav-item flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-[13px] font-medium transition-colors', tab === item.id && 'is-active')}
              >
                <item.icon className="h-[16px] w-[16px] flex-shrink-0" />
                {item.label}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setHistoryOpen((current) => !current)}
          className="mt-5 flex w-full items-center justify-between px-2.5 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/40"
        >
          History
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', historyOpen ? '' : '-rotate-90')} />
        </button>
        {historyOpen && (
          <div className="mt-1 space-y-0.5">
            {conversations.length === 0 ? (
              <p className="px-2.5 py-1.5 text-[13px] leading-relaxed text-white/35">Your conversations will appear here.</p>
            ) : conversations.map((conv) => (
              <div key={conv.id} className={cn('group relative flex items-center gap-1 rounded-xl px-1', activeConversationId === conv.id ? 'bg-white/10' : 'hover:bg-white/5')}>
                <button
                  type="button"
                  onClick={() => onLoadConversation(conv)}
                  className="min-w-0 flex-1 px-2 py-2 text-left"
                >
                  <div className="truncate text-[13px] text-white/80">{conv.title || 'Conversation'}</div>
                </button>
                <details className="relative">
                  <summary className="grid h-7 w-7 cursor-pointer list-none place-items-center rounded-lg text-white/40 marker:content-none hover:bg-white/5 hover:text-white [&::-webkit-details-marker]:hidden" aria-label={`Conversation actions for ${conv.title}`}>
                    <MoreHorizontal className="h-4 w-4" />
                  </summary>
                  <button
                    type="button"
                    onClick={() => onDeleteConversation(conv.id)}
                    className="absolute right-0 top-8 z-20 whitespace-nowrap rounded-lg border border-white/10 bg-[#262826] px-3 py-2 text-left text-xs text-white/80 shadow-xl hover:text-red-300"
                  >
                    Delete
                  </button>
                </details>
              </div>
            ))}
          </div>
        )}
      </div>

      {profileOpen && user && (
        <div className="fixed bottom-[64px] left-2 z-50 w-[200px] overflow-hidden rounded-2xl border border-white/10 bg-[#262826] shadow-2xl">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="truncate text-sm font-medium text-white">{user.name || 'Merchant'}</div>
            <div className="truncate text-[11px] text-white/45">{user.email}</div>
          </div>
          <div className="p-1.5">
            {profileItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setTab(item.id); setProfileOpen(false) }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-white/10 p-1.5">
            <button
              type="button"
              onClick={onSignOut}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white/70 transition-colors hover:bg-red-500/10 hover:text-red-300"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}

      {user && (
        <button
          type="button"
          onClick={() => setProfileOpen((current) => !current)}
          className="flex flex-shrink-0 items-center gap-2.5 border-t border-white/10 px-3 py-3 text-left"
        >
          <Image src={user.avatar} alt={user.name} width={32} height={32} className="h-8 w-8 flex-shrink-0 rounded-full object-cover" unoptimized />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">{user.name || 'Merchant'}</span>
        </button>
      )}
    </aside>
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
            className="dash-sidebar landing-menu fixed left-0 top-0 z-50 flex h-full w-[272px] flex-col lg:hidden"
          >
            <div className="flex h-[72px] items-center justify-between px-4">
              <img src="/assets/brand/logo.png" alt="seltra" className="h-7 w-auto" />
              <button onClick={onClose} className="text-white/55 hover:text-white" aria-label="Close menu"><X className="h-5 w-5" /></button>
            </div>
            <div className="px-3 pb-3">
              <button onClick={() => { onNewStore(); onClose() }}
                className="flex w-full items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-[13.5px] font-medium text-white hover:bg-white/5">
                <Plus className="h-4 w-4 text-[#3ddc84]" /> New store
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 pb-3">
              <div className="px-2.5 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/40">Workspace</div>
              <div className="space-y-0.5">
                {NAV_TABS.map((t) => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={cn('dash-nav-item flex w-full items-center gap-3 rounded-full px-3 py-2 text-[13.5px] font-medium', tab === t.id && 'is-active')}>
                    <t.icon className="h-4 w-4 flex-shrink-0" /> {t.label}
                  </button>
                ))}
              </div>
              <div className="mt-5">
                <div className="px-2.5 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/40">History</div>
                {conversations.length === 0
                  ? <p className="px-2.5 py-1.5 text-[13px] leading-relaxed text-white/35">Your conversations will appear here.</p>
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
function storeCover(store: StoreData) {
  const productImage = store.products?.flatMap((product) => product.images ?? []).find((image) => imageUrl(image?.url))?.url
  return imageUrl(store.canonical?.heroImageUrl) || imageUrl(productImage) || imageUrl(store.heroSource) || imageUrl(store.canonical?.logoUrl)
}

function storeStatusLabel(store: StoreData) {
  const status = (store.status ?? 'active').toLowerCase()
  if (status === 'active') return 'Published'
  if (status === 'draft') return 'Draft'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function EmptyState({
  input, setInput, send, sending, name, onAttach, pendingAttachment, onClearAttachment,
  stores, sidebarOpen, onToggleSidebar, onMenu, onUpgrade, showUpgrade, activeStore, onOpenStore, onSeeAllStores,
}: {
  input: string; setInput: (v: string) => void; send: () => void
  sending: boolean; name: string; onAttach: (f: File) => void
  pendingAttachment?: PendingAttachment | null; onClearAttachment?: () => void
  stores: StoreData[]
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onMenu: () => void
  onUpgrade: () => void
  showUpgrade: boolean
  activeStore: StoreData | null
  onOpenStore: (store: StoreData) => void
  onSeeAllStores: () => void
}) {
  const [library, setLibrary] = useState<'recents' | 'stores'>('recents')
  const [query, setQuery] = useState('')
  const [recentIds, setRecentIds] = useState<string[]>([])
  const firstName = name?.split(' ')[0] || ''
  useEffect(() => { setRecentIds(readRecentStoreIds()) }, [stores])
  const filtered = stores.filter((store) => store.name.toLowerCase().includes(query.trim().toLowerCase()))
  const viewed = recentIds
    .map((id) => filtered.find((store) => store.id === id || store.slug === id))
    .filter((store): store is StoreData => Boolean(store))
  const visibleStores = library === 'recents' ? (viewed.length > 0 ? viewed.slice(0, 3) : filtered.slice(0, 3)) : filtered
  const libraryTitle = library === 'stores' ? 'My stores' : viewed.length > 0 ? 'Recently viewed' : 'Recent stores'
  const starters = [
    'Generate a luxury store for young women in Accra and Lagos — complete with products and checkout.',
    'Generate a luxury store for young women in Accra and Lagos — complete with products and checkout.',
    'Generate a luxury store for young women in Accra and Lagos — complete with products and checkout.',
    'Generate a luxury store for young women in Accra and Lagos — complete with products and checkout.',
  ]

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <Aurora tone="hero" />

      <div className="relative z-40 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 pt-5 sm:px-7 sm:pt-6 lg:px-8">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onMenu} className="grid h-10 w-10 place-items-center rounded-xl bg-[#1c1e1d] text-white lg:hidden" aria-label="Open menu">
            <Menu className="h-4 w-4" />
          </button>
          {!sidebarOpen && (
            <button type="button" onClick={onToggleSidebar} className="hidden h-10 w-10 place-items-center rounded-xl bg-[#1c1e1d] text-white lg:grid" aria-label="Open sidebar">
              <PanelLeft className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex justify-center">
          {showUpgrade && (
            <button
              type="button"
              onClick={onUpgrade}
              className="inline-flex items-center gap-2 rounded-full bg-[#141615] py-1.5 pl-3.5 pr-1.5 text-[12px] font-medium text-white shadow-[0_12px_30px_-16px_rgba(0,0,0,0.55)] sm:gap-2.5 sm:pl-4 sm:text-[13px]"
            >
              Upgrade to Pro
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[#22c55e]">
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </button>
          )}
        </div>
        <NotificationBell activeStore={activeStore} tone="wash" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-[720px] flex-1 flex-col items-center justify-center px-5 py-10 sm:px-6">
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-3.5">
          <img src="/assets/brand/mark.png" alt="" className="h-9 w-9 object-contain sm:h-10 sm:w-10" />
          <h1 className="text-center text-[1.75rem] font-semibold tracking-[-0.04em] text-neutral-950 sm:text-[2.15rem] lg:text-[2.35rem]">
            What&apos;s the vision{firstName ? `, ${firstName}` : ''}?
          </h1>
        </div>

        <div className="landing-composer-halo mt-8 w-full sm:mt-9">
          <div className="landing-prompt group relative flex min-h-[118px] w-full flex-col justify-between overflow-hidden text-left">
            <span className="landing-sheen" aria-hidden />
            {pendingAttachment && (
              <div className="relative z-10 px-5 pt-3">
                <div className="relative h-14 w-14 overflow-hidden rounded-xl border border-black/10">
                  <img src={pendingAttachment.previewUrl} alt={pendingAttachment.name} className="h-full w-full object-cover" />
                  <button type="button" onClick={onClearAttachment} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white" aria-label="Remove attachment">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}
            <div className="relative z-10 px-5 pt-4 sm:px-6">
              <TypewriterPlaceholder
                prompts={[
                  'Ask seltra to build a skincare brand...',
                  'Ask seltra to launch a premium coffee brand...',
                  'Ask seltra to open a fashion store selling...',
                  'Ask seltra to start a handmade jewelry boutique...',
                ]}
                typingSpeed={35}
                deleteSpeed={18}
                pauseDuration={1600}
                active={input.length === 0}
                resumeDelay={200}
                className="pointer-events-none absolute inset-x-5 top-4 text-[15px] leading-6 text-neutral-400 sm:inset-x-6 sm:text-base"
              />
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                rows={1}
                wrap="off"
                placeholder=""
                aria-label="Describe the store you want to build"
                className={cn(
                  'composer-textarea composer-textarea-light relative z-10 h-6 w-full resize-none overflow-x-auto whitespace-pre bg-transparent text-[15px] leading-6 text-neutral-900 focus:outline-none sm:text-base',
                  input.length === 0 && 'caret-transparent',
                )}
              />
            </div>
            <div className="relative z-10 flex items-center justify-between gap-3 px-4 pb-3.5 pt-2.5 sm:px-5 sm:pb-4">
            <label className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-black/[0.08] bg-white text-neutral-400 transition-colors hover:border-black/15 hover:text-neutral-700 sm:h-9 sm:w-9" title="Attach files">
              <Plus className="h-4 w-4" />
              <input type="file" className="hidden" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) onAttach(file); e.target.value = '' }} />
            </label>
            <div className="flex items-center gap-1.5">
              <span className="hidden items-center gap-1 rounded-full px-3 py-2 text-sm font-medium text-neutral-500 sm:inline-flex">
                Build <ChevronDown className="h-4 w-4" />
              </span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 sm:h-9 sm:w-9" title="Voice prompt">
                <Mic className="h-4 w-4" />
              </span>
              <button
                type="button"
                onClick={send}
                disabled={sending || pendingAttachment?.uploading || (!input.trim() && !pendingAttachment)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#22c55e] text-white transition-colors hover:bg-[#16a34a] disabled:opacity-40 sm:h-9 sm:w-9"
                title="Build store"
              >
                {sending ? (
                  <span className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <img src="/seltra/icons/send.png" alt="" className="h-[18px] w-[18px] object-contain" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>

      <div className="relative z-10 mx-auto mt-auto w-full max-w-[1040px] px-4 pb-6 sm:px-8 sm:pb-8 lg:px-12 lg:pb-10">
        {stores.length === 0 ? (
          <section className="rounded-[28px] bg-[#161817] px-4 py-5 text-white sm:px-6 sm:py-6">
            <h2 className="px-1 text-base font-semibold">Getting started</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2 md:gap-4">
              {starters.map((desc, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setInput('A luxury skincare brand for young women in Accra and Lagos — complete with products and checkout.')}
                  className="rounded-2xl bg-[#242624] px-4 py-4 text-left transition-colors hover:bg-[#2c2e2c]"
                >
                  <div className="flex items-start gap-3.5">
                    <span className="mt-0.5 grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-black/35 text-white">
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">Build a skincare brand</span>
                      <span className="mt-1 block text-[13px] leading-relaxed text-white/55">{desc}</span>
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section className="rounded-[28px] bg-[#161817] px-4 py-5 text-white sm:px-6 sm:py-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 rounded-full bg-black/25 p-1">
                <button type="button" onClick={() => setLibrary('recents')} className={cn('rounded-full px-3.5 py-1.5 text-[13px] font-medium', library === 'recents' ? 'bg-[#2c2e2c] text-white' : 'text-white/55')}>Recents</button>
                <button type="button" onClick={() => setLibrary('stores')} className={cn('rounded-full px-3.5 py-1.5 text-[13px] font-medium', library === 'stores' ? 'bg-[#2c2e2c] text-white' : 'text-white/55')}>My stores</button>
              </div>
              <label className="flex h-10 w-full items-center gap-2 rounded-full border border-white/10 px-3 text-white/45 sm:w-auto sm:min-w-[200px]">
                <Search className="h-4 w-4" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search"
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/35"
                />
              </label>
            </div>
            <div className="mt-4 flex items-center justify-between px-1">
              <h2 className="text-[15px] font-semibold">{libraryTitle}</h2>
              <button type="button" onClick={onSeeAllStores} className="rounded-xl border border-white/10 px-3 py-1.5 text-[13px] text-white/80 transition-colors hover:bg-white/5">See all</button>
            </div>
            {visibleStores.length === 0 ? (
              <p className="px-1 py-8 text-sm text-white/45">No stores match that search.</p>
            ) : (
              <div className={cn('mt-4 grid gap-4', library === 'recents' ? 'md:grid-cols-2 xl:grid-cols-3' : 'sm:grid-cols-2 xl:grid-cols-3')}>
                {visibleStores.map((store) => {
                  const cover = storeCover(store)
                  return (
                    <button key={store.id ?? store.slug} type="button" onClick={() => onOpenStore(store)} className="overflow-hidden rounded-2xl bg-[#242624] text-left transition-colors hover:bg-[#2c2e2c]">
                      <div className="relative h-36 bg-[#101211] sm:h-[168px]">
                        {cover ? (
                          <img src={cover} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-end bg-[radial-gradient(circle_at_30%_20%,rgba(74,222,128,0.35),transparent_55%),linear-gradient(160deg,#10241a,#1a1c1b)] p-4">
                            <span className="text-sm font-medium text-white/80">{store.name}</span>
                          </div>
                        )}
                        <span className="absolute bottom-3 left-3 rounded-md bg-[#123024] px-2 py-1 text-[11px] font-medium text-[#b7f7cf]">{storeStatusLabel(store)}</span>
                      </div>
                      <div className="px-3.5 py-3">
                        <div className="truncate text-[14px] font-semibold">{store.name}</div>
                        <div className="mt-0.5 truncate text-[12px] text-white/45">{editedLabel(store.updatedAt) || `${store.slug}.seltra.co`}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

// ── Chat input ─────────────────────────────────────────────────────────────────
function ChatInput({ input, setInput, send, sending, onAttach, compact = false, pendingAttachment, onClearAttachment, variant = 'default', placeholder, busy = false, onStop }: {
  input: string; setInput: (v: string) => void; send: () => void
  sending: boolean; onAttach: (f: File) => void; compact?: boolean
  pendingAttachment?: PendingAttachment | null
  onClearAttachment?: () => void
  variant?: 'default' | 'chat'
  placeholder?: string
  busy?: boolean
  onStop?: () => void
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
      <div className={cn(
        'flex items-end gap-2 px-3 py-2',
        variant === 'chat'
          ? 'min-h-[92px] rounded-[22px] border border-white/10 bg-[#161817]'
          : 'rounded-[28px] border border-border bg-card/60 shadow-sm transition-all focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10',
      )}>
        <label className={cn('flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-full', variant === 'chat' ? 'border border-white/10 text-white/45 hover:text-white' : 'text-muted-foreground transition-colors hover:bg-muted/60 hover:text-primary')}>
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
          placeholder={placeholder ?? (pendingAttachment ? 'Describe what to do with this image...' : 'Message your agent...')}
          className={cn('flex-1 resize-none bg-transparent py-1.5 px-1 text-sm outline-none leading-[1.5] overflow-x-auto whitespace-pre composer-textarea', variant === 'chat' ? 'text-white placeholder:text-white/35' : 'placeholder:text-muted-foreground')}
          style={{ minHeight: 36, maxHeight: compact || variant === 'chat' ? 120 : 160, overflowY: 'auto' }}
        />
        {variant === 'chat' && (
          <span className="mb-1 hidden items-center gap-1 px-2 text-sm text-white/45 sm:inline-flex">
            Build <ChevronDown className="h-4 w-4" />
          </span>
        )}
        {variant === 'chat' && (
          <span className="mb-1 grid h-9 w-9 place-items-center text-white/40" title="Voice prompt">
            <Mic className="h-4 w-4" />
          </span>
        )}
        <button
          type="button"
          onClick={() => { if (busy) { onStop?.(); return } send() }}
          disabled={!busy && (sending || pendingAttachment?.uploading || (!input.trim() && !pendingAttachment))}
          aria-label={busy ? 'Stop' : 'Send'}
          className="mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#22c55e] text-white transition-opacity hover:opacity-90 disabled:opacity-35"
        >
          {busy ? <span className="block h-3 w-3 rounded-[3px] bg-white" /> : variant === 'chat' ? <img src="/seltra/icons/send.png" alt="" className="h-[18px] w-[18px] object-contain" /> : <Send className="h-4 w-4" />}
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
