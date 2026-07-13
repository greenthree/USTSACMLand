import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import Save from 'lucide-react/dist/esm/icons/save'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/authContextValue'
import { LoadingState } from '../components/LoadingState'
import { PlatformMark } from '../components/PlatformMark'
import { StatusBadge } from '../components/StatusBadge'
import {
  accountDraftHasConflict,
  accountDraftPlatforms,
  accountFormValuesEqual,
  clearAccountDraft,
  loadAccountDraft,
  mergeAccountDraft,
  saveAccountDraft,
  type AccountFormValues,
} from '../lib/accountDraft'
import { platformLabels } from '../lib/platforms'
import { gradeOptions, majorSuggestions, normalizeGrade } from '../lib/profileFields'
import { supabase } from '../lib/supabase'
import {
  platforms,
  type AccountVerificationStatus,
  type Platform,
  type ReviewStatus,
} from '../types/domain'

type AccountDisplayStatus = AccountVerificationStatus | 'missing'

interface PlatformAccountRow {
  platform: Platform
  external_id: string
  status: AccountVerificationStatus
  verification_error_message: string | null
}

const emptyAccounts: Record<Platform, string> = {
  codeforces: '',
  nowcoder: '',
  atcoder: '',
  xcpc_elo: '',
  luogu: '',
  qoj: '',
}

const demoAccounts: Record<Platform, string> = {
  codeforces: 'USTS_zhixing',
  nowcoder: '91827364',
  atcoder: 'zhixing_usts',
  xcpc_elo: 'xcpc_41382a9bc0de127f',
  luogu: '742193',
  qoj: 'zhixing',
}

const editablePlatforms = accountDraftPlatforms

const emptyAccountStatuses: Record<Platform, AccountDisplayStatus> = {
  codeforces: 'missing',
  nowcoder: 'missing',
  atcoder: 'missing',
  xcpc_elo: 'missing',
  luogu: 'missing',
  qoj: 'missing',
}

const emptyAccountErrors: Record<Platform, string | null> = {
  codeforces: null,
  nowcoder: null,
  atcoder: null,
  xcpc_elo: null,
  luogu: null,
  qoj: null,
}

const accountStatusLabels: Record<AccountDisplayStatus, string> = {
  missing: '未绑定',
  pending: '待验证',
  verified: '已验证',
  invalid: '无效',
  disabled: '已停用',
}

interface AccountState {
  accounts: Record<Platform, string>
  statuses: Record<Platform, AccountDisplayStatus>
  errors: Record<Platform, string | null>
}

function mapAccountRows(rows: PlatformAccountRow[]): AccountState {
  const accounts = { ...emptyAccounts }
  const statuses = { ...emptyAccountStatuses }
  const errors = { ...emptyAccountErrors }

  for (const row of rows) {
    if (!platforms.includes(row.platform)) continue
    accounts[row.platform] = row.external_id
    statuses[row.platform] = row.status
    errors[row.platform] = row.verification_error_message
  }

  return { accounts, statuses, errors }
}

function formValues(
  name: string,
  qq: string,
  major: string,
  grade: string,
  accounts: Record<Platform, string>,
): AccountFormValues {
  return {
    name,
    qq,
    major,
    grade,
    accounts: Object.fromEntries(
      accountDraftPlatforms.map((platform) => [platform, accounts[platform]]),
    ) as AccountFormValues['accounts'],
  }
}

function restoreAccountState(server: AccountState, values: AccountFormValues): AccountState {
  const accounts = { ...server.accounts }
  const statuses = { ...server.statuses }
  const errors = { ...server.errors }

  for (const platform of accountDraftPlatforms) {
    accounts[platform] = values.accounts[platform]
    if (values.accounts[platform] !== server.accounts[platform]) {
      statuses[platform] = values.accounts[platform].trim() ? 'pending' : 'missing'
      errors[platform] = null
    }
  }

  return { accounts, statuses, errors }
}

function AccountStatusBadge({
  status,
  error,
}: {
  status: AccountDisplayStatus
  error: string | null
}) {
  return (
    <span className={`status status-${status}`} title={error ?? undefined}>
      {accountStatusLabels[status]}
    </span>
  )
}

