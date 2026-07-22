import {
  classifyGhFailure,
  evaluateRepositoryReadiness,
  expectedWorkflows,
  requiredActionSecrets,
  requiredActionVariables,
} from './check-repository-readiness.mjs'

function createReadyState() {
  const observedAt = '2026-07-16T00:00:00.000Z'
  const defaultBranchSha = '0123456789abcdef'
  return {
    observedAt,
    repository: {
      nameWithOwner: 'greenthree/USTSACMLand',
      defaultBranch: 'main',
      defaultBranchSha,
    },
    workflows: expectedWorkflows.map((workflow) => ({
      ...workflow,
      state: 'active',
      contentMatches: true,
    })),
    workflowRuns: expectedWorkflows.map((workflow) => ({
      name: workflow.name,
      headBranch: 'main',
      headSha: defaultBranchSha,
      status: 'completed',
      conclusion: 'success',
      event:
        workflow.name === 'Sync platform statistics'
          ? 'schedule'
          : workflow.name.includes('backup')
            ? 'workflow_dispatch'
            : 'push',
      createdAt:
        workflow.name === 'Sync platform statistics'
          ? '2026-07-15T23:55:00.000Z'
          : workflow.name === 'Encrypted database backup'
            ? '2026-07-15T23:00:00.000Z'
            : observedAt,
      url: `https://github.test/actions/${workflow.name}`,
    })),
    actionSecrets: [...requiredActionSecrets],
    actionVariables: [...requiredActionVariables],
    actionsPermissions: {
      defaultWorkflowPermissions: 'read',
      canApprovePullRequestReviews: false,
    },
    actionsRetention: { days: 14, maximumAllowedDays: 90 },
    rulesets: [
      {
        name: 'Protect main',
        enforcement: 'active',
        target: 'branch',
        conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
        bypassActors: [],
        rules: [
          { type: 'pull_request' },
          { type: 'non_fast_forward' },
          { type: 'deletion' },
          {
            type: 'required_status_checks',
            parameters: {
              required_status_checks: [
                { context: 'verify' },
                { context: 'database-security' },
                { context: 'gitleaks' },
              ],
            },
          },
        ],
      },
    ],
    securityAndAnalysis: {
      secretScanning: 'enabled',
      pushProtection: 'enabled',
      dependabotSecurityUpdates: 'enabled',
    },
    privateVulnerabilityReporting: true,
    pages: {
      buildType: 'workflow',
      httpsEnforced: true,
      htmlUrl: 'https://ustsacm.fun/',
      cname: 'ustsacm.fun',
    },
  }
}

