import { adminFunctionError, adminRpcError } from './adminRateLimit'

describe('administrator rate-limit errors', () => {
  it('maps database rate limits without exposing internal keys', () => {
    expect(adminRpcError('成员状态更新失败', { message: 'admin_rate_limited' }).message).toBe(
      '成员状态更新失败：操作过于频繁。',
    )
  })

  it('reads the retry delay returned by an Edge Function', async () => {
    const error = await adminFunctionError('全量同步失败', {
      message: 'Edge Function returned a non-2xx status code',
      context: new Response(JSON.stringify({ retryAfterSeconds: 17 }), { status: 429 }),
    })

    expect(error.message).toBe('全量同步失败：操作过于频繁，约 17 秒后可重试。')
  })

  it('preserves ordinary service errors', async () => {
    const error = await adminFunctionError('范围同步失败', {
      message: 'network unavailable',
    })

    expect(error.message).toBe('范围同步失败：network unavailable')
  })
})
