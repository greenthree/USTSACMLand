import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from '@assistant-ui/react'
import { useChatRuntime } from '@assistant-ui/react-ai-sdk'
import type { ChatTransport, UIMessage } from 'ai'
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down'
import Check from 'lucide-react/dist/esm/icons/check'
import Copy from 'lucide-react/dist/esm/icons/copy'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import Send from 'lucide-react/dist/esm/icons/send'
import Square from 'lucide-react/dist/esm/icons/square'
import type { ComponentProps } from 'react'
import { useMemo } from 'react'
import { MockChatTransport } from './MockChatTransport'

function SafeMarkdownLink(props: ComponentProps<'a'>) {
  return <a {...props} target="_blank" rel="noreferrer noopener" />
}

function AssistantText() {
  return (
    <MarkdownTextPrimitive
      className="chat-spike-markdown"
      components={{ a: SafeMarkdownLink }}
      defer
      skipHtml
    />
  )
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="chat-spike-message chat-spike-message-assistant">
      <div className="chat-spike-message-label">学习助手</div>
      <MessagePrimitive.Parts components={{ Text: AssistantText }} />
      <ActionBarPrimitive.Root className="chat-spike-actions" hideWhenRunning autohide="not-last">
        <ActionBarPrimitive.Copy asChild>
          <button type="button" aria-label="复制回复" title="复制回复">
            <AuiIf condition={(state) => state.message.isCopied}>
              <Check size={15} aria-hidden="true" />
            </AuiIf>
            <AuiIf condition={(state) => !state.message.isCopied}>
              <Copy size={15} aria-hidden="true" />
            </AuiIf>
          </button>
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload asChild>
          <button type="button" aria-label="重新生成" title="重新生成">
            <RefreshCw size={15} aria-hidden="true" />
          </button>
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  )
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="chat-spike-message chat-spike-message-user">
      <div className="chat-spike-message-label">你</div>
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  )
}

function ChatThread() {
  return (
    <ThreadPrimitive.Root className="chat-spike-thread">
      <ThreadPrimitive.Viewport className="chat-spike-viewport">
        <AuiIf condition={(state) => state.thread.isEmpty}>
          <section className="chat-spike-welcome">
            <p>训练台 / Phase 0</p>
            <h2>把一个算法问题讲清楚</h2>
            <span>从题意、思路或一段代码开始。</span>
          </section>
        </AuiIf>
        <div className="chat-spike-messages">
          <ThreadPrimitive.Messages>
            {({ message }) => (message.role === 'user' ? <UserMessage /> : <AssistantMessage />)}
          </ThreadPrimitive.Messages>
        </div>
        <ThreadPrimitive.ViewportFooter className="chat-spike-footer">
          <ThreadPrimitive.ScrollToBottom asChild>
            <button type="button" aria-label="滚动到最新消息" title="滚动到最新消息">
              <ArrowDown size={16} aria-hidden="true" />
            </button>
          </ThreadPrimitive.ScrollToBottom>
          <ComposerPrimitive.Root className="chat-spike-composer">
            <ComposerPrimitive.Input
              aria-label="向 AI 学习助手提问"
              placeholder="写下题意、思路或代码问题"
              rows={1}
            />
            <AuiIf condition={(state) => !state.thread.isRunning}>
              <ComposerPrimitive.Send asChild>
                <button type="button" aria-label="发送问题" title="发送问题">
                  <Send size={17} aria-hidden="true" />
                </button>
              </ComposerPrimitive.Send>
            </AuiIf>
            <AuiIf condition={(state) => state.thread.isRunning}>
              <ComposerPrimitive.Cancel asChild>
                <button type="button" aria-label="停止生成" title="停止生成">
                  <Square size={14} aria-hidden="true" />
                </button>
              </ComposerPrimitive.Cancel>
            </AuiIf>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  )
}

const defaultTransport = new MockChatTransport()

export function ChatSpike({
  transport = defaultTransport,
}: {
  transport?: ChatTransport<UIMessage>
}) {
  const stableTransport = useMemo(() => transport, [transport])
  const runtime = useChatRuntime({ transport: stableTransport })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatThread />
    </AssistantRuntimeProvider>
  )
}
