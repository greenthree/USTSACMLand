import {
  RuntimeAdapterProvider,
  type GenericThreadHistoryAdapter,
  type MessageFormatAdapter,
  type MessageFormatItem,
  type MessageStorageEntry,
  type RemoteThreadListAdapter,
  type ThreadHistoryAdapter,
  type ThreadMessage,
  useAui,
} from '@assistant-ui/react'
import { createAssistantStream } from 'assistant-stream'
import type { PropsWithChildren } from 'react'
import { useMemo } from 'react'
import { demoAuthEnabled, supabase } from '../../lib/supabase'

const pageSize = 30
const maxTitleLength = 80
const activeThreadPrefix = 'usts-acm-land-webchat-active:v1:'
const demoHistoryPrefix = 'usts-acm-land-webchat-history:v1:'

interface ConversationRecord {
  id: string
  title: string | null
  status: 'regular' | 'archived'
  messageCount: number
  version: number
  createdAt: string
  updatedAt: string
  lastMessageAt: string
}

interface StoredMessageRecord {
  id: string
  parentId: string | null
  format: string
  content: Record<string, unknown>
  position: number
}

interface ConversationPage {
  conversations: ConversationRecord[]
  nextCursor?: string
}

interface WebChatHistoryBackend {
  list(after?: string): Promise<ConversationPage>
  create(): Promise<ConversationRecord>
  fetch(conversationId: string): Promise<ConversationRecord>
  rename(conversationId: string, title: string): Promise<void>
  setArchived(conversationId: string, archived: boolean): Promise<void>
  delete(conversationId: string): Promise<void>
  loadMessages(conversationId: string): Promise<StoredMessageRecord[]>
  upsertMessage(
    conversationId: string,
    message: Omit<StoredMessageRecord, 'position'>,
  ): Promise<void>
  deleteMessages(conversationId: string, messageIds: string[]): Promise<void>
}

interface RpcError {
  code?: string
  message: string
}

type UntypedRpc = (
  functionName: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: RpcError | null }>

function historyError(error: RpcError, fallback: string) {
  if (error.code === '54000') return new Error('历史会话已达上限，请先删除较早的对话。')
  if (error.code === 'P0002') return new Error('该历史对话不存在或已过期。')
  return new Error(`${fallback}：${error.message}`)
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('历史会话服务返回了无效数据。')
  }
  return value as Record<string, unknown>
}

function timestamp(value: unknown, name: string) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`历史会话服务返回了无效的${name}。`)
  }
  return value
}

function integer(value: unknown, name: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`历史会话服务返回了无效的${name}。`)
  }
  return value
}

function parseConversation(value: unknown): ConversationRecord {
  const row = record(value)
  const messageCount = row.message_count ?? row.messageCount
  const createdAt = row.created_at ?? row.createdAt
  const updatedAt = row.updated_at ?? row.updatedAt
  const lastMessageAt = row.last_message_at ?? row.lastMessageAt
  if (
    typeof row.id !== 'string' ||
    (row.title !== null && typeof row.title !== 'string') ||
    (row.status !== 'regular' && row.status !== 'archived')
  ) {
    throw new Error('历史会话服务返回了无效的会话。')
  }

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    messageCount: integer(messageCount, '消息数'),
    version: integer(row.version, '版本'),
    createdAt: timestamp(createdAt, '创建时间'),
    updatedAt: timestamp(updatedAt, '更新时间'),
    lastMessageAt: timestamp(lastMessageAt, '最后消息时间'),
  }
}

function parseStoredMessage(value: unknown): StoredMessageRecord {
  const row = record(value)
  const parentId = row.parent_id ?? row.parentId ?? null
  if (
    typeof row.id !== 'string' ||
    (parentId !== null && typeof parentId !== 'string') ||
    typeof row.format !== 'string'
  ) {
    throw new Error('历史会话服务返回了无效的消息。')
  }
  const content = record(row.content)
  return {
    id: row.id,
    parentId,
    format: row.format,
    content,
    position: integer(row.position, '消息位置'),
  }
}

interface ConversationCursor {
  lastMessageAt: string
  id: string
}

function encodeCursor(conversation: ConversationRecord) {
  return JSON.stringify({
    lastMessageAt: conversation.lastMessageAt,
    id: conversation.id,
  } satisfies ConversationCursor)
}

function decodeCursor(value?: string): ConversationCursor | null {
  if (!value) return null
  try {
    const parsed = record(JSON.parse(value))
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.lastMessageAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.lastMessageAt))
    ) {
      return null
    }
    return { id: parsed.id, lastMessageAt: parsed.lastMessageAt }
  } catch {
    return null
  }
}

