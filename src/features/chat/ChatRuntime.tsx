import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useRemoteThreadListRuntime,
} from '@assistant-ui/react'
import { useChatRuntime } from '@assistant-ui/react-ai-sdk'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import type { ChatTransport, UIMessage } from 'ai'
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down'
import Check from 'lucide-react/dist/esm/icons/check'
import CircleAlert from 'lucide-react/dist/esm/icons/circle-alert'
import Copy from 'lucide-react/dist/esm/icons/copy'
import History from 'lucide-react/dist/esm/icons/history'
import Plus from 'lucide-react/dist/esm/icons/plus'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import Send from 'lucide-react/dist/esm/icons/send'
import Square from 'lucide-react/dist/esm/icons/square'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import type { ComponentProps } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/authContextValue'
import { createBrowserWebChatTransport, normalizeWebChatError, WebChatApiError } from './chatApi'
import {
  createWebChatThreadListAdapter,
  readActiveWebChatThreadId,
  storeActiveWebChatThreadId,
} from './webChatHistory'

const defaultTransport = createBrowserWebChatTransport()

const suggestions = [
  '帮我拆解一道题的输入、输出和关键边界',
  '检查这段 C++ 的复杂度与可能的 bug',
  '给我一条学习二分答案的练习路线',
]

function SafeMarkdownLink(props: ComponentProps<'a'>) {
  return <a {...props} target="_blank" rel="noreferrer noopener" />
}

function AssistantText() {
  return (
    <MarkdownTextPrimitive
      className="assistant-markdown"
      components={{ a: SafeMarkdownLink }}
      defer
      skipHtml
    />
  )
}

function AssistantThinking() {
  const visible = useAuiState(
    (state) =>
      state.thread.isRunning &&
      state.message.isLast &&
      !state.message.content.some((part) => part.type === 'text' && part.text.trim().length > 0),
  )

  if (!visible) return null

  return (
    <div className="assistant-thinking-copy" role="status">
      <span>思考中</span>
      <i aria-hidden="true" />
      <i aria-hidden="true" />
      <i aria-hidden="true" />
    </div>
  )
}

function AssistantMessage() {
  const visible = useAuiState(
    (state) =>
      state.message.content.some((part) => part.type === 'text' && part.text.trim().length > 0) ||
      (state.thread.isRunning && state.message.isLast),
  )

  if (!visible) return null

  return (
    <MessagePrimitive.Root className="assistant-message assistant-message-model">
      <div className="assistant-message-rail" aria-hidden="true">
        <span>AI</span>
      </div>
      <div className="assistant-message-body">
        <p className="assistant-message-label">学习助手</p>
        <AssistantThinking />
        <MessagePrimitive.Parts components={{ Text: AssistantText }} />
        <ActionBarPrimitive.Root
          className="assistant-message-actions"
          hideWhenRunning
          autohide="not-last"
        >
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
      </div>
    </MessagePrimitive.Root>
  )
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="assistant-message assistant-message-user">
      <p className="assistant-message-label">你</p>
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  )
}

function EmptyConversation() {
  return (
    <section className="assistant-empty" aria-labelledby="assistant-empty-title">
      <div className="assistant-empty-index" aria-hidden="true">
        01
      </div>
      <div>
        <p>从一个具体问题开始</p>
        <h2 id="assistant-empty-title">把题意、思路或代码放到工作台上。</h2>
        <span>我会先帮你拆解问题、检查假设，再一起走到结论。</span>
        <div className="assistant-suggestions" aria-label="提问示例">
          {suggestions.map((suggestion) => (
            <ThreadPrimitive.Suggestion key={suggestion} prompt={suggestion} send={false} asChild>
              <button type="button">{suggestion}</button>
            </ThreadPrimitive.Suggestion>
          ))}
        </div>
      </div>
    </section>
  )
}

function EmptyConversationGate() {
  const messageCount = useAuiState((state) => state.thread.messages.length)
  return messageCount === 0 ? <EmptyConversation /> : null
}

