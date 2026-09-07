export interface LearningStage {
  id: string
  number: string
  duration: string
  title: string
  subtitle: string
  description: string
  topics: string[]
  practice: string
  checkpoint: string[]
}

export type StartLevel = 'beginner' | 'syntax' | 'contest'

// v2：任务键为「周序号:任务文案」，调整文案只会重置对应任务；v1（纯索引键）读取时自动迁移
export const LEARNING_PROGRESS_KEY = 'usts-acm-land-learning-progress:v2'
export const LEGACY_LEARNING_PROGRESS_KEY = 'usts-acm-land-learning-progress:v1'

export const learningStages: LearningStage[] = [
  {
    id: 'stage-foundation',
    number: '01',
    duration: '第 1–2 周',
    title: '环境与语法',
    subtitle: '先写出第一行 C++，再让程序稳定运行',
    description:
      '完成开发环境配置，熟悉输入输出、判断、循环、函数、数组和字符串。这个阶段不追求算法数量，重点是能把题意翻译成一段可运行的程序。',
    topics: ['输入输出', '判断与循环', '函数', '数组', '字符串', '基础调试'],
    practice: '每天学 1 个知识点，独立写出代码，再记录 1 个当天遇到的错误。',
    checkpoint: [
      '能独立调试越界与初始化错误',
      '能不照抄示例完成一道语法题',
      '累计完成 30 道入门题',
    ],
  },
  {
    id: 'stage-toolbox',
    number: '02',
    duration: '第 3–6 周',
    title: '基础题型',
    subtitle: '从会写语法，到能独立拆解一道题',
    description:
      '用排序、枚举、模拟、前缀和与二分等基础题型建立解题手感。先看懂问题中的过程和约束，再选择合适的写法。',
    topics: ['复杂度直觉', '模拟与枚举', '排序', '前缀和', '二分入门', '基础 STL'],
    practice: '按知识点完成小题单；每道题写完后，用一句话记录“我把什么过程翻译成了代码”。',
    checkpoint: [
      '能从数据范围估计目标复杂度',
      '能解释 O(n) 与 O(n²) 的差别',
      '能独立完成洛谷入门题单中的基础题',
    ],
  },
  {
    id: 'stage-contest',
    number: '03',
    duration: '持续积累',
    title: '算法思维',
    subtitle: '按模型学习，而不是只背一份模板',
    description:
      '逐步学习贪心、搜索、图论、数据结构和动态规划。每学一个算法，都要回答它解决什么结构、为什么正确、数据范围如何提示它。',
    topics: ['贪心', '递归与搜索', '图的遍历', '最短路', '并查集', '基础动态规划'],
    practice: '先读一份讲解，再完成 3–6 道从直接应用到轻微变形的题，并尝试口述解法。',
    checkpoint: [
      '能为基础算法写出正确性说明',
      '能从题目条件中识别常见模型',
      '能在赛后补完至少一道未通过题',
    ],
  },
  {
    id: 'stage-race',
    number: '04',
    duration: '从第 4 周开始',
    title: '参加比赛',
    subtitle: '从会做题，到在有限时间里做出选择',
    description:
      '从 Codeforces 新生赛或虚拟参赛开始，训练读题顺序、止损、罚时意识和赛后补题。Rating 只是反馈，真正重要的是更快发现模型与错误。',
    topics: ['读题顺序', '时间分配', '罚时意识', '止损换题', '赛后补题', '复盘记录'],
    practice: '先完成一场新手比赛；适应后每周参加公开赛或虚拟参赛，赛后 24 小时内补题。',
    checkpoint: ['能在开场快速浏览并分级题目', '能在卡题时主动切换目标', '形成自己的赛后复盘记录'],
  },
  {
    id: 'stage-team',
    number: '05',
    duration: '赛季进阶',
    title: '准备三人团队赛',
    subtitle: '把个人能力组织成一支队伍的吞吐量',
    description:
      'ICPC、CCPC 与 JSCPC 不只是三个人分别做题。需要约定读题、上机、验样例、交叉检查和信息同步方式，在一台电脑上减少等待与重复劳动。',
    topics: ['题目分工', '思路口述', '代码交叉检查', '纸上推导', '封榜决策', '队伍复盘'],
    practice:
      '定期进行五小时模拟赛；记录电脑空闲、重复读题和错误提交发生的时间点，再针对流程调整。',
    checkpoint: [
      '三人能用一分钟同步题意与进度',
      '有人编码时其他人仍有明确工作',
      '赛后能区分个人问题与协作问题',
    ],
  },
]

