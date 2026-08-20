import { describe, expect, it } from 'vitest'
import { resolveE2EPort } from '../playwright.config'

describe('resolveE2EPort', () => {
  it('defaults to 4273 when port is undefined or empty', () => {
    expect(resolveE2EPort(undefined)).toBe(4273)
    expect(resolveE2EPort('')).toBe(4273)
    expect(resolveE2EPort('   ')).toBe(4273)
  })

  it('parses valid numeric ports correctly', () => {
    expect(resolveE2EPort('4273')).toBe(4273)
    expect(resolveE2EPort('3000')).toBe(3000)
    expect(resolveE2EPort('1')).toBe(1)
    expect(resolveE2EPort('65535')).toBe(65535)
    expect(resolveE2EPort(' 8080 ')).toBe(8080)
  })

  it('rejects out of range port values', () => {
    expect(() => resolveE2EPort('0')).toThrow(/Invalid E2E port "0"/)
    expect(() => resolveE2EPort('65536')).toThrow(/Invalid E2E port "65536"/)
    expect(() => resolveE2EPort('-1')).toThrow(/Invalid E2E port "-1"/)
    expect(() => resolveE2EPort('999999')).toThrow(/Invalid E2E port "999999"/)
  })

  it('rejects non-integer and shell injection strings', () => {
    expect(() => resolveE2EPort('abc')).toThrow(/Invalid E2E port "abc"/)
    expect(() => resolveE2EPort('4273; rm -rf /')).toThrow(/Invalid E2E port "4273; rm -rf \/"/)
    expect(() => resolveE2EPort('4273.5')).toThrow(/Invalid E2E port "4273.5"/)
    expect(() => resolveE2EPort('4273 port')).toThrow(/Invalid E2E port "4273 port"/)
  })
})
