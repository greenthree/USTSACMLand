# 生产管理员交接与旧 JWT 边界（2026-07-16）

## 范围

本次在生产 Supabase 创建两个随机临时普通成员，使用一次性邮箱和密码。测试不绑定平台账号、不触发同步、不修改现有成员，也不记录邮箱、UUID、密码、JWT、API Key 或任何真实成员资料。

为建立交接起点，service role 仅把第一个临时成员初始化为管理员。之后的提升、接管、降级均由真实密码登录取得的用户 JWT 调用正式 `admin_set_member_role` RPC完成。

## 角色交接结果

交接流程及黑盒结果：

1. 第一名管理员通过正式 RPC 把第二名成员提升为管理员：HTTP 200；
2. 第二名成员在提升前已经签发的同一 JWT 无需重新登录，调用 `admin_list_members` 返回 HTTP 200，证明后台授权实时读取数据库 Profile，而不依赖 JWT 中缓存角色；
3. 第二名管理员通过正式 RPC 把第一名管理员降为普通成员：HTTP 200；
4. 第一名管理员在降级前已经签发的同一 JWT 再调用后台 RPC 返回 HTTP 403；
5. 管理员脱敏审计投影包含两条 `admin_role_change`：一次 `member -> admin`，一次 `admin -> member`；
6. 审计投影没有暴露操作原因原文、邮箱、UUID、密码或 Token。

角色交接检查 5/5 通过。该证据证明角色变化对现有会话即时生效，并且“先提升并验证新管理员，再降级旧管理员”的生产交接顺序可用。

## 删除后旧 JWT

清理前，两名临时用户都被规范化为启用普通成员。随后每个账号分别：

1. 获取绑定到目标用户的恢复租约；
2. 调用 `delete_auth_user_with_recovery_lease`；
3. 原子删除 Auth 用户及 Profile。

删除完成后，使用两个删除前签发且尚未自然过期的 access JWT再次测试：

- 查询本人私有 Profile 返回空结果；
- 修改本人 Profile 不产生更新行；
- 调用 `admin_list_members` 被拒绝。

旧 JWT 检查 2/2 通过，说明业务授权依赖 live Profile；Auth 用户删除后，尚未到期的 JWT 不能继续访问成员私有数据或后台 RPC。

## 清理结果

- 目标绑定租约原子删除：2/2；
- 临时 Auth 用户残留：0；
- 临时 Profile 残留：0；
- 现有成员身份值进入输出：否。

## 尚未证明的范围

本次验收不替代：

- 配置 `DELETION_RECOVERY_GITHUB_TOKEN` 后从 `delete-account` Edge Function 完成自助注销；
- Storage 所有权或其他受控约束的 HTTP 409；
- 最终删除期间第二数据库连接的行锁阻塞；
- Edge Function 响应传输丢失后的最终状态对账。
