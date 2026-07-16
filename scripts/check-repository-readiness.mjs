import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const expectedWorkflows = [
  { name: 'CI', path: '.github/workflows/ci.yml' },
  { name: 'Deploy GitHub Pages', path: '.github/workflows/deploy-pages.yml' },
  { name: 'Sync platform statistics', path: '.github/workflows/sync-stats.yml' },
  { name: 'Secret scan', path: '.github/workflows/secret-scan.yml' },
  { name: 'Encrypted database backup', path: '.github/workflows/database-backup.yml' },
]

export const requiredActionSecrets = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'BACKUP_ENCRYPTION_PASSPHRASE',
]

export const requiredActionVariables = ['BACKUP_RECOVERY_NOT_BEFORE']

// GitHub's ruleset API stores the check-run names, not the UI's
// "workflow / job" labels.
const requiredChecks = ['verify', 'database-security', 'gitleaks']
const scheduledWorkflowMaxAgeHours = new Map([
  ['Sync platform statistics', 0.75],
  ['Encrypted database backup', 30],
])

function asSet(values) {
  return new Set(values.filter(Boolean))
}

function targetsDefaultBranch(ruleset, defaultBranch) {
  const includes = ruleset.conditions?.ref_name?.include ?? []
  return includes.includes('~DEFAULT_BRANCH') || includes.includes(`refs/heads/${defaultBranch}`)
}

function findProtectiveRuleset(rulesets, defaultBranch) {
  return rulesets.find((ruleset) => {
    if (
      ruleset.enforcement !== 'active' ||
      ruleset.target !== 'branch' ||
      !targetsDefaultBranch(ruleset, defaultBranch)
    ) {
      return false
    }

    const ruleTypes = asSet((ruleset.rules ?? []).map((rule) => rule.type))
    const statusRule = (ruleset.rules ?? []).find((rule) => rule.type === 'required_status_checks')
    const checks = asSet(
      (statusRule?.parameters?.required_status_checks ?? []).map((check) => check.context),
    )

    return (
      ruleTypes.has('pull_request') &&
      ruleTypes.has('required_status_checks') &&
      ruleTypes.has('non_fast_forward') &&
      ruleTypes.has('deletion') &&
      requiredChecks.every((check) => checks.has(check))
    )
  })
}

