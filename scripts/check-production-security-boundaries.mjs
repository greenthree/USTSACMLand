import { execFileSync } from 'node:child_process'
import { randomBytes, randomInt } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { parseLinkedProjectRef, parseProductionApiKeys } from './check-sync-platform-outage.mjs'

const PRODUCTION_PROJECT_REF = 'qzggoqdmsvktrtnjislw'
const PRODUCTION_ORIGIN = 'https://ustsacm.fun'

export const requiredSecurityChecks = [
  'anonymousPublicViewSafe',
  'anonymousProfilesHidden',
  'anonymousAdminRpcDenied',
  'anonymousRuntimeSecretRpcsDenied',
  'memberOwnProfile',
  'memberCrossProfileDenied',
  'memberAdminRpcDenied',
  'memberAuditTableDenied',
  'memberFirecrawlRuntimeDenied',
  'memberRelayRuntimeDenied',
  'suspendedOwnProfileReadable',
  'suspendedWriteBlocked',
  'suspendedAdminRpcDenied',
  'suspendedPublicProjectionHidden',
  'initialAdminDirectory',
  'promotionVisibleToOldJwt',
  'demotionVisibleToOldJwt',
  'conversationOwnReadable',
  'adminCrossConversationDenied',
  'adminOwnListIsolated',
  'adminExportIsolated',
  'trainingGoalOwnReadable',
  'adminCrossTrainingGoalDenied',
  'adminOwnTrainingGoalListIsolated',
  'adminDirectMemberProfileAuthorized',
  'adminDirectAuditTableDenied',
  'adminFirecrawlRuntimeDenied',
  'adminRelayRuntimeDenied',
  'adminUnlimitedRpcDenied',
  'oldJwtPrivateAccessRevoked',
  'zeroAuth',
  'zeroProfiles',
  'zeroSyncJobs',
  'zeroAuditUuidReferences',
  'browserServiceKeysAbsent',
  'serviceRuntimeRpcsAvailable',
  'serviceProfileMutationBlocked',
]

