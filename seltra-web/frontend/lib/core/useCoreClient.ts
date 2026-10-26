'use client'

import { useMemo } from 'react'
import { useWorkspace } from '@/context/WorkspaceContext'
import { CoreClient } from './client'

export function useCoreClient() {
  const { session, refreshSession } = useWorkspace()
  return useMemo(() => new CoreClient(
    async () => session ?? refreshSession(),
    refreshSession,
  ), [session, refreshSession])
}
