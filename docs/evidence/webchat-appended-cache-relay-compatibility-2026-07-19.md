# WebChat 追加会话缓存兼容性证据（2026-07-19）

日期：2026-07-19（Asia/Shanghai）

## 目标

把原先两次字节完全相同的生产缓存探针升级为更接近成员使用方式的追加会话：第一轮发送超过 1024 Token 的用户消息，第二轮保留首轮用户消息并追加 assistant 与下一条 user 消息。只有第二轮返回 `input_tokens_details.cached_tokens > 0` 才算成功。

## 三次受控试验

每次运行都遵守 30 分钟数据库冷却，只手动触发一次，没有自动重试；脱敏 Artifact 不包含 Prompt、回复、成员身份、Base URL 或 API Key。

| GitHub Actions run                                                                  | 请求形状                                                                                        | 结果                  |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------- |
| [`29663216535`](https://github.com/greenthree/USTSACMLand/actions/runs/29663216535) | typed `input_text`，历史用户消息带 `prompt_cache_breakpoint`，省略请求级 `prompt_cache_options` | 首个上游请求 HTTP 400 |
| [`29664143722`](https://github.com/greenthree/USTSACMLand/actions/runs/29664143722) | 同一 typed 显式断点形状，并设置 `prompt_cache_options.mode=explicit`                            | 首个上游请求 HTTP 400 |
| [`29665061228`](https://github.com/greenthree/USTSACMLand/actions/runs/29665061228) | 普通 `role/content` 历史消息，省略显式缓存扩展，保留稳定 `prompt_cache_key`                     | 第二轮命中 1792 Token |

两份脱敏报告都由 Edge Function 对外映射为 HTTP 502、错误码 `upstream_http_error`，内部消息为 `Cache probe returned HTTP 400`。失败发生在第一轮，因此没有发送第二个上游请求，也没有产生缓存命中数据。

## 隐式追加缓存命中

PR [#87](https://github.com/greenthree/USTSACMLand/pull/87) 合并后，生产 `webchat` v15 与 `webchat-cache-probe` v7 均为 ACTIVE。第三次运行使用第一轮长用户消息，第二轮保留首轮并追加 assistant 与下一条 user 消息；两次请求并不相同。

| 请求   | 输入 Token | 输出 Token | 缓存输入 Token | Cache write Token |    时延 |
| ------ | ---------: | ---------: | -------------: | ----------------: | ------: |
| 第一次 |       2335 |          5 |              0 |                 0 | 1105 ms |
| 第二次 |       2356 |         17 |           1792 |                 0 | 5313 ms |

- 第二轮 `input_tokens_details.cached_tokens = 1792`，证明中转站能对追加会话的普通消息历史复用早期精确前缀。
- 两次合计 4691 输入 Token、22 输出 Token、4713 总 Token；生产探针账本按可信 Usage 结算 4713 Token。
- 第二轮时延高于第一轮，本次证据只验证缓存读取，不把时延作为性能承诺。
- `cache_write_tokens = 0`；非零 `cached_tokens` 已直接证明读取命中。

## 结论与剩余验收

两次试验的共同变量是 typed 消息内的 `prompt_cache_breakpoint`，请求级 mode 不同但均失败。当前生产中转站不兼容这一请求形状；不能再把失败解释为只缺少 `prompt_cache_options.mode=explicit`。

成员请求与探针使用普通 Responses `role/content` 历史消息，不发送不兼容的 `prompt_cache_breakpoint`。请求仍携带稳定 `prompt_cache_key`，第二轮保留第一轮的字节稳定消息前缀。后续流式对照发现请求级 `prompt_cache_options.mode=implicit` 与 `ttl=30m` 能让独立探针缓存键命中，但不能在验证生产缓存键对应渠道前直接推广到成员请求。

生产追加式探针已经命中，但它仍不能替代真实成员路径验收。最终 ROADMAP 条目需要真实授权成员在同一会话中发送超过 1024 Token 的长首轮并追加下一轮，在中转站日志和站内脱敏指标至少一次观察到 `cached_tokens > 0` 后才能勾选。
