import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import Save from 'lucide-react/dist/esm/icons/save'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/authContextValue'
import { LoadingState } from '../components/LoadingState'
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
import { syncMemberAvatar } from '../lib/memberAvatar'
import {
  normalizePlatformAccountId,
  platformAccountSaveErrorMessage,
  validatePlatformAccountId,
  validatePlatformAccounts,
} from '../lib/platformAccounts'
import { gradeOptions, normalizeGrade } from '../lib/profileFields'
import { getRegistrationCaptchaConfig } from '../lib/registrationCaptcha'
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
import { AccountDataExportSection } from './account/AccountDataExportSection'
import { AccountDeletionSection } from './account/AccountDeletionSection'
import { AccountPasswordSection } from './account/AccountPasswordSection'
import {
  AccountPlatformsSection,
  type AccountDisplayStatus,
} from './account/AccountPlatformsSection'
import { AccountProfileSection } from './account/AccountProfileSection'
import { AccountReferralSection } from './account/AccountReferralSection'

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
  programEnabled: false,
  code: null,
  rewardCount: 0,
  remainingRewards: 0,
  rewardTokens: 0,
  available: false,
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
  const [passwordCaptchaToken, setPasswordCaptchaToken] = useState('')
  const [passwordCaptchaResetKey, setPasswordCaptchaResetKey] = useState(0)
  const [showDeletionConfirmation, setShowDeletionConfirmation] = useState(false)
  const [deletionPassword, setDeletionPassword] = useState('')
  const [deletionConfirmed, setDeletionConfirmed] = useState(false)
  const [deletionNotice, setDeletionNotice] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [deletionCaptchaToken, setDeletionCaptchaToken] = useState('')
  const [deletionCaptchaResetKey, setDeletionCaptchaResetKey] = useState(0)
  const [exportingData, setExportingData] = useState(false)
  const [exportNotice, setExportNotice] = useState('')
  const [exportNoticeKind, setExportNoticeKind] = useState<'success' | 'error'>('success')
  const [referralSummary, setReferralSummary] = useState<ReferralSummary | null>(null)
  const [referralLoading, setReferralLoading] = useState(false)
  const [referralNotice, setReferralNotice] = useState('')
  const [copyNotice, setCopyNotice] = useState('')
  const [draftReady, setDraftReady] = useState(false)
  const baselineValuesRef = useRef<AccountFormValues | null>(null)
  const avatarSyncRetryRef = useRef(false)
  const referralRequestIdRef = useRef(0)
  const captchaConfig = getRegistrationCaptchaConfig()

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

  function handleAccountChange(platform: Platform, value: string) {
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
  }

  function handleAccountBlur(platform: Platform, value: string) {
    if (platform === 'xcpc_elo') return
    const draftPlatform = platform as (typeof accountDraftPlatforms)[number]
    const normalizedValue = normalizePlatformAccountId(value, draftPlatform)
    if (normalizedValue !== accounts[draftPlatform]) {
      const nextAccounts = { ...accounts, [draftPlatform]: normalizedValue }
      setAccounts(nextAccounts)
      persistFormDraft({ accounts: nextAccounts })
    }
    setAccountValidationErrors((current) => ({
      ...current,
      [draftPlatform]: validatePlatformAccountId(draftPlatform, normalizedValue),
    }))
  }

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
    const qqChanged = !baseline || submittedValues.qq !== baseline.qq
    const shouldSyncAvatar = qqChanged || avatarSyncRetryRef.current
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
      if (shouldSyncAvatar) {
        try {
          await syncMemberAvatar()
          avatarSyncRetryRef.current = false
        } catch (error) {
          avatarSyncRetryRef.current = true
          setSaving(false)
          setNoticeKind('error')
          setNotice(
            `资料已保存，但${error instanceof Error ? error.message : '头像同步失败，请稍后重试。'}`,
          )
          return
        }
      }
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

    const resetPasswordCaptcha = () => {
      setPasswordCaptchaToken('')
      setPasswordCaptchaResetKey((current) => current + 1)
    }

    if (newPassword.length < 8) {
      setPasswordNoticeKind('error')
      setPasswordNotice('新密码至少需要 8 位。')
      resetPasswordCaptcha()
      return
    }
    if (newPassword !== confirmedPassword) {
      setPasswordNoticeKind('error')
      setPasswordNotice('两次输入的新密码不一致。')
      resetPasswordCaptcha()
      return
    }
    if (newPassword === currentPassword) {
      setPasswordNoticeKind('error')
      setPasswordNotice('新密码不能与当前密码相同。')
      resetPasswordCaptcha()
      return
    }
    if (captchaConfig.configurationError) {
      setPasswordNoticeKind('error')
      setPasswordNotice(captchaConfig.configurationError)
      resetPasswordCaptcha()
      return
    }
    if (captchaConfig.enabled && !passwordCaptchaToken) {
      setPasswordNoticeKind('error')
      setPasswordNotice('请先完成修改密码安全验证。')
      resetPasswordCaptcha()
      return
    }

    setChangingPassword(true)
    try {
      if (captchaConfig.enabled) {
        await changePassword(currentPassword, newPassword, passwordCaptchaToken)
      } else {
        await changePassword(currentPassword, newPassword)
      }
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
      resetPasswordCaptcha()
      setChangingPassword(false)
    }
  }

  async function handleAccountDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      user?.role !== 'member' ||
      !deletionConfirmed ||
      !deletionPassword ||
      (captchaConfig.enabled && !deletionCaptchaToken)
    ) {
      return
    }

    setDeletingAccount(true)
    setDeletionNotice('')
    try {
      if (captchaConfig.enabled) {
        await deleteAccount(deletionPassword, deletionCaptchaToken)
      } else {
        await deleteAccount(deletionPassword)
      }
      if (userId) clearAccountDraft(userId)
    } catch (error) {
      setDeletionPassword('')
      setDeletionNotice(error instanceof Error ? error.message : '账号注销失败，请稍后重试。')
      setDeletingAccount(false)
    } finally {
      setDeletionCaptchaToken('')
      setDeletionCaptchaResetKey((current) => current + 1)
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
          <p>QQ 不会直接公开；服务端会用它获取并缓存榜单头像。</p>
        </div>
        <div className="account-status">
          <span>{isDemo ? '本地演示资料' : '账号资料'}</span>
        </div>
      </section>

      {loadingProfile ? <LoadingState label="正在读取账号资料" /> : null}

      <AccountReferralSection
        referralSummary={referralSummary}
        referralLoading={referralLoading}
        referralNotice={referralNotice}
        copyNotice={copyNotice}
        onCopy={() => void copyReferralLink()}
      />

      <form className="account-form" onSubmit={handleSave}>
        <AccountProfileSection
          name={name}
          onNameChange={(value) => {
            setName(value)
            persistFormDraft({ name: value })
          }}
          qq={qq}
          onQqChange={(value) => {
            setQq(value)
            persistFormDraft({ qq: value })
          }}
          grade={grade}
          onGradeChange={(value) => {
            setGrade(value)
            persistFormDraft({ grade: value })
          }}
          selectableGrades={selectableGrades}
          major={major}
          onMajorChange={(value) => {
            setMajor(value)
            persistFormDraft({ major: value })
          }}
          disabled={loadingProfile}
        />

        <AccountPlatformsSection
          accounts={accounts}
          accountStatuses={accountStatuses}
          accountErrors={accountErrors}
          accountValidationErrors={accountValidationErrors}
          onAccountChange={handleAccountChange}
          onAccountBlur={handleAccountBlur}
          disabled={loadingProfile}
        />

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

      <AccountDataExportSection
        exportingData={exportingData}
        disabled={exportingData || loadingProfile || !userId}
        exportNotice={exportNotice}
        exportNoticeKind={exportNoticeKind}
        onExport={() => void handleDataExport()}
      />

      <AccountPasswordSection
        currentPassword={currentPassword}
        onCurrentPasswordChange={setCurrentPassword}
        newPassword={newPassword}
        onNewPasswordChange={setNewPassword}
        confirmedPassword={confirmedPassword}
        onConfirmedPasswordChange={setConfirmedPassword}
        changingPassword={changingPassword}
        passwordNotice={passwordNotice}
        passwordNoticeKind={passwordNoticeKind}
        captchaConfig={captchaConfig}
        passwordCaptchaResetKey={passwordCaptchaResetKey}
        onPasswordCaptchaTokenChange={setPasswordCaptchaToken}
        passwordCaptchaToken={passwordCaptchaToken}
        onSubmit={handlePasswordChange}
      />

      <AccountDeletionSection
        isAdmin={user?.role === 'admin'}
        showDeletionConfirmation={showDeletionConfirmation}
        onShowConfirmation={setShowDeletionConfirmation}
        deletionPassword={deletionPassword}
        onDeletionPasswordChange={setDeletionPassword}
        deletionConfirmed={deletionConfirmed}
        onDeletionConfirmedChange={setDeletionConfirmed}
        deletingAccount={deletingAccount}
        deletionNotice={deletionNotice}
        captchaConfig={captchaConfig}
        deletionCaptchaResetKey={deletionCaptchaResetKey}
        onDeletionCaptchaTokenChange={setDeletionCaptchaToken}
        deletionCaptchaToken={deletionCaptchaToken}
        onCancel={() => {
          setShowDeletionConfirmation(false)
          setDeletionPassword('')
          setDeletionConfirmed(false)
          setDeletionNotice('')
          setDeletionCaptchaToken('')
          setDeletionCaptchaResetKey((current) => current + 1)
        }}
        onSubmit={handleAccountDeletion}
      />
    </div>
  )
}
