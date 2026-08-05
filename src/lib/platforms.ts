import type { Platform, RatingPlatform, SolvedPlatform } from '../types/domain'

export type RankingView = 'overall' | Platform

export const platformLabels: Record<Platform, string> = {
  codeforces: 'Codeforces',
  nowcoder: '牛客',
  atcoder: 'AtCoder',
  xcpc_elo: 'XCPC ELO',
  luogu: '洛谷',
  qoj: 'QOJ',
}

export const ratingPlatforms: RatingPlatform[] = ['codeforces', 'nowcoder', 'atcoder', 'xcpc_elo']
export const solvedPlatforms: SolvedPlatform[] = [
  'codeforces',
  'nowcoder',
  'atcoder',
  'luogu',
  'qoj',
]
export const ratingRankingViews: RankingView[] = ['overall', ...ratingPlatforms]
export const solvedRankingViews: RankingView[] = ['overall', ...solvedPlatforms]

// 首页“线上公开赛”的展示顺序是有意排布的（国际平台在前），与 solvedPlatforms 的顺序无关。
export const openContestPlatforms: readonly SolvedPlatform[] = [
  'codeforces',
  'atcoder',
  'nowcoder',
  'luogu',
  'qoj',
]

export const platformMetricLabels: Record<Platform, string> = Object.fromEntries(
  (Object.keys(platformLabels) as Platform[]).map((platform) => [
    platform,
    [
      (ratingPlatforms as readonly Platform[]).includes(platform) && 'Rating',
      (solvedPlatforms as readonly Platform[]).includes(platform) && '通过题数',
    ]
      .filter(Boolean)
      .join(' / '),
  ]),
) as Record<Platform, string>

export const rankingViewLabels: Record<RankingView, string> = {
  overall: '总榜',
  ...platformLabels,
}

export const platformUrls: Record<Platform, (id: string) => string> = {
  codeforces: (id) => `https://codeforces.com/profile/${encodeURIComponent(id)}`,
  nowcoder: (id) => `https://ac.nowcoder.com/acm/contest/profile/${encodeURIComponent(id)}`,
  atcoder: (id) => `https://atcoder.jp/users/${encodeURIComponent(id)}`,
  xcpc_elo: () => 'https://zzzzzzyt.github.io/xcpc-elo/',
  luogu: (id) => `https://www.luogu.com.cn/user/${encodeURIComponent(id)}`,
  qoj: (id) => `https://qoj.ac/user/profile/${encodeURIComponent(id)}`,
}

// 首页“线上公开赛”平台入口：链到各平台的比赛/赛程页（新窗口打开）
export const openContestPlatformUrls: Record<SolvedPlatform, string> = {
  codeforces: 'https://codeforces.com/contests',
  atcoder: 'https://atcoder.jp/contests/',
  nowcoder: 'https://ac.nowcoder.com/acm/contest/vip-index',
  luogu: 'https://www.luogu.com.cn/contest/list',
  qoj: 'https://qoj.ac/contests',
}
