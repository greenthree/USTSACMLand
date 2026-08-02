export interface AvatarDeletionPreparation {
  ready: boolean
}

export interface AvatarCleanupDependencies {
  deleteAuthUser(userId: string): Promise<boolean>
  prepareAvatarDeletion(userId: string): Promise<AvatarDeletionPreparation>
  removeAvatarObjects(userId: string): Promise<void>
  cancelAvatarDeletion(userId: string): Promise<void>
}

export async function deleteAuthUserWithAvatarCleanup(
  dependencies: AvatarCleanupDependencies,
  userId: string,
): Promise<boolean> {
  // The first attempt lets the database freeze and queue any WebChat images.
  // An owned avatar makes this attempt stop at the Storage deletion fence.
  if (await dependencies.deleteAuthUser(userId)) return true

  const preparation = await dependencies.prepareAvatarDeletion(userId)
  if (!preparation.ready) return false

  try {
    await dependencies.removeAvatarObjects(userId)
    const deleted = await dependencies.deleteAuthUser(userId)
    if (!deleted) await dependencies.cancelAvatarDeletion(userId)
    return deleted
  } catch (error) {
    try {
      await dependencies.cancelAvatarDeletion(userId)
    } catch {
      // Preserve the original failure. A frozen avatar is safer than a late
      // upload racing another account-deletion attempt.
    }
    throw error
  }
}
