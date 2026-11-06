import { Injectable } from '@nestjs/common'

export type LegacyStoreState = 'LIVE' | 'NOT_LIVE' | 'UNKNOWN'

@Injectable()
export class LegacyStoreGuard {
  /**
   * D0 found no reliable persisted predicate for a live V4 store. Keep this
   * unknown until the owner confirms the production rule; callers must fail
   * closed in team mode.
   */
  isLive(_tenant: Record<string, unknown>): LegacyStoreState {
    return 'UNKNOWN'
  }
}
