import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const requiredTriggerNames = [
  'auth_users_0_require_fenced_deletion',
  'auth_users_a_prepare_account_deletion',
  'on_auth_user_created',
]

function unquoteIdentifier(identifier) {
  return identifier.startsWith('"') && identifier.endsWith('"')
    ? identifier.slice(1, -1).replaceAll('""', '"')
    : identifier
}

export function extractAuthUserTriggers(source) {
  const statements = new Map()
  const triggerPattern = /^\s*CREATE\s+TRIGGER\s+("(?:[^"]|"")+"|[^\s]+)\s+[\s\S]*?;\s*$/gim

  for (const match of source.matchAll(triggerPattern)) {
    const name = unquoteIdentifier(match[1])
    if (!requiredTriggerNames.includes(name)) continue
    if (!/\bON\s+(?:"auth"|auth)\.(?:"users"|users)(?![A-Za-z0-9_])/i.test(match[0])) {
      throw new Error(`Required trigger ${name} is not attached to auth.users.`)
    }
    if (statements.has(name)) throw new Error(`Required trigger ${name} is duplicated.`)
    statements.set(name, match[0].trim())
  }

  const missing = requiredTriggerNames.filter((name) => !statements.has(name))
  if (missing.length > 0) {
    throw new Error(`Auth schema dump is missing required user triggers: ${missing.join(', ')}.`)
  }

  return [
    '-- USTS ACM Land application triggers attached to the Supabase-managed auth.users table.',
    '-- Extracted from the same production database as this encrypted backup.',
    ...requiredTriggerNames.map((name) => statements.get(name)),
    '',
  ].join('\n\n')
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2)
  if (!outputPath) {
    throw new Error(
      'Usage: node scripts/extract-auth-user-triggers.mjs <auth-schema.sql> <auth-hooks.sql>',
    )
  }

  const output = extractAuthUserTriggers(await readFile(resolve(inputPath), 'utf8'))
  await writeFile(resolve(outputPath), output, { mode: 0o600 })
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