export function AccountPage() {
  const { user, isDemo } = useAuth()
  const userId = user?.id
  const [name, setName] = useState('')
  const [qq, setQq] = useState('')
  const [major, setMajor] = useState('计算机科学与技术')
  const [grade, setGrade] = useState('')
  const [accounts, setAccounts] = useState<Record<Platform, string>>({ ...emptyAccounts })
  const [accountStatuses, setAccountStatuses] = useState<Record<Platform, AccountDisplayStatus>>({
    ...emptyAccountStatuses,
  })
  const [accountErrors, setAccountErrors] = useState<Record<Platform, string | null>>({
    ...emptyAccountErrors,
  })
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState<'success' | 'error'>('success')
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>('pending')
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draftReady, setDraftReady] = useState(false)
  const baselineValuesRef = useRef<AccountFormValues | null>(null)

  const selectableGrades =
    grade && !gradeOptions.includes(grade) ? [grade, ...gradeOptions] : gradeOptions

  function persistFormDraft(
    overrides: Partial<Omit<AccountFormValues, 'accounts'>> & {
      accounts?: Record<Platform, string>
    },
  ) {
    const baseline = baselineValuesRef.current
    if (!draftReady || !userId || !baseline) return

    const values = formValues(
      overrides.name ?? name,
      overrides.qq ?? qq,
      overrides.major ?? major,
      overrides.grade ?? grade,
      overrides.accounts ?? accounts,
    )
    if (accountFormValuesEqual(baseline, values)) clearAccountDraft(userId)
    else saveAccountDraft(userId, baseline, values)
  }

  useEffect(() => {
    if (!userId) return
    const currentUserId = userId

    setLoadingProfile(true)
    setDraftReady(false)
    baselineValuesRef.current = null
    setNotice('')

    function initializeProfile(
      serverValues: AccountFormValues,
      serverAccountState: AccountState,
      nextReviewStatus: ReviewStatus,
    ) {
      const draft = loadAccountDraft(currentUserId)
      const initialValues = draft ? mergeAccountDraft(serverValues, draft) : serverValues
      const accountState = restoreAccountState(serverAccountState, initialValues)

      setName(initialValues.name)
      setQq(initialValues.qq)
      setMajor(initialValues.major)
      setGrade(initialValues.grade)
      setAccounts(accountState.accounts)
      setAccountStatuses(accountState.statuses)
      setAccountErrors(accountState.errors)
      setReviewStatus(nextReviewStatus)
      baselineValuesRef.current = serverValues
      setDraftReady(true)
      setLoadingProfile(false)

      if (draft) {
        setNoticeKind('success')
        setNotice(
          accountDraftHasConflict(serverValues, draft)
            ? '已恢复未保存的修改；服务器资料也有更新，请确认后再保存。'
            : '已恢复未保存的修改。',
        )
      }
    }

    if (isDemo || !supabase) {
      const demoAccountState: AccountState = {
        accounts: { ...demoAccounts },
        statuses: Object.fromEntries(platforms.map((platform) => [platform, 'verified'])) as Record<
          Platform,
          AccountDisplayStatus
        >,
        errors: { ...emptyAccountErrors },
      }
      initializeProfile(
        formValues('周知行', '2984123417', '计算机科学与技术', '24级', demoAccountState.accounts),
        demoAccountState,
        'approved',
      )
      return
    }

    let active = true
    void Promise.all([
      supabase
        .from('profiles')
        .select('full_name, qq, major, grade, review_status')
        .eq('id', currentUserId)
        .single(),
      supabase
        .from('platform_accounts')
        .select('platform, external_id, status, verification_error_message')
        .eq('profile_id', currentUserId),
    ]).then(([profileResult, accountsResult]) => {
      if (!active) return
      if (profileResult.error || accountsResult.error) {
        setNoticeKind('error')
        setNotice(
          `资料读取失败：${profileResult.error?.message ?? accountsResult.error?.message ?? '未知错误'}`,
        )
        setLoadingProfile(false)
        return
      }

      const accountState = mapAccountRows((accountsResult.data ?? []) as PlatformAccountRow[])
      initializeProfile(
        formValues(
          profileResult.data.full_name ?? '',
          profileResult.data.qq ?? '',
          profileResult.data.major ?? '计算机科学与技术',
          profileResult.data.grade ?? '',
          accountState.accounts,
        ),
        accountState,
        profileResult.data.review_status as ReviewStatus,
      )
    })

    return () => {
      active = false
    }
  }, [isDemo, userId])

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedGrade = normalizeGrade(grade)
    const submittedValues = formValues(
      name.trim(),
      qq.trim(),
      major.trim(),
      normalizedGrade,
      accounts,
    )
    const baseline = baselineValuesRef.current
    setSaving(true)
    setNotice('')
    setNoticeKind('success')

    if (supabase && userId) {
      const profileUpdates: {
        full_name?: string
        qq?: string
        major?: string
        grade?: string
      } = {}
      if (!baseline || submittedValues.name !== baseline.name)
        profileUpdates.full_name = submittedValues.name
      if (!baseline || submittedValues.qq !== baseline.qq) profileUpdates.qq = submittedValues.qq
      if (!baseline || submittedValues.major !== baseline.major)
        profileUpdates.major = submittedValues.major
      if (!baseline || submittedValues.grade !== baseline.grade)
        profileUpdates.grade = submittedValues.grade

      if (Object.keys(profileUpdates).length > 0) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update(profileUpdates)
          .eq('id', userId)
        if (profileError) {
          setSaving(false)
          setNoticeKind('error')
          setNotice(`保存失败：${profileError.message}`)
          return
        }
      }

      const changedPlatforms = editablePlatforms.filter(
        (platform) =>
          !baseline || submittedValues.accounts[platform] !== baseline.accounts[platform],
      )
      const accountRows = changedPlatforms
        .filter((platform) => submittedValues.accounts[platform].length > 0)
        .map((platform) => ({
          profile_id: userId,
          platform,
          external_id: submittedValues.accounts[platform],
          normalized_external_id: submittedValues.accounts[platform].toLocaleLowerCase('en-US'),
        }))
      if (accountRows.length > 0) {
        const { error: accountError } = await supabase
          .from('platform_accounts')
          .upsert(accountRows, { onConflict: 'profile_id,platform' })
        if (accountError) {
          setSaving(false)
          setNoticeKind('error')
          setNotice(`平台绑定保存失败：${accountError.message}`)
          return
        }
      }

      const clearedPlatforms = changedPlatforms.filter(
        (platform) => submittedValues.accounts[platform].length === 0,
      )
      if (clearedPlatforms.length > 0) {
        const { error: deleteError } = await supabase
          .from('platform_accounts')
          .delete()
          .eq('profile_id', userId)
          .in('platform', clearedPlatforms)
        if (deleteError) {
          setSaving(false)
          setNoticeKind('error')
          setNotice(`平台解绑失败：${deleteError.message}`)
          return
        }
      }

      const [savedProfileResult, savedAccountsResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('full_name, qq, major, grade, review_status')
          .eq('id', userId)
          .single(),
        supabase
          .from('platform_accounts')
          .select('platform, external_id, status, verification_error_message')
          .eq('profile_id', userId),
      ])
      if (savedProfileResult.error || savedAccountsResult.error) {
        setSaving(false)
        setNoticeKind('error')
        setNotice(
          `资料已保存，但状态刷新失败：${savedProfileResult.error?.message ?? savedAccountsResult.error?.message ?? '未知错误'}`,
        )
        return
      }

      const accountState = mapAccountRows((savedAccountsResult.data ?? []) as PlatformAccountRow[])
      const savedValues = formValues(
        savedProfileResult.data.full_name ?? '',
        savedProfileResult.data.qq ?? '',
        savedProfileResult.data.major ?? '',
        savedProfileResult.data.grade ?? '',
        accountState.accounts,
      )
      setName(savedValues.name)
      setQq(savedValues.qq)
      setMajor(savedValues.major)
      setGrade(savedValues.grade)
      setAccounts(accountState.accounts)
      setAccountStatuses(accountState.statuses)
      setAccountErrors(accountState.errors)
      setReviewStatus(savedProfileResult.data.review_status as ReviewStatus)
      baselineValuesRef.current = savedValues
      clearAccountDraft(userId)
    } else if (userId) {
      setName(submittedValues.name)
      setQq(submittedValues.qq)
      setMajor(submittedValues.major)
      setGrade(submittedValues.grade)
      baselineValuesRef.current = submittedValues
      clearAccountDraft(userId)
    }

    setSaving(false)
    setNotice('资料已保存，关键绑定变更将在管理员复核后生效。')
  }

  const hasVerifiedAccount = editablePlatforms.some(
    (platform) => accounts[platform].trim() && accountStatuses[platform] === 'verified',
  )
  const hasSyncableXcpcAccount =
    accounts.xcpc_elo.trim().length > 0 &&
    accountStatuses.xcpc_elo !== 'missing' &&
    accountStatuses.xcpc_elo !== 'disabled'
  const hasSyncableAccount = hasVerifiedAccount || hasSyncableXcpcAccount
  const canSync = isDemo || (reviewStatus === 'approved' && hasSyncableAccount)
  const syncDisabledReason =
    reviewStatus !== 'approved'
      ? '成员资料审核通过后可同步'
      : !hasSyncableAccount
        ? '至少一个平台账号通过验证或存在 XCPC ELO 自动匹配记录后可同步'
        : undefined

  async function handleSync() {
    setSyncing(true)
    setNotice('')
    setNoticeKind('success')
    if (supabase && userId) {
      const { error } = await supabase.functions.invoke('sync-member', {
        body: { memberId: userId, triggerType: 'manual' },
      })
      setSyncing(false)
      if (error) setNoticeKind('error')
      setNotice(error ? `同步请求失败：${error.message}` : '同步任务已完成。')
      return
    }
    window.setTimeout(() => {
      setSyncing(false)
      setNotice('同步任务已加入队列。')
    }, 1200)
  }

  return (
    <div className="page account-page">
      <section className="page-heading account-heading">
        <div>
          <h1>我的资料</h1>
          <p>QQ 仅用于队内审核，不会展示在公开榜单。</p>
        </div>
        <div className="account-status">
          <StatusBadge status={reviewStatus} />
          <span>{isDemo ? '本地演示资料' : '账号资料'}</span>
        </div>
      </section>

      {loadingProfile ? <LoadingState label="正在读取账号资料" /> : null}

      <form className="account-form" onSubmit={handleSave}>
        <fieldset className="form-section" disabled={loadingProfile}>
          <div className="section-title-row">
            <div>
              <h2>基本资料</h2>
              <p>姓名、年级和专业会显示在公开成员列表。</p>
            </div>
          </div>
          <div className="form-grid">
            <label>
              <span>姓名</span>
              <input
                required
                value={name}
                onChange={(event) => {
                  const value = event.target.value
                  setName(value)
                  persistFormDraft({ name: value })
                }}
              />
            </label>
            <label>
              <span>QQ 号</span>
              <input
                required
                inputMode="numeric"
                pattern="[1-9][0-9]{4,11}"
                value={qq}
                onChange={(event) => {
                  const value = event.target.value
                  setQq(value)
                  persistFormDraft({ qq: value })
                }}
              />
            </label>
            <label>
              <span>年级</span>
              <select
                required
                value={grade}
                onChange={(event) => {
                  const value = event.target.value
                  setGrade(value)
                  persistFormDraft({ grade: value })
                }}
              >
                <option value="" disabled>
                  请选择年级
                </option>
                {selectableGrades.map((item) => (
                  <option value={item} key={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>专业</span>
              <input
                required
                list="major-suggestions"
                maxLength={100}
                placeholder="输入专业名称"
                value={major}
                onChange={(event) => {
                  const value = event.target.value
                  setMajor(value)
                  persistFormDraft({ major: value })
                }}
              />
              <datalist id="major-suggestions">
                {majorSuggestions.map((item) => (
                  <option value={item} key={item} />
                ))}
              </datalist>
            </label>
          </div>
        </fieldset>

        <fieldset className="form-section" disabled={loadingProfile}>
          <div className="section-title-row">
            <div>
              <h2>平台绑定</h2>
              <p>
                牛客和洛谷填写 UID（个人主页链接最后的一串数字）；XCPC ELO 使用姓名和学校自动匹配。
              </p>
            </div>
          </div>
          <div className="platform-form-list">
            {platforms.map((platform) => {
              if (platform === 'xcpc_elo') {
                return (
                  <div className="platform-form-row platform-auto-match-row" key={platform}>
                    <PlatformMark platform={platform} />
                    <span className="platform-field-label">姓名匹配</span>
                    <span className="platform-auto-match-value" aria-label="XCPC ELO 姓名匹配">
                      按「姓名 + 苏州科技大学」自动匹配
                    </span>
                    <AccountStatusBadge
                      status={accounts[platform] ? accountStatuses[platform] : 'missing'}
                      error={accountErrors[platform]}
                    />
                  </div>
                )
              }

              return (
                <label className="platform-form-row" key={platform}>
                  <PlatformMark platform={platform} />
                  <span className="platform-field-label">
                    {platform === 'nowcoder' || platform === 'luogu' ? 'UID' : '账号 ID'}
                  </span>
                  <input
                    aria-label={`${platformLabels[platform]} 账号`}
                    value={accounts[platform]}
                    onChange={(event) => {
                      const value = event.target.value
                      const nextAccounts = { ...accounts, [platform]: value }
                      setAccounts(nextAccounts)
                      persistFormDraft({ accounts: nextAccounts })
                      setAccountStatuses((current) => ({
                        ...current,
                        [platform]: value.trim() ? 'pending' : 'missing',
                      }))
                      setAccountErrors((current) => ({ ...current, [platform]: null }))
                    }}
                  />
                  <AccountStatusBadge
                    status={accounts[platform] ? accountStatuses[platform] : 'missing'}
                    error={accountErrors[platform]}
                  />
                </label>
              )
            })}
          </div>
        </fieldset>

        {notice ? (
          <p className={`form-${noticeKind} sticky-notice`} role="status">
            {notice}
          </p>
        ) : null}
        <div className="form-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={handleSync}
            disabled={syncing || loadingProfile || !canSync}
            title={!canSync ? syncDisabledReason : undefined}
          >
            <RefreshCw
              className={syncing ? 'is-spinning' : undefined}
              size={17}
              aria-hidden="true"
            />
            {syncing ? '同步中' : '立即同步'}
          </button>
          <button className="primary-button" type="submit" disabled={saving || loadingProfile}>
            <Save size={17} aria-hidden="true" />
            {saving ? '保存中' : '保存资料'}
          </button>
        </div>
      </form>
    </div>
  )
}
