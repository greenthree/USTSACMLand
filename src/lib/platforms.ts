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
export const solvedPlatforms: SolvedPlatform[] = ['codeforces', 'nowcoder', 'luogu', 'qoj']
export const ratingRankingViews: RankingView[] = ['overall', ...ratingPlatforms]
export const solvedRankingViews: RankingView[] = ['overall', ...solvedPlatforms]

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
