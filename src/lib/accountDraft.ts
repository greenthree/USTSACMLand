import type { Platform } from '../types/domain'

export const accountDraftPlatforms = [
  'codeforces',
  'nowcoder',
  'atcoder',
  'luogu',
  'qoj',
] as const satisfies readonly Platform[]

export type AccountDraftPlatform = (typeof accountDraftPlatforms)[number]

export interface AccountFormValues {
  name: string
  qq: string
  major: string
  grade: string
  accounts: Record<AccountDraftPlatform, string>
}

export interface AccountDraft {
  version: 1
  base: AccountFormValues
  values: AccountFormValues
}

const accountDraftKeyPrefix = 'usts-acm-land:account-draft:v1:'

function accountDraftKey(userId: string): string {
  return `${accountDraftKeyPrefix}${userId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseAccountFormValues(value: unknown): AccountFormValues | null {
  if (!isRecord(value)) return null
  if (
    typeof value.name !== 'string' ||
    typeof value.qq !== 'string' ||
    typeof value.major !== 'string' ||
    typeof value.grade !== 'string' ||
    !isRecord(value.accounts)
  )
    return null

  const accounts = {} as Record<AccountDraftPlatform, string>
  for (const platform of accountDraftPlatforms) {
    const account = value.accounts[platform]
    if (typeof account !== 'string') return null
    accounts[platform] = account
  }

  return {
    name: value.name,
    qq: value.qq,
    major: value.major,
    grade: value.grade,
    accounts,
  }
}

function copyAccountFormValues(value: AccountFormValues): AccountFormValues {
  return {
    name: value.name,
    qq: value.qq,
    major: value.major,
    grade: value.grade,
    accounts: Object.fromEntries(
      accountDraftPlatforms.map((platform) => [platform, value.accounts[platform]]),
    ) as AccountFormValues['accounts'],
  }
}

function parseAccountDraft(value: unknown): AccountDraft | null {
  if (!isRecord(value) || value.version !== 1) return null
  const base = parseAccountFormValues(value.base)
  const values = parseAccountFormValues(value.values)
  return base && values ? { version: 1, base, values } : null
}

export function loadAccountDraft(userId: string, storage: Storage = window.localStorage) {
  try {
    const serialized = storage.getItem(accountDraftKey(userId))
    return serialized ? parseAccountDraft(JSON.parse(serialized) as unknown) : null
  } catch {
    return null
  }
}

export function saveAccountDraft(
  userId: string,
  base: AccountFormValues,
  values: AccountFormValues,
  storage: Storage = window.localStorage,
) {
  const stored: AccountDraft = {
    version: 1,
    base: copyAccountFormValues(base),
    values: copyAccountFormValues(values),
  }
  try {
    storage.setItem(accountDraftKey(userId), JSON.stringify(stored))
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

export function clearAccountDraft(userId: string, storage: Storage = window.localStorage) {
  try {
    storage.removeItem(accountDraftKey(userId))
  } catch {
    // Saving the server state still succeeds when local storage is unavailable.
  }
}

export function accountFormValuesEqual(left: AccountFormValues, right: AccountFormValues): boolean {
  return (
    left.name === right.name &&
    left.qq === right.qq &&
    left.major === right.major &&
    left.grade === right.grade &&
    accountDraftPlatforms.every((platform) => left.accounts[platform] === right.accounts[platform])
  )
}

export function mergeAccountDraft(
  serverValues: AccountFormValues,
  draft: AccountDraft,
): AccountFormValues {
  const mergedAccounts = { ...serverValues.accounts }
  for (const platform of accountDraftPlatforms) {
    if (draft.values.accounts[platform] !== draft.base.accounts[platform]) {
      mergedAccounts[platform] = draft.values.accounts[platform]
    }
  }

  return {
    name: draft.values.name !== draft.base.name ? draft.values.name : serverValues.name,
    qq: draft.values.qq !== draft.base.qq ? draft.values.qq : serverValues.qq,
    major: draft.values.major !== draft.base.major ? draft.values.major : serverValues.major,
    grade: draft.values.grade !== draft.base.grade ? draft.values.grade : serverValues.grade,
    accounts: mergedAccounts,
  }
}

export function accountDraftHasConflict(
  serverValues: AccountFormValues,
  draft: AccountDraft,
): boolean {
  const profileConflict = (['name', 'qq', 'major', 'grade'] as const).some(
    (field) =>
      draft.values[field] !== draft.base[field] && serverValues[field] !== draft.base[field],
  )
  return (
    profileConflict ||
    accountDraftPlatforms.some(
      (platform) =>
        draft.values.accounts[platform] !== draft.base.accounts[platform] &&
        serverValues.accounts[platform] !== draft.base.accounts[platform],
    )
  )
}
