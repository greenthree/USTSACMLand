export function parseWebChatUiEnabled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true'
}

export const webChatUiEnabled = parseWebChatUiEnabled(import.meta.env.VITE_WEBCHAT_UI_ENABLED)
