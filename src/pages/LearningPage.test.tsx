import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'

describe('LearningPage', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('organizes the beginner route by first month, platform, stage, topic, rhythm, and resources', async () => {
    render(
      <MemoryRouter initialEntries={['/learning']}>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: /新手学习引导/ }, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(document.title).toBe('新手学习引导 | USTS ACM Land')
    const chapterNavigation = screen.getByRole('navigation', { name: '学习页章节' })
    for (const chapter of [
      '四周计划',
      '练习平台',
      '进阶路线',
      '知识地图',
      '训练节奏',
      '开放资源',
      '竞赛圈子',
    ]) {
      expect(chapterNavigation).toHaveTextContent(chapter)
    }

    expect(screen.getByText('每天 60–90 分钟即可开始')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '完全不会写代码' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('progressbar', { name: '四周学习进度' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    )
    expect(screen.getAllByRole('tab')).toHaveLength(4)
    const weekPanel = screen.getByRole('tabpanel')
    for (const content of [
      '搭好 C++ 环境',
      '配置 C++ 编译环境',
      '完成输入输出与判断练习',
      '独立提交 5 道短题',
    ]) {
      expect(weekPanel).toHaveTextContent(content)
    }
    expect(screen.getByRole('link', { name: '一键配置 C++ 环境（新窗口打开）' })).toHaveAttribute(
      'href',
      'https://ab.algoux.cn/',
    )

    for (const heading of ['环境与语法', '基础题型', '算法思维', '参加比赛', '准备三人团队赛']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    }

    expect(screen.getByLabelText('环境与语法知识点')).toHaveTextContent(
      '输入输出判断与循环函数数组字符串基础调试',
    )
    expect(screen.getAllByRole('heading', { level: 4, name: '怎么练' })).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 4, name: '进入下一阶段前' })).toHaveLength(1)
    expect(
      screen.getByRole('heading', { name: '知识点不是清单，而是一张相互连接的地图' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '把训练组织成稳定循环' })).toBeInTheDocument()

    expect(screen.getByLabelText('推荐平台学习顺序')).toHaveTextContent(
      '建议顺序牛客→洛谷→Codeforces',
    )
    expect(screen.getByRole('link', { name: '进入牛客竞赛（新窗口打开）' })).toHaveAttribute(
      'href',
      'https://www.nowcoder.com/problem/tracker#/problems',
    )
    expect(screen.getByRole('link', { name: '浏览洛谷题单（新窗口打开）' })).toHaveAttribute(
      'href',
      'https://www.luogu.com.cn/training/list',
    )
    expect(screen.getByRole('link', { name: '查看 800 分题目（新窗口打开）' })).toHaveAttribute(
      'href',
      'https://codeforces.com/problemset?tags=800-800',
    )

    const oiWiki = screen.getByRole('link', { name: 'OI Wiki（新窗口打开）' })
    expect(oiWiki).toHaveAttribute('href', 'https://oi-wiki.org/')
    expect(oiWiki).toHaveAttribute('target', '_blank')
    expect(oiWiki).toHaveAttribute('rel', 'noreferrer')
    expect(screen.getByRole('link', { name: 'Codeforces EDU（新窗口打开）' })).toHaveAttribute(
      'href',
      'https://codeforces.com/edu/courses',
    )
    expect(screen.getByRole('link', { name: '算法竞赛 Wiki（新窗口打开）' })).toHaveAttribute(
      'href',
      'https://www.algowiki.cn/',
    )
    expect(screen.getByRole('link', { name: 'XCPC Link（新窗口打开）' })).toHaveAttribute(
      'href',
      'https://xcpc.link/',
    )
    expect(screen.getByRole('heading', { name: '融入竞赛圈子' })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '查看 ACM 群组坐标汇总（新窗口打开）' }),
    ).toHaveAttribute('href', 'https://acmer.info/')
  }, 10_000)

  it('personalizes the starting point and persists interactive plan progress', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <MemoryRouter initialEntries={['/learning']}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { name: /新手学习引导/ }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: '已经会基础语法' }))
    expect(screen.getByText('推荐从这里开始').parentElement).toHaveTextContent('洛谷')
    expect(screen.getByRole('link', { name: '洛谷推荐入口（新窗口打开）' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /第 2 周/ }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('补齐程序基本结构')
    await user.click(screen.getByRole('checkbox', { name: '掌握数组与字符串' }))
    expect(screen.getByRole('progressbar', { name: '四周学习进度' })).toHaveAttribute(
      'aria-valuenow',
      '8',
    )
    expect(localStorage.getItem('usts-acm-land-learning-progress:v1')).toBe('["1-0"]')

    await user.click(screen.getByRole('button', { name: /基础题型/ }))
    expect(screen.getByLabelText('基础题型知识点')).toBeInTheDocument()
    expect(screen.queryByLabelText('环境与语法知识点')).not.toBeInTheDocument()

    unmount()
  }, 10_000)

  it('is linked from the primary navigation and returns focus on client-side navigation', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    const learningLink = await screen.findByRole('link', { name: '学习' }, { timeout: 5000 })
    await user.click(learningLink)

    expect(await screen.findByRole('heading', { name: /新手学习引导/ })).toBeInTheDocument()
    expect(learningLink).toHaveClass('active')
    expect(screen.getByRole('main')).toHaveFocus()
    expect(screen.getByText('已进入新手学习引导页面')).toHaveAttribute('role', 'status')
  })
})