export const firstFourWeeks = [
  {
    week: '第 1 周',
    focus: '搭好 C++/Python 环境',
    detail: '完成输入输出、判断与循环，确保能独立编译、运行和提交代码。',
    outcome: '写出第一批可通过的程序',
    tasks: ['配置 C++/Python 开发环境', '完成输入输出与判断练习', '在牛客独立提交 5 道短题'],
  },
  {
    week: '第 2 周',
    focus: '补齐程序基本结构',
    detail: '学习数组、字符串与函数，累计完成 30 道入门题。',
    outcome: '建立稳定的语法手感',
    tasks: ['掌握数组与字符串', '用函数拆分一段程序', '累计完成 30 道入门题'],
  },
  {
    week: '第 3 周',
    focus: '接触第一批题型',
    detail: '练习排序、枚举与模拟，开始一份适合自己的入门题单。',
    outcome: '从“写代码”转向“解问题”',
    tasks: ['完成 10 道模拟题', '完成 5 道枚举题', '完成 10 道排序题'],
  },
  {
    week: '第 4 周',
    focus: '完成第一次比赛',
    detail: '参加 Codeforces Div.4 或牛客周赛；没有合适场次时，选择往期比赛完成一次虚拟参赛。',
    outcome: '留下第一份赛后复盘',
    tasks: [
      '熟悉比赛提交与罚时',
      '完成一场 Codeforces Div.4、牛客周赛或虚拟赛',
      '补题并写下失败原因',
    ],
  },
]

export const weekActions: { label: string; href: string }[][] = [
  [
    { label: '一键配置 C++/Python 环境', href: 'https://ab.algoux.cn/' },
    { label: '使用 CP Editor', href: 'https://cpeditor.org/zh/' },
    { label: '去牛客完成入门练习', href: 'https://www.nowcoder.com/problem/tracker#/problems' },
  ],
  [{ label: '去牛客完成入门练习', href: 'https://www.nowcoder.com/problem/tracker#/problems' }],
  [
    { label: '继续在牛客练习', href: 'https://www.nowcoder.com/problem/tracker#/problems' },
    { label: '改用洛谷题单', href: 'https://www.luogu.com.cn/training/list' },
  ],
  [
    { label: '查看 Codeforces Div.4', href: 'https://codeforces.com/contests' },
    { label: '查看牛客周赛', href: 'https://ac.nowcoder.com/acm/contest/vip-index' },
  ],
]

export const totalTasks = firstFourWeeks.reduce((sum, week) => sum + week.tasks.length, 0)

export const taskIdOf = (weekIndex: number, task: string) => `${weekIndex}:${task}`

export const validTaskIds = new Set(
  firstFourWeeks.flatMap((week, weekIndex) => week.tasks.map((task) => taskIdOf(weekIndex, task))),
)

// v1 索引键 → v2 文案键；越界或已删除的任务直接丢弃
export function migrateLegacyProgress(stored: string[]): string[] {
  return stored.flatMap((legacyId) => {
    const [weekIndex, taskIndex] = legacyId.split('-').map(Number)
    const task = firstFourWeeks[weekIndex]?.tasks[taskIndex]
    return task === undefined ? [] : [taskIdOf(weekIndex, task)]
  })
}

