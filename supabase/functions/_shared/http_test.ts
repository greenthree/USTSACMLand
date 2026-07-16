import { rejects, strictEqual } from 'node:assert/strict'
import { fetchTextWithRetry, HttpError } from './http.ts'

Deno.test(
  'fetchTextWithRetry keeps the timeout active while reading the response body',
  async () => {
    let bodyAborted = false
    const fetcher: typeof fetch = (_input, init) => {
      const signal = init?.signal
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              signal?.addEventListener(
                'abort',
                () => {
                  bodyAborted = true
                  controller.error(signal.reason)
                },
                { once: true },
              )
            },
          }),
        ),
      )
    }

    await rejects(
      fetchTextWithRetry('https://example.test/slow-body', {
        fetcher,
        timeoutMs: 10,
        retries: 0,
      }),
      (error: unknown) => error instanceof HttpError && error.code === 'timeout',
    )
    strictEqual(bodyAborted, true)
  },
)

Deno.test('fetchTextWithRetry cancels a body rejected by Content-Length', async () => {
  let cancelled = false
  const fetcher: typeof fetch = () =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true
          },
        }),
        { headers: { 'content-length': '2048' } },
      ),
    )

  await rejects(
    fetchTextWithRetry('https://example.test/oversized', {
      fetcher,
      maxResponseBytes: 1024,
      retries: 0,
    }),
    /size limit/,
  )
  strictEqual(cancelled, true)
})
