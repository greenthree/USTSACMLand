import { buildMemberAvatarUrl } from './memberAvatarUrl'

describe('buildMemberAvatarUrl', () => {
  it('builds the anonymous function URL and trims a trailing project slash', () => {
    expect(
      buildMemberAvatarUrl(
        'https://project.supabase.co/',
        '11111111-1111-4111-8111-111111111111',
        '2026-08-02T00:00:00Z',
      ),
    ).toBe(
      'https://project.supabase.co/functions/v1/member-avatar?memberId=11111111-1111-4111-8111-111111111111&v=2026-08-02T00%3A00%3A00Z',
    )
  })

  it('does not build an avatar URL without a project URL or cache version', () => {
    expect(buildMemberAvatarUrl(undefined, 'member-id', '2026-08-02T00:00:00Z')).toBeNull()
    expect(buildMemberAvatarUrl('https://project.supabase.co', 'member-id', null)).toBeNull()
  })
})
