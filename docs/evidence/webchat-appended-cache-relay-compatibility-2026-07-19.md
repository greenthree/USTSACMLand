# WebChat 追加会话缓存兼容性证据（2026-07-19）

日期：2026-07-19（Asia/Shanghai）

## 目标

把原先两次字节完全相同的生产缓存探针升级为更接近成员使用方式的追加会话：第一轮发送超过 1024 Token 的用户消息，第二轮保留首轮用户消息并追加 assistant 与下一条 user 消息。只有第二轮返回 `input_tokens_details.cached_tokens > 0` 才算成功。

## 两次受控试验

两次运行都遵守 30 分钟数据库冷却，只手动触发一次，没有自动重试；脱敏 Artifact 不包含 Prompt、回复、成员身份、Base URL 或 API Key。

| GitHub Actions run                                                                  | 请求形状                                                                                        | 结果                  |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------- |
| [`29663216535`](https://github.com/greenthree/USTSACMLand/actions/runs/29663216535) | typed `input_text`，历史用户消息带 `prompt_cache_breakpoint`，省略请求级 `prompt_cache_options` | 首个上游请求 HTTP 400 |
| [`29664143722`](https://github.com/greenthree/USTSACMLand/actions/runs/29664143722) | 同一 typed 显式断点形状，并设置 `prompt_cache_options.mode=explicit`                            | 首个上游请求 HTTP 400 |

两份脱敏报告都由 Edge Function 对外映射为 HTTP 502、错误码 `upstream_http_error`，内部消息为 `Cache probe returned HTTP 400`。失败发生在第一轮，因此没有发送第二个上游请求，也没有产生缓存命中数据。

## 结论与恢复

两次试验的共同变量是 typed 消息内的 `prompt_cache_breakpoint`，请求级 mode 不同但均失败。当前生产中转站不兼容这一请求形状；不能再把失败解释为只缺少 `prompt_cache_options.mode=explicit`。

成员请求与探针恢复为此前生产已验证可以成功调用的普通 Responses `role/content` 历史消息，不发送 `prompt_cache_breakpoint` 或 `prompt_cache_options`。请求仍携带由模型和系统提示词版本派生的稳定 `prompt_cache_key`，第二轮仍保留第一轮的字节稳定消息前缀，由默认隐式缓存尝试复用。

本证据只确定参数兼容边界，不证明追加式隐式缓存已经命中。下一次探针必须等待固定 30 分钟冷却，并且只运行一次；最终 ROADMAP 条目仍需普通探针和真实授权成员会话至少一次观察到 `cached_tokens > 0` 后才能勾选。