export function evaluateRepositoryReadiness(state) {
  const errors = []
  const warnings = []
  const defaultBranch = state.repository.defaultBranch

  if (defaultBranch !== 'main') {
    errors.push(`默认分支必须为 main，当前为 ${defaultBranch || '未识别'}。`)
  }

  const remoteWorkflows = new Map(state.workflows.map((workflow) => [workflow.name, workflow]))
  for (const expected of expectedWorkflows) {
    const actual = remoteWorkflows.get(expected.name)
    if (!actual) {
      errors.push(`远端缺少工作流：${expected.name}（${expected.path}）。`)
      continue
    }
    if (actual.path !== expected.path) {
      errors.push(`工作流 ${expected.name} 路径异常：${actual.path}。`)
    }
    if (actual.state !== 'active') {
      errors.push(`工作流 ${expected.name} 未启用，当前状态为 ${actual.state}。`)
    }
    if (!actual.contentMatches) {
      errors.push(`远端工作流 ${expected.name} 与本地 ${expected.path} 内容不一致。`)
    }

    const successfulRun = state.workflowRuns.find(
      (run) =>
        run.name === expected.name &&
        run.headBranch === defaultBranch &&
        run.status === 'completed' &&
        run.conclusion === 'success',
    )
    if (!successfulRun) {
      errors.push(`工作流 ${expected.name} 尚无 ${defaultBranch} 分支的成功真实运行。`)
      continue
    }

    const maxAgeHours = scheduledWorkflowMaxAgeHours.get(expected.name)
    if (maxAgeHours !== undefined) {
      const observedAt = Date.parse(state.observedAt)
      const createdAt = Date.parse(successfulRun.createdAt)
      if (!Number.isFinite(observedAt) || !Number.isFinite(createdAt)) {
        errors.push(`工作流 ${expected.name} 的运行时间无法验证。`)
      } else {
        const ageHours = (observedAt - createdAt) / 3_600_000
        if (ageHours < 0 || ageHours > maxAgeHours) {
          errors.push(
            `工作流 ${expected.name} 最近成功运行距今 ${ageHours.toFixed(2)} 小时，超过 ${maxAgeHours} 小时门限。`,
          )
        }
      }
    } else if (successfulRun.headSha !== state.repository.defaultBranchSha) {
      errors.push(
        `工作流 ${expected.name} 最近成功运行未覆盖默认分支最新提交 ${state.repository.defaultBranchSha}。`,
      )
    }
  }

  const actionSecrets = asSet(state.actionSecrets)
  for (const secret of requiredActionSecrets) {
    if (!actionSecrets.has(secret)) errors.push(`Actions Secret 未配置：${secret}。`)
  }

  const actionVariables = asSet(state.actionVariables)
  for (const variable of requiredActionVariables) {
    if (!actionVariables.has(variable)) errors.push(`Actions 变量未配置：${variable}。`)
  }

  if (state.actionsPermissions.defaultWorkflowPermissions !== 'read') {
    errors.push('Actions 默认 GITHUB_TOKEN 权限必须为只读。')
  }
  if (state.actionsPermissions.canApprovePullRequestReviews) {
    errors.push('Actions 不应允许 GITHUB_TOKEN 自动批准 Pull Request。')
  }
  if (!state.actionsRetention) {
    errors.push('无法验证 Actions 日志与 Artifact 默认保留时间。')
  } else if (state.actionsRetention.days > 30) {
    warnings.push(
      `Actions 默认日志/Artifact 保留为 ${state.actionsRetention.days} 天；数据库备份 Artifact 虽单独限制为 14 天，仍建议把仓库默认值降至 30 天以内。`,
    )
  }

  const protectiveRuleset = findProtectiveRuleset(state.rulesets, defaultBranch)
  if (!protectiveRuleset) {
    errors.push(
      `未找到保护 ${defaultBranch} 的启用 ruleset：必须要求 PR、禁止删除/force push，并要求 ${requiredChecks.join('、')}。`,
    )
  } else if ((protectiveRuleset.bypassActors ?? []).length > 0) {
    errors.push(`ruleset ${protectiveRuleset.name} 存在默认绕过主体。`)
  }

  const security = state.securityAndAnalysis
  if (security.secretScanning !== 'enabled') errors.push('GitHub Secret scanning 未启用。')
  if (security.pushProtection !== 'enabled') errors.push('GitHub push protection 未启用。')
  if (security.dependabotSecurityUpdates !== 'enabled') {
    errors.push('Dependabot security updates 未启用。')
  }
  if (!state.privateVulnerabilityReporting) errors.push('Private vulnerability reporting 未启用。')

  if (state.pages.buildType !== 'workflow')
    errors.push('GitHub Pages 必须由 Actions workflow 部署。')
  if (!state.pages.httpsEnforced) errors.push('GitHub Pages 未强制 HTTPS。')
  if (!state.pages.htmlUrl) warnings.push('GitHub Pages 未返回公开站点地址。')

  return {
    errors,
    warnings,
    summary: {
      repository: state.repository.nameWithOwner,
      workflows: state.workflows.length,
      actionSecrets: state.actionSecrets.length,
      actionVariables: state.actionVariables.length,
      pagesUrl: state.pages.htmlUrl ?? null,
      actionsRetentionDays: state.actionsRetention?.days ?? null,
      defaultBranchSha: state.repository.defaultBranchSha,
    },
  }
}