class SupabaseWebChatHistoryBackend implements WebChatHistoryBackend {
  private async call(functionName: string, args?: Record<string, unknown>) {
    if (!supabase) throw new Error('Supabase 尚未配置，无法读取历史会话。')
    const rpc = supabase.rpc.bind(supabase) as unknown as UntypedRpc
    const { data, error } = await rpc(functionName, args)
    if (error) throw historyError(error, '历史会话操作失败')
    return data
  }

  async list(after?: string): Promise<ConversationPage> {
    const cursor = decodeCursor(after)
    const data = await this.call('list_own_webchat_conversations', {
      requested_limit: pageSize + 1,
      cursor_last_message_at: cursor?.lastMessageAt ?? null,
      cursor_id: cursor?.id ?? null,
    })
    if (!Array.isArray(data)) throw new Error('历史会话列表格式无效。')
    const records = data.map(parseConversation)
    const conversations = records.slice(0, pageSize)
    return {
      conversations,
      ...(records.length > pageSize && conversations.length > 0
        ? { nextCursor: encodeCursor(conversations.at(-1)!) }
        : undefined),
    }
  }

  async create() {
    const data = await this.call('create_own_webchat_conversation')
    const row = Array.isArray(data) ? data[0] : data
    return parseConversation(row)
  }

  async fetch(conversationId: string) {
    const data = await this.call('get_own_webchat_conversation', {
      requested_conversation_id: conversationId,
    })
    const row = Array.isArray(data) ? data[0] : data
    if (!row) throw new Error('该历史对话不存在或已过期。')
    return parseConversation(row)
  }

  async rename(conversationId: string, title: string) {
    await this.call('rename_own_webchat_conversation', {
      requested_conversation_id: conversationId,
      requested_title: title,
    })
  }

  async setArchived(conversationId: string, archived: boolean) {
    await this.call('set_own_webchat_conversation_archived', {
      requested_conversation_id: conversationId,
      requested_archived: archived,
    })
  }

  async delete(conversationId: string) {
    await this.call('delete_own_webchat_conversation', {
      requested_conversation_id: conversationId,
    })
  }

  async loadMessages(conversationId: string) {
    const data = await this.call('load_own_webchat_messages', {
      requested_conversation_id: conversationId,
    })
    if (!Array.isArray(data)) throw new Error('历史消息格式无效。')
    return data.map(parseStoredMessage)
  }

  async upsertMessage(conversationId: string, message: Omit<StoredMessageRecord, 'position'>) {
    await this.call('upsert_own_webchat_message', {
      requested_conversation_id: conversationId,
      requested_message_id: message.id,
      requested_parent_id: message.parentId,
      requested_format: message.format,
      requested_content: message.content,
    })
  }

  async deleteMessages(conversationId: string, messageIds: string[]) {
    if (messageIds.length === 0) return
    await this.call('delete_own_webchat_messages', {
      requested_conversation_id: conversationId,
      requested_message_ids: messageIds,
    })
  }
}

interface DemoHistoryStore {
  conversations: ConversationRecord[]
  messages: Record<string, StoredMessageRecord[]>
}

function emptyDemoStore(): DemoHistoryStore {
  return { conversations: [], messages: {} }
}

class DemoWebChatHistoryBackend implements WebChatHistoryBackend {
  private readonly key: string

  constructor(userId: string) {
    this.key = `${demoHistoryPrefix}${encodeURIComponent(userId)}`
  }

  private read(): DemoHistoryStore {
    try {
      const raw = localStorage.getItem(this.key)
      if (!raw) return emptyDemoStore()
      const parsed = record(JSON.parse(raw))
      if (!Array.isArray(parsed.conversations)) {
        return emptyDemoStore()
      }
      const parsedMessages = record(parsed.messages)
      const conversations = parsed.conversations.map(parseConversation)
      const messages = Object.fromEntries(
        Object.entries(parsedMessages).map(([conversationId, value]) => [
          conversationId,
          Array.isArray(value) ? value.map(parseStoredMessage) : [],
        ]),
      )
      return { conversations, messages }
    } catch {
      return emptyDemoStore()
    }
  }

  private write(store: DemoHistoryStore) {
    localStorage.setItem(this.key, JSON.stringify(store))
  }

