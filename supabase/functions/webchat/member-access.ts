export interface WebChatMemberRuntimeAccess {
  accountEligible: boolean
  enabled: boolean
  totalRequestLimit: number
  totalTokenLimit: number
  version: number
}

function integer(value: unknown, name: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`WebChat member access RPC returned an invalid ${name}`)
  }
  return value
}

export function parseWebChatMemberRuntimeAccess(value: unknown): WebChatMemberRuntimeAccess {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('WebChat member access RPC returned invalid data')
  }
  const record = row as Record<string, unknown>
  if (typeof record.account_eligible !== 'boolean' || typeof record.access_enabled !== 'boolean') {
    throw new Error('WebChat member access RPC returned invalid data')
  }

  return {
    accountEligible: record.account_eligible,
    enabled: record.access_enabled,
    totalRequestLimit: integer(record.total_request_limit, 'total request limit', 1),
    totalTokenLimit: integer(record.total_token_limit, 'total token limit', 100),
    version: integer(record.version, 'configuration version', 0),
  }
}
