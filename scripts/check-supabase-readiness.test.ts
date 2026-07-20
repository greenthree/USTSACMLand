import {
  evaluateSupabaseReadiness,
  expectedEdgeFunctions,
  requiredFunctionSecrets,
} from './check-supabase-readiness.mjs'

function createReadyState() {
  return {
    observedAt: '2026-07-17T00:10:00.000Z',
    project: {
      ref: 'project-ref',
      name: 'USTSACMLand',
      status: 'ACTIVE_HEALTHY',
      region: 'ap-northeast-1',
      postgresEngine: 17,
    },
    migrations: [{ local: '202607150001', remote: '202607150001', time: '202607150001' }],
    functions: expectedEdgeFunctions.map((slug) => ({
      slug,
      status: 'ACTIVE',
      version: 1,
      verifyJwt: true,
      importMap: true,
    })),
    dbLintResults: [],
    authSettings: {
      disableSignup: false,
      mailerAutoconfirm: true,
      phoneAutoconfirm: false,
      emailProviderEnabled: true,
    },
    authSettingsError: null,
    anonRestAudit: {
      privateResources: [
        { resource: 'profiles', status: 401, code: '42501' },
        { resource: 'audit_logs', status: 401, code: '42501' },
      ],
      publicResources: [
        { resource: 'public_members', status: 200, code: null },
        { resource: 'public_platform_stats', status: 200, code: null },
      ],
      forbiddenColumns: [{ resource: 'public_members', column: 'qq', status: 400, code: '42703' }],
    },
    anonRestAuditError: null,
    functionBoundaryAudit: {
      allowedOrigin: 'https://greenthree.github.io',
      probes: expectedEdgeFunctions.map((functionName) => ({
        functionName,
        allowed: {
          status: 200,
          allowOrigin: 'https://greenthree.github.io',
          vary: 'Origin, Access-Control-Request-Headers',
        },
        hostile: {
          status: 200,
          allowOrigin: null,
          vary: 'Origin',
        },
        getStatus: 401,
      })),
    },
    functionBoundaryAuditError: null,
    queueSchedulerHealth: {
      configured: true,
      cronActive: true,
      lastDispatchedAt: '2026-07-17T00:05:00.000Z',
      lastResponseDispatchedAt: '2026-07-17T00:05:00.000Z',
      lastHttpStatus: 200,
      lastResponseAt: '2026-07-17T00:05:01.000Z',
      lastTimedOut: false,
      lastTransportError: false,
      recentCronRuns: 3,
      recentCronSuccesses: 3,
    },
    queueSchedulerHealthError: null,
    providerBackups: {
      walgEnabled: true,
      pitrEnabled: true,
      availableBackups: 1,
    },
    functionSecrets: [...requiredFunctionSecrets],
  }
}

