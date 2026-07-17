import { parseWebChatUiEnabled } from './chatAvailability'

describe('WebChat UI availability', () => {
  it('only enables the hidden route for an explicit true value', () => {
    expect(parseWebChatUiEnabled('true')).toBe(true)
    expect(parseWebChatUiEnabled(' TRUE ')).toBe(true)
    expect(parseWebChatUiEnabled('false')).toBe(false)
    expect(parseWebChatUiEnabled(undefined)).toBe(false)
    expect(parseWebChatUiEnabled('1')).toBe(false)
  })
})
