import {
  createGradeOptions,
  majorSuggestions,
  normalizeGrade,
  parseMajorCatalog,
} from './profileFields'

describe('profile field normalization', () => {
  it.each([
    ['23', '23级'],
    ['23级', '23级'],
    ['2023', '23级'],
    [' 20 23 级 ', '23级'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeGrade(input)).toBe(expected)
  })

  it('parses newline-separated major catalogs in source order without blanks or duplicates', () => {
    expect(parseMajorCatalog('建筑学\n\n计算机科学与技术\r\n建筑学\n')).toEqual([
      '建筑学',
      '计算机科学与技术',
    ])
  })

  it('loads the complete root major catalog', () => {
    expect(majorSuggestions).toHaveLength(75)
    expect(majorSuggestions[0]).toBe('建筑学')
    expect(majorSuggestions).toContain('电子信息工程')
    expect(majorSuggestions).toContain('计算机科学与技术')
    expect(majorSuggestions.at(-1)).toBe('思想政治教育（师范）')
  })

  it('creates a seven-cohort grade list from the reference year', () => {
    expect(createGradeOptions(2026)).toEqual([
      '26级',
      '25级',
      '24级',
      '23级',
      '22级',
      '21级',
      '20级',
    ])
  })
})
