import { atcoderAdapter } from './atcoder.ts'
import { codeforcesAdapter } from './codeforces.ts'
import { luoguAdapter } from './luogu.ts'
import { nowcoderAdapter } from './nowcoder.ts'
import { qojAdapter } from './qoj.ts'
import type { PlatformAdapter, PlatformId } from './types.ts'
import { xcpcEloAdapter } from './xcpc-elo.ts'

export * from './types.ts'

export const adapters: Readonly<Record<PlatformId, PlatformAdapter>> = {
  codeforces: codeforcesAdapter,
  nowcoder: nowcoderAdapter,
  atcoder: atcoderAdapter,
  xcpc_elo: xcpcEloAdapter,
  luogu: luoguAdapter,
  qoj: qojAdapter,
}
