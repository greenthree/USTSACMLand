export type ContestKind = 'freshman' | 'practice' | 'school'
export type DifficultyLevel = 'l1' | 'l2' | 'l3'

export interface DifficultyDefinition {
  id: DifficultyLevel
  label: string
  title: string
  count: number
  summary: string
  scoring: string
  note: string
}

export const difficulties: DifficultyDefinition[] = [
  {
    id: 'l1',
    label: 'L1',
    title: '语法题',
    count: 3,
    summary: '考查输入输出、分支、循环与基础代码实现，帮助第一次参赛的同学进入状态。',
    scoring: '在 OJ 提交代码并通过全部测试点（AC），即可获得该题全部分数。',
    note: '不设置部分分，最终得分只取赛时所有提交记录中的最高分。',
  },
  {
    id: 'l2',
    label: 'L2',
    title: '基础算法题',
    count: 2,
    summary: '从直接写代码向基础算法过渡，关注建模、复杂度和实现的完整性。',
    scoring: '在 OJ 提交代码并通过全部测试点（AC），即可获得该题全部分数。',
    note: '不设置部分分，未通过全部测试点时该题不计分。',
  },
  {
    id: 'l3',
    label: 'L3',
    title: '思维题',
    count: 5,
    summary:
      '强调观察、推理与结论表达。代码是验证思路的工具，答题卡让未完成代码的思考也有被看见的机会。',
    scoring:
      'OJ 通过可直接获得满分；未通过时，可在纸质答题卡写下结论与推导过程，由裁判赛后人工阅卷。',
    note: '若 OJ 已通过，裁判不再批阅该题答题卡。',
  },
]

export const freshmanTimeline = [
  { time: '00:00', title: '比赛开始', detail: '先浏览全部题目，再选择适合自己的起点。' },
  { time: '01:00', title: '榜单封停', detail: '外部榜单不再显示其他选手的新结果。' },
  { time: '02:00', title: '比赛结束', detail: '停止提交，L3 答题卡进入人工阅卷。' },
  { time: '+1–3 天', title: '公布总榜', detail: '合并 OJ 与答题卡得分，发布最终成绩。' },
]

export const practiceTimeline = [
  { time: '00:00', title: '快速浏览', detail: '浏览三个梯级，先判断会写的题和可争取的测试点。' },
  {
    time: '30–60 分钟',
    title: '完成 L1',
    detail: '按个人节奏完成会写的基础级题目，不把节点当作硬性截止。',
  },
  { time: '第 2 小时', title: '推进 L2', detail: '集中完成会写的进阶级题目，继续积累确定得分。' },
  {
    time: '剩余时间',
    title: '争取部分分',
    detail: '对准尚未通过的题目和测试点，逐步提高已有得分。',
  },
]

export const schoolTimeline = [
  { time: '00:00', title: '比赛开始', detail: '三名队员共同读题，快速建立题目优先级。' },
  { time: '04:00', title: '榜单封停', detail: '最后一小时不再公开其他队伍的新结果。' },
  { time: '05:00', title: '比赛结束', detail: '停止提交，裁判确认所有有效评测结果。' },
  { time: '赛后', title: '滚榜揭晓', detail: '从封榜前名次开始逐队揭晓，形成最终排名。' },
]

export type RollboardProblemState = 'ac' | 'wa' | 'pending' | 'empty'
export type RollboardRevealResult = Extract<RollboardProblemState, 'ac' | 'wa'>

export interface RollboardProblem {
  label: string
  state: RollboardProblemState
  attempts?: number
  submissionTime?: number
  reveal?: RollboardRevealResult
  penalty?: number
}

export interface RollboardTeam {
  id: string
  team: string
  solved: number
  penalty: number
  seed: number
  problems: RollboardProblem[]
}

export type RollboardProblemInput = Omit<RollboardProblem, 'label'>

export function createSchoolRollboardProblems(
  teamSeed: number,
  problemG: RollboardProblemInput,
  problemK: RollboardProblemInput,
): RollboardProblem[] {
  const timeOffset = teamSeed * 3

  return [
    { label: 'A', state: 'ac', attempts: 1, submissionTime: 18 + timeOffset },
    { label: 'B', state: 'ac', attempts: 1, submissionTime: 36 + timeOffset },
    { label: 'C', state: 'ac', attempts: 2, submissionTime: 62 + timeOffset },
    { label: 'D', state: 'ac', attempts: 1, submissionTime: 89 + timeOffset },
    { label: 'E', state: 'empty' },
    { label: 'F', state: 'ac', attempts: 3, submissionTime: 126 + timeOffset },
    { label: 'G', ...problemG },
    { label: 'H', state: 'ac', attempts: 1, submissionTime: 169 + timeOffset },
    { label: 'I', state: 'ac', attempts: 2, submissionTime: 203 + timeOffset },
    { label: 'J', state: 'empty' },
    { label: 'K', ...problemK },
    { label: 'L', state: 'ac', attempts: 1, submissionTime: 246 + timeOffset },
  ]
}

