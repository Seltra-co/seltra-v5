import type { ReactNode } from 'react'

export function WorkbenchPreviewDock({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return <aside data-testid={open ? 'preview-pane' : undefined} aria-hidden={!open} className={className}>{children}</aside>
}
