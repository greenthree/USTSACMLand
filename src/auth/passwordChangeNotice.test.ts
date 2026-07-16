import { consumePasswordChangeNotice, storePasswordChangeNotice } from './passwordChangeNotice'

describe('password change notice', () => {
  beforeEach(() => sessionStorage.clear())

  it('is consumed exactly once', () => {
    storePasswordChangeNotice('success')
    expect(consumePasswordChangeNotice()).toBe('success')
    expect(consumePasswordChangeNotice()).toBeNull()
  })

  it('rejects unknown stored values', () => {
    sessionStorage.setItem('usts-acm-land-password-change-notice:v1', 'unknown')
    expect(consumePasswordChangeNotice()).toBeNull()
  })
})