describe('Supabase production readiness checker', () => {
  it('accepts a healthy project with migration parity and active functions', () => {
    expect(evaluateSupabaseReadiness(createReadyState())).toMatchObject({
      errors: [],
      warnings: [],
      summary: {
        projectRef: 'project-ref',
        projectStatus: 'ACTIVE_HEALTHY',
        migrations: 1,
        pendingMigrations: 0,
        functions: 4,
        lintFindings: 0,
        authEmailReady: true,
        anonRestReady: true,
        functionBoundaryReady: true,
        queueSchedulerReady: true,
        pitrEnabled: true,
        providerBackups: 1,
        functionSecrets: requiredFunctionSecrets.length,
        missingFunctionSecrets: 0,
      },
    })
  })

  it('reports local migrations that are not deployed', () => {
    const state = createReadyState()
    state.migrations.push({ local: '202607150002', remote: '', time: '202607150002' })

    expect(evaluateSupabaseReadiness(state).errors).toContain(
      '生产数据库缺少 1 个 migration：202607150002。',
    )
  })

  it('allows exact local deployment drift during preflight but keeps it visible', () => {
    const state = createReadyState()
    state.migrations.push({ local: '202607160003', remote: '', time: '202607160003' })
    state.functions = state.functions.filter(
      (fn) => !['delete-account', 'change-password'].includes(fn.slug),
    )
    state.functionBoundaryAudit.probes = state.functionBoundaryAudit.probes.map((probe) =>
      ['delete-account', 'change-password'].includes(probe.functionName)
        ? {
            ...probe,
            allowed: { status: 404, allowOrigin: null, vary: null },
            hostile: { status: 404, allowOrigin: null, vary: null },
            getStatus: 404,
          }
        : probe,
    )

    const report = evaluateSupabaseReadiness(state, { mode: 'preflight' })

    expect(report.errors).toEqual([])
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('待应用变更'),
        expect.stringContaining('待发布函数'),
        expect.stringContaining('delete-account 尚未部署'),
        expect.stringContaining('change-password 尚未部署'),
      ]),
    )
  })

  it('reports remote migrations missing from the repository', () => {
    const state = createReadyState()
    state.migrations.push({ local: '', remote: '202607160001', time: '202607160001' })

    expect(evaluateSupabaseReadiness(state).errors).toContain(
      '远端存在本地仓库缺失的 migration：202607160001。',
    )
  })

  it('allows only the known pending schema lint remediation during preflight', () => {
    const state = createReadyState()
    state.migrations.push({ local: '202607200002', remote: '', time: '202607200002' })
    state.dbLintResults = [
      { function: 'public.read_daily_problem_feed', issues: [{ level: 'warning' }] },
      { function: 'public.claim_webchat_total_request', issues: [{ level: 'warning extra' }] },
    ]

    const preflight = evaluateSupabaseReadiness(state, { mode: 'preflight' })
    expect(preflight.errors).toEqual([])
    expect(preflight.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('部署后严格检查仍必须为零')]),
    )
    expect(evaluateSupabaseReadiness(state).errors).toContain(
      '生产 public schema lint 返回 2 个问题。',
    )

    state.dbLintResults.push({
      function: 'public.unexpected_function',
      issues: [{ level: 'warning' }],
    })
    expect(evaluateSupabaseReadiness(state, { mode: 'preflight' }).errors).toContain(
      '生产 public schema lint 返回 3 个问题。',
    )
  })

  it('requires all Edge Functions to be active with JWT and import maps', () => {
    const state = createReadyState()
    state.functions = state.functions.filter((fn) => fn.slug !== 'delete-account')
    state.functions[0].verifyJwt = false
    state.functions[1].importMap = false

    expect(evaluateSupabaseReadiness(state).errors).toEqual(
      expect.arrayContaining([
        '生产环境缺少 Edge Function：delete-account。',
        'Edge Function sync-member 未启用 JWT 验证。',
        'Edge Function sync-stats 未使用仓库 import map。',
      ]),
    )
  })

  it('rejects unhealthy projects and schema lint findings', () => {
    const state = createReadyState()
    state.project.status = 'INACTIVE'
    state.dbLintResults = [{ level: 'error', message: 'broken function' }]

    expect(evaluateSupabaseReadiness(state).errors).toEqual(
      expect.arrayContaining([
        'Supabase 项目状态异常：INACTIVE。',
        '生产 public schema lint 返回 1 个问题。',
      ]),
    )
  })

  it('fails closed when no unique linked project is available', () => {
    const state = createReadyState()
    state.project = null
    state.migrations = []
    state.functions = []
    state.authSettings = null
    state.authSettingsError = '未找到唯一 linked 项目。'
    state.anonRestAudit = null
    state.anonRestAuditError = '未找到唯一 linked 项目。'
    state.functionBoundaryAudit = null
    state.functionBoundaryAuditError = '未找到唯一 linked 项目。'
    state.queueSchedulerHealth = null
    state.queueSchedulerHealthError = '未找到唯一 linked 项目。'
    state.providerBackups = null
    state.functionSecrets = []

    expect(evaluateSupabaseReadiness(state).errors).toEqual(
      expect.arrayContaining([
        '未找到唯一的 linked Supabase 项目。',
        '生产环境缺少 Edge Function：sync-member。',
        '无法验证生产 Auth 公开设置：未找到唯一 linked 项目。',
        '无法验证匿名 REST 权限：未找到唯一 linked 项目。',
        '无法验证生产 Edge Function CORS 与方法边界：未找到唯一 linked 项目。',
        '无法验证 Supabase 物理备份与 PITR 状态。',
        'Supabase Function Secret 未配置：ALLOWED_ORIGIN。',
      ]),
    )
  })

  it('requires open signup, email autoconfirm and the email provider', () => {
    const state = createReadyState()
    state.authSettings = {
      disableSignup: true,
      mailerAutoconfirm: false,
      phoneAutoconfirm: false,
      emailProviderEnabled: false,
    }

    expect(evaluateSupabaseReadiness(state).errors).toEqual(
      expect.arrayContaining([
        '生产 Auth 已禁止新用户注册。',
        '生产 Auth 未启用邮箱自动确认，注册后无法按产品要求直接建立会话。',
        '生产 Auth 未启用邮箱登录。',
      ]),
    )
  })

  it('rejects anonymous private-table exposure and public-view field leakage', () => {
    const state = createReadyState()
    state.anonRestAudit.privateResources[0] = {
      resource: 'profiles',
      status: 200,
      code: null,
    }
    state.anonRestAudit.publicResources[0] = {
      resource: 'public_members',
      status: 401,
      code: '42501',
    }
    state.anonRestAudit.forbiddenColumns[0] = {
      resource: 'public_members',
      column: 'qq',
      status: 200,
      code: null,
    }

    expect(evaluateSupabaseReadiness(state).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('匿名访问私有资源 profiles 未被权限边界拒绝'),
        '匿名无法读取公开视图 public_members（HTTP 401）。',
        expect.stringContaining('公开视图 public_members 意外暴露或未正确拒绝字段 qq'),
      ]),
    )
  })

  it('rejects incomplete or unsafe Edge Function CORS and method boundaries', () => {
    const state = createReadyState()
    state.functionBoundaryAudit.probes[0].allowed.allowOrigin = '*'
    state.functionBoundaryAudit.probes[0].allowed.vary = null
    state.functionBoundaryAudit.probes[1].hostile.allowOrigin = 'https://attacker.example'
    state.functionBoundaryAudit.probes[2].getStatus = 200

    const report = evaluateSupabaseReadiness(state)

    expect(report.errors).toEqual(
      expect.arrayContaining([
        'Edge Function sync-member 未正确允许正式 Pages Origin。',
        'Edge Function sync-stats 未正确拒绝恶意 CORS Origin。',
        'Edge Function delete-account 匿名 GET 返回 HTTP 200，未体现认证/方法边界。',
      ]),
    )
    expect(report.summary.functionBoundaryReady).toBe(false)
  })

  it('fails closed when an expected Edge Function has no boundary probe', () => {
    const state = createReadyState()
    state.functionBoundaryAudit.probes = state.functionBoundaryAudit.probes.filter(
      (probe) => probe.functionName !== 'delete-account',
    )

    expect(evaluateSupabaseReadiness(state).errors).toContain(
      'Edge Function delete-account 未取得 CORS 与方法边界探测结果。',
    )
  })

  it('warns when the provider exposes neither PITR nor a physical backup', () => {
    const state = createReadyState()
    state.providerBackups = {
      walgEnabled: true,
      pitrEnabled: false,
      availableBackups: 0,
    }

    expect(evaluateSupabaseReadiness(state).warnings).toContain(
      'Supabase 当前未启用 PITR 且没有可用物理备份；必须依赖并实际演练仓库中的加密逻辑备份。',
    )
  })

  it('reports every missing application Function Secret by name only', () => {
    const state = createReadyState()
    state.functionSecrets = state.functionSecrets.filter(
      (name) => name !== 'DELETION_RECOVERY_GITHUB_TOKEN',
    )

    expect(evaluateSupabaseReadiness(state).errors).toEqual(
      expect.arrayContaining(['Supabase Function Secret 未配置：DELETION_RECOVERY_GITHUB_TOKEN。']),
    )
  })

  it('requires fresh, configured, successful database queue scheduling', () => {
    const state = createReadyState()
    state.queueSchedulerHealth = {
      configured: false,
      cronActive: false,
      lastDispatchedAt: '2026-07-16T23:30:00.000Z',
      lastResponseDispatchedAt: '2026-07-16T23:30:00.000Z',
      lastHttpStatus: 401,
      lastResponseAt: '2026-07-16T23:30:01.000Z',
      lastTimedOut: false,
      lastTransportError: false,
      recentCronRuns: 0,
      recentCronSuccesses: 0,
    }

    const report = evaluateSupabaseReadiness(state)
    expect(report.errors).toEqual(
      expect.arrayContaining([
        '数据库同步队列调度器 Vault 配置不完整。',
        '数据库同步队列五分钟 cron 未启用。',
        expect.stringContaining('超过 12 分钟门限'),
        expect.stringContaining('最近已完成响应对应调度距今'),
        '数据库同步队列最近一次 Edge 请求未成功完成。',
        '数据库同步队列近 15 分钟没有成功 cron 运行。',
      ]),
    )
    expect(report.summary.queueSchedulerReady).toBe(false)
  })
})
