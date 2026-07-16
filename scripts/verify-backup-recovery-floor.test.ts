import { verifyBackupRecoveryFloor } from './verify-backup-recovery-floor.mjs'

function metadata(createdAt: string, floor: string) {
  return [
    `created_at=${createdAt}`,
    'repository=greenthree/USTSACMLand',
    'commit=0123456789abcdef',
    `recovery_not_before=${floor}`,
    'supabase_cli=2.109.1',
    '',
  ].join('\n')
}

describe('backup account-deletion recovery floor', () => {
  it('accepts a backup created after the current external floor', () => {
    expect(
      verifyBackupRecoveryFloor(
        metadata('2026-07-16T00:30:00Z', '2026-07-15T13:00:00.000Z'),
        '2026-07-15T13:00:00.000Z',
      ),
    ).toEqual({
      createdAt: '2026-07-16T00:30:00.000Z',
      recoveryNotBefore: '2026-07-15T13:00:00.000Z',
    })
  })

  it('rejects a backup created before a later account deletion floor', () => {
    expect(() =>
      verifyBackupRecoveryFloor(
        metadata('2026-07-15T00:30:00Z', '1970-01-01T00:00:00.000Z'),
        '2026-07-15T13:00:00.000Z',
      ),
    ).toThrow(/must not be restored/)
  })

  it('rejects a repository floor that regressed behind backup metadata', () => {
    expect(() =>
      verifyBackupRecoveryFloor(
        metadata('2026-07-16T00:30:00Z', '2026-07-15T13:00:00.000Z'),
        '2026-07-01T00:00:00.000Z',
      ),
    ).toThrow(/possible variable regression/)
  })

  it('rejects invalid, missing, or duplicated metadata', () => {
    expect(() => verifyBackupRecoveryFloor('created_at=invalid\n', '2026-07-01T00:00:00Z')).toThrow(
      /Backup creation time/,
    )
    expect(() =>
      verifyBackupRecoveryFloor(
        'created_at=2026-07-16T00:30:00Z\ncreated_at=2026-07-17T00:30:00Z\n',
        '2026-07-01T00:00:00Z',
      ),
    ).toThrow(/repeats created_at/)
  })
})
