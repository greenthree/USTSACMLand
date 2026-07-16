import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const supabaseCliVersion = '2.109.1'

export const expectedEdgeFunctions = [
  'sync-member',
  'sync-stats',
  'delete-account',
  'change-password',
]

export const requiredFunctionSecrets = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ALLOWED_ORIGIN',
  'FIRECRAWL_API_KEY',
  'LUOGU_COOKIE',
  'LUOGU_CSRF_TOKEN',
  'QOJ_SERVICE_USERNAME',
  'QOJ_SERVICE_PASSWORD',
  'SYNC_ALERT_WEBHOOK_URL',
  'SYNC_ALERT_WEBHOOK_TOKEN',
  'DELETION_RECOVERY_REPOSITORY',
  'DELETION_RECOVERY_GITHUB_TOKEN',
]

const privateRestResources = [
  ['profiles', 'id'],
  ['platform_accounts', 'id'],
  ['platform_stats', 'profile_id'],
  ['stat_snapshots', 'id'],
  ['sync_jobs', 'id'],
  ['sync_runs', 'id'],
  ['announcements', 'id'],
  ['audit_logs', 'id'],
]

const publicRestResources = [
  ['public_members', 'id,full_name,major,grade'],
  ['public_platform_accounts', 'profile_id,platform,external_id,verified_at'],
  [
    'public_platform_stats',
    'profile_id,platform,current_rating,max_rating,solved_count,status,source_observed_at,fetched_at,last_success_at,stale_after,error_code,source_version,updated_at',
  ],
  [
    'public_stat_snapshots',
    'id,profile_id,platform,current_rating,max_rating,solved_count,status,source_observed_at,recorded_at',
  ],
  ['public_announcements', 'id,title,body,published_at,expires_at,created_at,updated_at'],
]

const forbiddenPublicColumns = [
  ['public_members', 'qq'],
  ['public_members', 'role'],
  ['public_members', 'review_status'],
  ['public_members', 'is_public'],
  ['public_platform_accounts', 'status'],
  ['public_platform_stats', 'error_message'],
  ['public_announcements', 'status'],
]

function headerContainsOrigin(value) {
  return (
    typeof value === 'string' &&
    value
      .toLowerCase()
      .split(',')
      .map((item) => item.trim())
      .includes('origin')
  )
}

function isFunctionBoundaryProbeReady(probe, allowedOrigin) {
  return Boolean(
    probe &&
    probe.allowed.status === 200 &&
    probe.allowed.allowOrigin === allowedOrigin &&
    headerContainsOrigin(probe.allowed.vary) &&
    probe.hostile.status === 200 &&
    probe.hostile.allowOrigin === null &&
    [401, 405].includes(probe.getStatus),
  )
}

