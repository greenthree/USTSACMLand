# 数据库备份与恢复方案

本文定义 USTS ACM Land 的最低可恢复能力。备份包含真实姓名、邮箱、QQ、账号绑定、统计值和认证密码哈希，必须按敏感生产数据处理。

## 供应商保障边界

截至 2026-07-15，Supabase 官方说明：

- Free 项目没有自动每日备份保障，官方建议定期使用 `supabase db dump` 并保存异地副本。
- Pro、Team、Enterprise 的每日备份保留期分别为 7、14、30 天。
- PITR 是 Pro/Team/Enterprise 的附加能力；启用后以可选择时间点的物理备份替代每日备份。
- 数据库备份只包含 Storage 元数据，不包含 Storage API 中的文件对象。
- 本站把通用业务数据 dump 限定为 `public,private`，并另行导出 `auth` 数据，才能在避免重复表的同时保留用户和密码哈希。

2026-07-15 对正式项目的只读 CLI 核验结果为：`pitr_enabled=false`、可用物理备份 0 份。`walg_enabled=true` 只表示底层能力状态，不能当作已有恢复点。因此在 Dashboard 或 CLI 出现可用物理备份前，本站只能依赖本文件定义的加密逻辑备份，且首次成功 Artifact 和隔离恢复演练仍是发布阻塞项。

权威来源：

