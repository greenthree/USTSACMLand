# Bundled image codecs

These WebAssembly files are copied from the exact npm packages pinned by
`webchat-attachment/image-normalizer.ts` and `supabase/functions/deno.lock`.
They are bundled with the Edge Function because Deno cannot turn an `npm:`
specifier into a readable file URL at runtime.
`supabase/config.toml` must keep the `webchat-attachment` `static_files` glob so
the Supabase deploy and local Edge Runtime copy these assets into the bundle.

| File                  | Package source                                     | SHA-256                                                            |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `mozjpeg_dec.wasm`    | `@jsquash/jpeg@1.6.0/codec/dec/mozjpeg_dec.wasm`   | `a7c4b12169817e779ff4af137981393ae924944e167ad1bd95747c9199162d3e` |
| `squoosh_png_bg.wasm` | `@jsquash/png@3.1.1/codec/pkg/squoosh_png_bg.wasm` | `263d6e658808a74b72a1a99c5cc1d619237e70c150db6e41d5d84d3d117ab9be` |
| `webp_dec.wasm`       | `@jsquash/webp@1.5.0/codec/dec/webp_dec.wasm`      | `30fb52fa2a80166d25ba7debf902218904ba1f05ccce9f959f722beff9e2f344` |
| `webp_enc.wasm`       | `@jsquash/webp@1.5.0/codec/enc/webp_enc.wasm`      | `b6085bb6702f144e9dc6016d58d230b34a84976bf0d080b7390b4b4b137d6ab7` |

The non-SIMD WebP encoder is intentional: it provides one deterministic,
portable production path instead of selecting a different binary at runtime.
Codec license notices are stored beside the binaries.

The real-codec Deno tests require static-file read access:

```sh
deno test --allow-read --config supabase/functions/deno.json \
  supabase/functions/webchat-attachment/image-normalizer_test.ts
```