export function evaluateSupabaseReadiness(state, options = {}) {
  const errors = []
  const warnings = []
  const preflight = options.mode === 'preflight'

  if (!state.project) {
    errors.push('未找到唯一的 linked Supabase 项目。')
  } else {
    if (state.project.status !== 'ACTIVE_HEALTHY') {
      errors.push(`Supabase 项目状态异常：${state.project.status || '未知'}。`)
    }
    if (state.project.postgresEngine !== 17) {
      warnings.push(`生产数据库当前为 PostgreSQL ${state.project.postgresEngine || '未知'}。`)
    }
  }

  const pendingMigrations = []
  const remoteOnlyMigrations = []
  for (const migration of state.migrations) {
    if (migration.local && !migration.remote) pendingMigrations.push(migration.local)
    if (!migration.local && migration.remote) remoteOnlyMigrations.push(migration.remote)
    if (migration.local && migration.remote && migration.local !== migration.remote) {
      errors.push(`Migration 对应关系异常：local=${migration.local}，remote=${migration.remote}。`)
    }
  }
  if (pendingMigrations.length > 0) {
    const message = `生产数据库缺少 ${pendingMigrations.length} 个 migration：${pendingMigrations.join('、')}。`
    ;(preflight ? warnings : errors).push(
      preflight ? `部署前预检发现待应用变更：${message}` : message,
    )
  }
  if (remoteOnlyMigrations.length > 0) {
    errors.push(`远端存在本地仓库缺失的 migration：${remoteOnlyMigrations.join('、')}。`)
  }

  const functions = new Map(state.functions.map((fn) => [fn.slug, fn]))
  for (const slug of expectedEdgeFunctions) {
    const fn = functions.get(slug)
    if (!fn) {
      const message = `生产环境缺少 Edge Function：${slug}。`
      ;(preflight ? warnings : errors).push(
        preflight ? `部署前预检发现待发布函数：${message}` : message,
      )
      continue
    }
    if (fn.status !== 'ACTIVE') errors.push(`Edge Function ${slug} 状态为 ${fn.status}。`)
    if (!fn.verifyJwt) errors.push(`Edge Function ${slug} 未启用 JWT 验证。`)
    if (!fn.importMap) errors.push(`Edge Function ${slug} 未使用仓库 import map。`)
  }

  if (state.dbLintResults.length > 0) {
    errors.push(`生产 public schema lint 返回 ${state.dbLintResults.length} 个问题。`)
  }

  if (!state.providerBackups) {
    errors.push('无法验证 Supabase 物理备份与 PITR 状态。')
  } else if (!state.providerBackups.pitrEnabled && state.providerBackups.availableBackups === 0) {
    warnings.push(
      'Supabase 当前未启用 PITR 且没有可用物理备份；必须依赖并实际演练仓库中的加密逻辑备份。',
    )
  }

  const configuredFunctionSecrets = new Set(state.functionSecrets)
  const missingFunctionSecrets = requiredFunctionSecrets.filter(
    (name) => !configuredFunctionSecrets.has(name),
  )
  for (const name of missingFunctionSecrets) {
    errors.push(`Supabase Function Secret 未配置：${name}。`)
  }

  if (!state.authSettings) {
    errors.push(
      `无法验证生产 Auth 公开设置${state.authSettingsError ? `：${state.authSettingsError}` : '。'}`,
    )
  } else {
    if (state.authSettings.disableSignup) errors.push('生产 Auth 已禁止新用户注册。')
    if (!state.authSettings.mailerAutoconfirm) {
      errors.push('生产 Auth 未启用邮箱自动确认，注册后无法按产品要求直接建立会话。')
    }
    if (!state.authSettings.emailProviderEnabled) errors.push('生产 Auth 未启用邮箱登录。')
  }

  if (!state.anonRestAudit) {
    errors.push(
      `无法验证匿名 REST 权限${state.anonRestAuditError ? `：${state.anonRestAuditError}` : '。'}`,
    )
  } else {
    for (const probe of state.anonRestAudit.privateResources) {
      if (![401, 403].includes(probe.status) || probe.code !== '42501') {
        errors.push(
          `匿名访问私有资源 ${probe.resource} 未被权限边界拒绝（HTTP ${probe.status}，code=${probe.code || 'none'}）。`,
        )
      }
    }
    for (const probe of state.anonRestAudit.publicResources) {
      if (probe.status !== 200) {
        errors.push(`匿名无法读取公开视图 ${probe.resource}（HTTP ${probe.status}）。`)
      }
    }
    for (const probe of state.anonRestAudit.forbiddenColumns) {
      if (probe.status !== 400 || probe.code !== '42703') {
        errors.push(
          `公开视图 ${probe.resource} 意外暴露或未正确拒绝字段 ${probe.column}（HTTP ${probe.status}，code=${probe.code || 'none'}）。`,
        )
      }
    }
  }

  if (!state.functionBoundaryAudit) {
    errors.push(
      `无法验证生产 Edge Function CORS 与方法边界${state.functionBoundaryAuditError ? `：${state.functionBoundaryAuditError}` : '。'}`,
    )
  } else {
    const boundaryProbes = new Map(
      state.functionBoundaryAudit.probes.map((probe) => [probe.functionName, probe]),
    )
    for (const functionName of expectedEdgeFunctions) {
      const probe = boundaryProbes.get(functionName)
      if (preflight && !functions.has(functionName)) {
        warnings.push(`Edge Function ${functionName} 尚未部署，CORS 与方法边界留待部署后复核。`)
        continue
      }
      if (!probe) {
        errors.push(`Edge Function ${functionName} 未取得 CORS 与方法边界探测结果。`)
        continue
      }
      if (
        probe.allowed.status !== 200 ||
        probe.allowed.allowOrigin !== state.functionBoundaryAudit.allowedOrigin ||
        !headerContainsOrigin(probe.allowed.vary)
      ) {
        errors.push(`Edge Function ${probe.functionName} 未正确允许正式 Pages Origin。`)
      }
      if (probe.hostile.status !== 200 || probe.hostile.allowOrigin !== null) {
        errors.push(`Edge Function ${probe.functionName} 未正确拒绝恶意 CORS Origin。`)
      }
      if (![401, 405].includes(probe.getStatus)) {
        errors.push(
          `Edge Function ${probe.functionName} 匿名 GET 返回 HTTP ${probe.getStatus}，未体现认证/方法边界。`,
        )
      }
    }
  }

  return {
    errors,
    warnings,
    summary: {
      projectRef: state.project?.ref ?? null,
      projectStatus: state.project?.status ?? null,
      migrations: state.migrations.length,
      pendingMigrations: pendingMigrations.length,
      functions: state.functions.length,
      lintFindings: state.dbLintResults.length,
      authEmailReady: Boolean(
        state.authSettings &&
        !state.authSettings.disableSignup &&
        state.authSettings.mailerAutoconfirm &&
        state.authSettings.emailProviderEnabled,
      ),
      anonRestReady: Boolean(
        state.anonRestAudit &&
        state.anonRestAudit.privateResources.every(
          (probe) => [401, 403].includes(probe.status) && probe.code === '42501',
        ) &&
        state.anonRestAudit.publicResources.every((probe) => probe.status === 200) &&
        state.anonRestAudit.forbiddenColumns.every(
          (probe) => probe.status === 400 && probe.code === '42703',
        ),
      ),
      pitrEnabled: state.providerBackups?.pitrEnabled ?? null,
      providerBackups: state.providerBackups?.availableBackups ?? null,
      functionSecrets: state.functionSecrets.length,
      missingFunctionSecrets: missingFunctionSecrets.length,
      functionBoundaryReady: Boolean(
        state.functionBoundaryAudit &&
        expectedEdgeFunctions.every((functionName) =>
          isFunctionBoundaryProbeReady(
            state.functionBoundaryAudit.probes.find((probe) => probe.functionName === functionName),
            state.functionBoundaryAudit.allowedOrigin,
          ),
        ),
      ),
    },
  }
}

