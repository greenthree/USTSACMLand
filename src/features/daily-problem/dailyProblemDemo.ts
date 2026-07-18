import type { AdminDailyProblem, DailyProblemComment } from '../../types/domain'

const shanghaiToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())

const today = new Date(`${shanghaiToday}T12:00:00+08:00`)

function dateOffset(offset: number): string {
  const value = new Date(today)
  value.setDate(value.getDate() + offset)
  return value.toISOString().slice(0, 10)
}

export const demoDailyProblems: AdminDailyProblem[] = [
  {
    id: 101,
    date: dateOffset(0),
    title: '二分答案与可行性判断',
    sourcePlatform: 'codeforces',
    externalProblemId: '1201C',
    sourceUrl: 'https://codeforces.com/problemset/problem/1201/C',
    difficulty: '1600',
    tags: ['二分', '贪心', '排序'],
    trainingNote:
      '先写出“答案至少为 x”是否可行的判断，再思考为什么可行性随 x 单调变化。不要急着套模板。',
    estimatedMinutes: 45,
    completionCount: 18,
    commentCount: 2,
    completedAt: null,
    status: 'published',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 100,
    date: dateOffset(-1),
    title: '用前缀和整理连续区间',
    sourcePlatform: 'atcoder',
    externalProblemId: 'ABC125 C',
    sourceUrl: 'https://atcoder.jp/contests/abc125/tasks/abc125_c',
    difficulty: '入门进阶',
    tags: ['前缀', '后缀', '数论'],
    trainingNote: '尝试分别维护左侧和右侧的 GCD，让删除一个位置后的答案可以快速合并。',
    estimatedMinutes: 35,
    completionCount: 24,
    commentCount: 1,
    completedAt: new Date().toISOString(),
    status: 'published',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 99,
    date: dateOffset(-2),
    title: '从最短路开始理解图上的状态',
    sourcePlatform: 'luogu',
    externalProblemId: 'P4779',
    sourceUrl: 'https://www.luogu.com.cn/problem/P4779',
    difficulty: '普及+/提高',
    tags: ['图论', '最短路', '优先队列'],
    trainingNote: '记录每次从优先队列取出的节点为什么可以被确定，理解 Dijkstra 的贪心不变量。',
    estimatedMinutes: 50,
    completionCount: 31,
    commentCount: 0,
    completedAt: null,
    status: 'published',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 102,
    date: dateOffset(1),
    title: '尚未发布的下一题',
    sourcePlatform: 'nowcoder',
    externalProblemId: 'practice-1',
    sourceUrl: 'https://ac.nowcoder.com/',
    difficulty: '待定',
    tags: ['动态规划'],
    trainingNote: '这是一条用于后台操作的演示草稿。',
    estimatedMinutes: 40,
    completionCount: 0,
    commentCount: 0,
    completedAt: null,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

export const demoDailyProblemComments: DailyProblemComment[] = [
  {
    id: 501,
    problemId: 101,
    authorId: 'demo:teammate@example.edu.cn',
    authorLabel: '训练队成员',
    body: '把中位数左边的数忽略掉后，判断函数会更容易写清楚。',
    visibility: 'visible',
    createdAt: new Date(Date.now() - 50 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 50 * 60_000).toISOString(),
    canDelete: false,
  },
  {
    id: 502,
    problemId: 101,
    authorId: 'demo:member@example.edu.cn',
    authorLabel: '我',
    body: '注意总操作数可能超过 32 位整数，累加时要使用 long long。',
    visibility: 'visible',
    createdAt: new Date(Date.now() - 15 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 15 * 60_000).toISOString(),
    canDelete: true,
  },
  {
    id: 503,
    problemId: 101,
    authorId: 'demo:another@example.edu.cn',
    authorLabel: '另一位成员',
    body: '这是一条仅管理员可见的已隐藏演示讨论。',
    visibility: 'hidden',
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    canDelete: false,
  },
]