  async list(after?: string): Promise<ConversationPage> {
    const cursor = decodeCursor(after)
    const ordered = this.read()
      .conversations.filter((conversation) => {
        if (!cursor) return true
        if (conversation.lastMessageAt < cursor.lastMessageAt) return true
        return conversation.lastMessageAt === cursor.lastMessageAt && conversation.id < cursor.id
      })
      .sort((left, right) => {
        const byDate = right.lastMessageAt.localeCompare(left.lastMessageAt)
        return byDate || right.id.localeCompare(left.id)
      })
    const conversations = ordered.slice(0, pageSize)
    return {
      conversations,
      ...(ordered.length > pageSize && conversations.length > 0
        ? { nextCursor: encodeCursor(conversations.at(-1)!) }
        : undefined),
    }
  }

  async create() {
    const store = this.read()
    if (store.conversations.length >= 100) {
      throw new Error('历史会话已达上限，请先删除较早的对话。')
    }
    const now = new Date().toISOString()
    const conversation: ConversationRecord = {
      id: crypto.randomUUID(),
      title: null,
      status: 'regular',
      messageCount: 0,
      version: 1,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
    }
    store.conversations.unshift(conversation)
    store.messages[conversation.id] = []
    this.write(store)
    return conversation
  }

  async fetch(conversationId: string) {
    const conversation = this.read().conversations.find((item) => item.id === conversationId)
    if (!conversation) throw new Error('该历史对话不存在或已过期。')
    return conversation
  }

  async rename(conversationId: string, title: string) {
    const store = this.read()
    const conversation = store.conversations.find((item) => item.id === conversationId)
    if (!conversation) throw new Error('该历史对话不存在或已过期。')
    conversation.title = title.slice(0, maxTitleLength)
    conversation.updatedAt = new Date().toISOString()
    conversation.version += 1
    this.write(store)
  }

  async setArchived(conversationId: string, archived: boolean) {
    const store = this.read()
    const conversation = store.conversations.find((item) => item.id === conversationId)
    if (!conversation) throw new Error('该历史对话不存在或已过期。')
    conversation.status = archived ? 'archived' : 'regular'
    conversation.updatedAt = new Date().toISOString()
    conversation.version += 1
    this.write(store)
  }

  async delete(conversationId: string) {
    const store = this.read()
    store.conversations = store.conversations.filter((item) => item.id !== conversationId)
    delete store.messages[conversationId]
    this.write(store)
  }

  async loadMessages(conversationId: string) {
    const store = this.read()
    if (!store.conversations.some((item) => item.id === conversationId)) {
      throw new Error('该历史对话不存在或已过期。')
    }
    return [...(store.messages[conversationId] ?? [])].sort(
      (left, right) => left.position - right.position,
    )
  }

  async upsertMessage(conversationId: string, message: Omit<StoredMessageRecord, 'position'>) {
    const store = this.read()
    const conversation = store.conversations.find((item) => item.id === conversationId)
    if (!conversation) throw new Error('该历史对话不存在或已过期。')
    const messages = store.messages[conversationId] ?? []
    const existing = messages.find((item) => item.id === message.id)
    if (existing) {
      Object.assign(existing, message)
    } else {
      messages.push({ ...message, position: (messages.at(-1)?.position ?? 0) + 1 })
      conversation.messageCount += 1
    }
    const now = new Date().toISOString()
    conversation.lastMessageAt = now
    conversation.updatedAt = now
    conversation.status = 'regular'
    conversation.version += 1
    store.messages[conversationId] = messages
    this.write(store)
  }

  async deleteMessages(conversationId: string, messageIds: string[]) {
    const store = this.read()
    const conversation = store.conversations.find((item) => item.id === conversationId)
    if (!conversation) throw new Error('该历史对话不存在或已过期。')
    const messages = store.messages[conversationId] ?? []
    const deleted = new Set(messageIds)
    let changed = true
    while (changed) {
      changed = false
      for (const message of messages) {
        if (message.parentId && deleted.has(message.parentId) && !deleted.has(message.id)) {
          deleted.add(message.id)
          changed = true
        }
      }
    }
    store.messages[conversationId] = messages.filter((message) => !deleted.has(message.id))
    conversation.messageCount = store.messages[conversationId].length
    conversation.updatedAt = new Date().toISOString()
    conversation.version += 1
    this.write(store)
  }
}

class WebChatThreadHistoryAdapter implements ThreadHistoryAdapter {
  constructor(
    private readonly backend: WebChatHistoryBackend,
    private readonly aui: ReturnType<typeof useAui>,
  ) {}

  async load() {
    return { messages: [] }
  }

  async append() {
    throw new Error('WebChat history requires the AI SDK storage format.')
  }

