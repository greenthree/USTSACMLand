import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { verifyWebChatCacheProbeWorkflow } from './check-webchat-cache-probe-workflow.mjs'

const workflow = readFileSync(resolve('.github/workflows/webchat-cache-probe.yml'), 'utf8')

describe('WebChat production cache probe workflow', () => {
  it('accepts the checked-in manual Vault-backed probe workflow', () => {
    expect(verifyWebChatCacheProbeWorkflow(workflow)).toEqual({
      manualOnly: true,
      vaultOnly: true,
      retentionDays: 14,
    })
  })

  it('rejects automatic execution and duplicated relay secrets', () => {
    expect(() =>
      verifyWebChatCacheProbeWorkflow(
        workflow.replace('  workflow_dispatch:', '  workflow_dispatch:\n  schedule:'),
      ),
    ).toThrow(/must not run automatically/)
    expect(() =>
      verifyWebChatCacheProbeWorkflow(
        workflow.replace(
          'SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}',
          'CHAT_RELAY_API_KEY: ${{ secrets.CHAT_RELAY_API_KEY }}',
        ),
      ),
    ).toThrow(/SUPABASE_PROJECT_REF|only from Supabase Vault/)
  })

  it('rejects credentials on command lines and unsafe artifact uploads', () => {
    expect(() =>
      verifyWebChatCacheProbeWorkflow(
        workflow.replace(
          'run: node scripts/check-webchat-production-cache-probe.mjs',
          'run: node scripts/check-webchat-production-cache-probe.mjs $SUPABASE_SERVICE_ROLE_KEY',
        ),
      ),
    ).toThrow(/never be interpolated/)
    expect(() =>
      verifyWebChatCacheProbeWorkflow(
        workflow.replace('path: artifacts/webchat-production-cache-probe.json', 'path: .env'),
      ),
    ).toThrow(/sanitized cache probe report|forbidden/)
    expect(() =>
      verifyWebChatCacheProbeWorkflow(
        workflow.replace(
          'path: artifacts/webchat-production-cache-probe.json',
          'path: |\n            artifacts/webchat-production-cache-probe.json\n            dist/**',
        ),
      ),
    ).toThrow(/exact sanitized cache probe report/)
  })

  it('rejects unpinned actions', () => {
    expect(() =>
      verifyWebChatCacheProbeWorkflow(
        workflow.replace('actions/checkout@9c091bb', 'actions/checkout@main'),
      ),
    ).toThrow(/must pin reviewed action/)
  })
})
