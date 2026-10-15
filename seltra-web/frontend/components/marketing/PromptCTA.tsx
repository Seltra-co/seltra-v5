'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Mic, Plus } from 'lucide-react'
import { AuthFlowModal } from '@/components/marketing/AuthFlowModal'
import { Aurora } from '@/components/marketing/Aurora'
import { TypewriterPlaceholder } from '@/components/marketing/TypewriterPlaceholder'
import { cn } from '@/lib/utils'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'

const prompts = [
  'Ask Seltra to launch a premium coffee brand for...',
  'Ask Seltra to open a bakery selling artisan pastries that...',
  'Ask Seltra to start an organic grocery delivery store...',
]

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('seltra:token') : null
}

async function hasStores() {
  const token = getToken()
  if (!token) return false
  try {
    const res = await fetch(`${API_BASE}/api/v1/seltra/store`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => [])
    return Array.isArray(json) && json.length > 0
  } catch {
    return false
  }
}

export function PromptCTA() {
  const [chatInput, setChatInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [authSession, setAuthSession] = useState(0)
  const router = useRouter()

  const handleRun = async () => {
    setIsLoading(true)
    const prompt = chatInput.trim()
    if (prompt) sessionStorage.setItem('seltra:pending_prompt', prompt)

    if (!getToken()) {
      setIsLoading(false)
      setAuthSession((session) => session + 1)
      setAuthOpen(true)
      return
    }

    if (prompt) {
      router.push('/dashboard')
      return
    }

    router.push((await hasStores()) ? '/dashboard' : '/onboarding')
  }

  return (
    <section className="relative overflow-hidden px-5 py-20 sm:py-28">
      <Aurora tone="cta" />
      <div className="relative z-10 mx-auto max-w-2xl text-center">
        <h2 className="text-[2rem] font-semibold tracking-[-0.035em] text-neutral-950 sm:text-[2.75rem]">
          Your store is <span className="text-[#16a34a]">one prompt away</span>
        </h2>
        <p className="mx-auto mt-4 whitespace-nowrap text-[15px] text-neutral-500 sm:text-base">
          No code. No designers. No manual setup. Just describe what you are building.
        </p>

        <div className="mx-auto mt-8 w-full max-w-[564px]">
          <div className="landing-prompt flex min-h-[117px] flex-col justify-between overflow-hidden text-left">
            <div className="relative px-5 pt-4 sm:px-6">
              <TypewriterPlaceholder
                prompts={prompts}
                typingSpeed={35}
                deleteSpeed={18}
                pauseDuration={1600}
                active={chatInput.length === 0}
                resumeDelay={200}
                className="pointer-events-none absolute inset-x-5 top-4 text-[15px] leading-6 text-neutral-400 sm:inset-x-6 sm:text-base"
              />
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void handleRun()
                  }
                }}
                aria-label="Describe the store you want to build"
                wrap="off"
                rows={1}
                className={cn(
                  'composer-textarea composer-textarea-light relative z-10 h-6 w-full resize-none overflow-x-auto whitespace-pre bg-transparent text-[15px] leading-6 text-neutral-900 focus:outline-none sm:text-base',
                  chatInput.length === 0 && 'caret-transparent',
                )}
              />
            </div>

            <div className="flex items-center justify-between gap-3 px-4 pb-3.5 pt-2.5 sm:px-5 sm:pb-4 sm:pt-3">
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.08] bg-white text-neutral-400 transition-colors hover:border-black/15 hover:text-neutral-700 sm:h-9 sm:w-9" title="Attach files">
                <Plus className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-1.5">
                <button type="button" className="hidden items-center gap-1 rounded-full px-3 py-2 text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-800 sm:inline-flex">
                  Build <ChevronDown className="h-4 w-4" />
                </button>
                <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-50 hover:text-neutral-700 sm:h-9 sm:w-9" title="Voice prompt">
                  <Mic className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleRun()}
                  disabled={!chatInput.trim() || isLoading}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#16a34a] text-white transition-colors hover:bg-[#15803d] disabled:pointer-events-none disabled:opacity-100 sm:h-9 sm:w-9"
                  title="Build store"
                >
                  {isLoading ? (
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
      <AuthFlowModal key={authSession} open={authOpen} nextPath="/onboarding" onClose={() => setAuthOpen(false)} />
    </section>
  )
}
