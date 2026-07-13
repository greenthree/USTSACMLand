import type { SyncStatus } from '../types/domain'

export function mapPublicStatStatus(
  status: string,
  staleAfter: string | null,
  now = Date.now(),
): SyncStatus {
  if (status === 'fresh') {
    return staleAfter && Date.parse(staleAfter) <= now ? 'stale' : 'fresh'
  }
  if (status === 'stale') return 'stale'
  if (status === 'syncing') return 'syncing'
  return 'error'
}
