import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'

describe('HomePage', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('introduces ACM and links visitors to the product areas', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'USTS ACM Land' })).toBeInTheDocument()
    expect(document.querySelector('.home-hero-logo')).toHaveAttribute('src', '/icpc-foundation.png')
    expect(screen.getByText('三人一队')).toBeInTheDocument()
    expect(screen.getByText('五小时')).toBeInTheDocument()
    expect(screen.getByText('一台电脑')).toBeInTheDocument()
    expect(screen.getByText(/智力与创造力的巅峰赛/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'ACM，不只是把题做出来' })).toBeInTheDocument()
    expect(screen.getByText('赛场禁止，学习鼓励')).toBeInTheDocument()
    expect(screen.getByText(/正式算法竞赛中禁止使用 AI/)).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '从省赛到世界赛，认识主要算法竞赛' }),
    ).toBeInTheDocument()
    expect(screen.getByText('ICPC')).toBeInTheDocument()
    expect(screen.getByText('CCPC')).toBeInTheDocument()
    expect(screen.getByText('华为杯 JSCPC')).toBeInTheDocument()
    expect(screen.getByText('蓝桥杯')).toBeInTheDocument()
    expect(screen.getByText('天梯赛')).toBeInTheDocument()
    expect(screen.getByText('百度之星')).toBeInTheDocument()
    expect(screen.getByText(/Ⅰ乙比赛/)).toBeInTheDocument()
    expect(screen.getByText(/三个相互独立的赛事体系/)).toBeInTheDocument()
    expect(screen.getByText(/国内大厂技术笔试多采用算法竞赛的/)).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '每一周，都有新的比赛可以参加' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/每周都有十场以上面向所有人的线上公开赛/)).toBeInTheDocument()
    const contestPlatforms = screen.getByLabelText('主要线上公开赛平台')
    expect(contestPlatforms).toHaveTextContent('Codeforces')
    expect(contestPlatforms).toHaveTextContent('AtCoder')
    expect(contestPlatforms).toHaveTextContent('牛客')
    expect(contestPlatforms).toHaveTextContent('洛谷')
    expect(contestPlatforms).toHaveTextContent('QOJ')
    expect(screen.getByRole('heading', { name: '开放资源，帮新手走稳第一步' })).toBeInTheDocument()
    expect(screen.getByText(/绝大多数免费向学习者开放/)).toBeInTheDocument()
    expect(screen.queryByText(/不止于榜单/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '学习引导' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '每日一题' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'AI 学习助手' })).toBeInTheDocument()
    expect(screen.getByText(/计划接入 GPT-5.6/)).toBeInTheDocument()
    expect(screen.getAllByText('规划中')).toHaveLength(3)
    expect(screen.getByRole('heading', { name: '在比赛中找到下一段训练' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '新生赛' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '练习赛' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '校赛' })).toBeInTheDocument()
    expect(screen.getByText(/每场比赛中表现优异的选手，都有机会加入集训队/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '浏览集训队成员' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '创建成员账号' })).toHaveAttribute('href', '/register')
  })

  it('keeps rankings as a secondary public training record', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: '公开数据，是成长的一份记录' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '总 Rating 前列' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /查看完整榜单/ })).toHaveAttribute('href', '/rankings')
    const dataSummary = screen.getByLabelText('公开数据概览')
    expect(dataSummary).toHaveTextContent('16,582 累计通过题数')
    expect(dataSummary).not.toHaveTextContent('名成员')
    expect(dataSummary).not.toHaveTextContent('个平台账号')
  })

  it('adds an exact home entry to the primary navigation', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    const homeLink = await screen.findByRole('link', { name: '首页' })
    expect(homeLink).toHaveClass('active')
    expect(screen.queryByRole('link', { name: '成员' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '榜单' })).not.toHaveClass('active')
  })
})
