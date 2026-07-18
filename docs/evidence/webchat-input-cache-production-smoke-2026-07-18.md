# WebChat 输入缓存生产命中证据（2026-07-18）

日期：2026-07-18（Asia/Shanghai）

## 发布范围

- 功能 PR：[#69](https://github.com/greenthree/USTSACMLand/pull/69)，合并提交 `49cfe822aa6b62c0c673164cf76a176de2e9ef75`。
- 鉴权修复 PR：[#70](https://github.com/greenthree/USTSACMLand/pull/70)，合并提交 `d8db2ab7b910a3b25c36565d67be14db42d5773e`。
- 生产数据库已应用第 51 个 migration：`202607180006_webchat_cache_probe_accounting.sql`，本地与远端 migration 列表一致。
- `webchat-cache-probe` Edge Function 已部署为 ACTIVE v2，JWT 验证与仓库 import map 均已启用。

生产探针只从 Supabase Vault 读取管理员已经保存的中转站 Base URL、模型与 API Key。GitHub Actions 不保存这三项值；探针不保存 Prompt、回复、请求 ID、Base URL、API Key 或成员身份，不扣成员额度，也不会自动重试。

## 自动门禁

- PR #69 CI run [`29649357798`](https://github.com/greenthree/USTSACMLand/actions/runs/29649357798)：PostgreSQL 17 从空库应用 51 个 migration，31 个 pgTAP 文件、779 项断言全部通过；Vitest、Edge Function、构建、格式、lint 和工作流静态门禁同时通过。
- PR #70 CI run [`29649871369`](https://github.com/greenthree/USTSACMLand/actions/runs/29649871369)：service-role 鉴权兼容修复及其回归测试通过。
- 两个 PR 的 Secret scan 均通过。

## 首次运行与鉴权修复

首次生产 run [`29649732022`](https://github.com/greenthree/USTSACMLand/actions/runs/29649732022) 在 Edge Function 内部鉴权阶段返回 `401`。Gateway 已经验证 GitHub 保存的 service-role JWT，但 Edge Runtime 注入的当前 Key 文本与该仍有效的 JWT 不完全相同。该次运行未取得数据库 claim、未发送模型请求、未产生模型费用或冷却。

PR #70 保留“与当前 Runtime Key 完全一致”的检查，同时接受 Gateway 已验证且 JWT Payload 明确为 `role=service_role` 的服务端令牌；普通 `authenticated` JWT 和带浏览器 `Origin` 的请求仍被拒绝。

## 真实缓存命中

手动工作流 run [`29650242439`](https://github.com/greenthree/USTSACMLand/actions/runs/29650242439) 只执行一次并成功，脱敏 Artifact 名为 `webchat-production-cache-probe-29650242439`。

| 请求   | 输入 Token | 输出 Token | 缓存输入 Token | Cache write Token |    时延 |
| ------ | ---------: | ---------: | -------------: | ----------------: | ------: |
| 第一次 |       2335 |          5 |              0 |                 0 | 3005 ms |
| 第二次 |       2335 |          5 |           1792 |                 0 | 2052 ms |

- 两次请求使用相同模型、相同 `prompt_cache_key` 和字节一致的 1024 Token 以上稳定前缀。
- 第二次 `input_tokens_details.cached_tokens = 1792`，满足生产命中条件 `cached_tokens > 0`。
- 两次合计 Usage 为 4670 输入 Token、10 输出 Token、4680 总 Token；全站账本最终结算 4680 Token。
- 本次 `cache_write_tokens = 0`，没有观察到非零写入计数；第二次返回 1792 个缓存输入 Token 已直接证明读取命中。
- 第二次时延比第一次减少 953 ms，约 31.7%；该变化只作为本次观测，不作为固定性能承诺。

## 结论

当前生产中转站能够透传稳定 `prompt_cache_key`、复用精确输入前缀，并把 Responses Usage 中的缓存输入 Token 映射回本站。WebChat 输入缓存条目可以完成；普通短对话仍可能因输入不足 1024 Token 而显示 `cached_tokens = 0`，这不代表缓存配置失效。

判定依据为 OpenAI 官方 [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching#best-practices)：稳定内容放在前缀、相同请求复用稳定 `prompt_cache_key`，并通过 `cached_tokens` 和 `cache_write_tokens` 观察缓存读写。

后续更换模型、中转站或系统提示词版本后，应在全站预算允许时重新手动执行一次同一探针；不要把它改成定时任务或自动重试。
