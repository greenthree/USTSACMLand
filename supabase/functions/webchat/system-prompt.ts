const MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/

export function buildWebChatSystemPrompt(basePrompt: string, model: string): string {
  const normalizedBasePrompt = basePrompt.trim()
  const normalizedModel = model.trim()
  if (!normalizedBasePrompt) throw new Error('WebChat system prompt is empty')
  if (!MODEL_PATTERN.test(normalizedModel)) {
    throw new Error('WebChat runtime model has an invalid format')
  }

  return `${normalizedBasePrompt}\n\n当前实际使用的模型标识是「${normalizedModel}」。当用户询问当前模型时，只能使用这个服务端提供的标识作答，不要声称自己是其他模型。`
}