function runSupabaseJson(args, label) {
  const executable = process.platform === 'win32' ? process.execPath : 'npx'
  const executableArgs =
    process.platform === 'win32'
      ? [resolve(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')]
      : []
  try {
    const output = execFileSync(
      executable,
      [...executableArgs, '--yes', `supabase@${supabaseCliVersion}`, ...args, '--agent', 'yes'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    return output.trim() ? JSON.parse(output) : null
  } catch {
    throw new Error(`无法读取 ${label}；请确认 Supabase CLI 已登录且项目仍处于 linked 状态。`)
  }
}

async function readPublicAuthSettings(projectRef, apiKey) {
  const response = await fetch(`https://${projectRef}.supabase.co/auth/v1/settings`, {
    headers: {
      apikey: apiKey,
      'user-agent': 'USTSACMLand-readiness-check/1.0',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const settings = await response.json()
  return {
    disableSignup: Boolean(settings.disable_signup),
    mailerAutoconfirm: Boolean(settings.mailer_autoconfirm),
    phoneAutoconfirm: Boolean(settings.phone_autoconfirm),
    emailProviderEnabled: Boolean(settings.external?.email),
  }
}

async function readRestProbe(projectRef, apiKey, resource, select) {
  const url = new URL(`https://${projectRef}.supabase.co/rest/v1/${resource}`)
  url.searchParams.set('select', select)
  url.searchParams.set('limit', '1')
  const response = await fetch(url, {
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${apiKey}`,
      'user-agent': 'USTSACMLand-readiness-check/1.0',
    },
    signal: AbortSignal.timeout(10_000),
  })
  let code = null
  if (!response.ok) {
    try {
      const body = await response.json()
      code = typeof body.code === 'string' ? body.code : null
    } catch {
      code = null
    }
  } else {
    await response.body?.cancel()
  }
  return { status: response.status, code }
}

async function readAnonymousRestAudit(projectRef, apiKey) {
  const [privateResources, publicResources, forbiddenColumns] = await Promise.all([
    Promise.all(
      privateRestResources.map(async ([resource, select]) => ({
        resource,
        ...(await readRestProbe(projectRef, apiKey, resource, select)),
      })),
    ),
    Promise.all(
      publicRestResources.map(async ([resource, select]) => ({
        resource,
        ...(await readRestProbe(projectRef, apiKey, resource, select)),
      })),
    ),
    Promise.all(
      forbiddenPublicColumns.map(async ([resource, column]) => ({
        resource,
        column,
        ...(await readRestProbe(projectRef, apiKey, resource, column)),
      })),
    ),
  ])
  return { privateResources, publicResources, forbiddenColumns }
}

function readProductionOrigin() {
  const config = readFileSync(resolve('supabase/config.toml'), 'utf8')
  const siteUrlMatch = config.match(/^\s*site_url\s*=\s*"([^"]+)"\s*$/m)
  if (!siteUrlMatch) throw new Error('supabase/config.toml 未配置 auth.site_url。')
  try {
    return new URL(siteUrlMatch[1]).origin
  } catch {
    throw new Error('supabase/config.toml 的 auth.site_url 不是有效 URL。')
  }
}

async function readFunctionResponse(response) {
  const result = {
    status: response.status,
    allowOrigin: response.headers.get('access-control-allow-origin'),
    vary: response.headers.get('vary'),
  }
  await response.body?.cancel()
  return result
}

async function readFunctionBoundaryProbe(projectRef, apiKey, allowedOrigin, functionName) {
  const url = `https://${projectRef}.supabase.co/functions/v1/${functionName}`
  const createOptionsRequest = (origin) =>
    fetch(url, {
      method: 'OPTIONS',
      headers: {
        apikey: apiKey,
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type, apikey',
        'user-agent': 'USTSACMLand-readiness-check/1.0',
      },
      signal: AbortSignal.timeout(10_000),
    })
  const [allowedResponse, hostileResponse, getResponse] = await Promise.all([
    createOptionsRequest(allowedOrigin),
    createOptionsRequest('https://attacker.example'),
    fetch(url, {
      method: 'GET',
      headers: {
        apikey: apiKey,
        authorization: `Bearer ${apiKey}`,
        origin: allowedOrigin,
        'user-agent': 'USTSACMLand-readiness-check/1.0',
      },
      signal: AbortSignal.timeout(10_000),
    }),
  ])
  const [allowed, hostile] = await Promise.all([
    readFunctionResponse(allowedResponse),
    readFunctionResponse(hostileResponse),
  ])
  const getStatus = getResponse.status
  await getResponse.body?.cancel()
  return { functionName, allowed, hostile, getStatus }
}

async function readFunctionBoundaryAudit(projectRef, apiKey) {
  const allowedOrigin = readProductionOrigin()
  const probes = await Promise.all(
    expectedEdgeFunctions.map((functionName) =>
      readFunctionBoundaryProbe(projectRef, apiKey, allowedOrigin, functionName),
    ),
  )
  return { allowedOrigin, probes }
}

export async function collectSupabaseReadinessState() {
  const projects = runSupabaseJson(['projects', 'list'], 'Supabase 项目列表')
  const projectRows = Array.isArray(projects) ? projects : (projects?.projects ?? [])
  const linkedProjects = projectRows.filter((project) => project.linked)
  if (linkedProjects.length !== 1) {
    return {
      project: null,
      migrations: [],
      functions: [],
      dbLintResults: [],
      authSettings: null,
      authSettingsError: '未找到唯一 linked 项目。',
      anonRestAudit: null,
      anonRestAuditError: '未找到唯一 linked 项目。',
      functionBoundaryAudit: null,
      functionBoundaryAuditError: '未找到唯一 linked 项目。',
      providerBackups: null,
      functionSecrets: [],
    }
  }

  const project = linkedProjects[0]
  const migrationResponse = runSupabaseJson(['migration', 'list', '--linked'], 'migration 状态')
  const functions = runSupabaseJson(
    ['functions', 'list', '--project-ref', project.ref],
    'Edge Function 状态',
  )
  const lintResponse = runSupabaseJson(
    ['db', 'lint', '--linked', '--schema', 'public', '--level', 'warning', '--fail-on', 'error'],
    '生产 public schema lint',
  )
  const apiKeyResponse = runSupabaseJson(
    ['projects', 'api-keys', '--project-ref', project.ref],
    '项目公开 API key',
  )
  const backupResponse = runSupabaseJson(
    ['backups', 'list', '--project-ref', project.ref],
    'Supabase 物理备份状态',
  )
  const secretResponse = runSupabaseJson(
    ['secrets', 'list', '--project-ref', project.ref],
    'Supabase Function Secret 名称',
  )
  const apiKeys = Array.isArray(apiKeyResponse) ? apiKeyResponse : (apiKeyResponse?.keys ?? [])
  const publicApiKey =
    apiKeys.find((key) => key.type === 'publishable')?.api_key ??
    apiKeys.find((key) => key.name === 'anon')?.api_key
  let authSettings = null
  let authSettingsError = null
  let anonRestAudit = null
  let anonRestAuditError = null
  let functionBoundaryAudit = null
  let functionBoundaryAuditError = null
  if (!publicApiKey) {
    authSettingsError = '未找到 publishable 或 anon key。'
    anonRestAuditError = '未找到 publishable 或 anon key。'
    functionBoundaryAuditError = '未找到 publishable 或 anon key。'
  } else {
    const [authResult, restResult, functionBoundaryResult] = await Promise.allSettled([
      readPublicAuthSettings(project.ref, publicApiKey),
      readAnonymousRestAudit(project.ref, publicApiKey),
      readFunctionBoundaryAudit(project.ref, publicApiKey),
    ])
    if (authResult.status === 'fulfilled') authSettings = authResult.value
    else
      authSettingsError =
        authResult.reason instanceof Error ? authResult.reason.message : '请求失败。'
    if (restResult.status === 'fulfilled') anonRestAudit = restResult.value
    else
      anonRestAuditError =
        restResult.reason instanceof Error ? restResult.reason.message : '请求失败。'
    if (functionBoundaryResult.status === 'fulfilled') {
      functionBoundaryAudit = functionBoundaryResult.value
    } else {
      functionBoundaryAuditError =
        functionBoundaryResult.reason instanceof Error
          ? functionBoundaryResult.reason.message
          : '请求失败。'
    }
  }

  return {
    project: {
      ref: project.ref,
      name: project.name,
      status: project.status,
      region: project.region,
      postgresEngine: Number(project.database?.postgres_engine) || null,
    },
    migrations: migrationResponse?.migrations ?? [],
    functions: (Array.isArray(functions) ? functions : (functions?.functions ?? [])).map((fn) => ({
      slug: fn.slug,
      status: fn.status,
      version: fn.version,
      verifyJwt: fn.verify_jwt,
      importMap: fn.import_map,
    })),
    dbLintResults: lintResponse?.results ?? [],
    authSettings,
    authSettingsError,
    anonRestAudit,
    anonRestAuditError,
    functionBoundaryAudit,
    functionBoundaryAuditError,
    providerBackups: {
      walgEnabled: Boolean(backupResponse?.walg_enabled),
      pitrEnabled: Boolean(backupResponse?.pitr_enabled),
      availableBackups: Array.isArray(backupResponse?.backups) ? backupResponse.backups.length : 0,
    },
    functionSecrets: (secretResponse?.secrets ?? [])
      .map((secret) => secret.name)
      .filter((name) => typeof name === 'string'),
  }
}

async function main() {
  const mode = process.argv.includes('--preflight') ? 'preflight' : 'strict'
  const report = evaluateSupabaseReadiness(await collectSupabaseReadinessState(), { mode })
  console.log(
    `Supabase ${mode} readiness: ${report.summary.projectRef || 'no linked project'} (${report.summary.projectStatus || 'unknown'})`,
  )
  console.log(
    `Observed ${report.summary.migrations} migrations, ${report.summary.pendingMigrations} pending, ${report.summary.functions} Edge Functions, ${report.summary.functionSecrets} Function Secret names (${report.summary.missingFunctionSecrets} missing), ${report.summary.lintFindings} schema lint findings, Auth email readiness=${report.summary.authEmailReady}, anonymous REST readiness=${report.summary.anonRestReady}, Edge Function boundary readiness=${report.summary.functionBoundaryReady}, PITR=${report.summary.pitrEnabled} and provider backups=${report.summary.providerBackups}.`,
  )
  for (const warning of report.warnings) console.warn(`WARNING: ${warning}`)
  for (const error of report.errors) console.error(`BLOCKER: ${error}`)
  if (report.errors.length > 0) process.exitCode = 1
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
