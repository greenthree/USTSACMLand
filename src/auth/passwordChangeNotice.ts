export type PasswordChangeNotice = 'success' | 'revocation-warning'

const passwordChangeNoticeKey = 'usts-acm-land-password-change-notice:v1'

export function storePasswordChangeNotice(notice: PasswordChangeNotice): void {
  sessionStorage.setItem(passwordChangeNoticeKey, notice)
}

export function consumePasswordChangeNotice(): PasswordChangeNotice | null {
  const notice = sessionStorage.getItem(passwordChangeNoticeKey)
  sessionStorage.removeItem(passwordChangeNoticeKey)
  return notice === 'success' || notice === 'revocation-warning' ? notice : null
}
