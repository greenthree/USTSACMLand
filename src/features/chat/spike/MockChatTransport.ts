import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

export interface MockChatTransportOptions {
  chunkDelayMs?: number
  buildReply?: (prompt: string) => string
}

function latestUserText(messages: UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'user') continue

    return message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim()
  }

  return ''
}

function defaultReply(prompt: string): string {
  return [
    `我们先拆解这个问题：${prompt}`,
    '',
    '这是 Phase 0 的本地流式回复，用来验证消息状态、停止生成和 assistant-ui 渲染链路。',
  ].join('\n')
}

function waitForChunk(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  if (delayMs <= 0) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, delayMs)

    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

export class MockChatTransport implements ChatTransport<UIMessage> {
  private readonly chunkDelayMs: number
  private readonly buildReply: (prompt: string) => string
  private sequence = 0

  constructor(options: MockChatTransportOptions = {}) {
    this.chunkDelayMs = options.chunkDelayMs ?? 18
    this.buildReply = options.buildReply ?? defaultReply
  }

  async sendMessages({
    messages,
    abortSignal,
  }: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    const prompt = latestUserText(messages)
    const reply = this.buildReply(prompt)
    const chunkDelayMs = this.chunkDelayMs
    const messageId = `mock-assistant-${(this.sequence += 1)}`
    const textId = `${messageId}-text`
    let cancelled = false

    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        void (async () => {
          try {
            controller.enqueue({ type: 'start', messageId })
            controller.enqueue({ type: 'text-start', id: textId })
            for (const chunk of Array.from(reply)) {
              await waitForChunk(chunkDelayMs, abortSignal)
              if (cancelled) return
              controller.enqueue({ type: 'text-delta', id: textId, delta: chunk })
            }
            controller.enqueue({ type: 'text-end', id: textId })
            controller.enqueue({ type: 'finish', finishReason: 'stop' })
            controller.close()
          } catch (error) {
            if (cancelled) return
            if (error instanceof DOMException && error.name === 'AbortError') {
              controller.enqueue({ type: 'abort', reason: 'user' })
              controller.close()
              return
            }
            controller.error(error)
          }
        })()
      },
      cancel() {
        cancelled = true
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }
}
