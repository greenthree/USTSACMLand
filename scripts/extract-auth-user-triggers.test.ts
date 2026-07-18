import { extractAuthUserTriggers } from './extract-auth-user-triggers.mjs'

const authSchema = `
CREATE TRIGGER auth_internal_trigger AFTER UPDATE ON auth.users
FOR EACH ROW EXECUTE FUNCTION auth.internal_handler();

CREATE TRIGGER auth_users_a_prepare_account_deletion BEFORE DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.prepare_auth_user_deletion();

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER auth_users_0_require_fenced_deletion BEFORE DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.require_fenced_auth_user_deletion();
`

describe('Auth user trigger extraction', () => {
  it('keeps only the three application triggers in a deterministic order', () => {
    const output = extractAuthUserTriggers(authSchema)

    expect(output).not.toContain('auth_internal_trigger')
    expect(output.match(/CREATE TRIGGER/g)).toHaveLength(3)
    expect(output.indexOf('auth_users_0_require_fenced_deletion')).toBeLessThan(
      output.indexOf('auth_users_a_prepare_account_deletion'),
    )
    expect(output.indexOf('auth_users_a_prepare_account_deletion')).toBeLessThan(
      output.indexOf('on_auth_user_created'),
    )
  })

  it('accepts quoted Auth identifiers', () => {
    expect(
      extractAuthUserTriggers(authSchema.replaceAll('auth.users', '"auth"."users"')),
    ).toContain('"auth"."users"')
  })

  it('fails closed when a required trigger is missing or attached elsewhere', () => {
    expect(() =>
      extractAuthUserTriggers(
        authSchema.replace(
          /CREATE TRIGGER on_auth_user_created[\s\S]*?public\.handle_new_user\(\);/,
          '',
        ),
      ),
    ).toThrow(/on_auth_user_created/)
    expect(() =>
      extractAuthUserTriggers(
        authSchema.replace(
          'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users',
          'CREATE TRIGGER on_auth_user_created AFTER INSERT ON public.profiles',
        ),
      ),
    ).toThrow(/not attached to auth\.users/)
  })
})
