# 洛谷 Firecrawl 逐请求 Key 轮换（2026-10-19）

状态：实现与本地验证已完成，负责人已明确批准本轮提交/合并、仅新增迁移、`sync-member` 部署与一次单成员洛谷验证，正在执行；实际结果另行补充。

## 需求与当前事实

负责人确认 API Key 来自不同 Firecrawl 团队，明确要求每调用一次 API 就轮换。只读核对生产：共配置 7 个 Key，目前 6 个启用、健康且可选，1 个停用；启用 Key 的优先级范围为 1–7。没有读取凭据、改动 Key 配置或启用停用项。候选不把 Key 数量写死为 7，新增合格 Key 后自动参与。

批准后于 14:01 UTC 再核对：7 个 Key 已全部启用；该配置变化发生在本轮执行前，Agent 未改动 Key。生产迁移集合仍为 77 个，集合 MD5 为 `f7f4d2cce1b8bd49e8c1191197dae87e`，selector 函数体 MD5 为 `0405aeb80ac6c135399a980fb0072f38`，当前没有 queued/running 洛谷任务。

生产仍为 77 个迁移、`sync-member v67` / `sync-stats v47`，选择器源码与上一轮已发布版本一致。旧实现每个 attempt 固定一个 Key，并先按优先级排序，因此分页多时会一直使用最高优先级 Key。当前生产版本有真实单成员成功，也有后续 429，不能宣称全体恢复。

## 修改

- `createRuntimeLuoguAdapter` 每次实际 `/v2/scrape` 前重新选 Key，并使用 `<attempt-operation>:request:<n>` 唯一 claim。重建时再次读取相同页也有新的请求序号，不能用页码代替序号。每次结果只观察实际使用的那个 Key。
- 新迁移 `202610190002_luogu_firecrawl_request_rotation.sql` 只调整洛谷排序：最久未使用优先，时间相同再按已有 priority/id 排序。QOJ/牛客保持现有优先级策略和 QOJ 每次 attempt 一个 Key 的边界。
- 继续跳过停用、认证失败、冷却中、零额度 Key。只有一个合格 Key 时复用；没有合格 Key 时失败关闭，不回退到环境 Key。
- 429 或任意分页失败立即停止本次 attempt，不选择另一个 Key 重发；仍由既有队列最多重试一次。Cookie/CSRF、basic proxy、禁用缓存、分页间隔、并发上限、P/B 口径、游标和原子提交均保持原契约。
- 同时包含上一轮未发布的 Firecrawl 429 服务来源/文案修正；不记录供应商原始错误正文，也不把轮换当作限流原因已查明。

## 验证

- 新 SQL 回归在旧 77 迁移隔离基线上先失败：7 个不同优先级 Key 实际只选中 1 个，复现原问题。
- 在同一隔离库只应用新迁移，未安装生产尚缺的 Auth CAPTCHA migration；18 项新断言全部通过，验证 7 个 Key 两轮轮换、14 个独立 claim、重放拒绝、不可用 Key 跳过、冷却与 QOJ/牛客兼容。
- 4 个相关 pgTAP 文件合计 **100 项断言通过**，覆盖 Key 管理、旧洛谷 purpose、逐请求轮换和 service 权限；公开 Schema warning-level lint 通过。
- 完整 Edge 测试 **510 通过、1 ignored**；真实平台停机集成用例仍为既有 ignored，未声称本次执行。
- `sync-member` / `sync-stats` 类型检查、相关 Deno lint、Prettier 和 diff 检查通过。没有前端渲染改动，不新增浏览器烟测。

## 已批准的生产范围

1. 提交本轮代码、前向迁移、回归、文档；推送新 PR，完整 CI / Secret Scan 通过后合并，按受保护 Pages 链路等待 main、Pages 和生产榜单审计终态。
2. 仅应用 `202610190002`，预先核对真实 77 迁移集合、旧 selector 源码摘要，在同一事务更新函数与真实迁移历史；不使用整批 db push，不应用 Auth CAPTCHA。
3. 只部署 `sync-member`，`sync-stats` 不执行这个轮换消费者，无需部署；下载源码核对并记录版本、JWT/import map。
4. 使用一个既有洛谷绑定做一次 `scope=member, platforms=luogu` 受控同步，保持一次持久队列重试上限；核对逐请求 claim、不同 Key 使用、完整统计与队列终态。若该成员只需一页，不能以该结果声称生产已验证跨页轮换。

负责人已按上述范围明确批准；Agent 接回完整执行和终态核对，不再重复请求确认。不改动 Key 启用状态或凭据，不新增其他平台请求或安全探测。

## 回滚

保留本轮前 `sync-member v67` 的独立源码包，只回滚消费者并核对。新 selector 对旧消费者兼容，回滚时保留前向迁移、claim 和统计，不回写已发布 migration。QOJ/牛客选择规则未变。

```text
任务：洛谷每次 API 请求轮换 Firecrawl Key。
当前分支 / 提交：codex/luogu-request-key-rotation / 4f27c2a，候选待提交。
已完成：逐请求领取、洛谷 LRU 迁移、429 来源修正、回归和文档。
验证：完整 Edge 510 pass / 1 ignored；隔离生产基线相关 pgTAP 100；类型、lint、格式和 Schema lint。
生产状态：Agent 尚未更改；7 个配置、批准后核对为 7 个启用；77 个 migration；sync-member v67 / sync-stats v47。
未提交或用户已有改动：本轮任务文件；此前域名、交接和 readiness 脚本改动保留。
遗留风险：当前 429 的具体供应商原因尚无充分证据；真实跨页轮换待获批发布后验证。
下一步：按上述定向范围发布并验收。
需要项目负责人输入或批准：无；本轮范围已明确批准。
```
