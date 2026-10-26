'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Circle, ClipboardList, Loader2, Sparkles, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

export type CoreTodo = { id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }
export type CoreQuestion = { id: string; type: 'text' | 'radio' | 'checkbox'; question: string; options?: string[]; required?: boolean; placeholder?: string }
export type CoreQuestionnaire = { requestId: string; chatId: number; questions: CoreQuestion[]; isResponding?: boolean }
export type CoreBlueprint = { chatId: number; appName: string; userPrompt: string; templateId: string; themeId: string; designDirection: string; primaryColor: string; visuals?: Array<{ type: string; description: string; prompt: string }> }

type MessageBlock =
  | { kind: 'text'; content: string }
  | { kind: 'thought'; complete: boolean }
  | { kind: 'status'; title: string; state: string; content: string }
  | { kind: 'output'; title: string; state: string; content: string }
  | { kind: 'blueprint'; blueprint: Omit<CoreBlueprint, 'chatId'> }
  | { kind: 'asset'; prompt: string; path: string; state: string }

function decodeAttribute(value: string) {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

function attributes(source: string) {
  const result: Record<string, string> = {}
  for (const match of source.matchAll(/([\w-]+)="([^"]*)"/g)) result[match[1]] = decodeAttribute(match[2])
  return result
}

function parseMessage(source: string): MessageBlock[] {
  const blocks: MessageBlock[] = []
  const token = /<(think)\s*>([\s\S]*?)(?:<\/think>|$)|<(dyad-[a-z-]+)\b([^>]*)>([\s\S]*?)(?:<\/\3>|$)/gi
  let cursor = 0
  for (const match of source.matchAll(token)) {
    const start = match.index ?? 0
    if (start > cursor) blocks.push({ kind: 'text', content: source.slice(cursor, start) })
    if (match[1]) {
      blocks.push({ kind: 'thought', complete: match[0].toLowerCase().endsWith('</think>') })
    } else {
      const tag = (match[3] ?? '').toLowerCase()
      const attrs = attributes(match[4] ?? '')
      const actionTitles: Record<string, string> = {
        'dyad-write': 'Writing a file', 'dyad-edit': 'Updating a file', 'dyad-rename': 'Renaming a file',
        'dyad-delete': 'Removing a file', 'dyad-git': 'Saving changes', 'dyad-write-plan': 'Build plan',
        'dyad-exit-plan': 'Plan updated', 'dyad-app-blueprint': 'App blueprint', 'dyad-questionnaire': 'Follow-up questions',
        'dyad-image-generation': 'Preparing an image', 'dyad-command': 'Next step',
      }
      const isOutput = tag === 'dyad-output'
      if (tag === 'dyad-app-blueprint') {
        blocks.push({ kind: 'blueprint', blueprint: { appName: attrs['app-name'] || '', userPrompt: '', templateId: attrs.template || '', themeId: attrs.theme || '', designDirection: attrs['design-direction'] || '', primaryColor: attrs['primary-color'] || '' } })
        cursor = start + match[0].length
        continue
      }
      if (tag === 'dyad-image-generation') {
        blocks.push({ kind: 'asset', prompt: attrs.prompt || 'Generated visual', path: attrs.path || '', state: attrs.state || (match[0].toLowerCase().endsWith('</dyad-image-generation>') ? 'finished' : 'pending') })
        cursor = start + match[0].length
        continue
      }
      if (tag === 'dyad-questionnaire') {
        const answers = [...(match[5] ?? '').matchAll(/<qa\s+question="([^"]*)"\s+type="([^"]*)">([\s\S]*?)<\/qa>/gi)]
        blocks.push({ kind: 'status', title: 'Your answers will guide the build', state: attrs.state || 'finished', content: answers.map((answer) => `${decodeAttribute(answer[1])}\n${answer[3].trim()}`).join('\n\n') || 'Your answers have been saved.' })
        cursor = start + match[0].length
        continue
      }
      const isFileOperation = ['dyad-write', 'dyad-edit', 'dyad-rename', 'dyad-delete'].includes(tag)
      const complete = match[0].toLowerCase().endsWith(`</${tag}>`)
      blocks.push({
        kind: isOutput ? 'output' : 'status',
        title: attrs.title || attrs.message || (isOutput ? 'Notice' : actionTitles[tag] || 'Working'),
        state: attrs.state || (attrs.type === 'error' ? 'error' : complete ? 'finished' : 'pending'),
        content: isFileOperation ? attrs.description || attrs.path || '' : match[5] ?? '',
      })
    }
    cursor = start + match[0].length
  }
  if (cursor < source.length) blocks.push({ kind: 'text', content: source.slice(cursor) })

  // A partial custom tag at the end of a live stream is parser state, not user-facing copy.
  const last = blocks.at(-1)
  if (last?.kind === 'text') {
    const partialTag = last.content.lastIndexOf('<')
    if (partialTag >= 0 && /^<\/?[a-z][\w-]*(?:\s[^>]*)?$/i.test(last.content.slice(partialTag))) {
      last.content = last.content.slice(0, partialTag)
    }
  }
  const visibleBlocks = blocks.filter((block) => block.kind !== 'text' || block.content.trim())
  return visibleBlocks.filter((block, index) => {
    const previous = visibleBlocks[index - 1]
    if (block.kind !== 'status' || previous?.kind !== 'status') return true
    if (block.title === 'Working' && previous.title === 'Working') return false
    return !(block.title === previous.title && block.state === previous.state && block.content.trim() === previous.content.trim())
  })
}

function QuestionCard({ questionnaire, onSubmit }: { questionnaire: CoreQuestionnaire; onSubmit: (answers: Record<string, string> | null) => void }) {
  const { questions } = questionnaire
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const question = questions[index]
  if (!question) return null
  const answer = answers[question.id] ?? ''
  const isLast = index === questions.length - 1

  const updateAnswer = (value: string) => setAnswers((current) => ({ ...current, [question.id]: value }))
  const advance = () => {
    if (question.required !== false && !answer.trim()) return
    if (isLast) onSubmit(answers)
    else setIndex((current) => Math.min(current + 1, questions.length - 1))
  }

  return (
    <section className="my-4 w-full min-w-0 max-w-[680px] overflow-hidden rounded-2xl border border-emerald-400/20 bg-[#171b19] shadow-[0_16px_50px_rgba(0,0,0,.18)]" aria-label="Build questionnaire">
      <header className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300"><ClipboardList className="h-4 w-4" /></span><div><p className="text-sm font-semibold text-white">A few quick questions</p><p className="text-xs text-white/45">Help Core shape the first version</p></div></div>
        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs tabular-nums text-white/60">{index + 1} of {questions.length}</span>
      </header>
      <div className="px-4 py-4 sm:px-5">
        <div className="mb-4 h-1 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${((index + 1) / questions.length) * 100}%` }} /></div>
        <h3 className="text-[15px] font-semibold leading-6 text-white">{question.question}</h3>
        <div className="mt-3 space-y-2">
          {question.type === 'text' || !question.options?.length ? (
            <textarea value={answer} onChange={(event) => updateAnswer(event.target.value)} placeholder={question.placeholder || 'Type your answer…'} rows={2} className="w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-emerald-400/50" />
          ) : question.type === 'checkbox' ? (
            <div className="space-y-2">{question.options.map((option) => { const selected = answer.split('\n').includes(option); return <button type="button" key={option} onClick={() => updateAnswer(selected ? answer.split('\n').filter((item) => item !== option).join('\n') : [...answer.split('\n').filter(Boolean), option].join('\n'))} className={cn('flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors', selected ? 'border-emerald-400/35 bg-emerald-400/[0.08] text-white' : 'border-white/[0.08] bg-white/[0.02] text-white/75 hover:bg-white/[0.06]')}><span className={cn('grid h-4 w-4 place-items-center rounded border', selected ? 'border-emerald-400 bg-emerald-400 text-[#0c1710]' : 'border-white/25')}>{selected && <Check className="h-3 w-3" />}</span>{option}</button>})}</div>
          ) : (
            <div className="space-y-2">{question.options.map((option) => { const selected = answer === option; return <button type="button" key={option} onClick={() => updateAnswer(option)} className={cn('flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors', selected ? 'border-emerald-400/35 bg-emerald-400/[0.08] text-white' : 'border-white/[0.08] bg-white/[0.02] text-white/75 hover:bg-white/[0.06]')}><span className={cn('grid h-4 w-4 place-items-center rounded-full border', selected ? 'border-emerald-400' : 'border-white/25')}>{selected && <span className="h-2 w-2 rounded-full bg-emerald-400" />}</span>{option}</button>})}</div>
          )}
        </div>
        <footer className="mt-5 flex items-center justify-between">
          <div className="flex items-center gap-2"><button type="button" onClick={() => onSubmit(null)} disabled={questionnaire.isResponding} className="rounded-lg px-2 py-2 text-sm text-white/45 hover:text-white disabled:opacity-25">Dismiss</button><button type="button" onClick={() => setIndex((current) => Math.max(0, current - 1))} disabled={index === 0 || questionnaire.isResponding} className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm text-white/55 hover:text-white disabled:opacity-25"><ChevronLeft className="h-4 w-4" />Back</button></div>
          <button type="button" onClick={advance} disabled={(question.required !== false && !answer.trim()) || questionnaire.isResponding} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-[#082012] hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-45">{questionnaire.isResponding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{isLast ? 'Submit answers' : 'Next'}{!isLast && <ChevronRight className="h-4 w-4" />}</button>
        </footer>
      </div>
    </section>
  )
}

export function CoreTodoProgress({ todos }: { todos: CoreTodo[] }) {
  const [open, setOpen] = useState(true)
  if (!todos.length) return null
  const done = todos.filter((todo) => todo.status === 'completed').length
  const active = todos.find((todo) => todo.status === 'in_progress')
  return <section className="my-3 w-full min-w-0 max-w-[680px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#171b19]">
    <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-white/[0.025]">
      <span className="flex min-w-0 items-center gap-2.5"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-400/10 text-emerald-300"><ClipboardList className="h-4 w-4" /></span><span className="truncate text-sm font-medium text-white">{active?.content || (done === todos.length ? 'All steps complete' : 'Build progress')}</span></span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-white/50">{done}/{todos.length}<ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} /></span>
    </button>
    {open && <ol className="space-y-2 border-t border-white/[0.06] px-4 py-3">{todos.map((todo) => <li key={todo.id} className={cn('flex min-w-0 items-start gap-2.5 text-[13px]', todo.status === 'completed' ? 'text-white/40' : 'text-white/75')}>
      {todo.status === 'completed' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : todo.status === 'in_progress' ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-300" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-white/25" />}
      <span className={cn('min-w-0 break-words [overflow-wrap:anywhere]', todo.status === 'completed' && 'line-through')}>{todo.content}</span>
    </li>)}</ol>}
  </section>
}

function BlueprintCard({ blueprint, onApprove, onNameChange }: { blueprint: CoreBlueprint; onApprove: () => Promise<void>; onNameChange: (name: string) => void }) {
  const [name, setName] = useState(blueprint.appName)
  const [approving, setApproving] = useState(false)
  return <section className="my-4 w-full min-w-0 max-w-[680px] overflow-hidden rounded-2xl border border-emerald-400/20 bg-[#171b19] p-4 shadow-[0_16px_50px_rgba(0,0,0,.18)]">
    <div className="flex items-center gap-2 text-sm font-semibold text-white"><span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300"><Sparkles className="h-4 w-4" /></span>Review your app plan</div>
    <label className="mt-4 block text-xs text-white/50">App name<input value={name} onChange={(event) => { setName(event.target.value); onNameChange(event.target.value) }} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400/50" /></label>
    <p className="mt-3 text-sm leading-6 text-white/65">{blueprint.designDirection || 'Core will build the app from your prompt.'}</p>
    <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/55">{blueprint.templateId && <span className="rounded-full bg-white/[0.06] px-2.5 py-1">Template: {blueprint.templateId}</span>}{blueprint.themeId && <span className="rounded-full bg-white/[0.06] px-2.5 py-1">Theme: {blueprint.themeId}</span>}{blueprint.primaryColor && <span className="rounded-full bg-white/[0.06] px-2.5 py-1">Color: {blueprint.primaryColor}</span>}</div>
    {blueprint.visuals?.length ? <ul className="mt-3 space-y-1 text-xs text-white/55">{blueprint.visuals.map((visual, index) => <li key={`${visual.type}-${index}`}>{visual.type}: {visual.description}</li>)}</ul> : null}
    <div className="mt-4 flex justify-end"><button type="button" disabled={approving || !name.trim()} onClick={async () => { setApproving(true); try { await onApprove() } catch { /* The dashboard reports the Core operation error. */ } finally { setApproving(false) } }} className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-[#082012] hover:bg-emerald-300 disabled:opacity-50">{approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Approve and build</button></div>
  </section>
}

const INITIAL_ACTIVITY = ['Thinking', 'Planning', 'Imagining', 'Exploring', 'Reasoning', 'Mulling']
const BUILD_ACTIVITY = ['Moulding', 'Crafting', 'Assembling', 'Forging', 'Sketching', 'Wiring', 'Polishing', 'Building', 'Rendering']

function CoreActivity({ hasResponse }: { hasResponse: boolean }) {
  const [index, setIndex] = useState(0)
  const words = hasResponse ? BUILD_ACTIVITY : INITIAL_ACTIVITY
  useEffect(() => {
    setIndex(0)
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % words.length), 3600)
    return () => window.clearInterval(timer)
  }, [hasResponse, words.length])
  return <div className="my-3 inline-flex items-center gap-2.5 rounded-full border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 text-[13px] text-white/50" aria-live="polite"><Sparkles className="h-3.5 w-3.5 text-emerald-300/80" /><span>{words[index]}…</span></div>
}

