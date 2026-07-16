export interface MemberSyncResult {
  memberId: string
  status: number
  body: unknown
}

export interface MemberSyncSummary {
  requested: number
  succeeded: number
  queued: number
  failed: number
}

function memberSyncStatus(result: MemberSyncResult): unknown {
  return result.body !== null && typeof result.body === 'object' && 'status' in result.body
    ? result.body.status
    : null
}

export function memberSyncFailed(result: MemberSyncResult): boolean {
  if (result.status < 200 || result.status >= 300) return true
  return memberSyncStatus(result) === 'failed'
}

export function summarizeMemberSyncResults(results: MemberSyncResult[]): MemberSyncSummary {
  const failed = results.filter(memberSyncFailed).length
  const queued = results.filter(
    (result) => !memberSyncFailed(result) && memberSyncStatus(result) === 'queued',
  ).length
  return {
    requested: results.length,
    succeeded: results.length - failed - queued,
    queued,
    failed,
  }
}