function DeleteConversation({ onDelete }: { onDelete: () => void }) {
  const aui = useAui()
  const isRunning = useAuiState((state) => state.thread.isRunning)
  const isEmpty = useAuiState((state) => state.thread.messages.length === 0)
  const remoteId = useAuiState((state) => state.threadListItem.remoteId)

  const handleDelete = useCallback(() => {
    if (aui.thread().getState().isRunning) return
    if (!window.confirm('确定删除当前对话吗？删除后无法恢复。')) return
    aui.threadListItem().delete()
    onDelete()
  }, [aui, onDelete])

  return (
    <button
      className="assistant-clear-button"
      type="button"
      disabled={isRunning || (isEmpty && !remoteId)}
      onClick={handleDelete}
    >
      <Trash2 size={15} aria-hidden="true" />
      删除对话
    </button>
  )
}

function ErrorNotice({
  error,
  onDismiss,
  onReauthenticate,
  onRefreshAccess,
}: {
  error: WebChatApiError | null
  onDismiss: () => void
  onReauthenticate: () => Promise<void>
  onRefreshAccess?: () => void | Promise<void>
}) {
  const aui = useAui()
  const isRunning = useAuiState((state) => state.thread.isRunning)
  const lastUserMessageId = useAuiState((state) => {
    for (let index = state.thread.messages.length - 1; index >= 0; index -= 1) {
      const message = state.thread.messages[index]
      if (message?.role === 'user') return message.id
    }
    return null
  })

  if (!error || isRunning) return null

  const retry = () => {
    if (!lastUserMessageId) return
    onDismiss()
    aui.thread().startRun({ parentId: lastUserMessageId })
  }

  return (
    <div className="assistant-error" role="alert">
      <CircleAlert size={18} aria-hidden="true" />
      <div>
        <strong>{error.message}</strong>
        {error.retryAfterSeconds !== null ? (
          <span>建议等待 {error.retryAfterSeconds} 秒后再试。</span>
        ) : null}
        {error.requestId ? <small>请求编号：{error.requestId}</small> : null}
      </div>
      {error.retryable && lastUserMessageId ? (
        <button type="button" onClick={retry}>
          重新发送
        </button>
      ) : error.status === 401 ? (
        <button type="button" onClick={() => void onReauthenticate()}>
          重新登录
        </button>
      ) : error.status === 403 && onRefreshAccess ? (
        <button type="button" onClick={() => void onRefreshAccess()}>
          重新检查权限
        </button>
      ) : null}
    </div>
  )
}

function ConversationThread() {
  return (
    <ThreadPrimitive.Root className="assistant-thread">
      <ThreadPrimitive.Viewport className="assistant-viewport">
        <EmptyConversationGate />
        <div className="assistant-messages" aria-live="polite">
          <ThreadPrimitive.Messages>
            {({ message }) => (message.role === 'user' ? <UserMessage /> : <AssistantMessage />)}
          </ThreadPrimitive.Messages>
        </div>
        <ThreadPrimitive.ViewportFooter className="assistant-composer-dock">
          <ThreadPrimitive.ScrollToBottom asChild>
            <button
              className="assistant-scroll-button"
              type="button"
              aria-label="滚动到最新消息"
              title="滚动到最新消息"
            >
              <ArrowDown size={16} aria-hidden="true" />
            </button>
          </ThreadPrimitive.ScrollToBottom>
          <ComposerPrimitive.Root className="assistant-composer">
            <ComposerPrimitive.Input
              aria-label="向 AI 学习助手提问"
              placeholder="写下题意、思路或代码问题……"
              maxLength={12_000}
              rows={1}
            />
            <div className="assistant-composer-actions">
              <span>Enter 发送 · Shift + Enter 换行</span>
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
            </div>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  )
}

const conversationDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function ConversationListItem() {
  const lastMessageAt = useAuiState((state) => state.threadListItem.lastMessageAt)
  const title = useAuiState((state) => state.threadListItem.title ?? '新对话')

  return (
    <ThreadListItemPrimitive.Root className="assistant-history-item">
      <ThreadListItemPrimitive.Trigger asChild>
        <button className="assistant-history-trigger" type="button">
          <span>
            <ThreadListItemPrimitive.Title fallback="新对话" />
          </span>
          <time dateTime={lastMessageAt?.toISOString()}>
            {lastMessageAt ? conversationDateFormatter.format(lastMessageAt) : '刚刚'}
          </time>
        </button>
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemPrimitive.Delete asChild>
        <button
          className="assistant-history-delete"
          type="button"
          aria-label={`删除对话：${title}`}
          title="删除历史对话"
          onClick={(event) => {
            if (!window.confirm(`确定删除“${title}”吗？删除后无法恢复。`)) {
              event.preventDefault()
            }
          }}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </ThreadListItemPrimitive.Delete>
    </ThreadListItemPrimitive.Root>
  )
}

