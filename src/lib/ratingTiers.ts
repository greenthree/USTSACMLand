import type { Platform, RatingPlatform } from '../types/domain'

export type RatingTone =
  | 'gray'
  | 'brown'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'violet'
  | 'yellow'
  | 'orange'
  | 'red'
  | 'legendary'

export interface RatingTier {
  label: string
  shortLabel: string
  tone: RatingTone
}

// Accessible dark variants preserve each platform's hue while meeting WCAG AA
// contrast against the site's white table background.
export const ratingToneColors: Record<RatingTone, string> = {
  gray: '#59645e',
  brown: '#76502a',
  green: '#08763e',
  cyan: '#007674',
  blue: '#2455a4',
  violet: '#762a86',
  yellow: '#705400',
  orange: '#954600',
  red: '#aa2430',
  legendary: '#8f1728',
}

interface RatingTierDefinition extends RatingTier {
  minimum: number
}

// Platform sources checked on 2026-07-15:
// Codeforces: https://codeforces.com/blog/entry/20638
// AtCoder: https://atcoder.jp/posts/16
// NowCoder: https://www.nowcoder.com/discuss/353154183530487808 and
// https://ac.nowcoder.com/acm/contest/134527/A
// XCPC ELO: https://github.com/Zzzzzzyt/xcpc-elo/blob/master/frontend/app.js
const ratingTiers: Record<RatingPlatform, readonly RatingTierDefinition[]> = {
  codeforces: [
    { minimum: 2900, label: '传奇特级大师', shortLabel: '传奇大师', tone: 'legendary' },
    { minimum: 2600, label: '国际特级大师', shortLabel: '国际特级', tone: 'red' },
    { minimum: 2400, label: '特级大师', shortLabel: '特级大师', tone: 'red' },
    { minimum: 2300, label: '国际大师', shortLabel: '国际大师', tone: 'orange' },
    { minimum: 2200, label: '大师', shortLabel: '大师', tone: 'orange' },
    { minimum: 1900, label: '候选大师', shortLabel: '候选大师', tone: 'violet' },
    { minimum: 1600, label: '专家', shortLabel: '专家', tone: 'blue' },
    { minimum: 1400, label: '专才', shortLabel: '专才', tone: 'cyan' },
    { minimum: 1200, label: '学徒', shortLabel: '学徒', tone: 'green' },
    { minimum: Number.NEGATIVE_INFINITY, label: '新手', shortLabel: '新手', tone: 'gray' },
  ],
  nowcoder: [
    { minimum: 2800, label: '红名', shortLabel: '红名', tone: 'red' },
    { minimum: 2400, label: '橙名', shortLabel: '橙名', tone: 'orange' },
    { minimum: 2000, label: '黄名', shortLabel: '黄名', tone: 'yellow' },
    { minimum: 1500, label: '青名', shortLabel: '青名', tone: 'cyan' },
    { minimum: 1100, label: '蓝名', shortLabel: '蓝名', tone: 'blue' },
    { minimum: 700, label: '紫名', shortLabel: '紫名', tone: 'violet' },
    { minimum: Number.NEGATIVE_INFINITY, label: '灰名', shortLabel: '灰名', tone: 'gray' },
  ],
  atcoder: [
    {
      minimum: 3200,
      label: '高段位（颜色可自选）',
      shortLabel: '高段位',
      tone: 'red',
    },
    { minimum: 2800, label: '红色段位', shortLabel: '红色', tone: 'red' },
    { minimum: 2400, label: '橙色段位', shortLabel: '橙色', tone: 'orange' },
    { minimum: 2000, label: '黄色段位', shortLabel: '黄色', tone: 'yellow' },
    { minimum: 1600, label: '蓝色段位', shortLabel: '蓝色', tone: 'blue' },
    { minimum: 1200, label: '青色段位', shortLabel: '青色', tone: 'cyan' },
    { minimum: 800, label: '绿色段位', shortLabel: '绿色', tone: 'green' },
    { minimum: 400, label: '棕色段位', shortLabel: '棕色', tone: 'brown' },
    { minimum: Number.NEGATIVE_INFINITY, label: '灰色段位', shortLabel: '灰色', tone: 'gray' },
  ],
  xcpc_elo: [
    { minimum: 3000, label: '传奇特级大师', shortLabel: '传奇大师', tone: 'legendary' },
    { minimum: 2600, label: '国际特级大师', shortLabel: '国际特级', tone: 'red' },
    { minimum: 2400, label: '特级大师', shortLabel: '特级大师', tone: 'red' },
    { minimum: 2300, label: '国际大师', shortLabel: '国际大师', tone: 'red' },
    { minimum: 2100, label: '大师', shortLabel: '大师', tone: 'orange' },
    { minimum: 1900, label: '候选大师', shortLabel: '候选大师', tone: 'violet' },
    { minimum: 1600, label: '专家', shortLabel: '专家', tone: 'blue' },
    { minimum: 1400, label: '专才', shortLabel: '专才', tone: 'cyan' },
    { minimum: 1200, label: '学徒', shortLabel: '学徒', tone: 'green' },
    { minimum: Number.NEGATIVE_INFINITY, label: '新手', shortLabel: '新手', tone: 'gray' },
  ],
}

export function isRatingPlatform(platform: Platform): platform is RatingPlatform {
  return platform in ratingTiers
}

export function getRatingTier(platform: RatingPlatform, rating: number | null): RatingTier | null {
  if (rating === null || !Number.isFinite(rating)) return null
  const tier = ratingTiers[platform].find((candidate) => rating >= candidate.minimum)
  if (!tier) return null
  return { label: tier.label, shortLabel: tier.shortLabel, tone: tier.tone }
}
