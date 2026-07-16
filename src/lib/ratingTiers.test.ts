import { describe, expect, it } from 'vitest'
import { getRatingTier, isRatingPlatform, ratingToneColors } from './ratingTiers'

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastAgainstWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05)
}

describe('rating tiers', () => {
  it('uses the official Codeforces boundaries', () => {
    expect(getRatingTier('codeforces', 1199)?.shortLabel).toBe('新手')
    expect(getRatingTier('codeforces', 1200)?.shortLabel).toBe('学徒')
    expect(getRatingTier('codeforces', 1899)?.shortLabel).toBe('专家')
    expect(getRatingTier('codeforces', 1900)?.shortLabel).toBe('候选大师')
    expect(getRatingTier('codeforces', 2900)?.tone).toBe('legendary')
  })

  it('uses the NowCoder seven-color boundaries', () => {
    expect(getRatingTier('nowcoder', 699)?.shortLabel).toBe('灰名')
    expect(getRatingTier('nowcoder', 700)?.shortLabel).toBe('紫名')
    expect(getRatingTier('nowcoder', 1100)?.shortLabel).toBe('蓝名')
    expect(getRatingTier('nowcoder', 1500)?.shortLabel).toBe('青名')
    expect(getRatingTier('nowcoder', 2000)?.shortLabel).toBe('黄名')
    expect(getRatingTier('nowcoder', 2400)?.shortLabel).toBe('橙名')
    expect(getRatingTier('nowcoder', 2800)?.shortLabel).toBe('红名')
  })

  it('uses the official AtCoder boundaries and labels 3200+ explicitly', () => {
    expect(getRatingTier('atcoder', 399)?.shortLabel).toBe('灰色')
    expect(getRatingTier('atcoder', 400)?.shortLabel).toBe('棕色')
    expect(getRatingTier('atcoder', 800)?.shortLabel).toBe('绿色')
    expect(getRatingTier('atcoder', 2800)?.shortLabel).toBe('红色')
    expect(getRatingTier('atcoder', 3200)?.shortLabel).toBe('高段位')
  })

  it('follows the XCPC ELO repository boundaries', () => {
    expect(getRatingTier('xcpc_elo', 2099)?.shortLabel).toBe('候选大师')
    expect(getRatingTier('xcpc_elo', 2100)?.shortLabel).toBe('大师')
    expect(getRatingTier('xcpc_elo', 2300)?.shortLabel).toBe('国际大师')
    expect(getRatingTier('xcpc_elo', 3000)?.tone).toBe('legendary')
  })

  it('returns no tier for missing or invalid values and narrows platforms', () => {
    expect(getRatingTier('codeforces', null)).toBeNull()
    expect(getRatingTier('codeforces', Number.NaN)).toBeNull()
    expect(isRatingPlatform('atcoder')).toBe(true)
    expect(isRatingPlatform('qoj')).toBe(false)
  })

  it('keeps every rating hue at WCAG AA text contrast on white', () => {
    for (const color of Object.values(ratingToneColors)) {
      expect(contrastAgainstWhite(color)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
