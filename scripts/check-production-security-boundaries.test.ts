import { describe, expect, it } from 'vitest'
import {
  assertNoBrowserSecretValues,
  assertSecurityChecks,
  collectSupabaseSecretValues,
  discoverJavascriptReferences,
  isSafeOwnImageAttachmentExport,
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

  it('accepts only bounded own image metadata without URLs or private identifiers', () => {
    const safe = {
      webchat: {
        imageAttachments: {
          count: 1,
          items: [
            {
              mediaType: 'image/webp',
              bytes: 154,
              width: 3,
              height: 2,
              createdAt: '2026-07-26T00:00:00.000Z',
              readyAt: '2026-07-26T00:00:01.000Z',
              attachedAt: '2026-07-26T00:00:02.000Z',
            },
          ],
        },
      },
    }
    expect(
      isSafeOwnImageAttachmentExport(safe, {
        expectedCount: 1,
        expectedBytes: 154,
        expectedWidth: 3,
        expectedHeight: 2,
      }),
    ).toBe(true)
    expect(
      isSafeOwnImageAttachmentExport(
        { webchat: { imageAttachments: { count: 0, items: [] } } },
        { expectedCount: 0 },
      ),
    ).toBe(true)

    for (const leaked of [
      { previewUrl: 'https://storage.example.test/signed' },
      { objectKey: 'user/private/object.webp' },
      { sha256: 'a'.repeat(64) },
      { conversationId: 'private-conversation' },
      { id: 'private-attachment' },
    ]) {
      const payload = structuredClone(safe)
      Object.assign(payload.webchat.imageAttachments.items[0], leaked)
      expect(
        isSafeOwnImageAttachmentExport(payload, {
          expectedCount: 1,
          expectedBytes: 154,
          expectedWidth: 3,
          expectedHeight: 2,
        }),
      ).toBe(false)
    }
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
        'imageObjectStoredPrivately',
        'imageOwnerHistoryRestored',
        'imageCrossMemberPreviewDenied',
        'imagePersonalExportSafe',
        'imageSignedPreviewWorks',
        'imageMessageDeletionQueued',
        'imageCleanupDeletedObject',
        'imagePostCleanupAccountingConsistent',
        'imageNoActiveResidueBeforeAccountDeletion',
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