function GeneratedAssets({ assets, loadAsset }: { assets: Array<Extract<MessageBlock, { kind: 'asset' }>>; loadAsset?: (path: string) => Promise<string> }) {
  const [images, setImages] = useState<Record<number, string>>({})
  const [failed, setFailed] = useState<number[]>([])
  const assetKey = assets.map((asset) => `${asset.path}:${asset.prompt}:${asset.state}`).join('|')
  useEffect(() => {
    let cancelled = false
    setImages({}); setFailed([])
    if (loadAsset) assets.forEach((asset, index) => {
      if (!asset.path) return
      void loadAsset(asset.path).then((url) => { if (!cancelled) setImages((current) => ({ ...current, [index]: url })) }).catch(() => { if (!cancelled) setFailed((current) => [...current, index]) })
    })
    return () => { cancelled = true }
  }, [assetKey, loadAsset])
  return <section className="my-3 w-full min-w-0 max-w-[680px] overflow-hidden rounded-2xl border border-white/10 bg-[#171b19]">
    <header className="flex items-center justify-between border-b border-white/[0.07] px-3.5 py-2.5"><span className="text-sm font-medium text-white">Generated visuals</span><span className="text-xs text-white/40">{assets.length} {assets.length === 1 ? 'asset' : 'assets'}</span></header>
    <div className="grid grid-cols-2 gap-2 p-2.5 sm:grid-cols-3">{assets.map((asset, index) => <figure key={`${asset.path}-${index}`} className="min-w-0 overflow-hidden rounded-xl border border-white/[0.06] bg-black/20">
      {images[index] ? <img src={images[index]} alt={asset.prompt} className="aspect-square w-full object-cover" /> : <div className="grid aspect-square place-items-center bg-gradient-to-br from-emerald-950/70 via-[#202723] to-black px-2 text-center text-xs text-white/50"><span><Sparkles className="mx-auto mb-1.5 h-4 w-4 text-emerald-300" />{failed.includes(index) ? 'Preview unavailable' : asset.state === 'pending' ? 'Generating…' : asset.prompt}</span></div>}
      <figcaption className="line-clamp-2 px-2.5 py-2 text-[11px] leading-4 text-white/55" title={asset.prompt}>{asset.prompt}</figcaption>
    </figure>)}</div>
  </section>
}

