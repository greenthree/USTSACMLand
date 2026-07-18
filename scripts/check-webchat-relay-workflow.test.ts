import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { verifyWebChatRelayWorkflow } from './check-webchat-relay-workflow.mjs'

const workflow = readFileSync(resolve('.github/workflows/webchat-relay-smoke.yml'), 'utf8')

describe('WebChat relay compatibility workflow', () => {
  it('accepts the checked-in manual, billable smoke workflow', () => {
    expect(verifyWebChatRelayWorkflow(workflow)).toEqual({
      manualOnly: true,
      retentionDays: 14,
      abortCheck: true,
      cacheCheck: true,
    })
  })

  it('rejects automatic or pull-request execution', () => {
    expect(() =>
      verifyWebChatRelayWorkflow(
        workflow.replace('  workflow_dispatch:', '  workflow_dispatch:\n  pull_request:'),
      ),
    ).toThrow(/must not run automatically/)
  })

  it('rejects credentials passed on a command line', () => {
    expect(() =>
      verifyWebChatRelayWorkflow(
        workflow.replace(
          'run: npm run check:webchat-relay',
          'run: npm run check:webchat-relay -- ${{ secrets.CHAT_RELAY_API_KEY }}',
        ),
      ),
    ).toThrow(/must not be interpolated/)
  })

  it('rejects unpinned actions and unsafe artifact uploads', () => {
    expect(() =>
      verifyWebChatRelayWorkflow(
        workflow.replace('actions/checkout@9c091bb', 'actions/checkout@main'),
      ),
    ).toThrow(/must pin reviewed action/)
    expect(() =>
      verifyWebChatRelayWorkflow(
        workflow.replace('path: artifacts/webchat-relay-compatibility.json', 'path: .env'),
      ),
    ).toThrow(/reviewed artifact path|sanitized compatibility report/)
  })
})
