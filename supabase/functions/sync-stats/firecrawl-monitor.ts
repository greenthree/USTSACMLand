export function shouldCheckFirecrawlCredits(
  serviceRole: boolean,
  scope: string,
  requestedPlatforms: readonly string[] | undefined,
  cursor: number | undefined,
): boolean {
  return (
    serviceRole &&
    scope !== 'queue' &&
    cursor === undefined &&
    (scope === 'all' ||
      scope === 'member' ||
      requestedPlatforms?.includes('qoj') === true ||
      requestedPlatforms?.includes('nowcoder') === true)
  )
}
