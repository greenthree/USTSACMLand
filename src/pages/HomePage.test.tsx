import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import { AuthContext, type AuthContextValue, type AuthUser } from '../auth/authContextValue'
import { defaultMembersDataState, MembersDataContext } from '../data/membersDataContext'
import { mockMembers } from '../data/mock'
import { formatInteger } from '../lib/format'
import { calculateTotalSolved } from '../lib/rankings'
import { HomePage } from './HomePage'

vi.mock('../features/chat/chatAvailability', () => ({
  webChatUiEnabled: true,
}))

const mockTotalSolved = formatInteger(
  mockMembers.reduce((total, member) => total + (calculateTotalSolved(member) ?? 0), 0),
)

function renderHomePage({
  user = null,
  data = {},
}: {
  user?: AuthUser | null
  data?: Partial<typeof defaultMembersDataState>
} = {}) {
  const auth: AuthContextValue = {
    status: user ? 'authenticated' : 'anonymous',
    user,
    isDemo: false,
    isPasswordRecovery: false,
    signUp: vi.fn(async () => true),
    signIn: vi.fn(async () => {}),
    changePassword: vi.fn(async () => {}),
    completePasswordRecovery: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
  }
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthContext.Provider value={auth}>
        <MembersDataContext.Provider value={{ ...defaultMembersDataState, ...data }}>
          <HomePage />
        </MembersDataContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

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

    expect(
      await screen.findByRole('heading', { name: /USTS ACM Land/ }, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByText(/把最难的题/)).toBeInTheDocument()
    expect(document.querySelector('.home-hero-logo')).toHaveAttribute('src', '/icpc-foundation.png')
    expect(screen.getByRole('link', { name: /了解 ACM 竞赛/ })).toHaveAttribute(
      'href',
      '#about-acm',
    )
    expect(screen.getByRole('link', { name: '新手入门' })).toHaveAttribute('href', '/learning')

    expect(screen.getByText('三人一队')).toBeInTheDocument()
    expect(screen.getByText('五小时')).toBeInTheDocument()
    expect(screen.getByText('一台电脑')).toBeInTheDocument()
    expect(screen.getByText(/每解出一道题，志愿者就会给队伍系上一只气球/)).toBeInTheDocument()
    expect(document.querySelectorAll('.home-balloon')).toHaveLength(5)

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
    expect(document.querySelectorAll('.home-competition-letter')).toHaveLength(6)

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
    expect(screen.getByText(/在站内完成知识问答、代码讲解和训练复盘/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '已上线：新手学习引导' })).toHaveAttribute(
      'href',
      '/learning',
    )
    expect(screen.getByRole('link', { name: '已上线：每日一题' })).toHaveAttribute(
      'href',
      '/daily-problem',
    )
    expect(screen.getByRole('link', { name: '成员登录后可用：AI 学习助手' })).toHaveAttribute(
      'href',
      '/assistant',
    )
    expect(screen.getAllByRole('link', { name: /^已上线：/ })).toHaveLength(2)
    expect(screen.queryByText('规划中')).not.toBeInTheDocument()

    expect(screen.getByRole('heading', { name: '在比赛中找到下一段训练' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '新生赛' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '了解新生赛' })).toHaveAttribute('href', '/contests')
    expect(screen.getByRole('heading', { name: '练习赛' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '校赛' })).toBeInTheDocument()
    expect(screen.getByLabelText('USTS算法小白交流群')).toHaveTextContent(
      'USTS算法小白交流群QQ 群 721375856',
    )
    expect(screen.getByText(/每场比赛中表现优异的选手，都有机会加入集训队/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '创建成员账号' })).toHaveAttribute('href', '/register')
  }, 10_000)

  it('keeps rankings as a secondary public training record', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: '公开数据，是成长的一份记录' }, { timeout: 5000 }),
    ).toBeInTheDocument()
    const dataSummary = screen.getByLabelText('公开数据概览')
    expect(dataSummary).toHaveTextContent(`${mockTotalSolved} 累计通过题数`)
    expect(dataSummary).toHaveTextContent('当前为演示数据')
    expect(screen.getByRole('link', { name: /查看完整榜单/ })).toHaveAttribute('href', '/rankings')
    expect(screen.getByText(/每日 07:00 \/ 19:00/)).toBeInTheDocument()
    expect(screen.getByText(/每周二 08:00/)).toBeInTheDocument()
  })

  it('announces the demo fallback once when live data fails', () => {
    renderHomePage({
      data: { members: mockMembers, loading: false, error: '网络错误', demo: true },
    })

    expect(screen.getByRole('status')).toHaveTextContent('实时数据读取失败，当前展示演示数据。')
    const dataSummary = screen.getByLabelText('公开数据概览')
    expect(dataSummary).not.toHaveTextContent('当前为演示数据')
    expect(dataSummary).toHaveTextContent(mockTotalSolved)
  })

  it('shows a loading placeholder before member data arrives', () => {
    renderHomePage({ data: { members: [], loading: true, error: null, demo: false } })

    const dataSummary = screen.getByLabelText('公开数据概览')
    expect(dataSummary).toHaveAttribute('aria-busy', 'true')
    expect(dataSummary).toHaveTextContent('数据加载中')
    expect(dataSummary).toHaveTextContent('加载中')
    expect(dataSummary).not.toHaveTextContent('公开数据源')
  })

  it('switches the member entries for signed-in members', () => {
    renderHomePage({
      user: { id: 'u1', email: 'member@example.com', role: 'member', reviewStatus: 'approved' },
    })

    expect(screen.getByRole('link', { name: '管理我的资料' })).toHaveAttribute('href', '/account')
    expect(screen.queryByRole('link', { name: '创建成员账号' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '已上线：AI 学习助手' })).toHaveAttribute(
      'href',
      '/assistant',
    )
  })

  it('adds an exact home entry to the primary navigation', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    const homeLink = await screen.findByRole('link', { name: '首页' }, { timeout: 5000 })
    expect(homeLink).toHaveClass('active')
    expect(screen.queryByRole('link', { name: '成员' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '榜单' })).not.toHaveClass('active')
  })
})
