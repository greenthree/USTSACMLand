# 注销恢复 Fine-grained Token 生产验收（2026-07-25）

日期：2026-07-25（Asia/Shanghai）

本文不记录临时成员身份、密码、JWT、GitHub Token、恢复下限原值、Secret 摘要或其他私有数据。

## 凭据收敛

- 在 GitHub 创建 Fine-grained personal access token，Repository access 仅选择 `greenthree/USTSACMLand`。
- Repository permissions 只有 GitHub 强制的 `Metadata: Read-only` 与业务所需的 `Variables: Read and write`；没有授予 Contents、Administration 或其他额外权限。
- 新 Token 已覆盖 Supabase Function Secret `DELETION_RECOVERY_GITHUB_TOKEN`；Supabase 控制台更新时间刷新，且控制台摘要与本次一次性 Token 的本地 SHA-256 核对一致。核对过程不输出 Token 或摘要。
- `DELETION_RECOVERY_REPOSITORY` 继续固定为 `greenthree/USTSACMLand`。

## 无回显预检

生产 Token 完成以下 GitHub API 操作：

1. 读取固定目标仓库。
2. 读取 `BACKUP_RECOVERY_NOT_BEFORE`。
3. 使用完全相同的值执行一次 Variables PATCH。
4. 再次读取并确认值一致。

预检通过，输出只包含仓库名、变量名和确认布尔值。GitHub API 能证明该仓库与 Variables 读写路径可用，但不能替代 GitHub 设置页中的人工最小权限核对。

## 生产自助注销烟测

- 通过正式域名创建随机临时普通成员，注册后直接进入账号页。
- 第一次注销请求返回 4xx 并保留账号，证明失败关闭；只读核对确认该账号是普通成员、具有一个密码身份、无 Storage 对象、无活动同步任务且注销租约已释放。
- 未配置自动重试。在约束状态明确干净后由操作者进行一次人工重试，生产 `delete-account` 成功完成自助注销并将客户端送回登录页。
- GitHub `BACKUP_RECOVERY_NOT_BEFORE` 随后位于当前时间约一小时之后，证明生产 Edge Function 使用新 Fine-grained Token 自主完成了恢复下限单调前推，而不是仅命中旧下限或由维护端代写。
- 注销后的只读数据库核对结果为：Auth 用户 `0`、最近创建的临时 Profile `0`、恢复租约 `0`、关联同步任务 `0`、关联推荐码 `0`。
- SQL Editor 中包含临时夹具身份的查询内容已立即替换为无身份的 `select 1;`，浏览器会话中的一次性 Token、临时邮箱和密码缓冲均已清空。

## 结论

注销恢复凭据已经从权限偏宽的维护凭据收敛为仅限目标仓库 Variables 读写的 Fine-grained Token；无回显预检、Supabase Secret 覆盖、Edge 自主恢复下限写入、真实自助注销和零残留核对均通过。`ROADMAP.md` 对应 P0 条目可以标记为完成。