export function CoreAgentMessage({ content, isStreaming, todos, questionnaire, blueprint, onQuestionnaireSubmit, onBlueprintApprove, onBlueprintNameChange, loadAsset }: { content: string; isStreaming?: boolean; todos?: CoreTodo[]; questionnaire?: CoreQuestionnaire; blueprint?: CoreBlueprint; onQuestionnaireSubmit?: (answers: Record<string, string> | null) => void; onBlueprintApprove?: () => Promise<void>; onBlueprintNameChange?: (name: string) => void; loadAsset?: (path: string) => Promise<string> }) {
  const blocks = useMemo(() => parseMessage(content), [content])
  const hasQuestionnaireStatus = blocks.some((block) => block.kind === 'status' && /questionnaire/i.test(block.title))
  const hasBlueprintBlock = blocks.some((block) => block.kind === 'blueprint')
  return <div className="w-full min-w-0 max-w-[680px] overflow-x-hidden text-[15px] leading-7 text-white/90">
    {/* The dashboard shows a dedicated startup/waiting card while this
        placeholder message is empty. Start the inline activity label only
        after Core has streamed content, so the empty row is not mistaken for
        a response. */}
    {isStreaming && content.trim() ? <CoreActivity hasResponse /> : null}
    {blocks.map((block, index) => {
      if (block.kind === 'blueprint') return blueprint && onBlueprintApprove ? <BlueprintCard key={`blueprint-${index}`} blueprint={blueprint} onApprove={onBlueprintApprove} onNameChange={onBlueprintNameChange ?? (() => undefined)} /> : null
      if (block.kind === 'asset') {
        if (blocks[index - 1]?.kind === 'asset') return null
        const assets: Array<Extract<MessageBlock, { kind: 'asset' }>> = []
        for (let cursor = index; cursor < blocks.length && blocks[cursor].kind === 'asset'; cursor++) assets.push(blocks[cursor] as Extract<MessageBlock, { kind: 'asset' }>)
        return <GeneratedAssets key={`assets-${index}`} assets={assets} loadAsset={loadAsset} />
      }
      if (block.kind === 'thought') return null
      if (block.kind === 'status') return <div key={`status-${index}`} className={cn('my-3 flex min-w-0 gap-3 rounded-xl border px-3.5 py-3', /error|failed|aborted/i.test(block.state) ? 'border-red-400/20 bg-red-400/[0.05]' : 'border-white/[0.08] bg-[#171b19]')}>
        <span className="mt-0.5 shrink-0 text-emerald-300">{/error|failed|aborted/i.test(block.state) ? <TriangleAlert className="h-4 w-4 text-red-300" /> : /finished|complete/i.test(block.state) ? <CheckCircle2 className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}</span>
        <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium text-white">{hasQuestionnaireStatus && questionnaire ? 'Your answers will guide the build' : block.title}</p>{block.content.trim() && !(hasQuestionnaireStatus && questionnaire) ? <details className="mt-1 min-w-0 text-[13px] leading-5 text-white/55"><summary className="w-fit cursor-pointer select-none text-xs text-white/45 hover:text-white/75">Show details</summary><pre className="mt-2 max-h-64 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words font-sans [overflow-wrap:anywhere]">{block.content.trim()}</pre></details> : null}</div>
      </div>
      if (block.kind === 'output') return <div key={`output-${index}`} className="my-3 min-w-0 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] px-3.5 py-3"><p className="break-words text-sm font-medium text-amber-100">{block.title}</p>{block.content.trim() && <details className="mt-1 min-w-0 text-[13px] leading-5 text-white/60"><summary className="w-fit cursor-pointer select-none text-xs text-white/45 hover:text-white/75">Show error details</summary><pre className="mt-2 max-h-64 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words font-sans [overflow-wrap:anywhere]">{block.content.trim()}</pre></details>}</div>
      return <p key={`text-${index}`} className="my-2 min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{block.content.replace(/\n{3,}/g, '\n\n').trim()}</p>
    })}
    {blueprint && onBlueprintApprove && !hasBlueprintBlock ? <BlueprintCard blueprint={blueprint} onApprove={onBlueprintApprove} onNameChange={onBlueprintNameChange ?? (() => undefined)} /> : null}
    {questionnaire && onQuestionnaireSubmit ? <QuestionCard key={questionnaire.requestId} questionnaire={questionnaire} onSubmit={onQuestionnaireSubmit} /> : null}
    {todos?.length ? <CoreTodoProgress todos={todos} /> : null}
  </div>
}
