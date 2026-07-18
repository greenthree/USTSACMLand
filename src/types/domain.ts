export const platforms = ['codeforces', 'nowcoder', 'atcoder', 'xcpc_elo', 'luogu', 'qoj'] as const

export type Platform = (typeof platforms)[number]
export type RatingPlatform = Extract<Platform, 'codeforces' | 'nowcoder' | 'atcoder' | 'xcpc_elo'>
export type SolvedPlatform = Extract<
  Platform,
  'codeforces' | 'nowcoder' | 'atcoder' | 'luogu' | 'qoj'
>
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'suspended'
export type AccountVerificationStatus = 'pending' | 'verified' | 'invalid' | 'disabled'
export type AdminMemberStatus = 'active' | 'suspended'
export type AdminMemberRole = 'member' | 'admin'
export type AnnouncementStatus = 'draft' | 'published' | 'archived'
export type DailyProblemStatus = 'draft' | 'published' | 'archived'
export type SyncStatus = 'fresh' | 'stale' | 'error' | 'missing' | 'syncing'
export type SyncRunStatus = 'success' | 'running' | 'failed' | 'queued' | 'skipped'
export type SyncJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type SyncTriggerType = 'scheduled' | 'manual' | 'registration' | 'account_changed' | 'retry'
export type SyncJobScope = 'account' | 'member' | 'platform' | 'all'

export interface PlatformStat {
  platform: Platform
  externalId: string
  rating: number | null
  peakRating: number | null
  solved: number | null
  status: SyncStatus
  updatedAt: string | null
}

export interface Member {
  id: string
  name: string
  major: string
  grade: string
  bio: string
  reviewStatus: ReviewStatus
  joinedAt: string
  stats: Record<Platform, PlatformStat>
}

export interface AdminPlatformAccount {
  id: number
  profileId: string
  memberName: string
  major: string
  email: string
  platform: Platform
  externalId: string
  status: AccountVerificationStatus
  verifiedAt: string | null
  verificationErrorCode: string | null
  verificationErrorMessage: string | null
  updatedAt: string
}

export interface AdminMember {
  id: string
  name: string
  email: string
  qq: string
  major: string
  grade: string
  role: AdminMemberRole
  status: AdminMemberStatus
  suspensionNote: string | null
  isPublic: boolean
  joinedAt: string
  updatedAt: string
  platformCount: number
  verifiedPlatformCount: number
}

export interface AdminMemberProfileUpdate {
  name: string
  qq: string
  grade: string
  major: string
  isPublic: boolean
}

export interface AdminAnnouncement {
  id: number
  title: string
  body: string
  status: AnnouncementStatus
  publishedAt: string | null
  expiresAt: string | null
  createdBy: string | null
  createdByLabel: string
  updatedBy: string | null
  updatedByLabel: string
  createdAt: string
  updatedAt: string
}

export interface AdminAnnouncementInput {
  id: number | null
  title: string
  body: string
  status: AnnouncementStatus
  publishedAt: string | null
  expiresAt: string | null
  expectedUpdatedAt: string | null
}

export interface DailyProblem {
  id: number
  date: string
  title: string
  sourcePlatform: string
  externalProblemId: string
  sourceUrl: string
  difficulty: string
  tags: string[]
  trainingNote: string
  estimatedMinutes: number | null
  completionCount: number
  commentCount: number
  completedAt: string | null
}

export interface DailyProblemComment {
  id: number
  problemId: number
  authorId: string | null
  authorLabel: string
  body: string
  visibility: 'visible' | 'hidden'
  createdAt: string
  updatedAt: string
  canDelete: boolean
}

export interface AdminDailyProblem extends DailyProblem {
  status: DailyProblemStatus
  createdAt: string
  updatedAt: string
}

export interface AdminDailyProblemInput {
  id: number | null
  date: string
  title: string
  sourcePlatform: string
  externalProblemId: string
  sourceUrl: string
  difficulty: string
  tags: string[]
  trainingNote: string
  estimatedMinutes: number | null
  status: DailyProblemStatus
  expectedUpdatedAt: string | null
}

