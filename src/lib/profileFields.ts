import majorCatalog from '../../专业目录.txt?raw'

export function parseMajorCatalog(source: string): string[] {
  return Array.from(
    new Set(
      source
        .split(/\r?\n/u)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  )
}

export const majorSuggestions = parseMajorCatalog(majorCatalog)

export function createGradeOptions(referenceYear = new Date().getFullYear()): string[] {
  const currentGrade = referenceYear % 100
  return Array.from({ length: 7 }, (_, index) => {
    const grade = (currentGrade - index + 100) % 100
    return `${String(grade).padStart(2, '0')}级`
  })
}

export const gradeOptions = createGradeOptions()

export function normalizeGrade(value: string): string {
  const compact = value.trim().replace(/\s+/g, '')
  const match = /^(?:20)?([0-9]{2})(?:级)?$/.exec(compact)
  return match ? `${match[1]}级` : compact
}