function EmptyHistoryNotice() {
  const isEmpty = useAuiState((state) => state.threads.threadIds.length === 0)
  return isEmpty ? (
    <p className="assistant-history-empty">发送第一条消息后，会话会出现在这里。</p>
  ) : null
}

function ConversationHistory() {
  return (
    <aside className="assistant-history" aria-label="历史对话">
      <header>
        <div>
          <History size={17} aria-hidden="true" />
          <strong>历史对话</strong>
        </div>
        <ThreadListPrimitive.New asChild>
          <button type="button" aria-label="新建对话" title="新建对话">
            <Plus size={16} aria-hidden="true" />
          </button>
        </ThreadListPrimitive.New>
      </header>
      <ThreadListPrimitive.Root
        className="assistant-history-list"
        aria-label="历史对话列表"
        tabIndex={0}
      >
        <EmptyHistoryNotice />
        <ThreadListPrimitive.Items components={{ ThreadListItem: ConversationListItem }} />
        <ThreadListPrimitive.LoadMore asChild>
          <button className="assistant-history-more" type="button">
            加载更多
          </button>
        </ThreadListPrimitive.LoadMore>
      </ThreadListPrimitive.Root>
      <p className="assistant-history-privacy">仅你本人可见 · 最长保留 180 天</p>
    </aside>
  )
}

function CurrentConversationHeading() {
  const title = useAuiState((state) => state.threadListItem.title)
  return (
    <div>
      <span className="assistant-status-dot" aria-hidden="true" />
      <strong>{title || '新对话'}</strong>
      <small>自动保存到你的私有历史</small>
    </div>
  )
}

function AssistantWorkspace({
  error,
  onClearError,
  onReauthenticate,
  onRefreshAccess,
}: {
  error: WebChatApiError | null
  onClearError: () => void
  onReauthenticate: () => Promise<void>
  onRefreshAccess?: () => void | Promise<void>
}) {
  return (
    <div className="assistant-chat-layout">
      <ConversationHistory />
      <section className="assistant-workbench" aria-label="AI 对话工作台">
        <header className="assistant-workbench-header">
          <CurrentConversationHeading />
          <DeleteConversation onDelete={onClearError} />
        </header>
        <ErrorNotice
          error={error}
          onDismiss={onClearError}
          onReauthenticate={onReauthenticate}
          onRefreshAccess={onRefreshAccess}
        />
        <ConversationThread />
      </section>
    </div>
  )
}

export function ChatRuntime({
  transport,
  onUsageChanged,
}: {
  transport?: ChatTransport<UIMessage>
  onUsageChanged?: () => void | Promise<void>
}) {
  const navigate = useNavigate()
  const { signOut, user } = useAuth()
  const [error, setError] = useState<WebChatApiError | null>(null)
  const clearError = useCallback(() => setError(null), [])
  const reauthenticate = useCallback(async () => {
    await signOut()
    navigate('/login?returnTo=%2Fassistant', { replace: true })
  }, [navigate, signOut])
  const handleError = useCallback((nextError: Error) => {
    if (nextError instanceof DOMException && nextError.name === 'AbortError') return
    setError(normalizeWebChatError(nextError))
  }, [])
  const userId = user?.id ?? 'anonymous'
  const threadListAdapter = useMemo(() => createWebChatThreadListAdapter(userId), [userId])
  const initialThreadId = useMemo(() => readActiveWebChatThreadId(userId), [userId])
  const runtime = useRemoteThreadListRuntime({
    adapter: threadListAdapter,
    initialThreadId,
    onThreadIdChange: (threadId) => storeActiveWebChatThreadId(userId, threadId),
    runtimeHook: function WebChatThreadRuntime() {
      return useChatRuntime({
        transport: transport ?? defaultTransport,
        onError: handleError,
        onFinish: ({ isError }) => {
          if (!isError) clearError()
          void onUsageChanged?.()
        },
      })
    },
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantWorkspace
        error={error}
        onClearError={clearError}
        onReauthenticate={reauthenticate}
        onRefreshAccess={onUsageChanged}
      />
    </AssistantRuntimeProvider>
  )
}
