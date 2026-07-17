import { createClient } from '@supabase/supabase-js'
import { notifyRuntimeError, runtimeErrorAlert } from '../_shared/error-monitoring.ts'
import { resolveAuthenticatedUser } from './authorization.ts'
import { createWebChatHandler } from './handler.ts'
import { startWebChat } from './upstream.ts'

const DEFAULT_ALLOWED_ORIGINS = [
  'https://greenthree.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
].join(',')

const SYSTEM_PROMPT = `你是苏州科技大学 ACM 集训队官网的 AI 学习助手。你的职责是帮助成员理解算法、分析题意、调试代码和复盘训练。

先引导用户理解问题与验证思路，再给出结论。明确区分确定事实、推测和需要用户补充的信息。不要声称执行了未实际执行的代码或测试。正式算法竞赛期间禁止为参赛者提供实时解题协助；若用户说明正在参赛，应拒绝直接解题，并可提供赛后学习建议。`

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function integerEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = Deno.env.get(name)?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

const handler = createWebChatHandler({
  enabled: Deno.env.get('CHAT_ENABLED')?.trim().toLowerCase() === 'true',
  allowedOrigins: Deno.env.get('CHAT_ALLOWED_ORIGINS')?.trim() || DEFAULT_ALLOWED_ORIGINS,
  maxBodyBytes: integerEnv('CHAT_MAX_REQUEST_BYTES', 262_144, 1_024, 1_048_576),
  maxMessages: integerEnv('CHAT_MAX_MESSAGES', 40, 1, 100),
  maxMessageChars: integerEnv('CHAT_MAX_MESSAGE_CHARS', 12_000, 1_000, 50_000),
  maxTotalChars: integerEnv('CHAT_MAX_TOTAL_CHARS', 60_000, 1_000, 200_000),
  createServices() {
    const serviceClient = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    return {
      async getUser(token: string) {
        const { data, error } = await serviceClient.auth.getUser(token)
        return resolveAuthenticatedUser(data, error)
      },
      async isProfileApproved(userId: string) {
        const { data, error } = await serviceClient
          .from('profiles')
          .select('review_status')
          .eq('id', userId)
          .maybeSingle()
        if (error) {
          throw new Error(`Could not authorize WebChat profile: ${error.message}`)
        }
        return data?.review_status === 'approved'
      },
    }
  },
  startChat(options) {
    return startWebChat(
      {
        baseUrl: requiredEnv('CHAT_RELAY_BASE_URL'),
        apiKey: requiredEnv('CHAT_RELAY_API_KEY'),
        model: Deno.env.get('CHAT_RELAY_MODEL')?.trim() || 'gpt-5.6',
        systemPrompt: SYSTEM_PROMPT,
        promptVersion:
          Deno.env.get('CHAT_SYSTEM_PROMPT_VERSION')?.trim() || 'usts-learning-assistant-v1',
        maxOutputTokens: integerEnv('CHAT_MAX_OUTPUT_TOKENS', 2_048, 256, 16_384),
        timeoutMs: integerEnv('CHAT_REQUEST_TIMEOUT_MS', 120_000, 5_000, 300_000),
      },
      options,
    )
  },
  async reportUnexpectedError(request, error) {
    await notifyRuntimeError(runtimeErrorAlert('webchat', request, error))
  },
})

Deno.serve(handler)
