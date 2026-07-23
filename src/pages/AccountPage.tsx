import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import Save from 'lucide-react/dist/esm/icons/save'
import KeyRound from 'lucide-react/dist/esm/icons/key-round'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import Download from 'lucide-react/dist/esm/icons/download'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/authContextValue'
import { LoadingState } from '../components/LoadingState'
import { PlatformMark } from '../components/PlatformMark'
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
import {
  normalizePlatformAccountId,
  platformAccountSaveErrorMessage,
  platformAccountMaxLengths,
  validatePlatformAccountId,
  validatePlatformAccounts,
} from '../lib/platformAccounts'
import { gradeOptions, majorSuggestions, normalizeGrade } from '../lib/profileFields'
import {
  buildDemoPersonalDataExport,
  downloadPersonalDataExport,
  fetchOwnPersonalDataExport,
} from '../lib/personalDataExport'
import {
  buildReferralRegistrationUrl,
  fetchOwnReferralSummary,
  type ReferralSummary,
} from '../lib/referrals'
import { supabase } from '../lib/supabase'
import { platforms, type AccountVerificationStatus, type Platform } from '../types/domain'

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

const emptyValidationErrors = Object.fromEntries(
  accountDraftPlatforms.map((platform) => [platform, null]),
) as Record<(typeof accountDraftPlatforms)[number], string | null>

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