function runGhJson(args, label) {
  try {
    const output = execFileSync('gh', args, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    return output.trim() ? JSON.parse(output) : null
  } catch {
    throw new Error(`无法读取 ${label}；请先确认 gh 已登录且 Token 对目标仓库有只读权限。`)
  }
}

function listNames(args, label) {
  const rows = runGhJson(args, label)
  return Array.isArray(rows) ? rows.map((row) => row.name).filter(Boolean) : []
}

export function collectRepositoryReadinessState(repositoryName) {
  const repoViewArgs = repositoryName
    ? ['repo', 'view', repositoryName, '--json', 'nameWithOwner,defaultBranchRef']
    : ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef']
  const repository = runGhJson(repoViewArgs, '仓库信息')
  const nameWithOwner = repository.nameWithOwner
  const apiRoot = `repos/${nameWithOwner}`
  const defaultBranch = repository.defaultBranchRef?.name ?? null
  const defaultCommit = defaultBranch
    ? runGhJson(['api', `${apiRoot}/commits/${defaultBranch}`], '默认分支最新提交')
    : null
  const workflowResponse = runGhJson(
    ['api', `${apiRoot}/actions/workflows?per_page=100`],
    'Actions 工作流',
  )
  const runResponse = runGhJson(['api', `${apiRoot}/actions/runs?per_page=100`], 'Actions 运行记录')
  const repositorySettings = runGhJson(['api', apiRoot], '仓库安全设置')
  const actionsPermissions = runGhJson(
    ['api', `${apiRoot}/actions/permissions/workflow`],
    'Actions 默认权限',
  )
  const actionsRetention = runGhJson(
    ['api', `${apiRoot}/actions/permissions/artifact-and-log-retention`],
    'Actions 日志与 Artifact 保留设置',
  )
  const rulesetSummaries = runGhJson(['api', `${apiRoot}/rulesets`], '仓库 ruleset')
  const rulesets = Array.isArray(rulesetSummaries)
    ? rulesetSummaries.map((ruleset) =>
        runGhJson(['api', `${apiRoot}/rulesets/${ruleset.id}`], `ruleset ${ruleset.name}`),
      )
    : []
  const privateVulnerabilityReporting = runGhJson(
    ['api', `${apiRoot}/private-vulnerability-reporting`],
    '私密漏洞报告设置',
  )
  const pages = runGhJson(['api', `${apiRoot}/pages`], 'GitHub Pages 设置')
  const workflows = (workflowResponse.workflows ?? []).map((workflow) => {
    const expected = expectedWorkflows.find((item) => item.name === workflow.name)
    let contentMatches = false
    if (expected && defaultBranch) {
      const remoteFile = runGhJson(
        ['api', `${apiRoot}/contents/${workflow.path}?ref=${defaultBranch}`],
        `工作流 ${workflow.name} 内容`,
      )
      const remoteContent = Buffer.from(remoteFile.content ?? '', 'base64').toString('utf8')
      const localContent = readFileSync(resolve(expected.path), 'utf8')
      const normalize = (value) => value.replace(/\r\n/g, '\n').trimEnd()
      contentMatches = normalize(remoteContent) === normalize(localContent)
    }
    return {
      name: workflow.name,
      path: workflow.path,
      state: workflow.state,
      contentMatches,
    }
  })

  return {
    observedAt: new Date().toISOString(),
    repository: {
      nameWithOwner,
      defaultBranch,
      defaultBranchSha: defaultCommit?.sha ?? null,
    },
    workflows,
    workflowRuns: (runResponse.workflow_runs ?? []).map((run) => ({
      name: run.name,
      headBranch: run.head_branch,
      headSha: run.head_sha,
      status: run.status,
      conclusion: run.conclusion,
      event: run.event,
      createdAt: run.created_at,
      url: run.html_url,
    })),
    actionSecrets: listNames(
      ['secret', 'list', '--repo', nameWithOwner, '--app', 'actions', '--json', 'name'],
      'Actions Secret 名称',
    ),
    actionVariables: listNames(
      ['variable', 'list', '--repo', nameWithOwner, '--json', 'name'],
      'Actions 变量名称',
    ),
    actionsPermissions: {
      defaultWorkflowPermissions: actionsPermissions.default_workflow_permissions,
      canApprovePullRequestReviews: actionsPermissions.can_approve_pull_request_reviews,
    },
    actionsRetention: {
      days: actionsRetention.days,
      maximumAllowedDays: actionsRetention.maximum_allowed_days,
    },
    rulesets,
    securityAndAnalysis: {
      secretScanning: repositorySettings.security_and_analysis?.secret_scanning?.status,
      pushProtection:
        repositorySettings.security_and_analysis?.secret_scanning_push_protection?.status,
      dependabotSecurityUpdates:
        repositorySettings.security_and_analysis?.dependabot_security_updates?.status,
    },
    privateVulnerabilityReporting: Boolean(privateVulnerabilityReporting.enabled),
    pages: {
      buildType: pages.build_type,
      httpsEnforced: pages.https_enforced,
      htmlUrl: pages.html_url,
    },
  }
}

async function main() {
  const repositoryName = process.argv[2]
  const state = collectRepositoryReadinessState(repositoryName)
  const report = evaluateRepositoryReadiness(state)

  console.log(`Repository readiness: ${report.summary.repository}`)
  console.log(
    `Observed ${report.summary.workflows} workflows, ${report.summary.actionSecrets} Actions Secret names and ${report.summary.actionVariables} Actions variable names.`,
  )
  console.log(`Actions default retention: ${report.summary.actionsRetentionDays} days.`)
  if (report.summary.pagesUrl) console.log(`Pages: ${report.summary.pagesUrl}`)
  for (const warning of report.warnings) console.warn(`WARNING: ${warning}`)
  for (const error of report.errors) console.error(`BLOCKER: ${error}`)

  if (report.errors.length > 0) process.exitCode = 1
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
