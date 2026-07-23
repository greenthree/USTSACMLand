# 数据库备份与恢复方案

本文定义 USTS ACM Land 的最低可恢复能力。备份包含真实姓名、邮箱、QQ、账号绑定、统计值、认证密码哈希，以及 AI 学习助手图片附件，必须按敏感生产数据处理。

## 供应商保障边界

截至 2026-07-15，Supabase 官方说明：

- Free 项目没有自动每日备份保障，官方建议定期使用 `supabase db dump` 并保存异地副本。
- Pro、Team、Enterprise 的每日备份保留期分别为 7、14、30 天。
- PITR 是 Pro/Team/Enterprise 的附加能力；启用后以可选择时间点的物理备份替代每日备份。
- 数据库备份只包含 Storage 元数据，不包含 Storage API 中的文件对象。
- 本站在同一次 `pg_dump` 中导出 `public,private,auth` 数据，使 Profile、业务数据与 Auth 用户共享同一数据库快照；`auth-data.sql` 只保留为旧恢复顺序兼容占位，不再发起第二次数据 dump。

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
- `schema.sql`：应用 Schema、函数、RLS 和权限；Supabase 管理的 `auth` Schema 不整体覆盖。
- `auth-hooks.sql`：从同次生产 `auth` Schema dump 中只提取挂在 `auth.users` 上的三个本站触发器：注册 Profile 创建、注销前引用清理和恢复下限围栏。完整 `auth` Schema 临时 dump 在加密前删除，不进入 Artifact。
- `data.sql`：由一次数据 dump 同时包含 `public`、`private` 业务数据和 `auth` 用户、身份、密码哈希，避免注册恰好发生在两次 dump 之间而产生不一致备份。
- `auth-data.sql`：兼容旧恢复命令的非敏感占位文件；新备份的 Auth 数据已经包含在 `data.sql`。
- `migrations-schema.sql`、`migrations-data.sql`：Supabase migration 历史。
- `storage/webchat-images/manifest.ndjson`、`summary.json` 和 `objects/`：图片 migration 已安装时，从 `data.sql` 精确提取状态为 `ready` 或 `attached` 的附件引用，并用同次备份任务的临时 `storage.objects` dump 核对对象真实 metadata，只把这些对象从私有 `webchat-images` Bucket 纳入快照。每个对象都会校验固定路径格式、数据库与 Storage 字节数、SHA-256、实际 `image/webp` MIME 和 Cache-Control；临时 Storage metadata dump 在加密打包前删除，不进入 Artifact。未被数据库快照引用的对象不会写入最终归档。图片 migration 尚未安装时仍生成 `featureState=uninstalled` 的显式空清单，且强制对象数、字节数为 0、摘要为标准空 SHA-256；定时备份不会因未发布功能而失败，也不会把“未安装”误判成普通空 Bucket。
- `restore-manifest.json`：Schema v2 清单，记录 `profiles`、平台账号、当前统计、快照、同步运行、WebChat 图片附件、Auth 用户和 migration 历史 8 个关键表聚合行数，以及 Storage 功能状态、对象数、总字节数和对象清单摘要；不保存成员行内容。
- `metadata.txt`、`SHA256SUMS`：生成时间、提交版本和全部明文文件校验值。

数据库快照先生成，Storage 对象随后按该快照引用集下载、筛选和校验。任何 Storage 下载、缺失对象、属性不符、数量/容量越界、归档白名单或加密后大小检查失败都会终止任务；工作流不会发布只含数据库、不含对应图片对象的部分 Artifact。上述文件先打包，再使用 AES-256-CBC、PBKDF2-SHA256 和 600000 次迭代加密。工作流会立即解密一次，按动态精确白名单拒绝路径穿越、重复成员、符号链接、非普通文件和意外对象，然后删除 SQL、对象副本和临时明文归档。GitHub Artifact 只接收：

- `ustsacmland-database-backup.enc`
- `ustsacmland-database-backup.enc.sha256`

密文保留 14 天且不再次压缩。按每日任务计算，仓库备份的目标 RPO 为 24 小时；GitHub Artifact 没有跨快照去重，稳定状态下的存储占用约为 `14 × 单次加密快照大小`。2026-07-19 首次真实 Artifact 隔离演练的 GitHub Actions 端到端耗时为 2 分 7 秒，其中数据库恢复与验证阶段为 3 秒；该结果只覆盖旧的数据库-only 格式。Storage 纳入后必须重新运行一次真实隔离演练，才能建立新的自动化 RTO 基线。完整站点事故恢复仍不包含新建远端项目、Secrets/Auth 回调、Edge Functions、DNS、第三方凭据和业务复核，RTO 须通过远端灾备演练确认。

