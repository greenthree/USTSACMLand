import { platformLabels } from '../../lib/platforms'

export const icpcLogoUrl = `${import.meta.env.BASE_URL}icpc-foundation.png`
export const ccpcLogoUrl = `${import.meta.env.BASE_URL}ccpc-logo.png`

export const statPlatforms = Object.keys(platformLabels) as (keyof typeof platformLabels)[]

// 气球调色板唯一来源：hero SVG、赛事字母徽章共用；改色只改这里。
export type BalloonLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export const balloonPalette: Record<BalloonLetter, { fill: string; knot: string; ink: string }> = {
  A: { fill: '#d43d2a', knot: '#a92f20', ink: '#fff' },
  B: { fill: '#e8842c', knot: '#c26a1f', ink: '#161d17' },
  C: { fill: '#e5b32b', knot: '#b98f1f', ink: '#161d17' },
  D: { fill: '#2e7d4f', knot: '#245f3d', ink: '#fff' },
  E: { fill: '#2a5fd4', knot: '#2049a4', ink: '#fff' },
  F: { fill: '#7a3fd4', knot: '#5d2fa4', ink: '#fff' },
}

export const competitionBadges = Object.fromEntries(
  (Object.keys(balloonPalette) as BalloonLetter[]).map((letter) => [
    letter,
    { background: balloonPalette[letter].fill, color: balloonPalette[letter].ink },
  ]),
) as Record<BalloonLetter, { background: string; color: string }>

export interface HeroBalloon {
  letter: BalloonLetter
  cx: number
  cy: number
  rx: number
  ry: number
  fill: string
  light: string
  shade: string
  knot: string
  ink: string
  sway: 1 | -1
  airFreq: number
  airPhase: number
}

export const heroBalloons: HeroBalloon[] = [
  {
    letter: 'A',
    cx: 66,
    cy: 128,
    rx: 34,
    ry: 41,
    light: '#f17a63',
    shade: '#93271b',
    sway: 1,
    airFreq: 0.52,
    airPhase: 0.4,
    ...balloonPalette.A,
  },
  {
    letter: 'B',
    cx: 152,
    cy: 170,
    rx: 28,
    ry: 34,
    light: '#ffbc7a',
    shade: '#a9571a',
    sway: -1,
    airFreq: 0.67,
    airPhase: 2.8,
    ...balloonPalette.B,
  },
  {
    letter: 'C',
    cx: 236,
    cy: 118,
    rx: 37,
    ry: 45,
    light: '#ffd97e',
    shade: '#a37a14',
    sway: 1,
    airFreq: 0.45,
    airPhase: 4.6,
    ...balloonPalette.C,
  },
  {
    letter: 'D',
    cx: 318,
    cy: 164,
    rx: 27,
    ry: 33,
    light: '#5cb884',
    shade: '#1d4f31',
    sway: -1,
    airFreq: 0.73,
    airPhase: 1.5,
    ...balloonPalette.D,
  },
  {
    letter: 'E',
    cx: 384,
    cy: 134,
    rx: 31,
    ry: 38,
    light: '#6f96ff',
    shade: '#1d3f92',
    sway: 1,
    airFreq: 0.58,
    airPhase: 5.7,
    ...balloonPalette.E,
  },
]

export interface HomeCompetition {
  letter: BalloonLetter
  name: string
  fullName: string
  description: string
  type: string
}

export const homeCompetitions: HomeCompetition[] = [
  {
    letter: 'A',
    name: 'ICPC',
    fullName: '国际大学生程序设计竞赛',
    description: '面向全球高校的三人团队赛，经区域赛晋级全球总决赛。',
    type: '团队赛 · 国际',
  },
  {
    letter: 'B',
    name: 'CCPC',
    fullName: '中国大学生程序设计竞赛',
    description: '国内高水平三人团队赛事，设分站赛、女生专场和总决赛等竞赛阶段。',
    type: '团队赛 · 全国',
  },
  {
    letter: 'C',
    name: '华为杯 JSCPC',
    fullName: '江苏省大学生程序设计大赛',
    description: '面向江苏高校的省级程序设计赛事，以团队协作完成算法题目。',
    type: '团队赛 · 省级',
  },
  {
    letter: 'D',
    name: '蓝桥杯',
    fullName: '全国软件和信息技术专业人才大赛',
    description: '按组别开展的个人程序设计竞赛，覆盖省赛与全国总决赛。',
    type: '个人赛 · 全国',
  },
  {
    letter: 'E',
    name: '天梯赛',
    fullName: '中国高校计算机大赛团体程序设计天梯赛',
    description: '选手独立答题、成绩按团队汇总，兼顾个人能力与学校整体实力。',
    type: '团体计分 · 全国',
  },
  {
    letter: 'F',
    name: '百度之星',
    fullName: '程序设计大赛',
    description: '面向高校选手与开发者的个人算法竞赛，强调在线解题和综合编程能力。',
    type: '个人赛 · 全国',
  },
]

// 气球画框几何：viewBox 与运动边界的关系集中在此。
export const VIEW_W = 420
export const VIEW_H = 280
export const WALL_MARGIN = 4
export const CEILING_MARGIN = 6
export const FLOOR_Y = 244
export const KNOT_DROP = 7
export const STRING_BASE_Y = 270

export function balloonStringPath(balloon: HeroBalloon, offsetX = 0, offsetY = 0) {
  const knotX = balloon.cx + offsetX
  const knotY = balloon.cy + balloon.ry + KNOT_DROP + offsetY
  const baseX = balloon.cx + balloon.sway * 3
  const midX = (knotX + baseX) / 2 + balloon.sway * 7 - offsetX * 0.35
  const midY = (knotY + STRING_BASE_Y) / 2 + 9
  return `M${baseX} ${STRING_BASE_Y} Q ${midX.toFixed(1)} ${midY.toFixed(1)}, ${knotX.toFixed(1)} ${knotY.toFixed(1)}`
}
