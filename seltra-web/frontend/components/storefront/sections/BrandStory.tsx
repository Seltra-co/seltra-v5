//seltra-web/frontend/components/storefront/sections/BrandStory.tsx
'use client'

import { motion } from 'framer-motion'
import { SafeImage } from './SafeImage'
import { isValidImageUrl } from './utils'

interface Props {
    headline: string
    body: string
    stat?: string
    statLabel?: string
    layout: 'text-left' | 'text-center'
    imageUrl?: string
}

export function BrandStory({
    headline,
    body,
    stat,
    statLabel,
    layout,
    imageUrl,
}: Props) {

    const centered = layout === 'text-center'
    const safeStoryImageUrl = isValidImageUrl(imageUrl) ? imageUrl : null

    return (
        <section
            className="border-t"
            style={{
                borderColor: 'var(--store-border)',
                background: 'var(--store-bg)',
                paddingTop: 'clamp(4rem,8vh,6rem)',
                paddingBottom: 'clamp(4rem,8vh,6rem)',
                paddingLeft: 'clamp(1rem,4vw,2rem)',
                paddingRight: 'clamp(1rem,4vw,2rem)',
            }}
        >

            <div
                className={`grid gap-12 ${
                    centered
                        ? 'place-items-center'
                        : 'lg:grid-cols-[1fr_1fr]'
                } max-w-6xl mx-auto`}
            >

                <div
                    className={`flex flex-col gap-5 ${
                        centered
                            ? 'items-center text-center max-w-xl'
                            : 'justify-center'
                    }`}
                >

                    <motion.span
                        initial={{ opacity: 0, x: -8 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        className="store-eyebrow"
                        style={{ color: 'var(--store-accent)' }}
                    >
                        Our Story
                    </motion.span>

                    <motion.h2
                        initial={{ opacity: 0, y: 16 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="store-heading text-[clamp(1.8rem,3vw,2.8rem)] font-black"
                    >
                        {headline}
                    </motion.h2>

                    <motion.p
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        viewport={{ once: true }}
                        className="leading-8"
                        style={{
                            color: 'var(--store-muted)',
                            maxWidth: '55ch',
                        }}
                    >
                        {body}
                    </motion.p>

                    {stat && (
                        <div className="pt-4">

                            <div
                                className="store-heading text-5xl font-black"
                                style={{
                                    color: 'var(--store-accent)',
                                }}
                            >
                                {stat}
                            </div>

                            {statLabel && (
                                <div
                                    className="store-eyebrow mt-1"
                                    style={{
                                        color: 'var(--store-muted)',
                                    }}
                                >
                                    {statLabel}
                                </div>
                            )}

                        </div>
                    )}

                </div>

                {safeStoryImageUrl && (

                    <motion.div
                        initial={{ opacity: 0, scale: .97 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        className={`relative ${centered ? 'w-full max-w-3xl' : 'hidden lg:block'}`}
                    >

                        <div
                            className="relative overflow-hidden rounded-2xl"
                            style={{
                                background: 'var(--store-accent-soft)',
                                aspectRatio: centered ? '16 / 9' : '4 / 3',
                            }}
                        >

                            <SafeImage
                                src={safeStoryImageUrl}
                                alt={headline || 'Brand story image'}
                                fill
                                className="object-cover"
                            />

                        </div>

                        {!centered && (
                            <div
                                className="absolute -bottom-4 -right-4 rounded-xl border px-5 py-4"
                                style={{
                                    background: 'var(--store-surface)',
                                    borderColor: 'var(--store-border)',
                                    boxShadow:
                                        '0 8px 32px rgba(0,0,0,.08)',
                                }}
                            >

                                <div
                                    className="store-heading text-2xl font-black"
                                    style={{
                                        color: 'var(--store-accent)',
                                    }}
                                >
                                    100%
                                </div>

                                <div
                                    className="store-eyebrow mt-1"
                                    style={{
                                        color: 'var(--store-muted)',
                                    }}
                                >
                                    Satisfaction
                                </div>

                            </div>
                        )}

                    </motion.div>

                )}

            </div>

        </section>
    )
}
