import { verifyDatabaseRestoreDrill } from './verify-database-restore-drill.mjs'

const manifest = {
  schemaVersion: 1,
  createdAt: '2026-07-19T00:30:00.000Z',
  repository: 'greenthree/USTSACMLand',
  commit: '0123456789abcdef0123456789abcdef01234567',
  runId: '123456789',
  recoveryNotBefore: '1970-01-01T00:00:00.000Z',
  supabaseCli: '2.109.1',
  rowCounts: {
    profiles: 5,
    platformAccounts: 22,
    platformStats: 22,
    statSnapshots: 100,
    syncRuns: 120,
    authUsers: 5,
    migrations: 51,
  },
}

const observation = {
  sourceRunId: '123456789',
  sourceSha: '0123456789abcdef0123456789abcdef01234567',
  sourceRepository: 'greenthree/USTSACMLand',
  completedAt: '2026-07-19T01:00:00Z',
  durationSeconds: 87,
  rowCounts: { ...manifest.rowCounts },
  orphanCounts: {
    profilesWithoutAuth: 0,
    accountsWithoutProfile: 0,
    statsWithoutProfile: 0,
    statsWithoutAccount: 0,
  },
  authSmoke: {
    authHooksPresent: true,
    canaryCreated: true,
    passwordLogin: true,
    ownProfileReadable: true,
    otherProfilesHidden: true,
    fencedCanaryDeleted: true,
    canaryDeleted: true,
  },
  restSmoke: {
    anonymousPublicStatus: 200,
    anonymousPrivateStatus: 401,
    anonymousPrivateEmpty: false,
  },
}

describe('isolated database restore drill verification', () => {
  it('accepts exact row-count recovery plus Auth and RLS smoke evidence', () => {
    expect(verifyDatabaseRestoreDrill(manifest, observation)).toEqual({
      ok: true,
      source: {
        runId: '123456789',
        commit: '0123456789abcdef0123456789abcdef01234567',
        createdAt: '2026-07-19T00:30:00.000Z',
        supabaseCli: '2.109.1',
      },
      completedAt: '2026-07-19T01:00:00.000Z',
      durationSeconds: 87,
      restoredRowCounts: manifest.rowCounts,
      integrity: {
        orphanCounts: observation.orphanCounts,
        authUserApplicationTriggers: true,
        authPasswordLogin: true,
        ownProfileRls: true,
        otherProfilesHiddenByRls: true,
        anonymousPublicView: true,
        anonymousPrivateTableProtected: true,
        fencedAccountDeletion: true,
        canaryCleanedUp: true,
      },
    })
  })

  it('rejects a row-count mismatch', () => {
    expect(() =>
      verifyDatabaseRestoreDrill(manifest, {
        ...observation,
        rowCounts: { ...observation.rowCounts, authUsers: 4 },
      }),
    ).toThrow(/authUsers row count differs/)
  })

  it('rejects relational orphans', () => {
    expect(() =>
      verifyDatabaseRestoreDrill(manifest, {
        ...observation,
        orphanCounts: { ...observation.orphanCounts, accountsWithoutProfile: 1 },
      }),
    ).toThrow(/accountsWithoutProfile/)
  })

  it('rejects a failed password login or canary cleanup', () => {
    expect(() =>
      verifyDatabaseRestoreDrill(manifest, {
        ...observation,
        authSmoke: { ...observation.authSmoke, authHooksPresent: false },
      }),
    ).toThrow(/authHooksPresent/)
    expect(() =>
      verifyDatabaseRestoreDrill(manifest, {
        ...observation,
        authSmoke: { ...observation.authSmoke, passwordLogin: false },
      }),
    ).toThrow(/passwordLogin/)
    expect(() =>
      verifyDatabaseRestoreDrill(manifest, {
        ...observation,
        authSmoke: { ...observation.authSmoke, fencedCanaryDeleted: false },
      }),
    ).toThrow(/fencedCanaryDeleted/)
    expect(() =>
      verifyDatabaseRestoreDrill(manifest, {
        ...observation,
        authSmoke: { ...observation.authSmoke, canaryDeleted: false },
      }),
    ).toThrow(/canaryDeleted/)
  })

  it('accepts an empty RLS-filtered private response and rejects exposure', () => {
    expect(
      verifyDatabaseRestoreDrill(manifest, {
        ...observation,
        restSmoke: {
          anonymousPublicStatus: 200,
          anonymousPrivateStatus: 200,
          anonymousPrivateEmpty: true,
        },
      }).integrity.anonymousPrivateTableProtected,
    ).toBe(true)
    expect(() =>
      verifyDatabaseRestoreDrill(manifest, {
        ...observation,
        restSmoke: { ...observation.restSmoke, anonymousPublicStatus: 500 },
      }),
    ).toThrow(/public-view/)
    expect(() =>
      verifyDatabaseRestoreDrill(manifest, {
        ...observation,
        restSmoke: {
          ...observation.restSmoke,
          anonymousPrivateStatus: 200,
          anonymousPrivateEmpty: false,
        },
      }),
    ).toThrow(/RLS-filter all rows/)
  })

  it('rejects source-run or commit substitution', () => {
    expect(() =>
      verifyDatabaseRestoreDrill(manifest, { ...observation, sourceRunId: '987654321' }),
    ).toThrow(/backup run ID/)
    expect(() =>
      verifyDatabaseRestoreDrill(manifest, {
        ...observation,
        sourceSha: 'abcdef0123456789abcdef0123456789abcdef01',
      }),
    ).toThrow(/backup commit/)
  })
})