export const schoolRollboardTeams: RollboardTeam[] = [
  {
    id: 'compass',
    team: 'CF皇帝',
    solved: 10,
    penalty: 358,
    seed: 1,
    problems: createSchoolRollboardProblems(
      1,
      { state: 'ac', attempts: 2, submissionTime: 144 },
      { state: 'ac', attempts: 1, submissionTime: 218 },
    ),
  },
  {
    id: 'recursion',
    team: '零基础新生0队',
    solved: 9,
    penalty: 421,
    seed: 2,
    problems: createSchoolRollboardProblems(
      2,
      { state: 'ac', attempts: 2, submissionTime: 152 },
      { state: 'pending', attempts: 2, submissionTime: 110, reveal: 'ac', penalty: 130 },
    ),
  },
  {
    id: 'last-page',
    team: '春日影',
    solved: 9,
    penalty: 465,
    seed: 3,
    problems: createSchoolRollboardProblems(
      3,
      { state: 'ac', attempts: 1, submissionTime: 158 },
      { state: 'pending', attempts: 1, submissionTime: 120, reveal: 'ac', penalty: 120 },
    ),
  },
  {
    id: 'one-shot',
    team: '一路向南',
    solved: 8,
    penalty: 330,
    seed: 4,
    problems: createSchoolRollboardProblems(
      4,
      { state: 'pending', attempts: 1, submissionTime: 80, reveal: 'ac', penalty: 80 },
      { state: 'pending', attempts: 3, submissionTime: 252, reveal: 'wa' },
    ),
  },
  {
    id: 'boundary',
    team: '航电一队',
    solved: 8,
    penalty: 380,
    seed: 5,
    problems: createSchoolRollboardProblems(
      5,
      { state: 'pending', attempts: 2, submissionTime: 244, reveal: 'wa' },
      { state: 'pending', attempts: 3, submissionTime: 130, reveal: 'ac', penalty: 170 },
    ),
  },
]

export function cloneSchoolRollboardTeams(): RollboardTeam[] {
  return schoolRollboardTeams.map((team) => ({
    ...team,
    problems: team.problems.map((problem) => ({ ...problem })),
  }))
}

export function rankSchoolRollboardTeams(teams: RollboardTeam[]) {
  return [...teams].sort(
    (left, right) =>
      right.solved - left.solved || left.penalty - right.penalty || left.seed - right.seed,
  )
}

export function revealSchoolRollboardProblem(
  team: RollboardTeam,
  problemLabel: string,
): RollboardTeam {
  const problem = team.problems.find((item) => item.label === problemLabel)
  if (!problem?.reveal) return team
  const reveal = problem.reveal

  return {
    ...team,
    solved: team.solved + (reveal === 'ac' ? 1 : 0),
    penalty: team.penalty + (reveal === 'ac' ? (problem.penalty ?? 0) : 0),
    problems: team.problems.map((item) =>
      item.label === problemLabel ? { ...item, state: reveal } : item,
    ),
  }
}

export function completedSchoolRollboardTeams(): RollboardTeam[] {
  return cloneSchoolRollboardTeams().map((team) =>
    team.problems.reduce(
      (current, problem) =>
        problem.state === 'pending'
          ? revealSchoolRollboardProblem(current, problem.label)
          : current,
      team,
    ),
  )
}

export function formatRollboardSubmission(problem: RollboardProblem) {
  if (problem.state === 'empty') return '-'

  return `${Math.max(1, problem.attempts ?? 1)}/${problem.submissionTime ?? 0}`
}

export function describeRollboardSubmission(problem: RollboardProblem) {
  if (problem.state === 'empty') return `${problem.label} 题无提交`

  const submission = `第 ${Math.max(1, problem.attempts ?? 1)} 次提交，开赛后第 ${problem.submissionTime ?? 0} 分钟`
  return problem.state === 'ac'
    ? `${problem.label} 题首次 AC：${submission}`
    : `${problem.label} 题最后一次提交：${submission}`
}

export const contestLogoUrl = `${import.meta.env.BASE_URL}ustsacm.png`
