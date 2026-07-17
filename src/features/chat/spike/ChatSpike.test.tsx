import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatSpike } from './ChatSpike'
import { MockChatTransport } from './MockChatTransport'

describe('assistant-ui Phase 0 chat spike', () => {
  it('streams a mock response through the assistant-ui runtime', async () => {
    const user = userEvent.setup()
    render(<ChatSpike transport={new MockChatTransport({ chunkDelayMs: 0 })} />)

    const input = screen.getByRole('textbox', { name: '向 AI 学习助手提问' })
    await user.type(input, '如何判断一道题该用二分答案？')
    await user.click(screen.getByRole('button', { name: '发送问题' }))

    expect(await screen.findByText('如何判断一道题该用二分答案？')).toBeInTheDocument()
    expect(await screen.findByText(/我们先拆解这个问题/)).toHaveTextContent(
      '如何判断一道题该用二分答案？',
    )
    expect(screen.getByRole('button', { name: '复制回复' })).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('exposes stop generation and aborts the mock stream', async () => {
    const user = userEvent.setup()
    render(<ChatSpike transport={new MockChatTransport({ chunkDelayMs: 20 })} />)

    await user.type(
      screen.getByRole('textbox', { name: '向 AI 学习助手提问' }),
      '请逐字符输出一段很长的讲解',
    )
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    await user.click(await screen.findByRole('button', { name: '停止生成' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发送问题' })).toBeInTheDocument()
    })
    expect(screen.queryByText(/这是 Phase 0 的本地流式回复/)).not.toBeInTheDocument()
  })

  it('removes settled abort listeners while streaming a reply', async () => {
    const abortController = new AbortController()
    const addListener = vi.spyOn(abortController.signal, 'addEventListener')
    const removeListener = vi.spyOn(abortController.signal, 'removeEventListener')
    const transport = new MockChatTransport({ chunkDelayMs: 1, buildReply: () => 'abc' })

    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'phase-0-test',
      messageId: undefined,
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: '测试' }] }],
      abortSignal: abortController.signal,
    })
    await stream.pipeTo(new WritableStream())

    expect(addListener).toHaveBeenCalledTimes(3)
    expect(removeListener).toHaveBeenCalledTimes(3)
  })
})
