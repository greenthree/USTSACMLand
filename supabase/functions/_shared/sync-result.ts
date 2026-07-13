export interface MemberSyncResult {
  memberId: string
  status: number
  body: unknown
}

export interface MemberSyncSummary {
  requested: number
  succeeded: number
  failed: number
}

export function memberSyncFailed(result: MemberSyncResult): boolean {
  if (result.status < 200 || result.status >= 300) return true
  return (
    result.body !== null &&
    typeof result.body === 'object' &&
    'status' in result.body &&
    result.body.status === 'failed'
  )
}

export function summarizeMemberSyncResults(results: MemberSyncResult[]): MemberSyncSummary {
  const failed = results.filter(memberSyncFailed).length
  return {
    requested: results.length,
    succeeded: results.length - failed,
    failed,
  }
}