  withFormat<TMessage, TStorageFormat extends Record<string, unknown>>(
    formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
  ): GenericThreadHistoryAdapter<TMessage> {
    const currentConversationId = async () => {
      const state = this.aui.threadListItem().getState()
      if (state.remoteId) return state.remoteId
      return (await this.aui.threadListItem().initialize()).remoteId
    }

    const upsert = async (item: MessageFormatItem<TMessage>) => {
      const conversationId = await currentConversationId()
      const encoded = formatAdapter.encode(item)
      await this.backend.upsertMessage(conversationId, {
        id: formatAdapter.getId(item.message),
        parentId: item.parentId,
        format: formatAdapter.format,
        content: encoded,
      })
    }

    return {
      load: async () => {
        const conversationId = this.aui.threadListItem().getState().remoteId
        if (!conversationId) return { messages: [] }
        const messages = await this.backend.loadMessages(conversationId)
        const compatible = messages.filter((message) => message.format === formatAdapter.format)
        return {
          headId: compatible.at(-1)?.id ?? null,
          messages: compatible.map((message) =>
            formatAdapter.decode({
              id: message.id,
              parent_id: message.parentId,
              format: message.format,
              content: message.content as TStorageFormat,
            } satisfies MessageStorageEntry<TStorageFormat>),
          ),
        }
      },
      append: upsert,
      update: async (item) => upsert(item),
      delete: async (items) => {
        const conversationId = this.aui.threadListItem().getState().remoteId
        if (!conversationId) return
        await this.backend.deleteMessages(
          conversationId,
          items.map((item) => formatAdapter.getId(item.message)),
        )
      },
    }
  }
}

function titleFromMessages(messages: readonly ThreadMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === 'user')
  const text = firstUserMessage?.content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return '新对话'
  return text.length <= 28 ? text : `${text.slice(0, 27)}…`
}

function createHistoryProvider(backend: WebChatHistoryBackend) {
  return function WebChatHistoryProvider({ children }: PropsWithChildren) {
    const aui = useAui()
    const history = useMemo(() => new WebChatThreadHistoryAdapter(backend, aui), [aui])
    const adapters = useMemo(() => ({ history }), [history])
    return <RuntimeAdapterProvider adapters={adapters}>{children}</RuntimeAdapterProvider>
  }
}

export function createWebChatThreadListAdapter(userId: string): RemoteThreadListAdapter {
  const backend: WebChatHistoryBackend =
    supabase && !demoAuthEnabled
      ? new SupabaseWebChatHistoryBackend()
      : new DemoWebChatHistoryBackend(userId)

  return {
    unstable_Provider: createHistoryProvider(backend),
    async list(params) {
      const page = await backend.list(params?.after)
      return {
        threads: page.conversations.map((conversation) => ({
          remoteId: conversation.id,
          externalId: undefined,
          status: conversation.status,
          title: conversation.title ?? undefined,
          lastMessageAt: new Date(conversation.lastMessageAt),
          custom: {
            messageCount: conversation.messageCount,
            version: conversation.version,
          },
        })),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : undefined),
      }
    },
    async initialize() {
      const conversation = await backend.create()
      return { remoteId: conversation.id, externalId: undefined }
    },
    async fetch(threadId) {
      const conversation = await backend.fetch(threadId)
      return {
        remoteId: conversation.id,
        externalId: undefined,
        status: conversation.status,
        title: conversation.title ?? undefined,
        lastMessageAt: new Date(conversation.lastMessageAt),
        custom: {
          messageCount: conversation.messageCount,
          version: conversation.version,
        },
      }
    },
    rename: (threadId, title) => backend.rename(threadId, title),
    updateCustom: async () => undefined,
    archive: (threadId) => backend.setArchived(threadId, true),
    unarchive: (threadId) => backend.setArchived(threadId, false),
    delete: (threadId) => backend.delete(threadId),
    async generateTitle(threadId, messages) {
      const title = titleFromMessages(messages)
      await backend.rename(threadId, title)
      return createAssistantStream((controller) => controller.appendText(title))
    },
  }
}

function activeThreadKey(userId: string) {
  return `${activeThreadPrefix}${encodeURIComponent(userId)}`
}

export function readActiveWebChatThreadId(userId: string) {
  try {
    return localStorage.getItem(activeThreadKey(userId)) ?? undefined
  } catch {
    return undefined
  }
}

export function storeActiveWebChatThreadId(userId: string, threadId?: string) {
  try {
    if (threadId) localStorage.setItem(activeThreadKey(userId), threadId)
    else localStorage.removeItem(activeThreadKey(userId))
  } catch {
    // Conversation history still works when browser storage is unavailable;
    // only automatic refresh restoration is skipped.
  }
}
