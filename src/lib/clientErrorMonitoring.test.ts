import { recordClientRuntimeError } from './clientErrorMonitoring'

describe('client runtime monitoring', () => {
  it('records only fixed categories without error text or stack data', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    recordClientRuntimeError('unhandled_rejection', new TypeError('private@example.com'))

    expect(consoleError).toHaveBeenCalledWith(
      JSON.stringify({
        version: 1,
        event: 'client_runtime_error',
        surface: 'unhandled_rejection',
        category: 'type_error',
      }),
    )
    expect(consoleError.mock.calls[0][0]).not.toContain('private@example.com')
    consoleError.mockRestore()
  })
})
