import { buildDenoArguments, parseSupabaseStatusEnv } from './check-sync-platform-outage.mjs'

describe('single-platform outage integration runner', () => {
  it('reads only the required local Supabase connection values', () => {
    expect(
      parseSupabaseStatusEnv(
        [
          'ANON_KEY="local-anon"',
          'API_URL="http://127.0.0.1:54321"',
          'SERVICE_ROLE_KEY="local-service"',
          'DB_URL="postgresql://ignored"',
        ].join('\n'),
      ),
    ).toMatchObject({
      ANON_KEY: 'local-anon',
      API_URL: 'http://127.0.0.1:54321',
      SERVICE_ROLE_KEY: 'local-service',
    })
  })

  it('fails closed when the local service credential is unavailable', () => {
    expect(() =>
      parseSupabaseStatusEnv('ANON_KEY="local-anon"\nAPI_URL="http://127.0.0.1:54321"'),
    ).toThrow(/SERVICE_ROLE_KEY/)
  })

  it('restricts Deno network access to the local Supabase API', () => {
    const args = buildDenoArguments()
    expect(args).toContain('--allow-net=127.0.0.1:54321,localhost:54321')
    expect(args.some((argument) => argument === '--allow-net' || argument === '-A')).toBe(false)
    expect(args.some((argument) => argument.includes('0.0.0.0'))).toBe(false)
  })
})