function npxInvocation() {
  if (process.platform !== 'win32') return { command: 'npx', prefix: [] }
  return {
    command: process.execPath,
    prefix: [resolve(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')],
  }
}

function runSupabaseJson(args, execFile = execFileSync) {
  const npx = npxInvocation()
  let output
  try {
    output = execFile(
      npx.command,
      [...npx.prefix, '--yes', 'supabase@2.109.1', ...args, '--output', 'json', '--agent', 'yes'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 'unknown'
    throw new Error(
      `Production security audit could not read Supabase state (process status ${status}); credentials were redacted.`,
    )
  }
  try {
    return output.trim() ? JSON.parse(output) : null
  } catch {
    throw new Error(
      'Production security audit received invalid Supabase JSON; credentials were redacted.',
    )
  }
}

export function collectSupabaseSecretValues(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.keys
  if (!Array.isArray(rows)) throw new Error('Production API key response is invalid.')
  return rows
    .filter(
      (row) => row?.type === 'secret' || (row?.type === 'legacy' && row?.name === 'service_role'),
    )
    .map((row) => row?.api_key)
    .filter((value) => typeof value === 'string' && value.length >= 20)
}

export function discoverJavascriptReferences(source, baseUrl) {
  const references = new Set()
  for (const match of source.matchAll(/(?:src|href)="([^"]+\.js(?:\?[^\"]*)?)"/g)) {
    references.add(new URL(match[1], baseUrl).href)
  }
  for (const match of source.matchAll(/(?:\.\/|\/)?assets\/[A-Za-z0-9._-]+\.js/g)) {
    references.add(new URL(match[0].replace(/^\.\//, ''), baseUrl).href)
  }
  return [...references]
}

export function assertNoBrowserSecretValues(source, secretValues) {
  if (secretValues.some((value) => source.includes(value))) {
    throw new Error('A production browser asset contains a server-side Supabase key value.')
  }
  if (/github_pat_[A-Za-z0-9_]{20,}/.test(source)) {
    throw new Error('A production browser asset contains a fine-grained GitHub token pattern.')
  }
  if (/\b(?:sk|fc)-[A-Za-z0-9_-]{20,}/.test(source)) {
    throw new Error('A production browser asset contains a server-side API key pattern.')
  }
  return true
}

export function assertSecurityChecks(results) {
  const missing = requiredSecurityChecks.filter((name) => results[name] !== true)
  if (missing.length) {
    throw new Error(`Production security checks failed: ${missing.join(', ')}.`)
  }
  return true
}

async function scanProductionBrowserAssets({ fetchImpl, secretValues }) {
  const htmlResponse = await fetchImpl(`${PRODUCTION_ORIGIN}/`, {
    headers: { 'cache-control': 'no-cache' },
  })
  if (!htmlResponse.ok) throw new Error('Production HTML is unavailable for the security audit.')
  const html = await htmlResponse.text()
  const queue = discoverJavascriptReferences(html, `${PRODUCTION_ORIGIN}/`)
  const seen = new Set()
  const bodies = []
  while (queue.length) {
    const url = queue.shift()
    if (seen.has(url)) continue
    seen.add(url)
    const response = await fetchImpl(url, { headers: { 'cache-control': 'no-cache' } })
    if (!response.ok) throw new Error('A production JavaScript asset is unavailable.')
    const body = await response.text()
    bodies.push(body)
    for (const reference of discoverJavascriptReferences(body, `${PRODUCTION_ORIGIN}/`)) {
      if (!seen.has(reference)) queue.push(reference)
    }
  }
  if (!seen.size) throw new Error('No production JavaScript assets were discovered.')
  assertNoBrowserSecretValues(bodies.join('\n'), secretValues)
  return seen.size
}

function randomPassword() {
  return `A9!${randomBytes(24).toString('base64url')}`
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

export async function runProductionSecurityBoundaryCheck({
  execFile = execFileSync,
  fetchImpl = fetch,
  createClientImpl = createClient,
  projectRef = PRODUCTION_PROJECT_REF,
} = {}) {
  parseLinkedProjectRef(runSupabaseJson(['projects', 'list'], execFile), projectRef)
  const keyPayload = runSupabaseJson(
    ['projects', 'api-keys', '--project-ref', projectRef, '--reveal'],
    execFile,
  )
  const environment = parseProductionApiKeys(keyPayload, projectRef)
  const secretValues = collectSupabaseSecretValues(keyPayload)
  const assetCount = await scanProductionBrowserAssets({ fetchImpl, secretValues })

  const admin = createClientImpl(environment.API_URL, environment.SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const fixtures = []
  const clients = new Map()
  const identities = new Map()
  const results = { browserServiceKeysAbsent: true }
  let cleanupFallbacks = 0
  let primaryError = null

  const createFixture = async (label) => {
    const suffix = randomBytes(10).toString('hex')
    const identity = {
      email: `security-final-${label}-${suffix}@example.test`,
      password: randomPassword(),
    }
    const created = await admin.auth.admin.createUser({
      ...identity,
      email_confirm: true,
      user_metadata: { full_name: `受控安全复核${label}` },
    })
    if (created.error || !created.data.user) {
      throw new Error('Could not create a controlled production security fixture.')
    }
    const id = created.data.user.id
    fixtures.push(id)
    identities.set(id, identity)
    return id
  }

  const signIn = async (id) => {
    const client = createClientImpl(environment.API_URL, environment.ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const signedIn = await client.auth.signInWithPassword(identities.get(id))
    if (signedIn.error || !signedIn.data.session?.access_token) {
      throw new Error('Could not authenticate a controlled production security fixture.')
    }
    clients.set(id, client)
    return client
  }

  const authAbsent = async (id) => {
    const result = await admin.auth.admin.getUserById(id)
    return Boolean(result.error?.code === 'user_not_found' || (!result.error && !result.data?.user))
  }

  const profileAbsent = async (id) => {
    const { data, error } = await admin.from('profiles').select('id').eq('id', id).maybeSingle()
    if (error)
      throw new Error('Profile reconciliation failed during the production security audit.')
    return data === null
  }

  const invokeDeletion = async (id) => {
    if (await authAbsent(id)) return true
    const client = clients.get(id) ?? (await signIn(id))
    const session = await client.auth.getSession()
    const token = session.data.session?.access_token
    if (!token) throw new Error('Fixture session is unavailable for production cleanup.')
    const response = await fetchImpl(`${environment.API_URL}/functions/v1/delete-account`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        apikey: environment.ANON_KEY,
        'content-type': 'application/json',
        origin: PRODUCTION_ORIGIN,
      },
      body: JSON.stringify({ currentPassword: identities.get(id).password }),
    })
    let body = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    return response.status === 200 && body?.deleted === true
  }

  const expectRpcDenied = async (client, name, args = undefined) => {
    const result = await client.rpc(name, args)
    return Boolean(result.error)
  }

  let firstAdminId = null
  let promotedAdminId = null
  let suspendedId = null
  try {
    firstAdminId = await createFixture('admin-a')
    promotedAdminId = await createFixture('member-b')
    suspendedId = await createFixture('suspended-c')

    const blockedServiceMutation = await admin
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', firstAdminId)
    results.serviceProfileMutationBlocked = blockedServiceMutation.error?.code === '42501'
    requireCondition(
      results.serviceProfileMutationBlocked,
      'Service-role PostgREST profile mutation was not blocked by the production trigger.',
    )

    const qqValues = fixtures.map(() => randomInt(1_000_000_000, 9_999_999_999).toString())
    const initializationSql = `
update public.profiles
set
  major = '计算机科学与技术',
  grade = '24级',
  qq = case id
    when ${quoteLiteral(fixtures[0])}::uuid then ${quoteLiteral(qqValues[0])}
    when ${quoteLiteral(fixtures[1])}::uuid then ${quoteLiteral(qqValues[1])}
    when ${quoteLiteral(fixtures[2])}::uuid then ${quoteLiteral(qqValues[2])}
  end,
  is_public = true
where id in (${fixtures.map((id) => `${quoteLiteral(id)}::uuid`).join(', ')});

update public.profiles
set role = 'admin'
where id = ${quoteLiteral(firstAdminId)}::uuid;

update public.profiles
set
  review_status = 'suspended',
  review_note = 'Controlled production security audit'
where id = ${quoteLiteral(suspendedId)}::uuid;

select
  count(*)::integer as fixture_profiles,
  count(*) filter (where role = 'admin')::integer as fixture_admins,
  count(*) filter (where review_status = 'suspended')::integer as fixture_suspended
from public.profiles
where id in (${fixtures.map((id) => `${quoteLiteral(id)}::uuid`).join(', ')});
`
    const initialized = runSupabaseJson(
      ['db', 'query', '--linked', initializationSql.replace(/\s+/g, ' ').trim()],
      execFile,
    )
    const initializationRow = initialized?.rows?.[0]
    requireCondition(
      Number(initializationRow?.fixture_profiles) === 3 &&
        Number(initializationRow?.fixture_admins) === 1 &&
        Number(initializationRow?.fixture_suspended) === 1,
      'Production security fixture database initialization could not be confirmed.',
    )

    const firstAdmin = await signIn(firstAdminId)
    const member = await signIn(promotedAdminId)
    const suspended = await signIn(suspendedId)
    const anonymous = createClientImpl(environment.API_URL, environment.ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const anonymousPublic = await anonymous.from('public_members').select('*').in('id', fixtures)
    const anonymousProfiles = await anonymous.from('profiles').select('id').in('id', fixtures)
    const safePublicColumns = new Set([
      'id',
      'full_name',
      'grade',
      'major',
      'created_at',
      'updated_at',
    ])
    results.anonymousPublicViewSafe =
      !anonymousPublic.error &&
      anonymousPublic.data?.length === 2 &&
      anonymousPublic.data.some((row) => row.id === firstAdminId) &&
      anonymousPublic.data.some((row) => row.id === promotedAdminId) &&
      !anonymousPublic.data.some((row) => row.id === suspendedId) &&
      anonymousPublic.data.every((row) =>
        Object.keys(row).every((column) => safePublicColumns.has(column)),
      )
    results.anonymousProfilesHidden =
      Boolean(anonymousProfiles.error) || anonymousProfiles.data?.length === 0
    results.anonymousAdminRpcDenied = await expectRpcDenied(anonymous, 'admin_list_members')
    results.anonymousRuntimeSecretRpcsDenied =
      (await expectRpcDenied(anonymous, 'list_firecrawl_runtime_keys')) &&
      (await expectRpcDenied(anonymous, 'read_webchat_relay_runtime_config'))

    const serviceFirecrawlRuntime = await admin.rpc('list_firecrawl_runtime_keys')
    const serviceRelayRuntime = await admin.rpc('read_webchat_relay_runtime_config')
    results.serviceRuntimeRpcsAvailable =
      !serviceFirecrawlRuntime.error && !serviceRelayRuntime.error

    const ownProfile = await member
      .from('profiles')
      .select('id, role, review_status')
      .eq('id', promotedAdminId)
      .maybeSingle()
    const crossProfile = await member
      .from('profiles')
      .select('id')
      .eq('id', firstAdminId)
      .maybeSingle()
    results.memberOwnProfile = !ownProfile.error && ownProfile.data?.id === promotedAdminId
    results.memberCrossProfileDenied = !crossProfile.error && crossProfile.data === null
    results.memberAdminRpcDenied = await expectRpcDenied(member, 'admin_list_members')
    const memberAuditTable = await member.from('audit_logs').select('id').limit(1)
    results.memberAuditTableDenied = Boolean(memberAuditTable.error)
    results.memberFirecrawlRuntimeDenied = await expectRpcDenied(
      member,
      'list_firecrawl_runtime_keys',
    )
    results.memberRelayRuntimeDenied = await expectRpcDenied(
      member,
      'read_webchat_relay_runtime_config',
    )

    const suspendedOwn = await suspended
      .from('profiles')
      .select('id, full_name')
      .eq('id', suspendedId)
      .maybeSingle()
    const suspendedUpdate = await suspended
      .from('profiles')
      .update({ full_name: '不应生效的修改' })
      .eq('id', suspendedId)
      .select('id')
    const suspendedPublic = await suspended
      .from('public_members')
      .select('id')
      .eq('id', suspendedId)
    results.suspendedOwnProfileReadable =
      !suspendedOwn.error && suspendedOwn.data?.id === suspendedId
    results.suspendedWriteBlocked = !suspendedUpdate.error && suspendedUpdate.data?.length === 0
    results.suspendedAdminRpcDenied = await expectRpcDenied(suspended, 'admin_list_members')
    results.suspendedPublicProjectionHidden =
      !suspendedPublic.error && suspendedPublic.data?.length === 0

    const initialAdminDirectory = await firstAdmin.rpc('admin_list_members')
    results.initialAdminDirectory =
      !initialAdminDirectory.error &&
      fixtures.every((id) => initialAdminDirectory.data?.some((row) => row.id === id))
    requireCondition(
      results.initialAdminDirectory,
      'Temporary administrator directory access failed.',
    )

    const memberState = initialAdminDirectory.data.find((row) => row.id === promotedAdminId)
    const promote = await firstAdmin.rpc('admin_set_member_role', {
      expected_updated_at: memberState.updated_at,
      next_role: 'admin',
      reason: 'Controlled final production administrator handoff audit',
      target_profile_id: promotedAdminId,
    })
    requireCondition(!promote.error, 'Temporary administrator promotion failed.')

    const promotedDirectory = await member.rpc('admin_list_members')
    results.promotionVisibleToOldJwt =
      !promotedDirectory.error && promotedDirectory.data?.some((row) => row.id === firstAdminId)
    const firstAdminState = promotedDirectory.data?.find((row) => row.id === firstAdminId)
    requireCondition(
      results.promotionVisibleToOldJwt && firstAdminState,
      'Promoted administrator old JWT was not authorized from live profile state.',
    )

    const demote = await member.rpc('admin_set_member_role', {
      expected_updated_at: firstAdminState.updated_at,
      next_role: 'member',
      reason: 'Controlled final production administrator handoff audit',
      target_profile_id: firstAdminId,
    })
    requireCondition(!demote.error, 'Temporary administrator demotion failed.')
    results.demotionVisibleToOldJwt = await expectRpcDenied(firstAdmin, 'admin_list_members')
    const postDemotionDirectory = await member.rpc('admin_list_members')
    requireCondition(!postDemotionDirectory.error, 'Promoted administrator lost directory access.')

    const conversation = await firstAdmin.rpc('create_own_webchat_conversation')
    const conversationId = conversation.data?.[0]?.id
    requireCondition(
      !conversation.error && conversationId,
      'Demoted member could not create a private WebChat conversation.',
    )
    const ownConversation = await firstAdmin.rpc('get_own_webchat_conversation', {
      requested_conversation_id: conversationId,
    })
    const crossConversation = await member.rpc('get_own_webchat_conversation', {
      requested_conversation_id: conversationId,
    })
    const promotedOwnList = await member.rpc('list_own_webchat_conversations', {
      requested_limit: 31,
    })
    const promotedExport = await member.rpc('export_own_data')
    results.conversationOwnReadable =
      !ownConversation.error && ownConversation.data?.[0]?.id === conversationId
    results.adminCrossConversationDenied =
      Boolean(crossConversation.error) ||
      !crossConversation.data?.some((row) => row.id === conversationId)
    results.adminOwnListIsolated =
      !promotedOwnList.error && !promotedOwnList.data?.some((row) => row.id === conversationId)
    results.adminExportIsolated =
      !promotedExport.error && !JSON.stringify(promotedExport.data).includes(conversationId)

    const trainingGoalFixture = runSupabaseJson(
      [
        'db',
        'query',
        '--linked',
        `insert into public.training_goals (profile_id, title, metric, platform, baseline_value, baseline_components, target_value, start_date, end_date) values (${quoteLiteral(firstAdminId)}::uuid, 'Controlled production security audit', 'platform_solved', 'codeforces', 0, '{"codeforces":0}'::jsonb, 10, (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date, (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date + 30) returning id::text as goal_id;`,
      ],
      execFile,
    )
    const trainingGoalId = trainingGoalFixture?.rows?.[0]?.goal_id
    requireCondition(
      typeof trainingGoalId === 'string' && trainingGoalId.length > 0,
      'Could not create the controlled private training goal fixture.',
    )
    const ownTrainingGoal = await firstAdmin
      .from('training_goals')
      .select('id')
      .eq('id', trainingGoalId)
      .maybeSingle()
    const crossTrainingGoal = await member
      .from('training_goals')
      .select('id')
      .eq('id', trainingGoalId)
      .maybeSingle()
    const adminOwnTrainingGoals = await member.rpc('list_own_training_goals')
    results.trainingGoalOwnReadable =
      !ownTrainingGoal.error && String(ownTrainingGoal.data?.id) === trainingGoalId
    results.adminCrossTrainingGoalDenied =
      !crossTrainingGoal.error && crossTrainingGoal.data === null
    results.adminOwnTrainingGoalListIsolated =
      !adminOwnTrainingGoals.error &&
      !adminOwnTrainingGoals.data?.some((goal) => String(goal.goal_id) === trainingGoalId)

    const directAdminCrossProfile = await member
      .from('profiles')
      .select('id')
      .eq('id', firstAdminId)
      .maybeSingle()
    results.adminDirectMemberProfileAuthorized =
      !directAdminCrossProfile.error && directAdminCrossProfile.data?.id === firstAdminId
    const adminAuditTable = await member.from('audit_logs').select('id').limit(1)
    results.adminDirectAuditTableDenied = Boolean(adminAuditTable.error)
    results.adminFirecrawlRuntimeDenied = await expectRpcDenied(
      member,
      'list_firecrawl_runtime_keys',
    )
    results.adminRelayRuntimeDenied = await expectRpcDenied(
      member,
      'read_webchat_relay_runtime_config',
    )

    const boundedRow = postDemotionDirectory.data.find((row) => row.id === firstAdminId)
    results.adminUnlimitedRpcDenied = await expectRpcDenied(
      member,
      'admin_update_member_profile_unlimited',
      {
        expected_updated_at: boundedRow.updated_at,
        member_full_name: boundedRow.full_name,
        member_grade: boundedRow.grade ?? '24级',
        member_is_public: boundedRow.is_public,
        member_major: boundedRow.major ?? '计算机科学与技术',
        member_qq: boundedRow.qq ?? '100000001',
        target_profile_id: firstAdminId,
      },
    )

    assertSecurityChecks({
      ...results,
      oldJwtPrivateAccessRevoked: true,
      zeroAuth: true,
      zeroProfiles: true,
      zeroSyncJobs: true,
      zeroAuditUuidReferences: true,
    })

    runSupabaseJson(
      [
        'db',
        'query',
        '--linked',
        `update public.profiles set role = 'member' where id in (${fixtures
          .map((id) => `${quoteLiteral(id)}::uuid`)
          .join(', ')});`,
      ],
      execFile,
    )
    for (const id of fixtures) {
      if (!(await invokeDeletion(id))) {
        cleanupFallbacks += 1
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_500))
        requireCondition(await invokeDeletion(id), 'Controlled production fixture cleanup failed.')
      }
    }

    const oldJwtChecks = []
    for (const id of fixtures) {
      const client = clients.get(id)
      const ownAfterDelete = await client.from('profiles').select('id').eq('id', id)
      const writeAfterDelete = await client
        .from('profiles')
        .update({ full_name: '不应生效' })
        .eq('id', id)
        .select('id')
      const adminAfterDelete = await client.rpc('admin_list_members')
      oldJwtChecks.push(
        !ownAfterDelete.error &&
          ownAfterDelete.data?.length === 0 &&
          !writeAfterDelete.error &&
          writeAfterDelete.data?.length === 0 &&
          Boolean(adminAfterDelete.error),
      )
    }
    results.oldJwtPrivateAccessRevoked = oldJwtChecks.every(Boolean)

    const authGone = await Promise.all(fixtures.map(authAbsent))
    const profilesGone = await Promise.all(fixtures.map(profileAbsent))
    const jobs = await admin
      .from('sync_jobs')
      .select('id', { count: 'exact', head: true })
      .in('profile_id', fixtures)
    const auditRefs = await admin
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .or(fixtures.flatMap((id) => [`actor_id.eq.${id}`, `target_id.eq.${id}`]).join(','))
    results.zeroAuth = authGone.every(Boolean)
    results.zeroProfiles = profilesGone.every(Boolean)
    results.zeroSyncJobs = !jobs.error && (jobs.count ?? 0) === 0
    results.zeroAuditUuidReferences = !auditRefs.error && (auditRefs.count ?? 0) === 0
    assertSecurityChecks(results)
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    let cleanupError = null
    try {
      if (fixtures.length) {
        runSupabaseJson(
          [
            'db',
            'query',
            '--linked',
            `update public.profiles set role = 'member' where id in (${fixtures
              .map((id) => `${quoteLiteral(id)}::uuid`)
              .join(', ')});`,
          ],
          execFile,
        )
      }
      for (const id of fixtures) {
        if (!(await authAbsent(id))) {
          let deleted = await invokeDeletion(id)
          if (!deleted && !(await authAbsent(id))) {
            cleanupFallbacks += 1
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_500))
            deleted = await invokeDeletion(id)
          }
          if (!deleted && !(await authAbsent(id))) {
            throw new Error('A production security fixture could not be cleaned.')
          }
        }
      }
      const authGone = await Promise.all(fixtures.map(authAbsent))
      const profilesGone = await Promise.all(fixtures.map(profileAbsent))
      if (!authGone.every(Boolean) || !profilesGone.every(Boolean)) {
        throw new Error('Production security fixture cleanup could not be confirmed.')
      }
    } catch (error) {
      cleanupError = error
    }
    if (cleanupError) {
      if (primaryError) primaryError.message = `${primaryError.message}\n${cleanupError.message}`
      else throw cleanupError
    }
  }

  return {
    checksPassed: requiredSecurityChecks.length,
    assetCount,
    cleanupFallbacks,
    cleanupConfirmed: true,
  }
}

if (basename(process.argv[1] ?? '') === 'check-production-security-boundaries.mjs') {
  runProductionSecurityBoundaryCheck()
    .then((result) => {
      console.log(JSON.stringify({ ok: true, ...result }))
    })
    .catch((error) => {
      console.error(`Production security boundary audit failed: ${error.message}`)
      process.exitCode = 1
    })
}