- [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)
- [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Migrating Auth Users Between Supabase Projects](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects)
- [Supabase CLI `db dump`](https://supabase.com/docs/reference/cli/supabase-db-dump)
- [GitHub REST API: Actions variables](https://docs.github.com/en/rest/actions/variables)

生产项目的实际套餐仍须在 Supabase Dashboard 核对。在完成该核对前，发布检查按 Free 项目的最低保障处理，不假设存在供应商自动备份。

## 仓库备份策略

`.github/workflows/database-backup.yml` 每天北京时间 00:30（UTC 16:30）运行，也允许管理员手动触发。每次生成：

- `roles.sql`：自定义数据库角色。
- `schema.sql`：应用 Schema、函数、RLS 和权限。
- `data.sql`：只包含应用的 `public`、`private` 业务数据；`auth` 与 `supabase_migrations` 使用独立 dump，避免恢复时重复写入。
- `auth-data.sql`：`auth` Schema 的用户、身份和密码哈希等数据。
- `migrations-schema.sql`、`migrations-data.sql`：Supabase migration 历史。
- `restore-manifest.json`：从三份 data-only dump 计算的 7 个关键表聚合行数，只用于恢复后完整性比对，不保存任何行内容。
- `metadata.txt`、`SHA256SUMS`：生成时间、提交版本和全部明文文件校验值。

上述文件先打包，再使用 AES-256-CBC、PBKDF2-SHA256 和 600000 次迭代加密。工作流会立即解密一次并检查归档内容，然后删除 SQL 和临时明文归档。GitHub Artifact 只接收：

- `ustsacmland-database-backup.enc`
- `ustsacmland-database-backup.enc.sha256`

密文保留 14 天且不再次压缩。按每日任务计算，仓库备份的目标 RPO 为 24 小时；RTO 只有在首次恢复演练后才能确认，演练前不得宣传确定的恢复时长。

`.github/workflows/database-restore-drill.yml` 提供手动隔离恢复演练。管理员输入一个来自 `main` 的成功 `Encrypted database backup` run ID；工作流会同时核对来源仓库、工作流路径、分支、结论、run attempt、Artifact 名称和过期状态，不能把其他工作流或 PR 产物冒充为生产备份。该工作流没有 Supabase Access Token、项目引用或远端数据库连接，只把备份恢复到 GitHub Runner 中一次性的本地 Supabase/PostgreSQL 17，完成后无状态销毁。

永久注销采用外部恢复下限。`delete-account` 的目标绑定数据库租约覆盖“取得 owner/target 租约 → 使用仅有目标仓库 Variables write 的 GitHub fine-grained PAT 更新并回读确认 `BACKUP_RECOVERY_NOT_BEFORE` → 续期并停止外部阶段心跳 → 调用最终删除 RPC”的完整临界区；变量只含 UTC 时间，不含成员身份。最终 RPC 对租约单例行和目标 Profile 加锁，重新验证 owner、target、有效期、角色与活动同步后，在同一数据库事务删除 `auth.users` 并消费租约，Auth/Profile 级联与审计匿名化只会整体提交或回滚。租约冲突、取得或删除前续期失败、写入或回读确认失败时不得删除 Auth 用户，并返回 `503`；管理员、活动同步、Storage 所有权或其他受控约束拒绝删除时返回 `409` 并保留账号及业务数据。恢复时间再额外增加一小时安全余量，避免运行环境时钟偏差让下限落到实际删除时间之前。

当前网站没有使用 Supabase Storage 保存成员文件，仓库逻辑备份也不导出 `storage` Schema。将来一旦使用 Storage，必须先增加 Storage 元数据和对象文件的独立导出与恢复流程，不能把当前数据库备份当作文件备份。

## GitHub Actions Secrets

在仓库 `Settings > Secrets and variables > Actions` 配置：

| Secret                         | 要求                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `SUPABASE_ACCESS_TOKEN`        | Supabase 个人访问令牌；固定版本 CLI 仅用它链接目标项目并动态取得短期数据库登录 |
| `SUPABASE_PROJECT_REF`         | 生产项目引用，用于把备份任务严格绑定到目标项目                                 |
| `BACKUP_ENCRYPTION_PASSPHRASE` | 独立随机口令，至少 32 个字符；不得与数据库、GitHub、邮箱或平台账号密码复用     |

在 Supabase Function Secrets 另行配置：

| Secret                           | 要求                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `DELETION_RECOVERY_REPOSITORY`   | 固定为目标 GitHub 仓库，如 `greenthree/USTSACMLand`                          |
| `DELETION_RECOVERY_GITHUB_TOKEN` | Fine-grained PAT；只授权该仓库的 Variables write，不授予 Contents 等其他权限 |

推荐使用密码管理器生成并保存备份口令，至少由两名授权负责人分别确认可访问。口令丢失等同于全部仓库备份不可恢复；口令泄露时必须立即轮换，并删除旧 Artifact。

## 下载与本地完整性检查

只在受控电脑和私有目录操作。不要把 Artifact、解密文件、命令输出或用户数据上传到聊天、Issue、公开云盘或仓库。

```bash
sha256sum -c ustsacmland-database-backup.enc.sha256
export BACKUP_ENCRYPTION_PASSPHRASE='从密码管理器临时读取，不写入脚本'
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 \
  -in ustsacmland-database-backup.enc \
  -out ustsacmland-database-backup.tar.gz \
  -pass env:BACKUP_ENCRYPTION_PASSPHRASE
mkdir restored-backup
tar -C restored-backup -xzf ustsacmland-database-backup.tar.gz
(cd restored-backup && sha256sum -c SHA256SUMS)
export BACKUP_RECOVERY_NOT_BEFORE='从 GitHub Actions Variables 复制当前值'
npm run verify:backup-recovery-floor -- restored-backup/metadata.txt
```

检查完成后清除 shell 中的口令，并在不再需要时安全删除全部明文文件：

```bash
unset BACKUP_ENCRYPTION_PASSPHRASE
unset BACKUP_RECOVERY_NOT_BEFORE
rm -rf restored-backup ustsacmland-database-backup.tar.gz
```

## 恢复演练

恢复只能面向新建的隔离 Supabase 测试项目。除非负责人明确批准事故恢复，禁止把演练导入生产项目。

首次和季度例行演练优先使用仓库的手动 `Encrypted database restore drill` 工作流：

1. 先手动运行当前 `main` 的 `Encrypted database backup`，等待成功并记录 run ID。旧 Artifact 没有 `restore-manifest.json` 时必须重新生成，不能跳过行数核对。
2. 打开 Actions → `Encrypted database restore drill`，输入刚才的 run ID。恢复任务不会自动运行或自动重试。
3. 工作流校验密文 SHA-256、AES-256/PBKDF2 解密、归档精确文件白名单、内部 `SHA256SUMS` 和当前 `BACKUP_RECOVERY_NOT_BEFORE`。
4. 仓库 migration 会先移出目标目录，保证恢复目标只有 Supabase 平台基线；角色、应用 Schema、业务数据、Auth 数据和 migration 历史在同一 `psql --single-transaction` 中恢复，任一步失败都会整体回滚。
5. 恢复后逐项比较 `profiles`、平台账号、当前统计、快照、同步运行、Auth 用户和 migration 历史 7 个行数；四类孤儿关系必须为 0。
6. 工作流只在隔离环境创建随机临时账号，验证密码登录、本人 Profile 可读、其他 Profile 被 RLS 隐藏、匿名公开视图可读且匿名私表被拒绝，然后删除临时账号。
7. Runner 停止本地 Supabase，删除解密 SQL、归档、本地 Key、临时密码和响应；Artifact 只上传 14 天有效的脱敏聚合 JSON 报告。

自动化演练证明逻辑备份可以在干净的 Supabase 平台基线上恢复，并覆盖 Auth 与 RLS 基本可用性；它不包含 Edge Functions、Function Secrets、Auth 回调、Storage 对象或第三方凭据。事故恢复或迁移到新远端项目时，仍须继续执行下列人工步骤并验证外部集成。

1. 下载最近一次成功 Artifact，完成密文和内部文件校验。
2. 新建隔离 Supabase 项目，记录其 Session pooler URI 为 `RESTORE_DB_URL`。
3. 核对目标项目没有需要保留的数据，并暂停对目标项目的外部访问。
4. 按 Supabase 官方指南审查 `roles.sql` 中与目标平台管理角色冲突的语句。
5. 从 GitHub Actions Variables 读取当前 `BACKUP_RECOVERY_NOT_BEFORE`，运行恢复下限校验。任何失败都必须停止，不能通过修改本地 metadata 绕过。
6. 使用 `psql` 单事务恢复角色、应用 Schema、业务数据和认证数据：

```bash
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file roles.sql \
  --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --file auth-data.sql \
  --dbname "$RESTORE_DB_URL"
```

7. 根据 Supabase 官方 migration history 指南，审查并恢复 `migrations-schema.sql`、`migrations-data.sql`；若目标已存在相同对象，不得盲目覆盖。
8. 重新部署 Edge Functions，重新配置全部 Function Secrets、Auth 回调和 GitHub Actions Secrets。备份不包含这些 Secrets。
9. 使用隔离账号验证登录、资料、RLS、公开榜单、后台和一次单平台同步。
10. 使用密文内 `restore-manifest.json` 比较成员数、平台账号数、统计行数、快照数、同步运行数、Auth 用户数和 migration 数；任何差异都必须停止验收。
11. 删除隔离项目和本地明文文件，保留不含个人数据的演练日期、结果、耗时和问题清单。

不同项目使用不同 JWT Secret 时，旧会话会失效，成员需要重新登录。这是默认且更安全的恢复策略；不要为了保留旧会话而随意复制生产 JWT Secret。

## 验收频率

- 首次正式发布前必须完成一次隔离恢复演练。
- 此后至少每季度一次，或在 Auth/数据库大迁移后立即演练。
- 每周检查最近七天是否至少有六个成功的备份任务；失败必须当天处理。
- 每月确认最旧可下载 Artifact 与 14 天策略一致，并核对 Supabase 实际套餐和 Dashboard 备份页。

只有“最近备份存在”不能证明可恢复；必须以隔离项目成功登录和数据核对作为恢复验收证据。
