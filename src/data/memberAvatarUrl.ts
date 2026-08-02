export function buildMemberAvatarUrl(
  supabaseProjectUrl: string | undefined,
  memberId: string,
  updatedAt: string | null,
): string | null {
  const projectUrl = supabaseProjectUrl?.trim().replace(/\/+$/, '')
  if (!projectUrl || !updatedAt) return null

  const query = new URLSearchParams({ memberId, v: updatedAt })
  return `${projectUrl}/functions/v1/member-avatar?${query.toString()}`
}
