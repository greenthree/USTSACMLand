import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { buildSyncJobTarget } from './job.ts'

const memberId = '8a7c4494-97b0-4c5e-a386-02b0efcf22c7'

Deno.test('single-platform jobs use platform-isolated concurrency keys', () => {
  const luoguJob = buildSyncJobTarget(memberId, ['luogu'], ['luogu'])
  const qojJob = buildSyncJobTarget(memberId, ['qoj'], ['qoj'])

  deepStrictEqual(luoguJob, {
    scope: 'account',
    profile_id: memberId,
    platform: 'luogu',
    dedupe_key: `member:${memberId}:platform:luogu`,
    payload: { platforms: ['luogu'] },
  })
  strictEqual(qojJob.scope, 'account')
  strictEqual(qojJob.platform, 'qoj')
  strictEqual(qojJob.dedupe_key, `member:${memberId}:platform:qoj`)
  strictEqual(luoguJob.dedupe_key === qojJob.dedupe_key, false)
})

Deno.test('repeated requests for the same platform produce the same key', () => {
  const firstJob = buildSyncJobTarget(memberId, ['luogu'], ['luogu'])
  const secondJob = buildSyncJobTarget(memberId, ['luogu'], ['luogu'])

  strictEqual(firstJob.dedupe_key, secondJob.dedupe_key)
})

Deno.test('multi-platform and full-member jobs retain member scope', () => {
  const expected = {
    scope: 'member',
    profile_id: memberId,
    platform: null,
    dedupe_key: `member:${memberId}`,
    payload: { platforms: ['luogu', 'qoj'] },
  }

  deepStrictEqual(buildSyncJobTarget(memberId, ['luogu', 'qoj'], ['luogu', 'qoj']), expected)
  deepStrictEqual(buildSyncJobTarget(memberId, undefined, ['luogu', 'qoj']), expected)
})
