# 仅洛谷 Firecrawl 发布准备（2026-10-19）

状态：本次批准的发布已完成。PR #167 已合并；仅洛谷迁移、隐私说明和两个同步函数已上线，单成员洛谷真实验收首次成功。完整提交、运行编号和对账见 [生产发布记录](./evidence/luogu-firecrawl-production-2026-10-19.md)，全体自然日更仍待观察。下文保留发布前准备与执行方案作为审计记录。

## 范围

- 数据库：只应用 `202610190001_luogu_firecrawl_key_pool.sql`，扩展既有 Firecrawl Key 池的 `luogu` purpose 与一次性领取约束；原 RPC 签名、service-only 权限、QOJ 和牛客契约保持兼容。
- Edge：只发布 `sync-member`（洛谷获取）与 `sync-stats`（额度检查、单成员平台过滤）。
- Pages：只同步本轮隐私披露及相关文档；专用洛谷 Cookie/CSRF 将由服务端发送给 Firecrawl，抓取逐页消耗额度，关闭页面缓存不保证供应商零保留。
- 烟测：一个经过负责人明确批准的既有洛谷绑定，`scope=member` 且 `platforms=["luogu"]`。一次提交，瞬时可恢复错误仍按现有规则最多一次持久队列重试；不手工重复触发。

`202609080001_auth_captcha_control.sql` 与洛谷迁移、两个消费者没有依赖；本次不安装该迁移，不部署 `auth-captcha-config`，不要求新增 Management Secret。其既有缺口继续作为全站发布风险保留，不把仅洛谷验收写成完整 readiness 或正式版本发布通过。

## 独立验证的证据

1. 生产 HTTPS 管理通道只读核对：76 个 migration，与本地截至 `202608090001` 的版本集合完全一致，集合 MD5 为 `47c4a16510cb9bb9f692fc636f424905`。
2. 生产现有两个 Key 池函数的函数体与 `202607190002` 仓库源码匹配：selector 为 `6adca7a65dc960a15505443015d2c537`，observation 为 `04b74f3afba8dbfe6cfd2aaa3387126b`。这些是非敏感源码摘要，不是凭据摘要。
3. 新建隔离本地 PostgreSQL 17 项目 `usts-luogu-isolated-20261019`，从空库只应用这 76 个历史 migration，未安装 Auth CAPTCHA migration。
4. 在上述基线上执行本轮精确迁移及历史记录事务，结果为 **77 个迁移、Auth 迁移 0、洛谷迁移 1**；证明其没有 Auth 数据库依赖。
5. 受控本地故障放在提交前：故障后仍为 76 个迁移，两项新增迁移记录均为 0；再次正常执行成功；重放事务因基线不符被拒绝。没有重复迁移或部分提交。
6. 独立库 9 个相关 pgTAP 文件、188 项断言通过：洛谷幂等、其他平台原子提交、作业完成、队列调度、Key 池、Schema lint、平台隔离、service 权限及新 purpose。公开 Schema warning-level lint 通过。
7. 全仓 Schema 的既有完整 pgTAP 验证为 52 文件、1261 项通过，其中包含本地 Auth migration。独立生产基线上不能声称全套通过：测试 15 的目录矩阵显式引用尚未发布的 Auth RPC，本轮保留该测试，没有删减或修改它来放行。
8. 修正单成员过滤后，相关 Edge 回归 77 项通过，完整 Edge **507 通过 / 1 ignored**，两个消费函数类型检查、Deno lint、前端 lint、格式、CI/sync workflow 静态检查通过。之前的 670 项 Vitest、构建和三屏隐私页核验未受该服务端过滤修正影响。

同步 workflow 还通过 actionlint/ShellCheck；显式提供但规范化后为空的平台筛选会在发送请求前拒绝。隔离数据库服务已停止，Docker volume 与本地审阅材料保留，所有本地测试均未执行生产同步。

## 连接路径与迁移文件

普通 `migration list` / `db push --dry-run` 的 Postgres 直连仍超时；正常重新 link 后也未恢复，DoH 解析没有取得有效地址。未修改系统代理、DNS 或供应商网络规则。现有 `supabase db query --linked` 使用 HTTPS Management API，可正常完成上述只读核对。

候选已生成以下本地审阅材料（忽略目录，不提交）：

