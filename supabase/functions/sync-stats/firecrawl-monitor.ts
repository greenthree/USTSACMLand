export function shouldCheckFirecrawlCredits(
  serviceRole: boolean,
  scope: string,
  targets: Array<{ platform: string }>,
): boolean {
  return serviceRole && scope !== 'queue' && targets.some((target) => target.platform === 'qoj')
}