`.github/workflows/database-restore-drill.yml` 提供手动隔离恢复演练。管理员输入一个来自 `main` 的成功 `Encrypted database backup` run ID；工作流会同时核对来源仓库、工作流路径、分支、结论、run attempt、Artifact 名称和过期状态，不能把其他工作流或 PR 产物冒充为生产备份。该工作流没有 Supabase Access Token、项目引用或远端数据库连接，只把备份恢复到 GitHub Runner 中一次性的本地 Supabase/PostgreSQL 17，完成后无状态销毁。

永久注销采用外部恢复下限。`delete-account` 的目标绑定数据库租约覆盖“取得 owner/target 租约 → 使用仅有目标仓库 Variables write 的 GitHub fine-grained PAT 更新并回读确认 `BACKUP_RECOVERY_NOT_BEFORE` → 续期并停止外部阶段心跳 → 调用最终删除 RPC”的完整临界区；变量只含 UTC 时间，不含成员身份。最终 RPC 对租约单例行和目标 Profile 加锁，重新验证 owner、target、有效期、角色与活动同步后，在同一数据库事务删除 `auth.users` 并消费租约，Auth/Profile 级联与审计匿名化只会整体提交或回滚。租约冲突、取得或删除前续期失败、写入或回读确认失败时不得删除 Auth 用户，并返回 `503`；管理员、活动同步、Storage 所有权或其他受控约束拒绝删除时返回 `409` 并保留账号及业务数据。恢复时间再额外增加一小时安全余量，避免运行环境时钟偏差让下限落到实际删除时间之前。

当前归档只覆盖私有 `webchat-images` Bucket 中被数据库快照引用的对象，不归档整个 `storage` Schema，也不覆盖未来新增的其他 Bucket。备份任务只临时导出 `storage.objects` 数据用于验证真实 metadata，生成精确对象计划后逐个下载；临时 dump 和未引用对象都不会进入最终归档。`MAX_STORAGE_OBJECTS`、总容量、单对象路径、数据库与 Storage 大小、SHA-256、MIME 和 Cache-Control 在下载前后双重校验。运维上必须持续监控删除死信、对象计划规模和备份耗时，避免私有对象增长超过 Runner 与 Artifact 的可控范围。

## GitHub Actions Secrets

在仓库 `Settings > Secrets and variables > Actions` 配置：

| Secret                         | 要求                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `SUPABASE_ACCESS_TOKEN`        | Supabase 个人访问令牌；固定版本 CLI 仅用它链接目标项目并动态取得短期数据库登录 |
| `SUPABASE_PROJECT_REF`         | 生产项目引用，用于把备份任务严格绑定到目标项目                                 |
| `BACKUP_ENCRYPTION_PASSPHRASE` | 独立随机口令，至少 32 个字符；不得与数据库、GitHub、邮箱或平台账号密码复用     |

同一页面的 `Variables` 必须配置：

| Variable                    | 要求                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `MAX_BACKUP_ARTIFACT_BYTES` | 正整数；同时限制数据库快照引用的图片总字节数和最终加密 Artifact 大小，按可接受的 GitHub/Runner 容量设置 |
| `MAX_STORAGE_OBJECTS`       | 非负整数；限制单次数据库快照可引用并备份的 `webchat-images` 对象数量                                    |

任一变量缺失或格式错误都会让备份在连接生产项目之前失败。调整上限前先估算 14 份完整密文的总占用，并记录调整原因；不要用无界大值掩盖异常对象增长。

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
node scripts/verify-webchat-storage-backup.mjs archive \
  restored-backup/storage/webchat-images
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

