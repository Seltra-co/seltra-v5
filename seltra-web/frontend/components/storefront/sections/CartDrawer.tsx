//frontend/components/storefront/sections/CartDrawer.tsx
'use client'
import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import { X, Minus, Plus, ArrowRight, Loader2, ShoppingBag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import type { DeliveryTier, SelectedVariants, StoreProduct } from './types'

export interface CartItem { key: string; product: StoreProduct; quantity: number; selectedVariants?: SelectedVariants }

interface Props {
  open: boolean
  items: CartItem[]
  currency: string
  storeSlug: string
  storeId?: string
  onClose: () => void
  onUpdateQty: (id: string, delta: number) => void
  fulfillmentMode?: 'delivery' | 'pickup' | 'both' | null
  contactPhone?: string | null
  pickupAddress?: string | null
  pickupInstructions?: string | null
  deliveryDays?: string | null
  deliveryEstimate?: string | null
  deliveryFeeNote?: string | null
  deliveryTiers?: DeliveryTier[] | null
  checkoutLabel?: string
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'seltra.co'

function orderSuccessUrl(storeSlug: string): string {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return `${window.location.origin}/store/${storeSlug}/order/success`
  }
  return `https://${storeSlug}.${ROOT_DOMAIN}/order/success`
}

export function CartDrawer({
  open, items, currency, storeSlug, storeId, onClose, onUpdateQty,
  fulfillmentMode = 'delivery', contactPhone, pickupAddress, pickupInstructions,
  deliveryDays, deliveryEstimate, deliveryFeeNote, deliveryTiers, checkoutLabel,
}: Props) {
  const total     = items.reduce((s, i) => s + Number(i.product.price) * i.quantity, 0)
  const itemCount = items.reduce((s, i) => s + i.quantity, 0)
  const [co, setCo]           = useState(false)
  const [mode, setMode]       = useState<'delivery' | 'pickup'>(fulfillmentMode === 'pickup' ? 'pickup' : 'delivery')
  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')
  const [phone, setPhone]     = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity]       = useState('')
  const [mkt, setMkt]         = useState(true)
  const [loading, setLoading] = useState(false)

  const showModeChoice = fulfillmentMode === 'both'
  const isPickup = fulfillmentMode === 'pickup' || (fulfillmentMode === 'both' && mode === 'pickup')

  const checkout = async () => {
    if (!storeId || !name || !email || !phone || loading) return
    if (!isPickup && (!address || !city)) {
      toast.error('Please add a delivery address and city')
      return
    }
    if (!storeId || storeId.startsWith('fallback-')) {
      toast.error('Store is still loading. Please refresh and try again.')
      return
    }
    setLoading(true)
    try {
      const tok = typeof window !== 'undefined' ? localStorage.getItem('seltra:token') : null
      const res = await fetch(`${API_BASE}/api/v1/payment/initialize`, {
        method:'POST', headers:{ 'Content-Type':'application/json', ...(tok?{Authorization:`Bearer ${tok}`}:{}) },
        body: JSON.stringify({
          tenantId:storeId,
          items:items.map((i) => ({
            product:{ id:i.product.id, name:i.product.name, price:i.product.price },
            quantity:i.quantity,
            selectedVariants:i.selectedVariants,
          })),
          customerEmail:email.trim(), customerName:name.trim(), customerPhone:phone.trim(),
          shippingAddress: isPickup ? 'Pickup at merchant location' : address.trim(),
          shippingCity: isPickup ? '' : city.trim(),
          marketingOptIn:mkt,
          fulfillmentMode: isPickup ? 'pickup' : 'delivery',
          callbackUrl: orderSuccessUrl(storeSlug),
        }),
      })
      const data = await res.json()
      const url  = data?.authorization_url ?? data?.authorizationUrl
      if (!url) throw new Error(data?.message || 'Payment init failed')
      window.location.href = url
    } catch (err) { setLoading(false); toast.error(err instanceof Error ? err.message : 'Checkout failed') }
  }

  const inp = 'w-full rounded-[var(--store-radius)] border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2'
  const inpStyle = { borderColor:'var(--store-border)', color:'var(--store-text)' }

  return (
    <>
      <AnimatePresence>
        {open && <motion.div key="ov" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} transition={{ duration:0.2 }} className="store-cart-overlay" onClick={onClose} />}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.div key="dr" initial={{ x:'100%' }} animate={{ x:0 }} exit={{ x:'100%' }} transition={{ type:'spring', damping:28, stiffness:280 }} className="store-cart-drawer">
            <div className="flex flex-shrink-0 items-center justify-between border-b px-5 py-4" style={{ borderColor:'var(--store-border)' }}>
              <div className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" style={{ color:'var(--store-accent)' }} />
                <span className="font-bold text-[0.9375rem]" style={{ color:'var(--store-text)' }}>Your cart{itemCount>0&&<span className="ml-1 font-normal opacity-50 text-sm">({itemCount})</span>}</span>
              </div>
              <button onClick={onClose} className="rounded-full p-1.5 opacity-40 transition-opacity hover:opacity-100" style={{ color:'var(--store-text)' }}><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain p-4" style={{ minHeight:0 }}>
              {items.length===0 ? <div className="flex h-full items-center justify-center text-sm" style={{ color:'var(--store-muted)' }}>Your cart is empty</div> : (
                <div className="space-y-3">
                  <AnimatePresence initial={false}>
                    {items.map(({ key, product, quantity, selectedVariants }) => {
                      const imgUrl = product.images?.find((i) => i.isPrimary)?.url ?? product.images?.[0]?.url ?? ''
                      const hasImg = imgUrl && !imgUrl.startsWith('data:')
                      const variantLabel = selectedVariants
                        ? Object.keys(selectedVariants).sort((a, b) => a.localeCompare(b)).map((name) => `${name}: ${selectedVariants[name]}`).join(' · ')
                        : ''
                      return (
                        <motion.div key={key} layout initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-20 }} transition={{ duration:0.2 }} className="flex gap-3 rounded-[var(--store-radius)] border p-3" style={{ borderColor:'var(--store-border)', background:'var(--store-bg)' }}>
                          <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded" style={{ background:'var(--store-accent-soft)' }}>
                            {hasImg && <Image src={imgUrl} alt={product.name} fill className="object-cover" sizes="48px" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="truncate text-[0.8rem] font-semibold" style={{ color:'var(--store-text)' }}>{product.name}</div>
                            {variantLabel && <div className="mt-0.5 line-clamp-2 text-[0.68rem]" style={{ color:'var(--store-muted)' }}>{variantLabel}</div>}
                            <div className="text-[0.7rem]" style={{ color:'var(--store-muted)' }}>{product.currency} {Number(product.price).toFixed(2)}</div>
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-1.5 text-sm">
                            <button onClick={() => onUpdateQty(key,-1)} className="flex h-6 w-6 items-center justify-center rounded border transition-colors hover:border-[color:var(--store-accent)]" style={{ borderColor:'var(--store-border)', color:'var(--store-text)' }}><Minus className="h-3 w-3" /></button>
                            <span className="w-4 text-center tabular-nums" style={{ color:'var(--store-text)' }}>{quantity}</span>
                            <button onClick={() => onUpdateQty(key,1)} className="flex h-6 w-6 items-center justify-center rounded border transition-colors hover:border-[color:var(--store-accent)]" style={{ borderColor:'var(--store-border)', color:'var(--store-text)' }}><Plus className="h-3 w-3" /></button>
                          </div>
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>
                </div>
              )}
            </div>
            {items.length>0 && (
              <div className="flex-shrink-0 border-t p-4" style={{ borderColor:'var(--store-border)', background:'var(--store-surface)' }}>
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span style={{ color:'var(--store-muted)' }}>Total</span>
                  <span className="font-extrabold" style={{ color:'var(--store-accent)' }}>{currency} {total.toFixed(2)}</span>
                </div>
                <Button className="store-btn-primary w-full py-2.5 text-sm font-bold" style={{ background:'var(--store-cta-checkout-bg)', color:'var(--store-cta-checkout-text)', borderRadius:'var(--store-radius)' }} onClick={() => { onClose(); setCo(true) }}>
                  {checkoutLabel ?? 'Checkout'} <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {co && (
          <>
            <motion.div key="co-ov" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setCo(false)} />
            <motion.div key="co-modal" initial={{ opacity:0, scale:0.96, y:16 }} animate={{ opacity:1, scale:1, y:0 }} exit={{ opacity:0, scale:0.96, y:16 }} transition={{ duration:0.22 }} className="fixed inset-0 z-50 overflow-y-auto px-4 py-5" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto w-full max-w-md overflow-hidden rounded-3xl border shadow-2xl" style={{ background:'var(--store-surface)', borderColor:'var(--store-border)', maxHeight:'calc(100vh - 3rem)' }}>
                <div className="flex items-start justify-between border-b px-5 py-4" style={{ borderColor:'var(--store-border)' }}>
                  <div>
                    <h3 className="font-bold" style={{ color:'var(--store-text)' }}>Complete your order</h3>
                    <p className="mt-0.5 text-xs" style={{ color:'var(--store-muted)' }}>Total: <span className="font-semibold" style={{ color:'var(--store-accent)' }}>{currency} {total.toFixed(2)}</span></p>
                  </div>
                  <button onClick={() => setCo(false)} className="opacity-40 hover:opacity-100 transition-opacity" style={{ color:'var(--store-text)' }}><X className="h-4 w-4" /></button>
                </div>

                <div className="grid gap-3 p-5 overflow-y-auto" style={{ maxHeight:'calc(100vh - 11rem)', minHeight:0 }}>
                  {/* ── Fulfillment mode choice, only if merchant supports both ── */}
                  {showModeChoice && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {(['delivery', 'pickup'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMode(m)}
                          className="rounded-[var(--store-radius)] border px-3 py-2 text-sm font-medium capitalize transition-colors"
                          style={{
                            borderColor: mode === m ? 'var(--store-accent)' : 'var(--store-border)',
                            background: mode === m ? 'var(--store-accent-soft)' : 'transparent',
                            color: mode === m ? 'var(--store-accent)' : 'var(--store-text)',
                          }}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="grid gap-1"><span className="store-eyebrow">Full name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ama Owusu" className={inp} style={inpStyle} /></label>
                    <label className="grid gap-1"><span className="store-eyebrow">Phone</span><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+233 20 000 0000" className={inp} style={inpStyle} /></label>
                  </div>
                  <label className="grid gap-1"><span className="store-eyebrow">Email for receipt</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ama@example.com" className={inp} style={inpStyle} /></label>

                  {isPickup ? (
                    <div className="rounded-[var(--store-radius)] border p-3 text-sm" style={{ borderColor:'var(--store-accent)', background:'var(--store-accent-soft)', color:'var(--store-text)' }}>
                      <div className="font-semibold" style={{ color:'var(--store-accent)' }}>Pickup order</div>
                      {pickupAddress ? (
                        <p className="mt-1 text-xs">{pickupAddress}</p>
                      ) : (
                        <p className="mt-1 text-xs opacity-80">Pickup location will be confirmed by the merchant.</p>
                      )}
                      {pickupInstructions && <p className="mt-1 text-xs opacity-80">{pickupInstructions}</p>}
                      <p className="mt-2 text-xs">
                        Merchant contact: <span className="font-semibold">{contactPhone ?? 'The merchant will contact you with pickup details.'}</span>
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="grid gap-1"><span className="store-eyebrow">Delivery address</span><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="14 Ring Road" className={inp} style={inpStyle} /></label>
                        <label className="grid gap-1"><span className="store-eyebrow">City / area</span><input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Accra" className={inp} style={inpStyle} /></label>
                      </div>
                      <div className="rounded-[var(--store-radius)] border p-3 text-sm" style={{ borderColor:'var(--store-border)', background:'var(--store-surface)', color:'var(--store-text)' }}>
                        <div className="font-semibold">Standard delivery</div>
                        <p className="mt-1 text-xs text-muted-foreground">The merchant will contact you directly to confirm delivery details.</p>
                        {(deliveryDays || deliveryEstimate || deliveryFeeNote) && (
                          <div className="mt-3 text-xs" style={{ color:'var(--store-muted)' }}>
                            {deliveryDays && <p>Delivery days: <span className="font-medium" style={{ color:'var(--store-text)' }}>{deliveryDays}</span></p>}
                            {deliveryEstimate && <p className="mt-0.5">Estimated arrival: <span className="font-medium" style={{ color:'var(--store-text)' }}>{deliveryEstimate}</span></p>}
                            <p className="mt-0.5">{deliveryFeeNote || 'Delivery will be handled at an affordable rate to your location.'}</p>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  <label className="flex cursor-pointer items-center gap-2 rounded-[var(--store-radius)] border px-3 py-2.5 text-xs" style={{ borderColor:'var(--store-border)', color:'var(--store-muted)' }}>
                    <input type="checkbox" checked={mkt} onChange={(e) => setMkt(e.target.checked)} /> Send me order updates and store offers
                  </label>
                  <button
                    onClick={checkout}
                    disabled={!name||!email||!phone||loading||(!isPickup && (!address||!city))}
                    className="store-btn-primary mt-1 flex w-full items-center justify-center gap-2 py-3 text-sm font-bold disabled:opacity-40"
                    style={{ background:'var(--store-cta-checkout-bg)', color:'var(--store-cta-checkout-text)', borderRadius:'var(--store-radius)' }}
                  >
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Opening Moolre...</> : <>{checkoutLabel ?? 'Pay'} {currency} {total.toFixed(2)} <ArrowRight className="h-4 w-4" /></>}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