const demoReferralSummary: ReferralSummary = {
  programEnabled: true,
  code: '8A4C19F2E7B603D5',
  rewardCount: 2,
  remainingRewards: 8,
  rewardTokens: 2_000_000,
  available: true,
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
  const { user, isDemo, changePassword, deleteAccount } = useAuth()
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
  const [accountValidationErrors, setAccountValidationErrors] = useState({
    ...emptyValidationErrors,
  })
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState<'success' | 'error'>('success')
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmedPassword, setConfirmedPassword] = useState('')
  const [passwordNotice, setPasswordNotice] = useState('')
  const [passwordNoticeKind, setPasswordNoticeKind] = useState<'success' | 'error'>('success')
  const [changingPassword, setChangingPassword] = useState(false)
  const [showDeletionConfirmation, setShowDeletionConfirmation] = useState(false)
  const [deletionPassword, setDeletionPassword] = useState('')
  const [deletionConfirmed, setDeletionConfirmed] = useState(false)
  const [deletionNotice, setDeletionNotice] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [exportingData, setExportingData] = useState(false)
  const [exportNotice, setExportNotice] = useState('')
  const [exportNoticeKind, setExportNoticeKind] = useState<'success' | 'error'>('success')
  const [referralSummary, setReferralSummary] = useState<ReferralSummary | null>(null)
  const [referralLoading, setReferralLoading] = useState(false)
  const [referralNotice, setReferralNotice] = useState('')
  const [copyNotice, setCopyNotice] = useState('')
  const [draftReady, setDraftReady] = useState(false)
  const baselineValuesRef = useRef<AccountFormValues | null>(null)
  const referralRequestIdRef = useRef(0)

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

    function initializeProfile(serverValues: AccountFormValues, serverAccountState: AccountState) {
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
      setAccountValidationErrors({ ...emptyValidationErrors })
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
      )
      return
    }

    let active = true
    void Promise.all([
      supabase
        .from('profiles')
        .select('full_name, qq, major, grade')
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
      )
    })

    return () => {
      active = false
    }
  }, [isDemo, userId])

  const loadReferralSummary = useCallback(async (): Promise<ReferralSummary | null> => {
    if (!userId) return null
    const requestId = ++referralRequestIdRef.current
    setReferralLoading(true)
    setReferralNotice('')
    setReferralSummary(null)
    setCopyNotice('')

    if (isDemo || !supabase) {
      setReferralSummary(demoReferralSummary)
      setReferralLoading(false)
      return demoReferralSummary
    }

    try {
      const summary = await fetchOwnReferralSummary()
      if (requestId !== referralRequestIdRef.current) return null
      setReferralSummary(summary)
      return summary
    } catch (error) {
      if (requestId === referralRequestIdRef.current) {
        setReferralSummary(null)
        setReferralNotice(error instanceof Error ? error.message : '推荐计划读取失败。')
      }
      return null
    } finally {
      if (requestId === referralRequestIdRef.current) setReferralLoading(false)
    }
  }, [isDemo, userId])

  useEffect(() => {
    if (!userId) return
    void loadReferralSummary()

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadReferralSummary()
    }
    const refreshOnFocus = () => void loadReferralSummary()
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshOnFocus)

    return () => {
      referralRequestIdRef.current += 1
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [loadReferralSummary, userId])

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedGrade = normalizeGrade(grade)
    const normalizedAccounts = Object.fromEntries(
      accountDraftPlatforms.map((platform) => [
        platform,
        normalizePlatformAccountId(accounts[platform], platform),
      ]),
    ) as AccountFormValues['accounts']
    const validationErrors = validatePlatformAccounts(normalizedAccounts)
    setAccountValidationErrors(validationErrors)

    if (Object.values(validationErrors).some(Boolean)) {
      setNoticeKind('error')
      setNotice('请先修正平台账号格式。')
      return
    }

    const submittedValues = formValues(name.trim(), qq.trim(), major.trim(), normalizedGrade, {
      ...accounts,
      ...normalizedAccounts,
    })
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
          setNotice(platformAccountSaveErrorMessage(accountError))
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
        supabase.from('profiles').select('full_name, qq, major, grade').eq('id', userId).single(),
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
      setAccountValidationErrors({ ...emptyValidationErrors })
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
  const canSync = user?.role === 'admin' && (isDemo || hasSyncableAccount)
  const syncDisabledReason = !hasSyncableAccount
    ? '至少一个平台账号通过验证或存在 XCPC ELO 自动匹配记录后可同步'
    : undefined

  async function handleSync() {
    if (user?.role !== 'admin') return
    setSyncing(true)
    setNotice('')
    setNoticeKind('success')
    if (supabase && userId) {
      const { data, error } = await supabase.functions.invoke('sync-stats', {
        body: { scope: 'member', member_id: userId },
      })
      setSyncing(false)
      if (error) {
        setNoticeKind('error')
        setNotice(`同步请求失败：${error.message}`)
        return
      }
      const summary = data !== null && typeof data === 'object' ? data : {}
      const failed = Number('failed' in summary ? summary.failed : 0)
      const queued = Number('queued' in summary ? summary.queued : 0)
      if (Number.isFinite(failed) && failed > 0) {
        setNoticeKind('error')
        setNotice(`同步完成，但有 ${failed} 个平台最终失败。`)
      } else if (Number.isFinite(queued) && queued > 0) {
        setNotice(`同步完成，${queued} 个平台已进入唯一一次自动重试队列。`)
      } else {
        setNotice('同步任务已完成。')
      }
      return
    }
    window.setTimeout(() => {
      setSyncing(false)
      setNotice('同步任务已加入队列。')
    }, 1200)
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordNotice('')

    if (newPassword.length < 8) {
      setPasswordNoticeKind('error')
      setPasswordNotice('新密码至少需要 8 位。')
      return
    }
    if (newPassword !== confirmedPassword) {
      setPasswordNoticeKind('error')
      setPasswordNotice('两次输入的新密码不一致。')
      return
    }
    if (newPassword === currentPassword) {
      setPasswordNoticeKind('error')
      setPasswordNotice('新密码不能与当前密码相同。')
      return
    }

    setChangingPassword(true)
    try {
      await changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmedPassword('')
      setPasswordNoticeKind('success')
      setPasswordNotice('密码已更新。')
    } catch (error) {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmedPassword('')
      setPasswordNoticeKind('error')
      setPasswordNotice(error instanceof Error ? error.message : '密码更新失败，请稍后重试。')
    } finally {
      setChangingPassword(false)
    }
  }

  async function handleAccountDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (user?.role !== 'member' || !deletionConfirmed || !deletionPassword) return

    setDeletingAccount(true)
    setDeletionNotice('')
    try {
      await deleteAccount(deletionPassword)
      if (userId) clearAccountDraft(userId)
    } catch (error) {
      setDeletionPassword('')
      setDeletionNotice(error instanceof Error ? error.message : '账号注销失败，请稍后重试。')
      setDeletingAccount(false)
    }
  }

  async function handleDataExport() {
    if (!userId || !user) return

    setExportingData(true)
    setExportNotice('')
    try {
      const exportedData = isDemo
        ? buildDemoPersonalDataExport({
            userId,
            email: user.email,
            fullName: name,
            qq,
            grade,
            major,
            role: user.role,
            accounts,
          })
        : await fetchOwnPersonalDataExport()
      const filename = downloadPersonalDataExport(exportedData)
      setExportNoticeKind('success')
      setExportNotice(`数据已导出为 ${filename}。`)
    } catch (error) {
      setExportNoticeKind('error')
      setExportNotice(error instanceof Error ? error.message : '个人数据导出失败，请稍后重试。')
    } finally {
      setExportingData(false)
    }
  }

  async function copyReferralLink() {
    if (!referralSummary?.programEnabled || !referralSummary.code || !referralSummary.available) {
      return
    }
    setReferralNotice('')
    const latestSummary = await loadReferralSummary()
    if (!latestSummary?.programEnabled || !latestSummary.code || !latestSummary.available) return
    const link = buildReferralRegistrationUrl(latestSummary.code)
    try {
      await navigator.clipboard.writeText(link)
      setCopyNotice('邀请码注册链接已复制。')
    } catch {
      setCopyNotice('')
      setReferralNotice('复制失败，请检查浏览器剪贴板权限后重试。')
    }
  }

  return (
    <div className="page account-page">
      <section className="page-heading account-heading">
        <div>
          <h1>我的资料</h1>
          <p>QQ 仅用于队内管理，不会展示在公开榜单。</p>
        </div>
        <div className="account-status">
          <span>{isDemo ? '本地演示资料' : '账号资料'}</span>
        </div>
      </section>

      {loadingProfile ? <LoadingState label="正在读取账号资料" /> : null}

      {referralSummary?.programEnabled ? (
        <section className="account-form account-referral-form" aria-labelledby="referral-title">
          <div className="form-section">
            <div className="section-title-row">
              <div>
                <h2 id="referral-title">推荐计划</h2>
                <p>分享邀请码，绑定成功后可获得额外 WebChat 累计额度上限。</p>
              </div>
            </div>
            {referralNotice ? (
              <p className="form-error" role="alert">
                {referralNotice}
              </p>
            ) : null}
            <div className="referral-summary-grid">
              <div className="referral-card">
                <span>我的邀请码</span>
                <strong>{referralLoading ? '读取中' : (referralSummary?.code ?? '--')}</strong>
              </div>
              <div className="referral-card">
                <span>已奖励次数</span>
                <strong>
                  {referralLoading ? '读取中' : String(referralSummary?.rewardCount ?? 0) + ' / 10'}
                </strong>
              </div>
              <div className="referral-card">
                <span>累计增加 Token 上限</span>
                <strong>
                  {referralLoading
                    ? '读取中'
                    : (referralSummary?.rewardTokens ?? 0).toLocaleString('zh-CN')}
                </strong>
              </div>
            </div>
            <div className="form-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={referralLoading || !referralSummary?.code || !referralSummary.available}
                onClick={() => void copyReferralLink()}
              >
                复制注册链接
              </button>
              <span className="referral-copy-note" aria-live="polite">
                {copyNotice || '新用户可通过链接自动带入邀请码。'}
              </span>
            </div>
            {referralSummary?.programEnabled && referralSummary.remainingRewards === 0 ? (
              <p className="account-data-export-note">当前邀请码已达到邀请上限，暂不可继续使用。</p>
            ) : null}
          </div>
        </section>
      ) : null}

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
                    aria-invalid={accountValidationErrors[platform] ? 'true' : undefined}
                    aria-describedby={
                      accountValidationErrors[platform]
                        ? `platform-${platform}-validation-error`
                        : undefined
                    }
                    autoCapitalize="none"
                    inputMode={platform === 'nowcoder' || platform === 'luogu' ? 'numeric' : 'text'}
                    maxLength={platformAccountMaxLengths[platform]}
                    spellCheck={false}
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
                      setAccountValidationErrors((current) => ({
                        ...current,
                        [platform]: null,
                      }))
                    }}
                    onBlur={(event) => {
                      const normalizedValue = normalizePlatformAccountId(
                        event.target.value,
                        platform,
                      )
                      if (normalizedValue !== accounts[platform]) {
                        const nextAccounts = { ...accounts, [platform]: normalizedValue }
                        setAccounts(nextAccounts)
                        persistFormDraft({ accounts: nextAccounts })
                      }
                      setAccountValidationErrors((current) => ({
                        ...current,
                        [platform]: validatePlatformAccountId(platform, normalizedValue),
                      }))
                    }}
                  />
                  <AccountStatusBadge
                    status={accounts[platform] ? accountStatuses[platform] : 'missing'}
                    error={accountErrors[platform]}
                  />
                  {accountValidationErrors[platform] ? (
                    <span
                      className="platform-validation-error"
                      id={`platform-${platform}-validation-error`}
                    >
                      {accountValidationErrors[platform]}
                    </span>
                  ) : null}
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
          {user?.role === 'admin' ? (
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
          ) : null}
          <button className="primary-button" type="submit" disabled={saving || loadingProfile}>
            <Save size={17} aria-hidden="true" />
            {saving ? '保存中' : '保存资料'}
          </button>
        </div>
      </form>

      <section className="account-form account-data-export" aria-labelledby="data-export-title">
        <div className="form-section">
          <div className="section-title-row">
            <div>
              <h2 id="data-export-title">导出个人数据</h2>
              <p>
                下载版本化 JSON
                文件，包含已保存的账号资料、平台绑定与统计、同步记录、每日一题记录，以及本人私有的
                AI 对话和用量。
              </p>
            </div>
          </div>
          <p className="account-data-export-note">
            文件不会包含密码、登录令牌、服务密钥、管理员身份信息或其他成员数据。
          </p>
          {exportNotice ? (
            <p
              className={`form-${exportNoticeKind} account-export-notice`}
              role={exportNoticeKind === 'error' ? 'alert' : 'status'}
            >
              {exportNotice}
            </p>
          ) : null}
          <div className="form-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={exportingData || loadingProfile || !userId}
              onClick={() => void handleDataExport()}
            >
              <Download size={17} aria-hidden="true" />
              {exportingData ? '正在整理数据' : '导出我的数据'}
            </button>
          </div>
        </div>
      </section>

      <form className="account-form account-security-form" onSubmit={handlePasswordChange}>
        <fieldset className="form-section" disabled={changingPassword}>
          <div className="section-title-row">
            <div>
              <h2>账号安全</h2>
              <p>修改密码前需要验证当前密码。</p>
            </div>
          </div>
          <div className="form-grid">
            <label>
              <span>当前密码</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              <span id="account-new-password-label">新密码</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                aria-labelledby="account-new-password-label"
                aria-describedby="account-new-password-help"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <small id="account-new-password-help">至少 8 位，不要与其他网站共用。</small>
            </label>
            <label className="span-two">
              <span>确认新密码</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirmedPassword}
                onChange={(event) => setConfirmedPassword(event.target.value)}
              />
            </label>
          </div>
          {passwordNotice ? (
            <p
              className={`form-${passwordNoticeKind} account-password-notice`}
              role={passwordNoticeKind === 'error' ? 'alert' : 'status'}
            >
              {passwordNotice}
            </p>
          ) : null}
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={changingPassword}>
              <KeyRound size={17} aria-hidden="true" />
              {changingPassword ? '更新中' : '修改密码'}
            </button>
          </div>
        </fieldset>
      </form>

      <form className="account-form account-danger-form" onSubmit={handleAccountDeletion}>
        <fieldset className="form-section danger-zone" disabled={deletingAccount}>
          <div className="section-title-row">
            <div>
              <h2>注销账号</h2>
              <p>注销后，账号、个人资料、平台绑定和全部统计记录将永久删除。</p>
            </div>
          </div>

          {user?.role === 'admin' ? (
            <p className="danger-zone-note">
              管理员账号不能自助注销；请先完成管理员交接并移除管理员身份。
            </p>
          ) : showDeletionConfirmation ? (
            <div className="account-deletion-confirmation">
              <label>
                <span>账号密码</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={256}
                  value={deletionPassword}
                  onChange={(event) => setDeletionPassword(event.target.value)}
                />
              </label>
              <label className="account-deletion-checkbox">
                <input
                  type="checkbox"
                  required
                  checked={deletionConfirmed}
                  onChange={(event) => setDeletionConfirmed(event.target.checked)}
                />
                <span>我确认永久删除账号及全部训练数据，此操作无法撤销。</span>
              </label>
              {deletionNotice ? (
                <p className="form-error account-deletion-notice" role="alert">
                  {deletionNotice}
                </p>
              ) : null}
              <div className="form-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={deletingAccount}
                  onClick={() => {
                    setShowDeletionConfirmation(false)
                    setDeletionPassword('')
                    setDeletionConfirmed(false)
                    setDeletionNotice('')
                  }}
                >
                  取消
                </button>
                <button
                  className="danger-button"
                  type="submit"
                  disabled={deletingAccount || !deletionPassword || !deletionConfirmed}
                >
                  <Trash2 size={17} aria-hidden="true" />
                  {deletingAccount ? '正在注销' : '永久注销账号'}
                </button>
              </div>
            </div>
          ) : (
            <div className="form-actions">
              <button
                className="danger-button"
                type="button"
                onClick={() => setShowDeletionConfirmation(true)}
              >
                <Trash2 size={17} aria-hidden="true" />
                注销账号
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </div>
  )
}
