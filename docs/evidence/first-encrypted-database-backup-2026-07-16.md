# 首次生产加密数据库备份证据（2026-07-16）

## 范围

- 仓库提交：`34caed9dd1033de7c4a5cc6a1728660a095bd125`
- Pull Request：[#40](https://github.com/greenthree/USTSACMLand/pull/40)
- 成功运行：[`29509805851`](https://github.com/greenthree/USTSACMLand/actions/runs/29509805851)
- Artifact：`ustsacmland-database-backup-29509805851-1`
- Artifact 大小：120,042 字节
- 到期时间：2026-07-30 15:11:56 UTC（14 天）

本文不记录 Supabase Access Token、短期数据库密码、数据库连接 URI、备份加密口令、成员数据或 SQL 内容。

## 凭据边界

生产 GitHub Actions 已配置：

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `BACKUP_ENCRYPTION_PASSPHRASE`

工作流不保存长期数据库密码。固定版本 Supabase CLI 在每次运行时链接指定项目并动态取得短期数据库登录。独立随机加密口令同时保存在 GitHub Actions Secret 和维护者本机 Windows 凭据管理器的 `USTSACMLand Backup Encryption` 项中；口令值未进入命令输出、Git、Actions 日志或本文档。

## GitHub Actions 结果

成功 run 用时约 3 分 13 秒，依次完成：

1. 验证 Token、项目引用、恢复下限和至少 32 字符的加密口令；
2. 导出数据库角色；
3. 导出业务 Schema；
4. 导出业务数据；
5. 单独导出 Supabase Auth 数据；
6. 导出 migration Schema 与数据；
7. 为七个明文成员生成 SHA-256 清单；
8. 使用 AES-256-CBC、PBKDF2-SHA256、600,000 次迭代加密；
9. 在 runner 内立即解密并检查必需文件；
10. 删除明文 SQL、压缩包和验证副本；
11. 只上传 `.enc` 文件及其 SHA-256 文件，保留 14 天。

第一次尝试因从 Windows 凭据管理器读取 Supabase Token 时误用 UTF-16 解码而在 CLI 格式检查阶段失败；它没有连接数据库或生成备份。修正为按原始 UTF-8 字节读取、在本机只读验证项目访问并重新写入 GitHub Secret 后，第二次运行成功。

## 下载后独立复核

成功 Artifact 随后下载到本机临时目录，并完成独立于 Actions runner 的验证：

- 外层加密文件 SHA-256 与随附文件一致；
- 从 Windows 凭据管理器读取加密口令后成功解密；
- `roles.sql`、`schema.sql`、`data.sql`、`auth-data.sql`、两个 migration 文件、`metadata.txt` 和 `SHA256SUMS` 共八个必需成员均存在且非空；
- `SHA256SUMS` 中七个内部文件校验全部通过；
- metadata 中的提交、run ID 与本次运行一致；
- 验证完成后，本机临时加密副本、解密压缩包和明文目录全部删除。

## 验收边界

本证据证明生产备份可以创建、加密、上传、下载、解密并通过完整性校验。它尚不证明备份能在新 Supabase 项目完整恢复并支持登录，因此 ROADMAP 中“隔离恢复演练”仍保持未完成。