describe('repository readiness checker', () => {
  it('classifies GitHub failures without exposing raw responses', () => {
    expect(classifyGhFailure({ stderr: 'Get https://api.github.com: TLS handshake timeout' })).toBe(
      'GitHub API 网络连接失败或超时',
    )
    expect(classifyGhFailure({ stderr: 'dial tcp: wsarecv: connection attempt failed' })).toBe(
      'GitHub API 网络连接失败或超时',
    )
    expect(
      classifyGhFailure({ stderr: 'HTTP 401: Bad credentials (https://api.github.com)' }),
    ).toBe('GitHub CLI 未登录或登录状态已失效')
    expect(
      classifyGhFailure({ stderr: 'HTTP 403: Resource not accessible by personal access token' }),
    ).toBe('GitHub Token 对目标仓库缺少只读权限')
    expect(classifyGhFailure({ stderr: 'unexpected response containing sensitive details' })).toBe(
      'GitHub CLI 返回未知错误',
    )
  })

  it('accepts a repository that satisfies the release settings contract', () => {
    expect(evaluateRepositoryReadiness(createReadyState())).toMatchObject({
      errors: [],
      warnings: [],
      summary: {
        repository: 'greenthree/USTSACMLand',
        workflows: 5,
        actionSecrets: 6,
        actionVariables: 1,
        actionsRetentionDays: 14,
        defaultBranchSha: '0123456789abcdef',
      },
    })
  })

  it('reports missing workflows and successful real runs separately', () => {
    const state = createReadyState()
    state.workflows = state.workflows.filter((workflow) => workflow.name !== 'Secret scan')
    state.workflowRuns = state.workflowRuns.filter(
      (run) => run.name !== 'Encrypted database backup',
    )

    expect(evaluateRepositoryReadiness(state).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('远端缺少工作流：Secret scan'),
        expect.stringContaining('Encrypted database backup 尚无 main 分支的成功真实运行'),
      ]),
    )
  })

  it('reports missing backup credentials without exposing any values', () => {
    const state = createReadyState()
    state.actionSecrets = state.actionSecrets.filter(
      (name) => name !== 'BACKUP_ENCRYPTION_PASSPHRASE',
    )
    state.actionVariables = []

    expect(evaluateRepositoryReadiness(state).errors).toEqual(
      expect.arrayContaining([
        'Actions Secret 未配置：BACKUP_ENCRYPTION_PASSPHRASE。',
        'Actions 变量未配置：BACKUP_RECOVERY_NOT_BEFORE。',
      ]),
    )
  })

  it('rejects incomplete default-branch protection', () => {
    const state = createReadyState()
    state.rulesets[0].rules = state.rulesets[0].rules.filter(
      (rule) => rule.type !== 'non_fast_forward',
    )

    expect(evaluateRepositoryReadiness(state).errors).toEqual(
      expect.arrayContaining([expect.stringContaining('未找到保护 main 的启用 ruleset')]),
    )
  })

  it('rejects repository security features that are disabled', () => {
    const state = createReadyState()
    state.securityAndAnalysis.dependabotSecurityUpdates = 'disabled'
    state.privateVulnerabilityReporting = false
    state.pages.httpsEnforced = false
    state.pages.cname = null

    expect(evaluateRepositoryReadiness(state).errors).toEqual(
      expect.arrayContaining([
        'Dependabot security updates 未启用。',
        'Private vulnerability reporting 未启用。',
        'GitHub Pages 未强制 HTTPS。',
        'GitHub Pages 自定义域名必须为 ustsacm.fun，当前为 未配置。',
      ]),
    )
  })

  it('rejects writable default Actions permissions and PR approval', () => {
    const state = createReadyState()
    state.actionsPermissions = {
      defaultWorkflowPermissions: 'write',
      canApprovePullRequestReviews: true,
    }

    expect(evaluateRepositoryReadiness(state).errors).toEqual(
      expect.arrayContaining([
        'Actions 默认 GITHUB_TOKEN 权限必须为只读。',
        'Actions 不应允许 GITHUB_TOKEN 自动批准 Pull Request。',
      ]),
    )
  })

  it('warns when repository-wide Actions retention is longer than necessary', () => {
    const state = createReadyState()
    state.actionsRetention = { days: 90, maximumAllowedDays: 90 }

    expect(evaluateRepositoryReadiness(state).warnings).toContain(
      'Actions 默认日志/Artifact 保留为 90 天；数据库备份 Artifact 虽单独限制为 14 天，仍建议把仓库默认值降至 30 天以内。',
    )
  })

  it('rejects workflow content drift, stale schedules and old default-branch checks', () => {
    const state = createReadyState()
    const ci = state.workflows.find((workflow) => workflow.name === 'CI')
    if (ci) ci.contentMatches = false
    const ciRun = state.workflowRuns.find((run) => run.name === 'CI')
    if (ciRun) ciRun.headSha = 'old-sha'
    const syncRun = state.workflowRuns.find((run) => run.name === 'Sync platform statistics')
    if (syncRun) {
      syncRun.createdAt = '2026-07-15T09:30:00.000Z'
      state.workflowRuns.unshift({
        ...syncRun,
        event: 'workflow_dispatch',
        createdAt: '2026-07-15T23:59:00.000Z',
      })
    }

    expect(evaluateRepositoryReadiness(state).errors).toEqual(
      expect.arrayContaining([
        '远端工作流 CI 与本地 .github/workflows/ci.yml 内容不一致。',
        expect.stringContaining('工作流 CI 最近成功运行未覆盖默认分支最新提交'),
        expect.stringContaining('工作流 Sync platform statistics 最近成功运行距今 14.50 小时'),
      ]),
    )
  })
})
