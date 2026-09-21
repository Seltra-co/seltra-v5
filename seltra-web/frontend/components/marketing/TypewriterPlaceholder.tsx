'use client'

import { useEffect, useMemo, useState } from 'react'

type TypewriterPlaceholderProps = {
  prompts: string[]
  typingSpeed?: number
  deleteSpeed?: number
  pauseDuration?: number
  loop?: boolean
  active?: boolean
  resumeDelay?: number
  className?: string
}

type Phase = 'typing' | 'pauseAfterTyping' | 'deleting' | 'pauseAfterDeleting'

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setPrefersReducedMotion(media.matches)

    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return prefersReducedMotion
}

export function TypewriterPlaceholder({
  prompts,
  typingSpeed = 35,
  deleteSpeed = 18,
  pauseDuration = 1600,
  loop = true,
  active = true,
  resumeDelay = 1200,
  className,
}: TypewriterPlaceholderProps) {
  const safePrompts = useMemo(() => prompts.filter(Boolean), [prompts])
  const [promptIndex, setPromptIndex] = useState(0)
  const [visibleLength, setVisibleLength] = useState(0)
  const [phase, setPhase] = useState<Phase>('typing')
  const [canRun, setCanRun] = useState(active)
  const prefersReducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    if (active) {
      const timer = window.setTimeout(() => setCanRun(true), resumeDelay)
      return () => window.clearTimeout(timer)
    }

    setCanRun(false)
    setVisibleLength(0)
    setPhase('typing')
    return undefined
  }, [active, resumeDelay])

  useEffect(() => {
    if (!canRun || safePrompts.length === 0) return undefined

    if (prefersReducedMotion) {
      setVisibleLength(safePrompts[promptIndex]?.length ?? 0)
      if (!loop && promptIndex === safePrompts.length - 1) return undefined

      const timer = window.setTimeout(() => {
        setPromptIndex((current) => {
          const next = current + 1
          return next >= safePrompts.length ? 0 : next
        })
      }, pauseDuration + 1400)

      return () => window.clearTimeout(timer)
    }

    const prompt = safePrompts[promptIndex] ?? ''
    let delay = typingSpeed

    if (phase === 'typing') {
      if (visibleLength >= prompt.length) {
        delay = pauseDuration
        const timer = window.setTimeout(() => setPhase('pauseAfterTyping'), delay)
        return () => window.clearTimeout(timer)
      }

      const timer = window.setTimeout(() => setVisibleLength((length) => length + 1), delay)
      return () => window.clearTimeout(timer)
    }

    if (phase === 'pauseAfterTyping') {
      setPhase('deleting')
      return undefined
    }

    if (phase === 'deleting') {
      if (visibleLength <= 0) {
        delay = 420
        const timer = window.setTimeout(() => setPhase('pauseAfterDeleting'), delay)
        return () => window.clearTimeout(timer)
      }

      const timer = window.setTimeout(() => setVisibleLength((length) => Math.max(0, length - 1)), deleteSpeed)
      return () => window.clearTimeout(timer)
    }

    if (!loop && promptIndex === safePrompts.length - 1) return undefined

    const timer = window.setTimeout(() => {
      setPromptIndex((current) => {
        const next = current + 1
        return next >= safePrompts.length ? 0 : next
      })
      setPhase('typing')
    }, 260)

    return () => window.clearTimeout(timer)
  }, [
    canRun,
    deleteSpeed,
    loop,
    pauseDuration,
    phase,
    prefersReducedMotion,
    promptIndex,
    safePrompts,
    typingSpeed,
    visibleLength,
  ])

  if (!canRun || safePrompts.length === 0) return null

  const currentPrompt = safePrompts[promptIndex] ?? ''
  const text = currentPrompt.slice(0, visibleLength)

  return (
    <div aria-hidden="true" className={className}>
      <div className="min-h-[1.45em] text-white/60">
        {text}
        {!prefersReducedMotion && <span className="ml-0.5 inline-block h-[1em] w-px translate-y-0.5 animate-pulse bg-primary/80" />}
      </div>
    </div>
  )
}
