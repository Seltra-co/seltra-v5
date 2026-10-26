'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, FileText, Image as ImageIcon, Mic, Paperclip, Sparkles, Wrench, X, Plus, Figma } from 'lucide-react'
import { AuthFlowModal } from '@/components/marketing/AuthFlowModal'
import { TypewriterPlaceholder } from '@/components/marketing/TypewriterPlaceholder'
import { savePendingBuild } from '@/lib/builder/pending'
import { cn } from '@/lib/utils'

type Mode = 'build' | 'chat' | 'plan'
type Rec = { lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void; stop: () => void }
type RecWindow = Window & { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }

export function MarketingComposer({ prompts, hero = false }: { prompts: string[]; hero?: boolean }) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [filePreviews, setFilePreviews] = useState<(string | null)[]>([])
  const [mode, setMode] = useState<Mode>('build')
  const [menu, setMenu] = useState<'attachments' | 'mode' | null>(null)
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [waveform, setWaveform] = useState(Array.from({ length: 48 }, () => 0.08))
  const [loading, setLoading] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [authSession, setAuthSession] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recognition = useRef<Rec | null>(null)
  const voiceBase = useRef('')
  const voiceDraft = useRef('')
  const voicePauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioStream = useRef<MediaStream | null>(null)
  const analyser = useRef<AnalyserNode | null>(null)
  const audioContext = useRef<AudioContext | null>(null)
  const animationFrame = useRef<number | null>(null)
  const router = useRouter()
  const stopMeter = () => {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current)
    animationFrame.current = null
    audioStream.current?.getTracks().forEach((track) => track.stop())
    audioStream.current = null
    analyser.current = null
    if (audioContext.current && audioContext.current.state !== 'closed') void audioContext.current.close()
    audioContext.current = null
  }
  const startMeter = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioStream.current = stream
      const context = new AudioContext()
      audioContext.current = context
      const meter = context.createAnalyser()
      meter.fftSize = 256
      meter.smoothingTimeConstant = 0.78
      context.createMediaStreamSource(stream).connect(meter)
      analyser.current = meter
      const bins = new Uint8Array(meter.frequencyBinCount)
      const draw = () => {
        if (!analyser.current) return
        analyser.current.getByteFrequencyData(bins)
        setWaveform(Array.from({ length: 48 }, (_, i) => Math.max(0.06, Math.min(1, bins[Math.min(bins.length - 1, Math.floor((i / 48) * bins.length * 0.72))] / 190))))
        animationFrame.current = requestAnimationFrame(draw)
      }
      animationFrame.current = requestAnimationFrame(draw)
    } catch { /* Transcription can still work where microphone metering is blocked. */ }
  }
  useEffect(() => () => {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current)
    if (voicePauseTimer.current) clearTimeout(voicePauseTimer.current)
    audioStream.current?.getTracks().forEach((track) => track.stop())
    if (audioContext.current && audioContext.current.state !== 'closed') void audioContext.current.close()
  }, [])
  useEffect(() => {
    const urls = files.map((file) => file.type.startsWith('image/') ? URL.createObjectURL(file) : null)
    setFilePreviews(urls)
    return () => urls.forEach((url) => { if (url) URL.revokeObjectURL(url) })
  }, [files])
  const token = () => localStorage.getItem('seltra:token')
  const handoff = async (figma = false) => {
    await savePendingBuild({ prompt: text.trim(), mode, files, figma })
    if (!token()) { setAuthSession((n) => n + 1); setAuthOpen(true); return }
    router.push('/dashboard')
  }
  const send = async () => {
    if ((!text.trim() && !files.length) || loading) return
    setLoading(true)
    try {
      await handoff()
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }
  const revealVoiceDraft = () => {
    if (voicePauseTimer.current) clearTimeout(voicePauseTimer.current)
    voicePauseTimer.current = null
    const spoken = voiceDraft.current.trim()
    if (!spoken) return
    setTranscript(spoken)
    setText(`${voiceBase.current}${voiceBase.current ? ' ' : ''}${spoken}`)
    requestAnimationFrame(() => {
      if (!textareaRef.current) return
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 128)}px`
    })
  }
  const finishVoice = () => {
    revealVoiceDraft()
    recognition.current?.stop()
    stopMeter()
    setRecording(false)
  }
  const discardVoice = () => {
    if (voicePauseTimer.current) clearTimeout(voicePauseTimer.current)
    voicePauseTimer.current = null
    voiceDraft.current = ''
    recognition.current?.stop()
    stopMeter()
    setRecording(false)
    setText(voiceBase.current)
    setTranscript('')
  }
  const toggleVoice = () => {
    if (recording) { finishVoice(); return }
    const Constructor = (window as RecWindow).SpeechRecognition ?? (window as RecWindow).webkitSpeechRecognition
    if (!Constructor) { setTranscript('Live speech recognition is not available in this browser.'); return }
    const rec = new Constructor()
    recognition.current = rec
    voiceBase.current = text.trim()
    rec.lang = navigator.language || 'en-US'
    rec.interimResults = true
    rec.continuous = true
    rec.onresult = (event) => {
      let result = ''
      for (let i = 0; i < event.results.length; i++) result += event.results[i][0]?.transcript ?? ''
      voiceDraft.current = result
      if (voicePauseTimer.current) clearTimeout(voicePauseTimer.current)
      voicePauseTimer.current = setTimeout(revealVoiceDraft, 700)
    }
    rec.onend = () => { revealVoiceDraft(); setRecording(false); stopMeter() }
    rec.onerror = () => { setRecording(false); stopMeter() }
    setTranscript('Listening…')
    voiceBase.current = text.trim()
    voiceDraft.current = ''
    setRecording(true)
    rec.start()
    void startMeter()
  }
  const pickFiles = (accept: string) => { if (!fileRef.current) return; fileRef.current.accept = accept; fileRef.current.click() }
  return <>
    <div className={cn('landing-prompt relative mx-auto flex min-h-[112px] w-full flex-col justify-between overflow-visible text-left', hero ? 'max-w-[532px]' : 'max-w-[564px]')}>
      <div className="relative px-5 pt-4 sm:px-6">
        {!text && !transcript && <TypewriterPlaceholder prompts={prompts} typingSpeed={35} deleteSpeed={18} pauseDuration={1600} active={!text} resumeDelay={200} className="pointer-events-none absolute inset-x-5 top-4 text-sm leading-6 text-neutral-400 sm:inset-x-6 sm:text-sm" />}
        <textarea ref={textareaRef} value={text} onChange={(e) => { setText(e.target.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 128)}px` }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} aria-label="Describe what you want Seltra to build" rows={1} className="composer-textarea composer-textarea-light relative z-10 min-h-7 max-h-32 w-full resize-none overflow-y-auto whitespace-pre-wrap break-words bg-transparent text-[15px] leading-6 text-neutral-900 focus:outline-none sm:text-base" />
      </div>
      {files.length > 0 && <div className="mx-5 mb-1 flex max-w-[calc(100%-2.5rem)] gap-2 overflow-x-auto pb-1">{files.map((file, i) => <div key={`${file.name}-${i}`} className="relative h-[84px] w-[96px] shrink-0 overflow-hidden rounded-xl border border-black/10 bg-neutral-100">{filePreviews[i] ? <img src={filePreviews[i] ?? ''} alt={file.name} className="h-full w-full object-cover" /> : <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-neutral-500"><FileText className="h-6 w-6"/><span className="w-full truncate text-center text-[10px]">{file.name}</span></div>}<span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[10px] text-white">{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, index) => index !== i))} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/65 text-white"><X className="h-3 w-3"/></button></div>)}</div>}
      {recording && <div className="mx-4 mb-2 flex min-h-12 items-center gap-2 rounded-full border border-black/10 bg-neutral-50 px-2.5 py-1.5 sm:mx-5"><button type="button" aria-label="Discard voice input" onClick={discardVoice} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-black/10 text-neutral-600 hover:bg-white"><X className="h-4 w-4"/></button><div className="flex h-8 min-w-0 flex-1 items-center justify-center gap-[2px] overflow-hidden" role="img" aria-label="Live microphone waveform">{waveform.slice(0, 40).map((level, i) => <span key={i} className="w-[3px] shrink-0 rounded-full bg-neutral-500/90 transition-[height] duration-75" style={{ height: `${Math.max(2, Math.round(level * 28))}px` }}/>)}</div><span className="sr-only" aria-live="polite">{transcript || 'Listening'}</span><button type="button" aria-label="Stop voice transcription" onClick={finishVoice} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-black/10 bg-white text-neutral-700"><span className="h-3 w-3 rounded-[3px] bg-current"/></button><button type="button" aria-label="Use voice transcription" onClick={finishVoice} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-neutral-900 text-white"><Check className="h-4 w-4"/></button></div>}
      <div className="flex items-center justify-between gap-3 px-4 pb-3.5 pt-2.5 sm:px-5 sm:pb-4 sm:pt-3">
        <div className="relative"><button type="button" aria-label="Add attachments" aria-expanded={menu === 'attachments'} onClick={() => setMenu(menu === 'attachments' ? null : 'attachments')} className="flex h-9 w-9 items-center justify-center rounded-full border border-black/[0.08] bg-white text-neutral-500 hover:text-neutral-800"><Plus className="h-4 w-4"/></button>
          {menu === 'attachments' && <div className="absolute left-0 top-full z-50 mt-2 w-56 rounded-2xl border border-black/10 bg-white p-1.5 text-neutral-800 shadow-xl"><button type="button" onClick={() => { setMenu(null); pickFiles('*/*') }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-neutral-100"><Paperclip className="h-4 w-4"/>Attach files</button><button type="button" onClick={() => { setMenu(null); pickFiles('image/*') }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-neutral-100"><ImageIcon className="h-4 w-4"/>Attach image</button><button type="button" onClick={() => { setMenu(null); void handoff(true) }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-neutral-100"><Figma className="h-4 w-4 text-fuchsia-600"/>Import from Figma</button></div>}
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { setFiles((current) => [...current, ...Array.from(e.target.files ?? [])]); e.currentTarget.value = '' }}/>
        </div>
        <div className="flex items-center gap-1.5"><div className="relative"><button type="button" aria-expanded={menu === 'mode'} onClick={() => setMenu(menu === 'mode' ? null : 'mode')} className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-medium text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800">{mode === 'build' ? 'Build' : mode === 'plan' ? 'Plan' : 'Chat'}<ChevronDown className="h-4 w-4"/></button>
          {menu === 'mode' && <div className="absolute bottom-auto right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-black/10 bg-white p-1.5 text-neutral-800 shadow-xl">{([['build','Build','Make changes directly',Wrench],['chat','Chat','Ask anything, explore ideas',Sparkles],['plan','Plan','Detailed spec for complex builds',FileText]] as const).map(([value,label,desc,Icon])=><button key={value} type="button" onClick={() => { setMode(value); setMenu(null) }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-neutral-100"><Icon className="h-4 w-4 text-green-600"/><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{label}{value === 'chat' && <small className="ml-2 rounded-full bg-blue-600 px-2 py-0.5 text-white">Free</small>}</span><span className="block text-xs text-neutral-500">{desc}</span></span>{mode === value && <Check className="h-4 w-4 text-green-600"/>}</button>)}</div>}</div>
          <button type="button" onClick={toggleVoice} aria-label={recording ? 'Stop voice input' : 'Start voice input'} className={cn('flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-50 hover:text-neutral-700', recording && 'bg-green-50 text-green-700')}><Mic className="h-4 w-4"/></button>
          <button type="button" onClick={() => void send()} disabled={(!text.trim() && !files.length) || loading} className="flex h-9 w-9 items-center justify-center rounded-full bg-[#16a34a] text-white hover:bg-[#15803d] disabled:opacity-40" title="Continue to Seltra">{loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"/> : <img src="/seltra/icons/send.png" alt="Send" className="h-[18px] w-[18px] object-contain"/>}</button>
        </div>
      </div>
    </div>
    <AuthFlowModal key={authSession} open={authOpen} nextPath="/dashboard" onClose={() => setAuthOpen(false)}/>
  </>
}
