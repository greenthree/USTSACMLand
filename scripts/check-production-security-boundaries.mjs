import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomInt } from 'node:crypto'
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
  'anonymousAttachmentGatewayDenied',
  'anonymousImageCleanupGatewayDenied',
  'memberImageCleanupDenied',
  'memberImageUploadSafelyDisabled',
  'imageBucketPrivate',
  'imageStorageAccountingConsistent',
  'imageUploadsPaused',
  'imageObjectStoredPrivately',
  'imageOwnerHistoryRestored',
  'imageCrossMemberPreviewDenied',
  'imagePersonalExportSafe',
  'imageSignedPreviewWorks',
  'imageMessageDeletionQueued',
  'imageCleanupDeletedObject',
  'imagePostCleanupAccountingConsistent',
  'imageNoActiveResidueBeforeAccountDeletion',
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
  'zeroFixtureImageAttachments',
  'zeroFixtureImageObjects',
  'zeroFixtureImageDeletionQueue',
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

const safeImageExportFields = new Set([
  'mediaType',
  'bytes',
  'width',
  'height',
  'createdAt',
  'readyAt',
  'attachedAt',
  'deletedAt',
])

export function isSafeOwnImageAttachmentExport(
  payload,
  { expectedCount, expectedBytes = null, expectedWidth = null, expectedHeight = null },
) {
  const projection = payload?.webchat?.imageAttachments
  if (
    !projection ||
    typeof projection !== 'object' ||
    Array.isArray(projection) ||
    !Number.isSafeInteger(projection.count) ||
    projection.count !== expectedCount ||
    !Array.isArray(projection.items) ||
    projection.items.length !== expectedCount
  ) {
    return false
  }

  if (
    /https?:\/\/|urn:ustsacm:webchat-attachment:|webchat-images|object[_-]?key|sha256|conversation[_-]?id|message[_-]?id|validation[_-]?owner|last[_-]?error/i.test(
      JSON.stringify(projection),
    )
  ) {
    return false
  }

  for (const item of projection.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    if (Object.keys(item).some((field) => !safeImageExportFields.has(field))) return false
    if (
      item.mediaType !== 'image/webp' ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 1 ||
      !Number.isSafeInteger(item.width) ||
      item.width < 1 ||
      !Number.isSafeInteger(item.height) ||
      item.height < 1 ||
      typeof item.createdAt !== 'string' ||
      typeof item.readyAt !== 'string' ||
      typeof item.attachedAt !== 'string' ||
      (item.deletedAt !== undefined && typeof item.deletedAt !== 'string')
    ) {
      return false
    }
  }

  if (expectedCount === 0) return true
  return projection.items.some(
    (item) =>
      (expectedBytes === null || item.bytes === expectedBytes) &&
      (expectedWidth === null || item.width === expectedWidth) &&
      (expectedHeight === null || item.height === expectedHeight),
  )
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

async function readJsonResponse(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function errorCode(body) {
  return typeof body?.error?.code === 'string' ? body.error.code : null
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
  let imageAttachmentId = null
  let imageObjectKey = null

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

  const emergencyCleanupImageFixture = async () => {
    if (imageObjectKey) {
      const removed = await admin.storage.from('webchat-images').remove([imageObjectKey])
      if (removed.error) {
        throw new Error('Controlled image fixture object cleanup failed.')
      }
    }
    if (!imageAttachmentId) return
    const cleanupOwner = crypto.randomUUID()
    const cleanupSql = `
begin;
select 1 from private.webchat_global_quota_state where singleton for update;
with target as (
  select attachment.storage_allocation_bytes
  from private.webchat_image_attachments as attachment
  where attachment.id = ${quoteLiteral(imageAttachmentId)}::uuid
  for update
), transitioned as (
  update private.webchat_image_attachments as attachment
  set
    status = 'deleted',
    validation_owner_token = null,
    validation_lease_expires_at = null,
    deletion_requested_at = coalesce(attachment.deletion_requested_at, pg_catalog.clock_timestamp()),
    deleted_at = coalesce(attachment.deleted_at, pg_catalog.clock_timestamp()),
    storage_allocation_bytes = 0,
    updated_at = pg_catalog.clock_timestamp()
  where attachment.id = ${quoteLiteral(imageAttachmentId)}::uuid
  returning attachment.id
)
update private.webchat_global_quota_state as state
set
  image_storage_allocated_bytes = greatest(
    state.image_storage_allocated_bytes - coalesce((select target.storage_allocation_bytes from target), 0),
    0
  ),
  image_uploads_paused = true,
  updated_at = pg_catalog.clock_timestamp()
where state.singleton;
update private.webchat_image_deletion_outbox as queue
set
  claimed_by = coalesce(queue.claimed_by, ${quoteLiteral(cleanupOwner)}::uuid),
  lease_expires_at = null,
  completed_at = coalesce(queue.completed_at, pg_catalog.clock_timestamp()),
  updated_at = pg_catalog.clock_timestamp()
where queue.attachment_id = ${quoteLiteral(imageAttachmentId)}::uuid;
commit;
select
  (select count(*)::integer from private.webchat_image_attachments where id = ${quoteLiteral(imageAttachmentId)}::uuid and status <> 'deleted') as active_attachment,
  (select image_uploads_paused from private.webchat_global_quota_state where singleton) as uploads_paused;
`
    const cleanup = runSupabaseJson(
      ['db', 'query', '--linked', cleanupSql.replace(/\s+/g, ' ').trim()],
      execFile,
    )?.rows?.[0]
    requireCondition(
      Number(cleanup?.active_attachment) === 0 && cleanup?.uploads_paused === true,
      'Controlled image fixture database cleanup could not be confirmed.',
    )
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

    const attachmentUrl = `${environment.API_URL}/functions/v1/webchat-attachment`
    const imageCleanupUrl = `${environment.API_URL}/functions/v1/webchat-image-cleanup`
    const anonymousAttachmentResponse = await fetchImpl(attachmentUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: PRODUCTION_ORIGIN },
      body: JSON.stringify({ action: 'preview', attachmentId: crypto.randomUUID() }),
    })
    const anonymousImageCleanupResponse = await fetchImpl(imageCleanupUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: 1 }),
    })
    results.anonymousAttachmentGatewayDenied = [401, 403].includes(
      anonymousAttachmentResponse.status,
    )
    results.anonymousImageCleanupGatewayDenied = [401, 403].includes(
      anonymousImageCleanupResponse.status,
    )

    const memberSession = await firstAdmin.auth.getSession()
    const memberToken = memberSession.data.session?.access_token
    requireCondition(memberToken, 'Member session token is unavailable for image boundary checks.')
    const memberCleanupResponse = await fetchImpl(imageCleanupUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${memberToken}`,
        apikey: environment.ANON_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ limit: 1 }),
    })
    const memberCleanupBody = await readJsonResponse(memberCleanupResponse)
    results.memberImageCleanupDenied =
      memberCleanupResponse.status === 403 &&
      errorCode(memberCleanupBody) === 'service_role_required'

    const uploadForm = new FormData()
    uploadForm.set('action', 'upload')
    uploadForm.set('conversationId', conversationId)
    uploadForm.set(
      'file',
      new File(
        [
          Uint8Array.from(
            Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
              'base64',
            ),
          ),
        ],
        'controlled.png',
        { type: 'image/png' },
      ),
    )
    const memberUploadResponse = await fetchImpl(attachmentUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${memberToken}`,
        apikey: environment.ANON_KEY,
        origin: PRODUCTION_ORIGIN,
      },
      body: uploadForm,
    })
    const memberUploadBody = await readJsonResponse(memberUploadResponse)
    results.memberImageUploadSafelyDisabled =
      memberUploadResponse.status === 503 &&
      ['attachment_disabled', 'attachment_uploads_paused'].includes(errorCode(memberUploadBody))

    const bucket = await admin.storage.getBucket('webchat-images')
    results.imageBucketPrivate =
      !bucket.error &&
      bucket.data?.public === false &&
      Number(bucket.data?.file_size_limit) === 4_194_304 &&
      Array.isArray(bucket.data?.allowed_mime_types) &&
      bucket.data.allowed_mime_types.length === 1 &&
      bucket.data.allowed_mime_types[0] === 'image/webp'

    const imageAccounting = await admin.rpc('reconcile_webchat_image_storage_accounting')
    const imageAccountingRow = imageAccounting.data?.[0]
    results.imageStorageAccountingConsistent =
      !imageAccounting.error &&
      imageAccountingRow?.accounting_consistent === true &&
      Number(imageAccountingRow?.recorded_allocation_bytes) === 0 &&
      Number(imageAccountingRow?.attachment_allocation_bytes) === 0 &&
      Number(imageAccountingRow?.stored_object_bytes) === 0 &&
      Number(imageAccountingRow?.orphan_object_count) === 0 &&
      Number(imageAccountingRow?.missing_ready_object_count) === 0
    results.imageUploadsPaused = imageAccountingRow?.uploads_paused === true

    const webpBytes = Uint8Array.from(
      Buffer.from(
        'UklGRpoAAABXRUJQVlA4WAoAAAAQAAAAAgAAAQAAQUxQSAcAAAAA/////4D/AFZQOCBsAAAAUAQAnQEqAwACAADAEiWoAnS6AfgB+oFKA/ACtAP4BlAH6ADnVTqxTi77AAD+4pVX2n/ELe6//sAKEByNvhrYZf3f4s8O0kvut/8TWxOhwt/z8PDpnVd/+90//3gLi/CGOl3/pV5jHj/+mLAA',
        'base64',
      ),
    )
    const webpSha256 = createHash('sha256').update(webpBytes).digest('hex')
    imageAttachmentId = crypto.randomUUID()
    const imageValidationOwner = crypto.randomUUID()
    const imageMessageId = `security-image-${randomBytes(8).toString('hex')}`
    imageObjectKey =
      `user/${firstAdminId}/conversation/${conversationId}` +
      `/attachment/${imageAttachmentId}.webp`
    const lifecycleSetupSql = `
begin;
update private.webchat_global_quota_state
set image_uploads_paused = false, updated_at = pg_catalog.clock_timestamp()
where singleton;
select * from public.reserve_webchat_image_attachment(
  ${quoteLiteral(firstAdminId)}::uuid,
  ${quoteLiteral(conversationId)}::uuid,
  ${quoteLiteral(imageAttachmentId)}::uuid,
  'image/webp',
  ${webpBytes.byteLength}
);
select * from public.start_webchat_image_validation(
  ${quoteLiteral(firstAdminId)}::uuid,
  ${quoteLiteral(imageAttachmentId)}::uuid,
  ${quoteLiteral(imageValidationOwner)}::uuid,
  600
);
update private.webchat_global_quota_state
set image_uploads_paused = true, updated_at = pg_catalog.clock_timestamp()
where singleton;
commit;
select
  (select status from private.webchat_image_attachments where id = ${quoteLiteral(imageAttachmentId)}::uuid) as attachment_status,
  (select image_uploads_paused from private.webchat_global_quota_state where singleton) as uploads_paused;
`
    const lifecycleSetup = runSupabaseJson(
      ['db', 'query', '--linked', lifecycleSetupSql.replace(/\s+/g, ' ').trim()],
      execFile,
    )?.rows?.[0]
    requireCondition(
      lifecycleSetup?.attachment_status === 'validating' && lifecycleSetup?.uploads_paused === true,
      'Controlled image fixture validation setup failed.',
    )

    const storedObject = await admin.storage
      .from('webchat-images')
      .upload(imageObjectKey, webpBytes, {
        cacheControl: '0',
        contentType: 'image/webp',
        upsert: false,
      })
    requireCondition(!storedObject.error, 'Controlled image fixture Storage upload failed.')
    const completedImage = await admin.rpc('complete_webchat_image_validation', {
      requested_user_id: firstAdminId,
      requested_attachment_id: imageAttachmentId,
      requested_owner_token: imageValidationOwner,
      requested_object_bytes: webpBytes.byteLength,
      requested_width: 3,
      requested_height: 2,
      requested_sha256: webpSha256,
    })
    requireCondition(
      !completedImage.error && completedImage.data?.[0]?.status === 'ready',
      'Controlled image fixture validation completion failed.',
    )

    const anonymousObject = await anonymous.storage.from('webchat-images').download(imageObjectKey)
    const memberObject = await firstAdmin.storage.from('webchat-images').download(imageObjectKey)
    results.imageObjectStoredPrivately =
      Boolean(anonymousObject.error) && Boolean(memberObject.error)

    const imageUrn = `urn:ustsacm:webchat-attachment:${imageAttachmentId}`
    const storedMessage = await firstAdmin.rpc('upsert_own_webchat_message', {
      requested_conversation_id: conversationId,
      requested_message_id: imageMessageId,
      requested_parent_id: null,
      requested_format: 'ai-sdk/v6',
      requested_content: {
        role: 'user',
        parts: [
          { type: 'text', text: 'Controlled production image lifecycle audit' },
          { type: 'file', mediaType: 'image/webp', url: imageUrn },
        ],
      },
    })
    requireCondition(!storedMessage.error, 'Controlled image history fixture could not be stored.')

    const ownerImagePreview = await firstAdmin.rpc('read_own_webchat_image_attachment_preview', {
      requested_conversation_id: conversationId,
      requested_message_id: imageMessageId,
      requested_attachment_id: imageAttachmentId,
    })
    const crossImagePreview = await member.rpc('read_own_webchat_image_attachment_preview', {
      requested_conversation_id: conversationId,
      requested_message_id: imageMessageId,
      requested_attachment_id: imageAttachmentId,
    })
    const restoredHistory = await firstAdmin.rpc('load_own_webchat_messages', {
      requested_conversation_id: conversationId,
    })
    results.imageOwnerHistoryRestored =
      !ownerImagePreview.error &&
      ownerImagePreview.data?.[0]?.id === imageAttachmentId &&
      !restoredHistory.error &&
      restoredHistory.data?.some(
        (message) =>
          message.id === imageMessageId && JSON.stringify(message.content).includes(imageUrn),
      )
    results.imageCrossMemberPreviewDenied =
      !crossImagePreview.error && crossImagePreview.data?.length === 0

    const ownerImageExport = await firstAdmin.rpc('export_own_data')
    const crossMemberImageExport = await member.rpc('export_own_data')
    results.imagePersonalExportSafe =
      !ownerImageExport.error &&
      !crossMemberImageExport.error &&
      isSafeOwnImageAttachmentExport(ownerImageExport.data, {
        expectedCount: 1,
        expectedBytes: webpBytes.byteLength,
        expectedWidth: 3,
        expectedHeight: 2,
      }) &&
      isSafeOwnImageAttachmentExport(crossMemberImageExport.data, { expectedCount: 0 })

    const signedPreview = await admin.storage
      .from('webchat-images')
      .createSignedUrl(imageObjectKey, 30)
    requireCondition(
      !signedPreview.error && signedPreview.data?.signedUrl,
      'Controlled image fixture signed preview could not be created.',
    )
    const signedPreviewResponse = await fetchImpl(signedPreview.data.signedUrl, {
      headers: { 'cache-control': 'no-store' },
    })
    const signedPreviewBytes = new Uint8Array(await signedPreviewResponse.arrayBuffer())
    results.imageSignedPreviewWorks =
      signedPreviewResponse.status === 200 &&
      signedPreviewResponse.headers.get('content-type')?.split(';', 1)[0] === 'image/webp' &&
      signedPreviewBytes.byteLength === webpBytes.byteLength &&
      createHash('sha256').update(signedPreviewBytes).digest('hex') === webpSha256

    const deletedMessage = await firstAdmin.rpc('delete_own_webchat_messages', {
      requested_conversation_id: conversationId,
      requested_message_ids: [imageMessageId],
    })
    requireCondition(
      !deletedMessage.error && Number(deletedMessage.data) === 1,
      'Controlled image history fixture could not be deleted.',
    )
    const queuedImageSql = `
select
  count(*) filter (where queue.completed_at is null)::integer as open_jobs,
  count(*) filter (
    where queue.attachment_id = ${quoteLiteral(imageAttachmentId)}::uuid
      and queue.completed_at is null
      and queue.dead_lettered_at is null
      and queue.available_at <= pg_catalog.clock_timestamp()
  )::integer as fixture_open_jobs
from private.webchat_image_deletion_outbox as queue;
`
    const queuedImage = runSupabaseJson(
      ['db', 'query', '--linked', queuedImageSql.replace(/\s+/g, ' ').trim()],
      execFile,
    )?.rows?.[0]
    results.imageMessageDeletionQueued =
      Number(queuedImage?.open_jobs) === 1 && Number(queuedImage?.fixture_open_jobs) === 1

    const imageCleanupResponse = await fetchImpl(imageCleanupUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${environment.SERVICE_ROLE_KEY}`,
        apikey: environment.SERVICE_ROLE_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ limit: 1 }),
    })
    const imageCleanupBody = await readJsonResponse(imageCleanupResponse)
    const deletedObject = await admin.storage.from('webchat-images').download(imageObjectKey)
    results.imageCleanupDeletedObject =
      imageCleanupResponse.status === 200 &&
      imageCleanupBody?.claimed === 1 &&
      imageCleanupBody?.deleted === 1 &&
      imageCleanupBody?.retried === 0 &&
      imageCleanupBody?.deadLettered === 0 &&
      imageCleanupBody?.deadLettersOutstanding === false &&
      imageCleanupBody?.storageAccountingConsistent === true &&
      Boolean(deletedObject.error)

    const postCleanupAccounting = await admin.rpc('reconcile_webchat_image_storage_accounting')
    const postCleanupAccountingRow = postCleanupAccounting.data?.[0]
    results.imagePostCleanupAccountingConsistent =
      !postCleanupAccounting.error &&
      postCleanupAccountingRow?.accounting_consistent === true &&
      postCleanupAccountingRow?.uploads_paused === true &&
      Number(postCleanupAccountingRow?.recorded_allocation_bytes) === 0 &&
      Number(postCleanupAccountingRow?.attachment_allocation_bytes) === 0 &&
      Number(postCleanupAccountingRow?.stored_object_bytes) === 0 &&
      Number(postCleanupAccountingRow?.orphan_object_count) === 0 &&
      Number(postCleanupAccountingRow?.missing_ready_object_count) === 0

    const imageResidueSql = `
select
  (select count(*)::integer
   from private.webchat_image_attachments as attachment
   where attachment.user_id in (${fixtures.map((id) => `${quoteLiteral(id)}::uuid`).join(', ')})
     and attachment.status <> 'deleted')
    as active_fixture_image_attachments,
  (select count(*)::integer
   from storage.objects as object
   where object.bucket_id = 'webchat-images'
     and (${fixtures.map((id) => `object.name like ${quoteLiteral(`user/${id}/%`)}`).join(' or ')}))
    as fixture_image_objects,
  (select count(*)::integer
   from private.webchat_image_deletion_outbox as deletion
   join private.webchat_image_attachments as attachment on attachment.id = deletion.attachment_id
   where attachment.user_id in (${fixtures.map((id) => `${quoteLiteral(id)}::uuid`).join(', ')})
     and deletion.completed_at is null)
    as open_fixture_image_deletion_queue;
`
    const imageResidue = runSupabaseJson(
      ['db', 'query', '--linked', imageResidueSql.replace(/\s+/g, ' ').trim()],
      execFile,
    )?.rows?.[0]
    results.imageNoActiveResidueBeforeAccountDeletion =
      Number(imageResidue?.active_fixture_image_attachments) === 0 &&
      Number(imageResidue?.fixture_image_objects) === 0 &&
      Number(imageResidue?.open_fixture_image_deletion_queue) === 0

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
      zeroFixtureImageAttachments: true,
      zeroFixtureImageObjects: true,
      zeroFixtureImageDeletionQueue: true,
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
    const finalImageResidueSql = `
select
  (select count(*)::integer
   from private.webchat_image_attachments as attachment
   where attachment.user_id in (${fixtures.map((id) => `${quoteLiteral(id)}::uuid`).join(', ')}))
    as fixture_image_attachments,
  (select count(*)::integer
   from storage.objects as object
   where object.bucket_id = 'webchat-images'
     and (${fixtures.map((id) => `object.name like ${quoteLiteral(`user/${id}/%`)}`).join(' or ')}))
    as fixture_image_objects,
  (select count(*)::integer
   from private.webchat_image_deletion_outbox as deletion
   join private.webchat_image_attachments as attachment on attachment.id = deletion.attachment_id
   where attachment.user_id in (${fixtures.map((id) => `${quoteLiteral(id)}::uuid`).join(', ')}))
    as fixture_image_deletion_queue;
`
    const finalImageResidue = runSupabaseJson(
      ['db', 'query', '--linked', finalImageResidueSql.replace(/\s+/g, ' ').trim()],
      execFile,
    )?.rows?.[0]
    results.zeroFixtureImageAttachments = Number(finalImageResidue?.fixture_image_attachments) === 0
    results.zeroFixtureImageObjects = Number(finalImageResidue?.fixture_image_objects) === 0
    results.zeroFixtureImageDeletionQueue =
      Number(finalImageResidue?.fixture_image_deletion_queue) === 0
    assertSecurityChecks(results)
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    let cleanupError = null
    try {
      if (fixtures.length) {
        await emergencyCleanupImageFixture()
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
