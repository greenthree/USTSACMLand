import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChatTransport, UIMessage } from 'ai'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AuthContext, type AuthContextValue } from '../../auth/authContextValue'
import { WebChatApiError } from './chatApi'
import type { WebChatAttachmentClient, WebChatAttachmentPreview } from './chatAttachments'
import { MockChatTransport } from './spike/MockChatTransport'
import { ChatRuntime } from './ChatRuntime'

const signOut = vi.fn<() => Promise<void>>()

const authValue: AuthContextValue = {
  status: 'authenticated',
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'member@example.edu.cn',
    role: 'member',
    reviewStatus: 'approved',
  },
  isDemo: false,
  isPasswordRecovery: false,
  signUp: vi.fn(),
  signIn: vi.fn(),
  changePassword: vi.fn(),
  completePasswordRecovery: vi.fn(),
  deleteAccount: vi.fn(),
  signOut,
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="current route">{`${location.pathname}${location.search}`}</output>
}

function renderChat(
  transport: ChatTransport<UIMessage>,
  onUsageChanged?: () => void,
  options?: { imageInputEnabled?: boolean; attachmentClient?: WebChatAttachmentClient },
) {
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={['/assistant']}>
        <ChatRuntime
          transport={transport}
          onUsageChanged={onUsageChanged}
          imageInputEnabled={options?.imageInputEnabled}
          attachmentClient={options?.attachmentClient}
        />
        <LocationProbe />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('AI learning assistant workspace', () => {
  beforeEach(() => {
    localStorage.clear()
    signOut.mockReset().mockResolvedValue()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fills a suggestion, streams a reply, exposes history actions, and deletes the conversation', async () => {
    const user = userEvent.setup()
    const onUsageChanged = vi.fn()
    renderChat(new MockChatTransport({ chunkDelayMs: 0 }), onUsageChanged)

    const input = screen.getByRole('textbox', { name: '向 AI 学习助手提问' })
    await user.click(screen.getByRole('button', { name: '给我一条学习二分答案的练习路线' }))
    expect(input).toHaveValue('给我一条学习二分答案的练习路线')

    await user.click(screen.getByRole('button', { name: '发送问题' }))
    expect(await screen.findByText(/我们先拆解这个问题/)).toBeInTheDocument()
    await waitFor(() => expect(onUsageChanged).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: '复制回复' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '删除对话' }))
    expect(
      await screen.findByRole('heading', { name: '把题意、思路或代码放到工作台上。' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/我们先拆解这个问题/)).not.toBeInTheDocument()
  })

  it('shows thinking before visible text and keeps deletion disabled while generation is running', async () => {
    const user = userEvent.setup()
    renderChat(new MockChatTransport({ chunkDelayMs: 10_000 }))

    await user.type(screen.getByRole('textbox', { name: '向 AI 学习助手提问' }), '输出长讲解')
    await user.click(screen.getByRole('button', { name: '发送问题' }))

    expect(await screen.findByText('思考中')).toBeInTheDocument()
    expect(document.querySelectorAll('.assistant-message-model')).toHaveLength(1)
    expect(screen.getAllByText('学习助手')).toHaveLength(1)
    expect(await screen.findByRole('button', { name: '停止生成' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除对话' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '停止生成' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发送问题' })).toBeInTheDocument()
    })
    expect(document.querySelectorAll('.assistant-message-model')).toHaveLength(0)

    await user.type(screen.getByRole('textbox', { name: '向 AI 学习助手提问' }), '再次提问')
    await user.click(screen.getByRole('button', { name: '发送问题' }))

    expect(await screen.findByText('思考中')).toBeInTheDocument()
    expect(document.querySelectorAll('.assistant-message-model')).toHaveLength(1)
    expect(screen.getAllByText('学习助手')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '停止生成' }))
  })

  it('restores the active conversation after a refresh-style remount', async () => {
    const user = userEvent.setup()
    const first = renderChat(new MockChatTransport({ chunkDelayMs: 0 }))

    await user.type(screen.getByRole('textbox', { name: '向 AI 学习助手提问' }), '刷新后继续')
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    expect(await screen.findByText(/我们先拆解这个问题：刷新后继续/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /刷新后继续刚刚/ })).toBeInTheDocument()

    first.unmount()
    renderChat(new MockChatTransport({ chunkDelayMs: 0 }))

    expect((await screen.findAllByText('刷新后继续')).length).toBeGreaterThanOrEqual(2)
    expect(await screen.findByText(/我们先拆解这个问题：刷新后继续/)).toBeInTheDocument()
  })

  it('keeps a failed request visible after the run finishes', async () => {
    const user = userEvent.setup()
    const failedTransport: ChatTransport<UIMessage> = {
      async sendMessages() {
        throw new WebChatApiError('登录状态已失效，请重新登录。', 401, 'unauthorized')
      },
      async reconnectToStream() {
        return null
      },
    }
    renderChat(failedTransport)

    await user.type(screen.getByRole('textbox', { name: '向 AI 学习助手提问' }), '测试错误')
    await user.click(screen.getByRole('button', { name: '发送问题' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('登录状态已失效，请重新登录。')
    await user.click(screen.getByRole('button', { name: '重新登录' }))
    await waitFor(() => {
      expect(signOut).toHaveBeenCalledTimes(1)
      expect(screen.getByLabelText('current route')).toHaveTextContent(
        '/login?returnTo=%2Fassistant',
      )
    })
  })

  it('uploads an image, sends only its URN, restores its preview, and removes drafts', async () => {
    const user = userEvent.setup()
    const attachmentIds = [
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]
    const upload = vi.fn(async () => {
      const id = attachmentIds.shift()!
      return {
        id,
        mediaType: 'image/webp' as const,
        width: 32,
        height: 32,
        byteSize: 128,
        status: 'ready' as const,
        previewUrl: `https://storage.example.test/${id}`,
        expiresIn: 120,
      }
    })
    const preview = vi.fn(async (id: string, options?: { forceRefresh?: boolean }) => ({
      id,
      mediaType: 'image/webp' as const,
      width: 32,
      height: 32,
      byteSize: 128,
      status: 'attached' as const,
      previewUrl: `https://storage.example.test/${id}${options?.forceRefresh ? '?refreshed=1' : ''}`,
      expiresIn: 120,
    }))
    const remove = vi.fn(async () => undefined)
    const attachmentClient = { upload, preview, remove }
    const baseTransport = new MockChatTransport({ chunkDelayMs: 0 })
    const sendMessages = vi.fn((options: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]) =>
      baseTransport.sendMessages(options),
    )
    const transport: ChatTransport<UIMessage> = {
      sendMessages,
      reconnectToStream: () => baseTransport.reconnectToStream(),
    }
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 32, height: 32, close: vi.fn() })),
    )
    renderChat(transport, undefined, { imageInputEnabled: true, attachmentClient })
    const input = screen.getByRole('textbox', { name: '向 AI 学习助手提问' })
    const file = new File(['png'], 'private-name.png', { type: 'image/png' })

    await user.click(screen.getByRole('button', { name: '添加图片' }))
    const firstPicker = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(firstPicker).not.toBeNull()
    await user.upload(firstPicker!, file)
    expect(await screen.findByRole('button', { name: '移除图片' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '移除图片' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222'))

    await user.click(screen.getByRole('button', { name: '添加图片' }))
    const secondPicker = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(secondPicker).not.toBeNull()
    await user.upload(secondPicker!, file)
    expect(await screen.findByRole('button', { name: '移除图片' })).toBeInTheDocument()
    await user.type(input, '分析截图')
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    expect(await screen.findByText(/我们先拆解这个问题：分析截图/)).toBeInTheDocument()

    const sentMessages = sendMessages.mock.calls[0]?.[0].messages
    expect(sentMessages?.at(-1)?.parts).toEqual([
      { type: 'text', text: '分析截图' },
      {
        type: 'file',
        mediaType: 'image/webp',
        url: 'urn:ustsacm:webchat-attachment:33333333-3333-4333-8333-333333333333',
      },
    ])
    expect(JSON.stringify(sentMessages)).not.toContain('private-name.png')
    const renderedImage = await screen.findByRole('img', { name: '用户上传的图片' })
    expect(renderedImage).toHaveAttribute(
      'src',
      'https://storage.example.test/33333333-3333-4333-8333-333333333333',
    )
    fireEvent.error(renderedImage)
    await waitFor(() => {
      expect(preview).toHaveBeenLastCalledWith('33333333-3333-4333-8333-333333333333', {
        forceRefresh: true,
      })
      expect(screen.getByRole('img', { name: '用户上传的图片' })).toHaveAttribute(
        'src',
        'https://storage.example.test/33333333-3333-4333-8333-333333333333?refreshed=1',
      )
    })
  })

  it('shows slow uploads immediately and blocks button and Enter sends until ready', async () => {
    const user = userEvent.setup()
    let resolveUpload!: (value: WebChatAttachmentPreview) => void
    const upload = vi.fn(
      () =>
        new Promise<WebChatAttachmentPreview>((resolve) => {
          resolveUpload = resolve
        }),
    )
    const attachmentClient = {
      upload,
      preview: vi.fn(async (id: string) => ({
        id,
        mediaType: 'image/webp' as const,
        width: 32,
        height: 32,
        byteSize: 128,
        status: 'attached' as const,
        previewUrl: `https://storage.example.test/${id}`,
        expiresIn: 120,
      })),
      remove: vi.fn(async () => undefined),
    }
    const baseTransport = new MockChatTransport({ chunkDelayMs: 0 })
    const sendMessages = vi.fn((options: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]) =>
      baseTransport.sendMessages(options),
    )
    const transport: ChatTransport<UIMessage> = {
      sendMessages,
      reconnectToStream: () => baseTransport.reconnectToStream(),
    }
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 32, height: 32, close: vi.fn() })),
    )
    renderChat(transport, undefined, { imageInputEnabled: true, attachmentClient })
    const input = screen.getByRole('textbox', { name: '向 AI 学习助手提问' })
    const file = new File(['png'], 'slow.png', { type: 'image/png' })

    await user.click(screen.getByRole('button', { name: '添加图片' }))
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(picker).not.toBeNull()
    expect(picker).toHaveProperty('multiple', false)
    await user.upload(picker!, file)

    expect(await screen.findByText('图片上传中，完成后可发送')).toBeInTheDocument()
    const uploadStatus = screen.getByRole('status', { name: '上传中 0%' })
    expect(uploadStatus.closest('.assistant-image-attachment')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: '发送问题' })).toBeDisabled()
    await user.type(input, '等待图片')
    await user.keyboard('{Enter}')
    expect(sendMessages).not.toHaveBeenCalled()

    resolveUpload({
      id: '44444444-4444-4444-8444-444444444444',
      mediaType: 'image/webp',
      width: 32,
      height: 32,
      byteSize: 128,
      status: 'ready',
      previewUrl: 'https://storage.example.test/44444444-4444-4444-8444-444444444444',
      expiresIn: 120,
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送问题' })).not.toBeDisabled())
    await user.click(screen.getByRole('button', { name: '发送问题' }))

    expect(await screen.findByText(/我们先拆解这个问题：等待图片/)).toBeInTheDocument()
    expect(sendMessages).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '移除图片' })).not.toBeInTheDocument()
  })

  it('renders a failed upload as a visible status and requires removal before sending', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 32, height: 32, close: vi.fn() })),
    )
    const attachmentClient = {
      upload: vi.fn(async () => {
        throw new Error('图片服务不可用')
      }),
      preview: vi.fn(async () => {
        throw new Error('preview unavailable')
      }),
      remove: vi.fn(async () => undefined),
    }
    renderChat(new MockChatTransport({ chunkDelayMs: 0 }), undefined, {
      imageInputEnabled: true,
      attachmentClient,
    })
    const composer = screen.getByRole('textbox', { name: '向 AI 学习助手提问' })
    await user.type(composer, '先建立一条历史消息')
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    expect(await screen.findByText(/我们先拆解这个问题：先建立一条历史消息/)).toBeInTheDocument()
    const file = new File(['png'], 'failed.png', { type: 'image/png' })

    await user.click(screen.getByRole('button', { name: '添加图片' }))
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(picker).not.toBeNull()
    await user.upload(picker!, file)

    const status = await screen.findByRole('status', { name: '上传失败：图片服务不可用' })
    expect(status).toBeInTheDocument()
    expect(status.closest('.assistant-image-attachment')).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByRole('button', { name: '发送问题' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('图片服务不可用')
    expect(screen.queryByRole('button', { name: '重新发送' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '移除图片' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('status', { name: '上传失败：图片服务不可用' }),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '发送问题' })).not.toBeDisabled()
  })

  it('lets a revoked member recheck access without retrying the paid request', async () => {
    const user = userEvent.setup()
    const onUsageChanged = vi.fn()
    const deniedTransport: ChatTransport<UIMessage> = {
      async sendMessages() {
        throw new WebChatApiError('当前账号不能使用 AI 学习助手。', 403, 'member_access_denied')
      },
      async reconnectToStream() {
        return null
      },
    }
    renderChat(deniedTransport, onUsageChanged)

    await user.type(screen.getByRole('textbox', { name: '向 AI 学习助手提问' }), '检查权限')
    await user.click(screen.getByRole('button', { name: '发送问题' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('当前账号不能使用 AI 学习助手。')
    expect(screen.queryByRole('button', { name: '重新发送' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新检查权限' }))
    await waitFor(() => expect(onUsageChanged).toHaveBeenCalled())
  })
})
