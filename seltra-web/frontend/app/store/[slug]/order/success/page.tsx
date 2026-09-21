//frontend/app/store/[slug]order/success/page.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertCircle, CheckCircle, Loader2, ShoppingBag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { motion } from 'framer-motion'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'
const SELTRA_LOGO = 'https://res.cloudinary.com/dfmsaarli/image/upload/seltra_logo_1_wdtlfv.png'

type VerificationState = 'idle' | 'checking' | 'confirmed' | 'pending' | 'failed'

type VerifiedOrder = {
  id?: string
  totalAmount?: string | number
  currency?: string
  paystackRef?: string | null
}

export default function OrderSuccessPage() {
  const params = useParams<{ slug: string }>()
  const [state, setState] = useState<VerificationState>('idle')
  const [message, setMessage] = useState('Confirming your payment...')
  const [order, setOrder] = useState<VerifiedOrder | null>(null)
  const [reference, setReference] = useState<string | null>(null)

  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    setReference(search.get('reference') || search.get('trxref') || '')
  }, [])

  useEffect(() => {
    if (reference === null) return

    if (!reference) {
      setState('pending')
      setMessage('Payment is being confirmed. Receipt details will follow by email.')
      return
    }

    let cancelled = false
    let attempts = 0

    const verify = async () => {
      attempts += 1
      setState((current) => (current === 'confirmed' ? current : 'checking'))

      try {
        const res = await fetch(`${API_BASE}/api/v1/payment/verify?reference=${encodeURIComponent(reference)}`)
        const data = await res.json().catch(() => ({}))
        if (cancelled) return

        if (data?.success) {
          setState('confirmed')
          setOrder(data.order ?? null)
          setMessage('Payment received. Your order is being prepared.')
          return
        }

        if (data?.status === 'pending' && attempts < 8) {
          setState('pending')
          setMessage('Payment is being confirmed. This page will update automatically.')
          setTimeout(() => { if (!cancelled) void verify() }, 8000)
          return
        }

        setState(data?.status === 'pending' ? 'pending' : 'failed')
        setMessage(data?.message || 'Payment could not be confirmed yet. Please keep your receipt reference.')
      } catch {
        if (!cancelled) {
          setState('pending')
          setMessage('Payment is being confirmed. Receipt details will follow by email.')
        }
      }
    }

    void verify()
    return () => { cancelled = true }
  }, [reference])

  const amount = order?.totalAmount
    ? `${order.currency || 'GHS'} ${Number(order.totalAmount).toFixed(2)}`
    : null

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-0 flex w-full justify-center">
        <img
          src={SELTRA_LOGO}
          alt="Seltra"
          className="h-46 w-auto object-contain sm:h-24 md:h-32"
        />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        className="w-full max-w-md text-center"
      >
        <div className="mb-6 flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            {state === 'checking' ? (
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            ) : state === 'failed' ? (
              <AlertCircle className="h-10 w-10 text-destructive" />
            ) : (
              <CheckCircle className="h-10 w-10 text-primary" />
            )}
          </div>
        </div>

        <h1 className="mb-2 text-2xl font-bold tracking-tight">
          {state === 'failed' ? 'Payment not confirmed' : 'Order confirmed'}
        </h1>
        <p className="mb-5 text-muted-foreground">{message}</p>

        {(reference || amount) && (
          <div className="mb-6 rounded-lg border bg-card p-4 text-left text-sm">
            {amount && (
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold">{amount}</span>
              </div>
            )}
            {reference && (
              <div className="grid gap-1">
                <span className="text-muted-foreground">Reference</span>
                <span className="break-all font-mono text-xs">{reference}</span>
              </div>
            )}
          </div>
        )}

        {/* <Button asChild className="w-full gap-2">
          <Link href={`/store/${params.slug}`}>
            <ShoppingBag className="h-4 w-4" /> Continue shopping
          </Link>
        </Button> */}
        <Button asChild className="w-full gap-2">
          <Link href="/">
            <ShoppingBag className="h-4 w-4" /> Continue shopping
          </Link>
        </Button>
        <p className="mt-5 text-xs text-muted-foreground">
          Checkout, receipt, and order updates powered by Seltra.
        </p>
      </motion.div>
    </div>
  )
}