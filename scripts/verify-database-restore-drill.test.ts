import { verifyDatabaseRestoreDrill } from './verify-database-restore-drill.mjs'

const manifest = {
  schemaVersion: 2,
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
    webchatImageAttachments: 2,
    authUsers: 5,
    migrations: 51,
  },
  storage: {
    featureState: 'installed',
    bucket: 'webchat-images',
    objectCount: 2,
    totalBytes: 2048,
    manifestSha256: 'a'.repeat(64),
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
    authUsersWithoutProfile: 0,
    accountsWithoutProfile: 0,
    statsWithoutProfile: 0,
    statsWithoutAccount: 0,
    webchatImagesWithoutProfile: 0,
    webchatImagesWithoutConversation: 0,
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
  storage: {
    ...manifest.storage,
    featureState: 'installed',
    featureAbsent: false,
    bucketPrivate: true,
    anonymousDenied: true,
    databaseReferencesMatched: true,
    objectHashesVerified: true,
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
      restoredStorage: manifest.storage,
      integrity: {
        orphanCounts: observation.orphanCounts,
        authUserApplicationTriggers: true,
        authUsersHaveProfiles: true,
        authPasswordLogin: true,
        ownProfileRls: true,
        otherProfilesHiddenByRls: true,
        anonymousPublicView: true,
        anonymousPrivateTableProtected: true,
        fencedAccountDeletion: true,
        canaryCleanedUp: true,
        storageFeatureState: 'installed',
        storageBucketPrivate: true,
        storageAnonymousAccessDenied: true,
        storageDatabaseReferencesMatched: true,
        storageObjectHashesVerified: true,
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
    expect(() =>
      verifyDatabaseRestoreDrill(manifest, {
        ...observation,
        orphanCounts: { ...observation.orphanCounts, authUsersWithoutProfile: 1 },
      }),
    ).toThrow(/authUsersWithoutProfile/)
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

  it('rejects Storage aggregate drift or a failed private-object smoke check', () => {
    expect(() =>
      verifyDatabaseRestoreDrill(manifest, {
        ...observation,
        storage: { ...observation.storage, objectCount: 1 },
      }),
    ).toThrow(/Storage object count differs/)
    expect(() =>
      verifyDatabaseRestoreDrill(manifest, {
        ...observation,
        storage: { ...observation.storage, anonymousDenied: false },
      }),
    ).toThrow(/anonymousDenied/)
  })

  it('accepts a legacy v1 artifact without Storage while retaining current integrity checks', () => {
    const legacyManifest = {
      ...manifest,
      schemaVersion: 1,
      rowCounts: Object.fromEntries(
        Object.entries(manifest.rowCounts).filter(([key]) => key !== 'webchatImageAttachments'),
      ),
    }
    delete legacyManifest.storage
    const legacyObservation = { ...observation, rowCounts: legacyManifest.rowCounts }
    delete legacyObservation.storage
    expect(verifyDatabaseRestoreDrill(legacyManifest, legacyObservation)).toMatchObject({
      restoredStorage: null,
      integrity: {
        storageFeatureState: 'legacy-unavailable',
        storageDatabaseReferencesMatched: null,
      },
    })
    expect(() =>
      verifyDatabaseRestoreDrill(
        { ...legacyManifest, storage: manifest.storage },
        legacyObservation,
      ),
    ).toThrow(/Legacy restore manifest unexpectedly contains Storage data/)
  })

  it('accepts an explicit uninstalled v2 Storage snapshot', () => {
    const emptyDigest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    const uninstalledManifest = {
      ...manifest,
      rowCounts: { ...manifest.rowCounts, webchatImageAttachments: 0 },
      storage: {
        featureState: 'uninstalled',
        bucket: 'webchat-images',
        objectCount: 0,
        totalBytes: 0,
        manifestSha256: emptyDigest,
      },
    }
    const uninstalledObservation = {
      ...observation,
      rowCounts: uninstalledManifest.rowCounts,
      orphanCounts: Object.fromEntries(
        Object.entries(observation.orphanCounts).filter(
          ([key]) => !key.startsWith('webchatImagesWithout'),
        ),
      ),
      storage: {
        ...uninstalledManifest.storage,
        featureAbsent: true,
        bucketPrivate: null,
        anonymousDenied: null,
        databaseReferencesMatched: true,
        objectHashesVerified: true,
      },
    }
    expect(verifyDatabaseRestoreDrill(uninstalledManifest, uninstalledObservation)).toMatchObject({
      restoredStorage: uninstalledManifest.storage,
      integrity: { storageFeatureState: 'uninstalled', storageBucketPrivate: null },
    })
    expect(() =>
      verifyDatabaseRestoreDrill(
        {
          ...uninstalledManifest,
          rowCounts: { ...uninstalledManifest.rowCounts, webchatImageAttachments: 1 },
        },
        {
          ...uninstalledObservation,
          rowCounts: { ...uninstalledObservation.rowCounts, webchatImageAttachments: 1 },
        },
      ),
    ).toThrow(/Uninstalled Storage restore evidence/)
  })
})
