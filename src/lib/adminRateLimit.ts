interface ErrorLike {
  message: string
  context?: unknown
}

function retryMessage(prefix: string, retryAfterSeconds: number | null): Error {
  const delay =
    retryAfterSeconds && retryAfterSeconds > 0 ? `，约 ${retryAfterSeconds} 秒后可重试` : ''
  return new Error(`${prefix}：操作过于频繁${delay}。`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : '未知错误'
}

export function adminRpcError(prefix: string, error: unknown): Error {
  const message = errorMessage(error)
  return message.includes('admin_rate_limited')
    ? retryMessage(prefix, null)
    : new Error(`${prefix}：${message}`)
}

export async function adminFunctionError(prefix: string, error: ErrorLike): Promise<Error> {
  if (error.context instanceof Response && error.context.status === 429) {
    try {
      const body = (await error.context.clone().json()) as { retryAfterSeconds?: unknown }
      const retryAfterSeconds = Number(body.retryAfterSeconds)
      return retryMessage(prefix, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null)
    } catch {
      return retryMessage(prefix, null)
    }
  }
  return adminRpcError(prefix, error)
}
