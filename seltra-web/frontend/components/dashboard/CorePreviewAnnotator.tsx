'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, RotateCcw, X } from 'lucide-react'

type Point = { x: number; y: number }
type Stroke = Point[]

export function CorePreviewAnnotator({
  screenshot,
  onCancel,
  onAttach,
}: {
  screenshot: string
  onCancel: () => void
  onAttach: (file: File) => void
}) {
  const imageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeStrokeRef = useRef<Stroke | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [activeStroke, setActiveStroke] = useState<Stroke | null>(null)

  useEffect(() => {
    const image = imageRef.current
    const canvas = canvasRef.current
    if (!image || !canvas || !size.width || !size.height) return
    const context = canvas.getContext('2d')
    if (!context) return
    canvas.width = size.width
    canvas.height = size.height
    context.clearRect(0, 0, size.width, size.height)
    context.drawImage(image, 0, 0, size.width, size.height)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = '#ef4444'
    context.lineWidth = Math.max(4, size.width / 250)
    for (const stroke of [...strokes, ...(activeStroke ? [activeStroke] : [])]) {
      if (stroke.length < 2) continue
      context.beginPath()
      context.moveTo(stroke[0].x, stroke[0].y)
      for (const point of stroke.slice(1)) context.lineTo(point.x, point.y)
      context.stroke()
    }
  }, [size, screenshot, strokes, activeStroke])

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * size.width,
      y: ((event.clientY - bounds.top) / bounds.height) * size.height,
    }
  }

  const attach = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return
      onAttach(new File([blob], 'annotated-core-preview.png', { type: 'image/png' }))
    }, 'image/png')
  }

  return <div className="absolute inset-0 z-20 flex flex-col bg-[#101211]">
    <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
      <p className="text-xs text-white/75">Draw on the preview to point out what to change.</p>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => { setStrokes([]); setActiveStroke(null); activeStrokeRef.current = null }} className="grid h-8 w-8 place-items-center rounded-lg text-white/65 hover:bg-white/10" aria-label="Clear annotations"><RotateCcw size={15} /></button>
        <button type="button" onClick={onCancel} className="grid h-8 w-8 place-items-center rounded-lg text-white/65 hover:bg-white/10" aria-label="Cancel annotation"><X size={16} /></button>
        <button type="button" onClick={attach} disabled={!size.width || !size.height} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"><Check size={14} /> Add to chat</button>
      </div>
    </div>
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
      <div className="relative max-h-full max-w-full" style={size.width && size.height ? { aspectRatio: `${size.width} / ${size.height}`, height: '100%' } : undefined}>
        <img ref={imageRef} src={screenshot} alt="Core preview screenshot" className="hidden" onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
        <canvas
          ref={canvasRef}
          className="h-full max-h-full max-w-full touch-none cursor-crosshair"
          aria-label="Annotated preview screenshot"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            const stroke = [pointFromEvent(event)]
            activeStrokeRef.current = stroke
            setActiveStroke(stroke)
          }}
          onPointerMove={(event) => {
            if (!activeStrokeRef.current) return
            const stroke = [...activeStrokeRef.current, pointFromEvent(event)]
            activeStrokeRef.current = stroke
            setActiveStroke(stroke)
          }}
          onPointerUp={() => { if (activeStrokeRef.current) setStrokes((current) => [...current, activeStrokeRef.current!]); activeStrokeRef.current = null; setActiveStroke(null) }}
          onPointerCancel={() => { if (activeStrokeRef.current) setStrokes((current) => [...current, activeStrokeRef.current!]); activeStrokeRef.current = null; setActiveStroke(null) }}
        />
      </div>
    </div>
  </div>
}
