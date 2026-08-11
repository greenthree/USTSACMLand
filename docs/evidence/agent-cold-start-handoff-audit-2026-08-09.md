# Agent 冷启动接管验收记录（2026-08-09）

## 范围与授权

- 日期与时区：2026-08-09，Asia/Shanghai。
- 任务：仅依靠仓库文档完成冷启动检查、同步巡检、备份连续性核对和发布/回滚桌面推演。
- 起始提交：`c6ed95e721eb4ab58f796a4c8ca13694fef10e8e`，默认分支 `main`。
- 本轮允许：仓库、GitHub、Supabase 和公开生产站点只读检查；本地检查器、测试与文档修复。
- 本轮禁止且未执行：触发同步、备份或恢复工作流，修改生产 migration、Function、Secret、Auth、cron、Cloudflare、成员数据，创建标签、合并或部署。
- 冷启动时已有的 README、ROADMAP 和运维文档修改及未跟踪 Agent 契约均被保留，没有清理或覆盖。

## GitHub 与发布基线

- 默认分支为 `main`，当前提交 `c6ed95e`。
- 启用的仓库 ruleset 要求 Pull Request、禁止删除与 non-fast-forward，并要求 `verify`、`database-security`、`gitleaks`；无默认绕过主体。
- `production-operations` Environment 只允许 `main`，只核对到两个 Supabase Secret 名称，没有读取值。
- GitHub Actions 默认日志与 Artifact 保留期为 30 天；数据库加密备份 Artifact 单独保留 14 天。
- 当前提交的 CI `31011279491`、Secret Scan `31011279143`、Pages build/deploy 与生产榜单审计 `31012265942` 均成功。
- `npm run check:cloudflare-domain` 通过裸域、重定向、SPA 回退、HTML 短缓存、指纹资源一年缓存和二次缓存命中检查。

## Supabase 与同步巡检

- 唯一 linked 项目为 `ACTIVE_HEALTHY`。
- 严格就绪检查通过：75 个 migration、0 项 pending、12 个 ACTIVE Edge Function、23 个 Function Secret 名称且 0 缺失、0 个 schema lint finding；Auth 邮件、匿名 REST、函数边界和队列调度均通过。
- 12 个函数均使用仓库 import map；除公开头像代理 `member-avatar` 按设计关闭 JWT 验证外，其余函数均启用 JWT 验证。
- 五分钟队列 cron 为 active，Vault 配置完整；检查时近 15 分钟运行 3 次且 3 次成功，最近请求 HTTP 为 `200`，无超时或传输错误。
- 队列聚合：到期排队 0、未来排队 0、运行中 0、超过 15 分钟运行 0、等待重试 0、已耗尽但仍活动 0；过去 24 小时任务成功 54、失败 0。
- 六个平台最近终态均为成功。过去 24 小时 Codeforces、牛客、AtCoder 与洛谷没有失败；XCPC ELO 与 QOJ 最近一次周二批次成功。
- 最近 12 次 `Sync platform statistics` 计划运行全部成功；最新运行 `31284111001` 成功完成配置检查和 Supabase 同步触发。
- `npm run check:sync-workflow` 通过默认分支 Environment 保护、分页、持久队列重试所有权和日志脱敏结构门禁。

## 备份与恢复边界

- 2026-08-02 至 2026-08-08 的七个每日计划备份中六个成功，达到手册要求的“最近七天至少六次成功”。
- 2026-08-06 运行 `31125234967` 在没有执行步骤的情况下被取消；后续 2026-08-07 和 2026-08-08 均成功。最新成功运行 `31268403658` 完成加密逻辑备份、即时验证和 Artifact 上传。
- `npm run check:backup-workflow` 与 `npm run check:restore-drill-workflow` 通过：备份包含 7 个逻辑 dump、1 个私有 Storage 快照和 14 天保留；恢复演练保持手动触发、核对 8 项聚合计数、私有 Storage 和脱敏证据。
- Supabase PITR 未启用且供应商物理备份为 0，仍依赖仓库加密逻辑备份。
- 本轮没有触发新备份或恢复。正式发布检查单要求的“当前 `main` 新生成 Schema v2 Artifact 恢复演练”仍未完成，不能用旧成功运行替代。

## 发布与回滚桌面推演

### 当前发布

- 当前 Pages 发布提交为 `c6ed95e`，上一成功发布提交为 `63655a3`。
- 两个提交之间只有前端、字体、文档和构建预算变化，没有 Supabase migration 或 Edge Function 变化。

### 前端回滚

1. 从当前 `origin/main` 创建 `codex/*` 修复分支。
2. 使用 `git revert c6ed95e` 形成可审计回退提交，不重写历史。
3. 提交 PR，等待 `verify`、`database-security`、`gitleaks`。
4. 获得项目负责人明确部署批准后合并，等待精确 `head_sha` 的 Pages build、deploy 和 `production-ranking-audit`。
5. 验证正式首页、深链、登录、账号页、后台和遗留模块关闭状态。

### Edge Function 回滚

- 只有旧函数与当前 75 个 migration 兼容时，才在临时 worktree 检出最后正常提交并只部署受影响函数。
- 部署 Function 属于生产写操作，必须逐次批准；完成后严格运行 `npm run check:supabase-readiness`。
- 若 Schema 不兼容旧函数，不回滚函数，改为从 `main` 发布最小兼容修复。

### 数据库回滚

- 未应用 migration：停止并修正后重新跑空库 CI。
- 已应用 migration：不修改历史文件，新增 corrective migration 前向修复。
- 只有整库灾难恢复才考虑备份；必须先验证 `BACKUP_RECOVERY_NOT_BEFORE`，并在隔离项目完成恢复演练。任何生产恢复都需要单独批准。

### Cloudflare 回滚

- DNS only、移除 Pages Custom domain、缓存 Purge 和流量路径切换都会改变生产行为，必须在维护窗口取得单独批准。
- 指纹静态资源不做无差别 Purge；仅在 Pages 已成功但 HTML 未更新时清理必要 HTML 路径。

## 发现与修复

- `check:repository-readiness` 原先把 `SUPABASE_PROJECT_REF` 和 `SUPABASE_SERVICE_ROLE_KEY` 当作仓库级 Secret，和实际最小权限配置冲突。
- 检查器现分别验证四个仓库级 Secret 名称、两个 `production-operations` Environment Secret 名称，并验证 Environment 只允许默认分支。
- README、ROADMAP、运维与发布文档同步为 75 个 migration、12 个函数、30 天仓库 Actions 保留期和正确 Secret 存放位置。
- 项目负责人在本次交接后选择 Apache License 2.0（SPDX 标识符：`Apache-2.0`）；维护 Agent 已加入根目录 `LICENSE`，并在 README、ROADMAP 与发布检查单中明确源码与学校/集训队/赛事标识、第三方素材、成员数据和平台数据的授权边界。

## 结论与遗留阻塞

本次冷启动验收满足 `docs/maintainer-handoff.md` 第 13 节：Agent 能仅根据仓库文档区分授权等级，完成同步巡检和发布/回滚桌面推演，并保持 Secret、成员资料和生产状态不被修改。

`v1.0.0` 仍有以下发布阻塞：

- 维护窗口内完成受控 Auth `429` 窗口恢复验证。
- 使用当前 `main` 新生成的 Schema v2 Artifact 完成手动隔离恢复演练。
- 核验 Supabase Auth/Edge 日志与 Firecrawl 作业、会话的实际保留窗口。
- Cloudflare 真实流量回滚演练需要单独维护窗口和明确批准。
