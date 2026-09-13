export type ContestKind = 'school' | 'practice'
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
  { time: '00:00', title: '比赛开始', detail: '选手独立读题，快速建立题目优先级。' },
  { time: '02:00', title: '榜单封停', detail: '最后一小时不再公开其他选手的新结果。' },
  { time: '03:00', title: '比赛结束', detail: '停止提交，裁判确认所有有效评测结果。' },
  { time: '赛后', title: '滚榜揭晓', detail: '从封榜前名次开始逐位揭晓，形成最终排名。' },
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
  const timeOffset = teamSeed * 2

  return [
    { label: 'A', state: 'ac', attempts: 1, submissionTime: 8 + timeOffset },
    { label: 'B', state: 'ac', attempts: 1, submissionTime: 16 + timeOffset },
    { label: 'C', state: 'ac', attempts: 2, submissionTime: 26 + timeOffset },
    { label: 'D', state: 'ac', attempts: 1, submissionTime: 38 + timeOffset },
    { label: 'E', state: 'empty' },
    { label: 'F', state: 'ac', attempts: 3, submissionTime: 50 + timeOffset },
    { label: 'G', ...problemG },
    { label: 'H', state: 'ac', attempts: 1, submissionTime: 64 + timeOffset },
    { label: 'I', state: 'ac', attempts: 2, submissionTime: 80 + timeOffset },
    { label: 'J', state: 'empty' },
    { label: 'K', ...problemK },
    { label: 'L', state: 'ac', attempts: 1, submissionTime: 94 + timeOffset },
  ]
}

export const schoolRollboardTeams: RollboardTeam[] = [
  {
    id: 'compass',
    team: 'CF皇帝',
    solved: 10,
    penalty: 704,
    seed: 1,
    problems: createSchoolRollboardProblems(
      1,
      { state: 'ac', attempts: 2, submissionTime: 100 },
      { state: 'ac', attempts: 1, submissionTime: 112 },
    ),
  },
  {
    id: 'recursion',
    team: '零基础选手',
    solved: 9,
    penalty: 614,
    seed: 2,
    problems: createSchoolRollboardProblems(
      2,
      { state: 'ac', attempts: 2, submissionTime: 106 },
      { state: 'pending', attempts: 2, submissionTime: 135, reveal: 'ac', penalty: 155 },
    ),
  },
  {
    id: 'last-page',
    team: '春日影',
    solved: 9,
    penalty: 614,
    seed: 3,
    problems: createSchoolRollboardProblems(
      3,
      { state: 'ac', attempts: 1, submissionTime: 110 },
      { state: 'pending', attempts: 1, submissionTime: 160, reveal: 'ac', penalty: 160 },
    ),
  },
  {
    id: 'one-shot',
    team: '一路向南',
    solved: 8,
    penalty: 520,
    seed: 4,
    problems: createSchoolRollboardProblems(
      4,
      { state: 'pending', attempts: 1, submissionTime: 140, reveal: 'ac', penalty: 140 },
      { state: 'pending', attempts: 3, submissionTime: 172, reveal: 'wa' },
    ),
  },
  {
    id: 'boundary',
    team: '航电同学',
    solved: 8,
    penalty: 536,
    seed: 5,
    problems: createSchoolRollboardProblems(
      5,
      { state: 'pending', attempts: 2, submissionTime: 144, reveal: 'wa' },
      { state: 'pending', attempts: 3, submissionTime: 150, reveal: 'ac', penalty: 190 },
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
