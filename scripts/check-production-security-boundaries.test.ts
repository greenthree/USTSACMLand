import { describe, expect, it } from 'vitest'
import {
  assertNoBrowserSecretValues,
  assertSecurityChecks,
  collectSupabaseSecretValues,
  discoverJavascriptReferences,
  requiredSecurityChecks,
} from './check-production-security-boundaries.mjs'

describe('production security boundary audit', () => {
  it('collects only server-side legacy and secret Supabase key values', () => {
    expect(
      collectSupabaseSecretValues([
        { name: 'anon', type: 'legacy', api_key: 'legacy-anon-value-1234567890' },
        { name: 'service_role', type: 'legacy', api_key: 'legacy-service-value-123456' },
        { name: 'default', type: 'publishable', api_key: 'sb_publishable_public-value' },
        { name: 'default', type: 'secret', api_key: 'sb_secret_private-value-1234' },
      ]),
    ).toEqual(['legacy-service-value-123456', 'sb_secret_private-value-1234'])
  })

  it('discovers entry and lazy JavaScript assets without duplicates', () => {
    const source = [
      '<script src="/assets/index-abc.js"></script>',
      'const lazy="assets/Account-def.js";',
      'const same="./assets/Account-def.js";',
    ].join('\n')
    expect(discoverJavascriptReferences(source, 'https://ustsacm.fun/')).toEqual([
      'https://ustsacm.fun/assets/index-abc.js',
      'https://ustsacm.fun/assets/Account-def.js',
    ])
  })

  it('rejects real secret values and credential-shaped browser content', () => {
    expect(() =>
      assertNoBrowserSecretValues('safe browser code', ['server-secret-value-123']),
    ).not.toThrow()
    expect(() =>
      assertNoBrowserSecretValues('server-secret-value-123', ['server-secret-value-123']),
    ).toThrow(/Supabase key value/)
    expect(() => assertNoBrowserSecretValues('github_pat_abcdefghijklmnopqrstuvwxyz', [])).toThrow(
      /GitHub token/,
    )
    expect(() => assertNoBrowserSecretValues('sk-abcdefghijklmnopqrstuvwxyz', [])).toThrow(
      /API key pattern/,
    )
  })

  it('requires every production identity and cleanup check', () => {
    expect(requiredSecurityChecks).toEqual(
      expect.arrayContaining([
        'anonymousAttachmentGatewayDenied',
        'anonymousImageCleanupGatewayDenied',
        'memberImageCleanupDenied',
        'memberImageUploadSafelyDisabled',
        'imageBucketPrivate',
        'imageStorageAccountingConsistent',
        'imageUploadsPaused',
        'zeroFixtureImageAttachments',
        'zeroFixtureImageObjects',
        'zeroFixtureImageDeletionQueue',
      ]),
    )
    const complete = Object.fromEntries(requiredSecurityChecks.map((name) => [name, true]))
    expect(() => assertSecurityChecks(complete)).not.toThrow()
    expect(() =>
      assertSecurityChecks({ ...complete, adminCrossConversationDenied: false }),
    ).toThrow(/adminCrossConversationDenied/)
  })
})