export type AdminMemberAccountStatus = AccountVerificationStatus | 'missing'
export type AdminMemberStatStatus = 'fresh' | 'stale' | 'unavailable' | 'missing'

export interface AdminMemberPlatformDetail {
  platform: Platform
  accountId: number | null
  externalId: string | null
  accountStatus: AdminMemberAccountStatus
  verifiedAt: string | null
  verificationErrorMessage: string | null
  accountUpdatedAt: string | null
  currentRating: number | null
  maxRating: number | null
  solvedCount: number | null
  statStatus: AdminMemberStatStatus
  sourceObservedAt: string | null
  lastSuccessAt: string | null
  staleAfter: string | null
  sourceVersion: string | null
  statUpdatedAt: string | null
}

export interface AdminMemberActivity {
  id: string
  kind: 'audit' | 'sync'
  targetTable: string
  action: string
  platform: Platform | null
  runStatus: string | null
  detail: string | null
  sourceVersion: string | null
  createdAt: string
}

export interface AdminMemberDetail extends AdminMember {
  platforms: AdminMemberPlatformDetail[]
  activity: AdminMemberActivity[]
}

export interface AdminManualStatsInput {
  currentRating: number | null
  maxRating: number | null
  solvedCount: number | null
  sourceObservedAt: string | null
  note: string
}

export interface SyncRun {
  id: number
  jobId: number
  profileId: string
  platform: Platform
  memberName: string
  status: SyncRunStatus
  jobStatus: SyncJobStatus
  triggerType: SyncTriggerType
  requestedBy: string | null
  durationMs: number | null
  startedAt: string
  finishedAt: string | null
  errorCode: string | null
  errorMessage: string | null
  sourceVersion: string | null
}

export interface SyncQueueJob {
  id: number
  profileId: string | null
  memberName: string
  scope: SyncJobScope
  platform: Platform | null
  status: Extract<SyncJobStatus, 'queued' | 'running'>
  triggerType: SyncTriggerType
  attemptCount: number
  maxAttempts: number
  scheduledAt: string
  startedAt: string | null
  createdAt: string
  errorCode: string | null
}

export interface AdminOverview {
  approvedMemberCount: number
  pendingMemberCount: number
  failedJobCount24h: number
  runningJobCount: number
  overdueStatCount: number
  credentialErrorCount: number
  verifiedAccountCount: number
}

export interface AdminSourceHealth {
  platform: Platform
  totalRuns: number
  succeededRuns: number
  failedRuns: number
  successRate: number | null
  averageDurationMs: number | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  latestErrorCode: string | null
}

export interface AdminSourceHealthGroup {
  id: 'official-api' | 'page-parsing' | 'authenticated-browser'
  label: string
  platforms: Platform[]
  platformLabel: string
  totalRuns: number
  succeededRuns: number
  failedRuns: number
  successRate: number | null
  averageDurationMs: number | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  latestErrorCode: string | null
}

export type FirecrawlKeyHealthStatus =
  'unknown' | 'healthy' | 'warning' | 'critical' | 'degraded' | 'rate_limited' | 'auth_failed'

export interface AdminFirecrawlKey {
  id: string
  label: string
  keyConfigured: boolean
  enabled: boolean
  priority: number
  healthStatus: FirecrawlKeyHealthStatus
  consecutiveFailures: number
  cooldownUntil: string | null
  lastSelectedAt: string | null
  lastCheckedAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastErrorCode: string | null
  creditsRemaining: number | null
  creditsTotal: number | null
  billingPeriodEnd: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface AdminSyncBatchResult {
  requested: number
  succeeded: number
  queued: number
  failed: number
}

export interface AdminSyncRetryResult {
  jobId: number | null
  memberId: string
  status: 'success' | 'queued' | 'failed'
}

export interface AuditEntry {
  id: number
  actorId: string | null
  actor: string
  action: string
  targetTable: string
  targetId: string | null
  target: string
  createdAt: string
  summary: string
}