export function readStoredProgress(): string[] {
  try {
    const stored = localStorage.getItem(LEARNING_PROGRESS_KEY)
    if (stored) {
      return Array.from(
        new Set((JSON.parse(stored) as string[]).filter((id) => validTaskIds.has(id))),
      )
    }
    const legacy = localStorage.getItem(LEGACY_LEARNING_PROGRESS_KEY)
    if (legacy) {
      return Array.from(new Set(migrateLegacyProgress(JSON.parse(legacy) as string[])))
    }
  } catch {
    // 存储不可用或内容损坏时从零开始
  }
  return []
}

export const learningChapters = [
  { id: 'learning-first-month', index: '01', label: '四周计划' },
  { id: 'learning-platforms', index: '02', label: '练习平台' },
  { id: 'learning-roadmap', index: '03', label: '进阶路线' },
  { id: 'learning-topics', index: '04', label: '知识地图' },
  { id: 'learning-rhythm', index: '05', label: '训练节奏' },
  { id: 'learning-resources', index: '06', label: '开放资源' },
  { id: 'learning-community', index: '07', label: '竞赛圈子' },
]

export const beginnerPlatforms = [
  {
    id: 'beginner' as StartLevel,
    order: '01',
    name: '牛客',
    cue: '完全不会写代码',
    goal: '从中文语法题和基础题开始，先建立编程手感与信心。',
    action: '进入牛客竞赛',
    href: 'https://www.nowcoder.com/problem/tracker#/problems',
    className: 'nowcoder',
    firstStep: '今天先完成 3 道输入输出题，熟悉提交和判题结果。',
  },
  {
    id: 'syntax' as StartLevel,
    order: '02',
    name: '洛谷',
    cue: '已经会基础语法',
    goal: '按知识点使用题单循序练习，把基础题型组织成系统。',
    action: '浏览洛谷题单',
    href: 'https://www.luogu.com.cn/training/list',
    className: 'luogu',
    firstStep: '从排序、枚举或模拟中选择一个题单，先完成最前面的 3 题。',
  },
  {
    id: 'contest' as StartLevel,
    order: '03',
    name: 'Codeforces',
    cue: '想开始参加比赛',
    goal: '从 800 分题目和新手比赛开始，适应英文题面与真实比赛节奏。',
    action: '查看 800 分题目',
    href: 'https://codeforces.com/problemset?tags=800-800',
    className: 'codeforces',
    firstStep: '找一场 Div. 4 或新手赛，从第一题开始，一步一步来。',
  },
]

export const resources = [
  {
    name: '算法竞赛 Wiki',
    type: '中文入门与知识导航',
    description: '从入门主题出发查找算法竞赛知识、学习顺序和相关资料。',
    href: 'https://www.algowiki.cn/',
  },
  {
    name: 'OI Wiki',
    type: '中文知识索引',
    description: '查找算法定义、性质、复杂度和进一步阅读入口。',
    href: 'https://oi-wiki.org/',
  },
  {
    name: 'Codeforces EDU',
    type: '专题课程与题目',
    description: '用课程配套题把二分、数据结构、图论等专题练成可用技能。',
    href: 'https://codeforces.com/edu/courses',
  },
  {
    name: 'AtCoder Problems',
    type: '难度与进度工具',
    description: '按难度挑选 AtCoder 题目，观察不同知识点的稳定通过区间。',
    href: 'https://kenkoooo.com/atcoder/',
  },
  {
    name: '牛客竞赛',
    type: '中文比赛与题库',
    description: '参加周赛、练习赛与寒暑假训练营，积累中文题面比赛经验。',
    href: 'https://ac.nowcoder.com/acm/contest/vip-index',
  },
  {
    name: 'XCPC Link',
    type: '算法竞赛链接集合',
    description: '集中查找比赛、训练平台、题库、工具与社区资源入口。',
    href: 'https://xcpc.link/',
  },
]
