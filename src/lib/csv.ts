export function csvCell(value: string): string {
  const formulaCandidate = value.trimStart()
  const safeValue =
    /^[=+\-@]/.test(formulaCandidate) || /^[\t\r\n]/.test(value) ? `'${value}` : value
  return `"${safeValue.replaceAll('"', '""')}"`
}

export function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','))
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
