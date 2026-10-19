# QOJ 诊断与洛谷 Firecrawl 候选迁移

后续结果：负责人批准后，洛谷已通过 PR #167 完成定向发布，单成员真实同步首次成功，生产为 `sync-member v67` / `sync-stats v47`。详见 [生产发布记录](./luogu-firecrawl-production-2026-10-19.md)。下文保留此前诊断与候选阶段的事实；全体洛谷自然日更仍待观察。

日期：2026-10-19（Asia/Shanghai）；下列数据库和 Actions 时间为 UTC。

## 范围和基线

负责人要求先研究 QOJ 失败，再将洛谷获取方式改为 Firecrawl。本轮完成生产只读诊断、公开页面/官方文档核对、本地实现和验证；未读取或回显任何真实凭据。负责人更新 QOJ Secret 后，执行了一次限定为单个已验证 QOJ 绑定的生产检查；没有批量重跑。

- 分支/起点：`codex/luogu-lentille-records` / `54a3a5ebe4c36a2dd88776e2fc9b53df696b3e20`。
- 远端 main：`61e245f8d679b45f3bd962d3894194f218201b4c`；[草稿 PR #167](https://github.com/greenthree/USTSACMLand/pull/167) 仍 OPEN，现有检查成功只覆盖旧提交。
- linked 项目：`qzggoqdmsvktrtnjislw`；本次检查时 `sync-member v66`、`sync-stats v46`，均 ACTIVE、JWT/import map 开启。
- 原有域名修复文档、维护交接、洛谷旧证据和 repository-readiness 改动保留。

## QOJ：已证实和未证实

1. [最近周更 38355749813](https://github.com/greenthree/USTSACMLand/actions/runs/38355749813)（10 月 13 日）在 QOJ 上出现 `auth_expired`、`unknown` 和一次 queued；XCPC ELO 正常继续。不能把整批失败当作调度停止。
2. 聚合 `sync_runs`，10 月共有 11 次 `auth_expired`，均为 `failureStage=login_submit`、`loginSubmitStep=observe_result`；另有 3 次限流、1 次 unknown。没有读取账号、成员 ID 或错误正文。
3. 将固定已知错误字符串在 SQL 内转换为枚举再聚合，9 月 29 日至 10 月 13 日共 17 次属于 `QOJ service-account login failed`，`authTarget=qoj`。没有命中适配器专门识别的凭据拒绝分支。该通用分支只证明仍在登录页或没有确认 `Logout`，并不证明密码错误、2FA 或 Firecrawl Key 到期。
4. QOJ 最近成功为 `2026-09-22 04:15:09.636+00`。5 个生产 Key 均启用且 `healthy`、最近错误为空；10 月 19 日最新额度观察为 `00:55:23.249936+00`，最小剩余额度 992。这个状态不能证明 QOJ 服务登录可用。
5. 本轮通过 Firecrawl 正常读取公开登录页，仍有 `#form-login`、`#input-username`、`#input-password`、`#button-submit` 和 `.help-block`，公开脚本仍将凭据拒绝显示为固定英文消息。未提交表单，不以无凭据页面冒充登录验收。

因此已将故障缩小到“提交后的登录结果未确认”，无法从现有脱敏日志继续区分登录响应/跳转、观察窗口或其他上游行为。下一步应在单独批准的一次受控 QOJ 登录中观察固定状态枚举、表单提交响应类别和会话清理，不先换密码、不重复提交或绕过挑战。QOJ 源码本轮未改。

## 洛谷获取契约和实现

[最近日更 39182780261](https://github.com/greenthree/USTSACMLand/actions/runs/39182780261)（10 月 19 日）仍有 6 项 `luogu/source_unavailable`，其余平台继续。洛谷最近成功为 `2026-09-10 14:57:50.177+00`；生产仍未恢复。

本轮正常抓取公开记录页，确认存在唯一 `script#lentille-context[type="application/json"]`，顶层字段为 `instance/template/status/locale/data/user/time`；未登录响应为 `template=error`、`status=401`、`data.errorCode=401`、`UserUnloginException`。这证明凭据仍必要，不证明生产 Cookie 过期；没有抓取认证成员记录。记录列表字段契约沿用已核实的 Lentille 客户端与严格 parser，成功分页仍需认证烟测确认。

- 新获取层调用 Firecrawl `/v2/scrape`，传入专用 Cookie/CSRF，读取 `rawHtml`，禁用缓存、不建持久 profile、不使用增强代理/交互会话、无应用内联重试。
- 严格核对页面状态、UID、页码、`status=12` 与唯一上下文；丢弃查看者对象和其他上下文，只向增量层返回记录 ID、时间、状态与 PID。
- Accepted P/B 去重、精确记录游标、受限重建、30 天校准、分页上限、失败保留与数据库原子提交继续由原逻辑负责。来源版本为 `luogu-firecrawl-lentille-pb-v6`。
- 新 migration `202610190001_luogu_firecrawl_key_pool.sql` 扩展既有 Key 池和一次性 claim；同一个 attempt 的全部分页使用同一个 Key，不能失败后再选一个。洛谷上游错误与 Firecrawl 认证/限流分开，避免误停 Key。
- `sync-stats` 的首批额度检查覆盖洛谷；隐私页、`PRIVACY.md`、来源说明、README 和 [ADR 0009](../adr/0009-luogu-firecrawl-record-pages.md) 同步更新。关闭缓存不等于供应商零保留；首次全量/校准按页增加成本和耗时。

官方契约来源：[Firecrawl REST source of truth](https://docs.firecrawl.dev/agent-source-of-truth/curl)，本轮重新读取；使用其 `rawHtml`、自定义 headers、metadata 和缓存选项。公开抓取缓存和截图均位于忽略目录，不提交。

## 验证

- 定向 Edge 回归：71 项通过；完整 Edge：505 通过、1 个需要本地服务的集成测试默认 ignored。
- 对本轮公开抓取的真实未登录 HTML 运行候选 parser，确认为 `auth_expired/authTarget=luogu`；未将其当成成功分页或认证恢复证明。
- 独立执行本地 outage 集成检查：两个阶段均通过，`fixtureCleaned=true`；覆盖失败保留、最多一次重试及跨平台隔离。
- 本地 PostgreSQL 17 成功应用新 migration，完整 pgTAP：52 个文件、1261 项断言通过；公开 Schema warning-level lint 通过。
- 更新新增 SQL 测试的连续编号及 CI 库存断言（52 文件/1261 断言）；不降低门禁。
- Deno 类型检查、153 文件 lint、前端 lint、生产构建与 bundle gate、同步/CI workflow 静态检查通过。
- 全仓 Vitest：107 文件、670 项通过；最终格式/diff 复核通过。
- 内置浏览器：本地 `/privacy` 正确显示 10 月 19 日日期和新披露，1440×1000、390×844、1920×1080 均无页面级横向溢出；未出现加载/框架错误覆盖层，控制台 error/warn 为空。实际滚动到“第三方服务”确认披露完整可读。截图：`.codex-tmp/luogu-firecrawl-privacy-{desktop,mobile}-20261019.png`；viewport override 已复原。
- 本地预览与测试服务在核验后停止，原有本地数据库保留在 Docker volume；集成测试夹具已清理。没有变动生产服务。

## 生产边界与下一步

本轮授权落实诊断和仓库修改，并完成一次单成员 QOJ 受控检查。未提交、推送或更新 PR，未将生产洛谷 Cookie/CSRF 发送给 Firecrawl，未执行本地候选 migration 或函数发布。QOJ 单成员同步成功；洛谷仍保留旧统计并失败关闭，未宣称洛谷恢复。

发布前收口核对：生产 `supabase_migrations.schema_migrations` 最新为 `202608090001_retire_webchat_mutations`；本地待应用集合包含既有 `202609080001_auth_captcha_control.sql` 和本次 `202610190001_luogu_firecrawl_key_pool.sql`。整批 `db push --dry-run` 因生产 Postgres TLS 超时未完成，没有写入。此前将 Auth 视为洛谷必需前置不准确：已在与生产一致的 76 迁移隔离库上，成功独立应用仅洛谷迁移并通过 188 项相关断言、事务回滚和重放拒绝。Auth 不在本次范围；现有 HTTPS CLI 管理通道可正常只读核对，定向迁移事务及精确回滚包已准备，见 [仅洛谷发布准备](../luogu-firecrawl-release-2026-10-19.md)。生产函数仍为 `sync-member v66` / `sync-stats v46`，未发布候选。

受控检查 run：[39217938997](https://github.com/greenthree/USTSACMLand/actions/runs/39217938997)（2026-10-19 07:44 UTC）使用 `scope=member`，实际覆盖同一成员的六个平台。QOJ、Codeforces、牛客、AtCoder 和 XCPC ELO 成功，只有洛谷为 `source_unavailable`；QOJ 没有排队重试或失败记录。该范围超出了原定 QOJ 单平台检查；本轮已在候选中补齐 member 请求的 `platforms` 过滤，拒绝无效/空过滤，防止洛谷烟测再次扩大为全部平台。同步作业对账显示该次没有 queued/running；本记录不保存成员 UUID 或 QOJ 用户名。

上线前需要明确批准新增的凭据流向、migration、函数和受控烟测；应用顺序与兼容回滚见 ADR。现有 Auth migration/预检限制应另行解决，不能运行包含网络安全探测的完整 checker 或为了通过而放宽门禁。QOJ 一次受控登录是单独诊断范围，不应捆绑为批量重跑。

```text
任务：QOJ 只读研究；洛谷改为 Firecrawl 候选。
当前分支 / 提交：codex/luogu-lentille-records / 54a3a5e（新改动未提交）。
已完成：聚合诊断、公开契约核对、获取层/Key 池迁移、回归与隐私文案。
生产状态：QOJ 更新 Secret 后单成员检查成功；洛谷仍失败，尚未发布 Firecrawl 候选。
未提交或用户已有改动：本轮相关文件与起始工作区的 6 项原有文档/脚本变更均保留。
遗留风险：QOJ 只完成一个成员的成功检查，仍需自然周更；洛谷认证分页、凭据转发、Edge 时间和额度尚未生产验收；Postgres 直连未恢复，HTTPS 通道的定向发布方案待批准。
下一步：按仅洛谷范围取得提交/发布批准，CI 通过后执行独立迁移、隐私披露和两个消费者发布，再只同步一个成员的洛谷。
需要项目负责人输入或批准：上述生产及凭据流转范围；如需新 Secret，由负责人直接输入供应商控制台。
```
