export interface MemberSyncResult {
  memberId: string
  status: number
  body: unknown
}

export interface PlatformMemberSyncResult extends MemberSyncResult {
  platform: string
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

export interface PlatformSyncSummary extends MemberSyncSummary {
  platform: string
}

export function summarizePlatformSyncResults(
  results: PlatformMemberSyncResult[],
): PlatformSyncSummary[] {
  const grouped = new Map<string, PlatformMemberSyncResult[]>()
  for (const result of results) {
    const platformResults = grouped.get(result.platform) ?? []
    platformResults.push(result)
    grouped.set(result.platform, platformResults)
  }

  return [...grouped.entries()].map(([platform, platformResults]) => ({
    platform,
    ...summarizeMemberSyncResults(platformResults),
  }))
}
