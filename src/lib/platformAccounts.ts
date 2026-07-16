import type { AccountDraftPlatform } from './accountDraft'

const accountPatterns: Record<AccountDraftPlatform, RegExp> = {
  codeforces: /^[A-Za-z0-9_.-]{3,24}$/,
  nowcoder: /^[0-9]+$/,
  atcoder: /^[A-Za-z0-9_]{1,30}$/,
  luogu: /^[0-9]+$/,
  qoj: /^[A-Za-z0-9_.-]{1,50}$/,
}

const accountErrorMessages: Record<AccountDraftPlatform, string> = {
  codeforces: '请输入 3-24 位 Codeforces Handle，仅可使用英文字母、数字、下划线、点和连字符。',
  nowcoder: '牛客 UID 只能包含数字，请填写个人主页链接末尾的数字。',
  atcoder: '请输入 1-30 位 AtCoder 用户名，仅可使用英文字母、数字和下划线。',
  luogu: '洛谷 UID 只能包含数字，请填写个人主页链接末尾的数字。',
  qoj: '请输入 1-50 位 QOJ 用户名，仅可使用英文字母、数字、下划线、点和连字符。',
}

export const platformAccountMaxLengths: Record<AccountDraftPlatform, number> = {
  codeforces: 24,
  nowcoder: 20,
  atcoder: 30,
  luogu: 20,
  qoj: 50,
}

export function normalizePlatformAccountId(value: string, platform?: AccountDraftPlatform): string {
  const trimmed = value.trim()
  if ((platform === 'nowcoder' || platform === 'luogu') && /^\d+$/.test(trimmed)) {
    return trimmed.replace(/^0+(?=\d)/, '')
  }
  return trimmed
}

export function validatePlatformAccountId(
  platform: AccountDraftPlatform,
  value: string,
): string | null {
  const normalizedValue = normalizePlatformAccountId(value, platform)
  if (!normalizedValue) return null
  return accountPatterns[platform].test(normalizedValue) ? null : accountErrorMessages[platform]
}

export function validatePlatformAccounts(
  accounts: Record<AccountDraftPlatform, string>,
): Record<AccountDraftPlatform, string | null> {
  return Object.fromEntries(
    Object.entries(accounts).map(([platform, value]) => [
      platform,
      validatePlatformAccountId(platform as AccountDraftPlatform, value),
    ]),
  ) as Record<AccountDraftPlatform, string | null>
}

export function platformAccountSaveErrorMessage(error: {
  code?: string | null
  message: string
}): string {
  if (
    error.code === '23505' ||
    error.message.includes('platform_accounts_platform_external_unique')
  ) {
    return '该平台账号已被绑定，请检查填写内容或联系管理员。'
  }

  if (error.code === '23514' || error.message.includes('platform_accounts_external_id_format')) {
    return '平台账号格式不符合要求，请检查后重试。'
  }

  return `平台绑定保存失败：${error.message}`
}