- `.codex-tmp/prepare-luogu-release-20261019.mjs`：从仓库原文件生成材料，不读取任何凭据，不执行生产写操作。
- `.codex-tmp/luogu-release-20261019/manifest.json`：候选文件摘要、目标项目、明确排除项。
- `.codex-tmp/luogu-release-20261019/apply-only-luogu.sql`：基线检查、仓库精确迁移、真实迁移历史记录和权限复核处于同一事务；提交前清理 SQL 文件末尾空行后重新生成，SHA-256 为 `17e23739aa0c250e4eae75c7f2aea09fe5f73c12e609c9d42acd12df91140e66`。
- 源迁移规范化换行后的 SHA-256 为 `284eef682a5446331208896217a54f7355a4a24a79a54271c204db154078f85e`；逻辑与已测试候选一致。

授权后可通过已经登录的 CLI 执行这一份事务文件，使用绝对文件路径：

```powershell
$luoguReleaseSql = Join-Path (Get-Location) '.codex-tmp/luogu-release-20261019/apply-only-luogu.sql'
Get-FileHash -Algorithm SHA256 -LiteralPath $luoguReleaseSql
npx --yes supabase@2.109.1 db query --linked --file $luoguReleaseSql
```

这是本次明确申请批准的定向迁移执行方式，不在 SQL Editor 手工粘贴，不伪造 Auth migration 完成状态，不执行整批 `db push`。本地已验证同一事务的 PostgreSQL 执行、回滚与重放拒绝；生产写入尚未执行。应用前必须再次只读确认项目、76 版本集合与两个函数体未变化，并核对文件摘要；变化即重新对账。

请求超时或响应丢失时，先通过只读查询核对迁移记录、两个函数体和约束，确认事务终态。不能因没有收到响应就重新提交，也不使用 `migration repair` 虚构完成记录。

## 执行顺序（授权后）

1. 只提交本轮洛谷、同步过滤、迁移/测试、隐私披露和本记录；保留原有域名修复、维护交接和 repository-readiness 改动。推送并更新现有 PR #167，等待当前候选的 verify、database-security、gitleaks 全部通过。
2. 再读生产元数据、Secret 名称、Key 健康、队列和回滚材料，按上节执行仅洛谷迁移并只读复核。源版本或范围不一致则停止生产写入。
3. 合并通过 CI 的候选，等待 main CI、Pages 和 production-ranking-audit 完成，并确认新隐私披露上线。本次采用“数据库 → Pages 隐私文案 → 两个 Edge 消费者”的顺序，让新凭据流向先被披露；数据库扩展在旧消费者下兼容。
4. 从已通过 CI 的同一候选源码，只部署 `sync-member` 和 `sync-stats`，分别记录新版本与 JWT/import map，下载源码核对，保持其他函数和配置不变。
5. 仅在上述新 `sync-stats` 已验证后，使用 `scope=member`、`platforms=luogu` 和受控目标执行一次工作流。旧版 member scope 会忽略平台过滤，**不能提前用它做洛谷单平台烟测**。
6. 对账该成员洛谷的 run、job、快照、去重状态和 freshness，失败时确认旧统计/游标保留；观察下一次自然日更后再判断恢复验收。任何生产日志只记录聚合/状态，不输出成员 UUID、UID 或凭据。

全站 Auth 和网络安全探测型 readiness 未执行、未标为成功。此次定向操作必须经过负责人对上述范围的批准；不是正式 v1.0.0 或全站就绪放行。

## 回滚

- 已独立下载本次生产 `sync-member v66` 和 `sync-stats v46` 的各自 27 个源码文件，保存到 `.codex-tmp/luogu-release-20261019/rollback-sync-member/` 与 `rollback-sync-stats/`。两个 bundle 分开，防止共享文件版本相互覆盖。
- `sync-member` 全部文件与 `be1f594e6a9d9f004b5b093e6d487971794b8bb3` 匹配；`sync-stats` 只有其未执行的 Luogu adapter 副本较旧。各自精确摘要保存在 `rollback-manifest.json`；回滚应使用各函数自己的源码包。
- 回滚仅恢复这两个消费者并复核，保留兼容的新数据库 Schema 和迁移记录；不回退 migration、不清空统计/增量状态。旧版本仍可能洛谷失败，但恢复此前失败保留行为。

```text
任务：仅洛谷的独立发布准备及获批执行。
分支/提交：codex/luogu-lentille-records / c75bebf；main 合并为 6de6968。
完成：隔离验证、候选门禁、受限迁移、隐私发布、两个消费者发布和单成员首次成功。
生产：77 个 migration；sync-member v67 / sync-stats v47；受控洛谷为 fresh；队列为空；HTTPS 管理通道可用。
已有修改：上一轮和用户未提交文档/脚本均保留。
下一步：核对下一次自然日更的全体洛谷结果；本次获批的执行范围已完成。
负责人所需：本次范围已批准；遇到验证码或必须更新凭据时再由负责人输入。
```
