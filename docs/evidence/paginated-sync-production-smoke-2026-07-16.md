# 计划同步游标分页生产烟测（2026-07-16）

## 范围

- 仓库提交：`a32e5f03a3815ecdcba4e68ef4be5a615ac8a5c8`
- Pull Request：[#38](https://github.com/greenthree/USTSACMLand/pull/38)
- GitHub Actions run：[`29506050543`](https://github.com/greenthree/USTSACMLand/actions/runs/29506050543)
- 同步范围：AtCoder、牛客、洛谷、XCPC ELO、QOJ
- Edge Function：合并后使用仓库 `supabase/functions/deno.json` 显式 import map 部署的 `sync-stats`

本文只记录聚合结果，不包含成员 ID、姓名、平台账号、任务 ID、Firecrawl Job ID、凭据或第三方响应正文。

## 结果

工作流从第一页持续执行到第 10 页，最后一页返回 `hasMore=false`。每页最多处理 3 个已验证平台账号，共处理 30 个目标：

| 平台     | 请求 | 成功 | 失败 |
| -------- | ---: | ---: | ---: |
| AtCoder  |    6 |    6 |    0 |
| 牛客     |    6 |    6 |    0 |
| 洛谷     |    6 |    6 |    0 |
| XCPC ELO |    6 |    6 |    0 |
| QOJ      |    6 |    2 |    4 |
| 合计     |   30 |   26 |    4 |

关键结论：

- 10 个游标页均收到正常 HTTP 2xx/207 响应，没有再次出现旧版五平台请求的 Supabase HTTP 546 网关超时。
- 第一页存在业务失败后，工作流仍继续执行剩余 9 页；所有页完成后才统一以失败状态结束，没有让前一页故障阻止后续平台。
- 六个牛客目标均成功，证明原先因六个牛客账号串行导致的单次 Edge 请求时限问题已由三账号分页规避。
- QOJ 共请求 6 次，与 6 个已绑定目标一致；没有传输层自动重试或重复创建任务。四个 QOJ 业务失败保留最后成功值，未影响其他平台和后续页。
- Actions 日志只包含同步范围、平台、请求/成功/排队/失败计数和 `hasMore`，未输出身份或账号信息。

## 发现与后续修正

本次 run 暴露一处日志可观测性缺口：`sync-member` 以 HTTP 207 返回内层失败时，原日志筛选只检查非 2xx 顶层状态，因此能显示失败计数但没有输出结构化错误码。后续修正把 `body.status == "failed"` 也纳入筛选，仍只输出平台和标准错误码，不输出原始错误文本。为遵守 QOJ 不自动重试约束，本次没有为了补日志而再次触发 QOJ。

## 验收判断

计划同步的稳定游标分页、页间继续、最终聚合失败、QOJ 单次尝试和日志脱敏均获得生产证据。QOJ 的四个业务失败属于独立的数据源健康问题；密码错误、Cloudflare、限流和告警投递的受控生产演练仍按 ROADMAP 保持未完成。
