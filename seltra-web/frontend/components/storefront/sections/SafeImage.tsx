//seltra-web/frontend/components/storefront/sections/SafeImage.tsx
'use client'
import React from 'react'
import Image, { type ImageProps } from 'next/image'

interface ImageBoundaryProps {
  children: React.ReactNode
  fallback: React.ReactNode
}

interface ImageBoundaryState {
  failed: boolean
}

class ImageBoundary extends React.Component<ImageBoundaryProps, ImageBoundaryState> {
  constructor(props: ImageBoundaryProps) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError(): ImageBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.warn('[SafeImage] next/image failed to render:', error)
  }

  render() {
    if (this.state.failed) {
      return <>{this.props.fallback}</>
    }
    return <>{this.props.children}</>
  }
}

const defaultFallback = (
  <div
    className="absolute inset-0"
    style={{ background: 'linear-gradient(135deg, var(--store-accent-soft), var(--store-surface))' }}
  />
)

/**
 * Drop-in replacement for next/image's <Image>. If the loader throws
 * (bad src, disallowed domain, malformed URL, etc.) this renders a
 * fallback instead of crashing the whole tree above it.
 */
export function SafeImage({
  fallback,
  ...imageProps
}: ImageProps & { fallback?: React.ReactNode }) {
  return (
    <ImageBoundary fallback={fallback ?? defaultFallback}>
      <Image {...imageProps} />
    </ImageBoundary>
  )
}