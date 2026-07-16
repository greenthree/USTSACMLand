function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export function resolveCorsOrigin(
  requestOrigin: string | null,
  configuredOrigins = Deno.env.get('ALLOWED_ORIGIN'),
): string | null {
  const configured = configuredOrigins?.trim() || '*'
  if (configured === '*') return '*'
  if (!requestOrigin) return null

  const normalizedRequestOrigin = normalizeOrigin(requestOrigin)
  if (!normalizedRequestOrigin) return null
  const allowedOrigins = configured
    .split(',')
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter((origin): origin is string => origin !== null)
  return allowedOrigins.includes(normalizedRequestOrigin) ? requestOrigin : null
}

export function corsHeaders(
  request?: Request,
  configuredOrigins = Deno.env.get('ALLOWED_ORIGIN'),
): Record<string, string> {
  const allowedOrigin = resolveCorsOrigin(request?.headers.get('origin') ?? null, configuredOrigins)
  return {
    ...(allowedOrigin ? { 'access-control-allow-origin': allowedOrigin } : {}),
    ...(allowedOrigin && allowedOrigin !== '*' ? { vary: 'Origin' } : {}),
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
  }
}

export function jsonResponse(
  body: unknown,
  status = 200,
  request?: Request,
  additionalHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      'content-type': 'application/json; charset=utf-8',
      ...additionalHeaders,
    },
  })
}
