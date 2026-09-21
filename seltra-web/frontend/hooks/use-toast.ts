// hooks/use-toast.ts
// Thin wrapper around sonner so old code importing from @/hooks/use-toast
// continues to work without changes.

import { toast as sonnerToast } from 'sonner'

interface ToastOptions {
  title?: string
  description?: string
  variant?: 'default' | 'destructive'
}

export function toast(options: ToastOptions) {
  const message = options.title ?? ''
  const description = options.description

  if (options.variant === 'destructive') {
    sonnerToast.error(message, { description })
  } else {
    sonnerToast(message, { description })
  }
}

export function useToast() {
  return { toast }
}