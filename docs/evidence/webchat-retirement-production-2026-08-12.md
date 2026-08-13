# WebChat 退役关闭态生产部署

日期：2026-08-12（Asia/Shanghai）

项目：`qzggoqdmsvktrtnjislw` / `USTSACMLand`

基线提交：`29709004dca0d69b3778f512f13c5c8200018042`

执行范围：项目负责人批准的 `202608090001_retire_webchat_mutations.sql` 与 `webchat-config` 单函数部署。

## 执行结果

- 生产 migration 已由 Supabase CLI `2.109.1` 应用。
- dry-run 仅包含 `202608090001_retire_webchat_mutations.sql`。
- migration list 已对账为本地/远端一致，共 76 个 migration，0 个待部署。
- 仅部署 `webchat-config`，版本从 13 更新为 14；其他 11 个 Edge Function 未部署。
- 未修改 Secret/Vault，未读取或回显任何 Secret 值，未部署 Pages，未发起模型、图片或 WebChat 消息请求。

## 关闭态对账

部署后通过 Supabase linked database 只读查询确认：

| 检查项                                                    | 结果     |
| --------------------------------------------------------- | -------- |
| `202608090001` 已应用                                     | `true`   |
| `private.webchat_relay_config.requests_enabled`           | `false`  |
| `private.webchat_global_quota_state.image_uploads_paused` | `true`   |
| 6 个退役 writer 对 `anon`                                 | 全部撤销 |
| 6 个退役 writer 对 `authenticated`                        | 全部撤销 |
| 6 个退役 writer 对 `service_role`                         | 全部撤销 |
| 部署后新增 `webchat_requests`                             | `0`      |
| 部署后新增全局 request usage                              | `0`      |

`npm run check:supabase-readiness` 通过，报告 76 个 migration、12 个 Edge Function、23 个 Function Secret 名称（缺失 0）、0 个 schema lint finding、Auth/REST/Edge Function/CORS/队列调度就绪。报告同时提示生产未启用 PITR 且物理备份为 0；项目继续依赖并演练仓库加密逻辑备份，该提示不是本次 WebChat 关闭变更引入的故障。

`webchat-config` 的本地专项测试通过：15/15。测试覆盖管理员认证、正式 Origin CORS、只读脱敏配置、更新请求固定返回 `410 feature_retired`、不读取用量、不调用 writer，以及异常响应脱敏。

未运行完整 `npm run check:production-security`，因为该脚本包含临时解除图片暂停、上传真实夹具和完整图片生命周期流程，与本次明确的“不得触发图片请求”批准范围冲突。已用上述不触发图片、模型或真实成员写入的最小关闭态验证替代，并保留完整脚本作为后续独立安全复核工具。

公开生产页面验证已完成：首页桌面、390px 和 1440px 宽屏无横向溢出且 Chrome 控制台无 warning/error；未登录 `/assistant` 回到首页，普通导航无 AI 助手入口；未登录 `/admin/webchat` 进入登录页。

## 回滚边界

数据库 migration 不回写、不删除、不重新授予退役 writer；如发现问题，只能新增前向 corrective migration。函数故障时只部署与当前 Schema 兼容的最小关闭态修复，保持所有产品开关关闭；不得回退为可写版本。