1. 先手动运行当前 `main` 的 `Encrypted database backup`，等待成功并记录 run ID。恢复演练优先使用 Schema v2；历史 Schema v1 Artifact 仍可用于数据库恢复，但只接受固定的数据库-only 文件白名单，归档中出现任何 Storage 路径都会拒绝，报告也会明确标记 Storage 证据不可用。该兼容路径不能替代上线图片功能前的 Schema v2 Storage 恢复演练。
2. 打开 Actions → `Encrypted database restore drill`，输入刚才的 run ID。恢复任务不会自动运行或自动重试。
3. 工作流校验密文 SHA-256、AES-256/PBKDF2 解密、按 Storage 清单生成的归档精确白名单、内部 `SHA256SUMS` 和当前 `BACKUP_RECOVERY_NOT_BEFORE`。
4. 仓库 migration 会先移出目标目录，保证恢复目标只有 Supabase 平台基线；解密文件只复制进一次性数据库容器，由容器内 `supabase_admin` Unix-socket 管理入口把角色、应用 Schema、三个 `auth.users` 应用触发器、业务数据、Auth 数据和 migration 历史在同一 `psql --single-transaction` 中恢复，任一步失败都会整体回滚。工作流不会让普通本地 `postgres` 提升为平台角色，也不持有远端数据库连接。
5. 恢复后逐项比较 `profiles`、平台账号、当前统计、快照、同步运行、WebChat 图片附件、Auth 用户和 migration 历史 8 个行数；同时检查 `Profile -> Auth` 与 `Auth -> Profile` 两个方向、平台数据和图片附件共 7 类孤儿关系必须为 0。Schema v1 只比较原有 7 个表，Schema v2 `uninstalled` 则要求图片附件数为 0。
6. 对 `featureState=installed`，本地 Supabase 以 Storage 服务启动，工作流创建只允许 WebP、单对象上限 4 MiB 的私有 `webchat-images` Bucket，按原始 object key 及清单中的 MIME/Cache-Control 恢复对象，并验证无认证请求与匿名 bearer 请求都不能读取。随后使用 service role 下载 Bucket，逐项比对数据库 `ready`/`attached` 引用、对象数量、总字节数、SHA-256，以及恢复后 `storage.objects.metadata` 中的 MIME 与 Cache-Control；空快照使用临时隐私探针并在完成后删除。对 `featureState=uninstalled`，工作流验证空清单、零附件和功能确实不存在，不创建伪 Bucket；Schema v1 明确跳过 Storage 验收。
7. 工作流确认三个允许名单内的 `auth.users` 触发器均已恢复，再在隔离环境创建随机临时账号，验证注册触发器自动创建本人 Profile、密码登录、本人 Profile 可读、其他 Profile 被 RLS 隐藏、匿名公开视图可读，并要求匿名私表请求返回 `401/403` 或严格的 `200 []` RLS 空结果。临时账号必须通过恢复后的目标绑定租约和受控注销 RPC 删除，不能绕过注销围栏。
8. Runner 停止本地 Supabase，删除解密 SQL、Storage 对象、归档、本地 Key、临时密码、探针和响应；Artifact 只上传 14 天有效的脱敏聚合 JSON 报告。

自动化演练证明逻辑备份可以在干净的 Supabase 平台基线上恢复，并覆盖 Auth、RLS 与私有 `webchat-images` 对象；它不包含 Edge Functions、Function Secrets、Auth 回调、其他 Bucket 或第三方凭据。事故恢复或迁移到新远端项目时，仍须继续执行下列人工步骤并验证外部集成。

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
  --file auth-hooks.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --file auth-data.sql \
  --dbname "$RESTORE_DB_URL"
```

7. 根据 Supabase 官方 migration history 指南，审查并恢复 `migrations-schema.sql`、`migrations-data.sql`；若目标已存在相同对象，不得盲目覆盖。
8. 在目标项目创建私有 `webchat-images` Bucket，保持 4 MiB 与 `image/webp` 限制；使用 service role 按归档中的原始 object key 上传 `storage/webchat-images/objects`，再验证匿名读取被拒绝。不得把 Bucket 临时改成公开。
9. 重新部署 Edge Functions，重新配置全部 Function Secrets、Auth 回调和 GitHub Actions Secrets。备份不包含这些 Secrets。
10. 使用隔离账号验证登录、资料、RLS、公开榜单、后台和一次单平台同步。
11. 使用密文内 `restore-manifest.json` 比较 Schema v2 的 8 个表行数和 7 类孤儿关系，并按功能状态比对 Storage 对象数、总字节数、清单 SHA-256、数据库引用及对象哈希；同时确认 `auth-hooks.sql` 的三个触发器均存在。Schema v1 只能提供原有 7 个表和数据库关系证据，不能声称完成 Storage 验收。任何差异都必须停止验收。
12. 删除隔离项目和本地明文文件，保留不含个人数据的演练日期、结果、耗时和问题清单。

不同项目使用不同 JWT Secret 时，旧会话会失效，成员需要重新登录。这是默认且更安全的恢复策略；不要为了保留旧会话而随意复制生产 JWT Secret。

## 验收频率

- 首次正式发布前必须完成一次隔离恢复演练。
- 此后至少每季度一次，或在 Auth/数据库大迁移后立即演练。
- 每周检查最近七天是否至少有六个成功的备份任务；失败必须当天处理。
- 每月确认最旧可下载 Artifact 与 14 天策略一致，核算约 `14 × 单次加密快照大小` 的实际占用，并核对 Supabase 实际套餐、Storage 用量和 Dashboard 备份页。

只有“最近备份存在”不能证明可恢复；必须以隔离项目成功登录和数据核对作为恢复验收证据。

旧数据库-only 格式的首次真实演练 run、聚合行数、Auth/RLS、受控注销、清理结果和 RTO 边界见 [生产加密数据库隔离恢复演练证据](./evidence/database-restore-drill-2026-07-19.md)。该证据不覆盖 Schema v2 清单和 `webchat-images` 对象，Storage 版本上线前必须补充一次新的真实演练记录。
