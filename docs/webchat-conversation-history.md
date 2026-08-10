# WebChat 私有会话历史契约

> 归档边界：WebChat / AI 学习助手已经退出产品范围。本文只解释保留的私有历史
> Schema、RPC、前端代码和数据生命周期，不是成员入口、启用或生产对话验收手册。
> 生产请求和界面必须保持关闭，不得为了验证历史功能发送模型请求或重新开放入口。

保留实现由 `202607180005_webchat_conversation_history.sql`、前端 assistant-ui 线程适配器和站内隐私说明共同约束。关闭态维护继续保护已有历史数据的账号隔离、保留期、账号绑定删除 RPC 和注销级联。

## 数据边界

- `private.webchat_conversations` 保存当前用户的会话标题、状态、消息数、内容体积、版本和活动时间。
- `private.webchat_messages` 保存 `ai-sdk/v6` 消息内容、父消息 ID 和稳定位置。
- 浏览器、`authenticated` 与 `service_role` 都没有两张表的直表读取权限。
- 关闭态浏览器只保留绑定 `auth.uid()` 的 own-history 列表、正文读取和删除 RPC；接口不接受目标用户 ID，因此普通管理员也不能借助站内后台读取成员正文。创建、重命名、归档和消息 upsert RPC 已对 `anon`、`authenticated` 与 `service_role` 撤销执行权限。
- 历史客户端只在 `localStorage` 保存当前会话 UUID，用于刷新后选择同一线程；正文由 Supabase 私有数据库保存。未配置 Supabase 的本地演示实现使用按演示账号隔离的本机存储。

## 上限与保留

- 每个账号最多 100 个会话。
- 每个会话最多 120 条消息。
- 单条序列化消息不超过 64 KiB，单会话序列化正文不超过 1 MiB。
- 会话最后活动超过 180 天后，由 `webchat-history-retention` 每日任务删除。
- own-history 删除 RPC 删除单个会话时，消息随外键级联删除；永久注销 Profile 时，全部会话和消息级联删除。

遗留消息 upsert 实现会锁定所属会话，校验父消息已经存在，并原子更新消息数、总字节、位置和版本；重复写入同一消息 ID 只更新内容，不重复计数。该实现仅为 Schema 兼容和事务回归测试保留，没有应用角色执行权。历史列表按 `(user_id, status, last_message_at, id)` 游标分页，每页 30 条。

## 历史客户端行为

- 历史 assistant-ui 适配器曾在生成结束后保存本轮用户消息和模型可见回复。
- 历史界面曾读取上次活动会话 UUID，并通过私有 RPC 恢复、切换或删除线程。
- 历史请求在首个可见正文到达前显示“思考中”，并在正文、失败、停止或超时后清除该状态。
- 历史持久化不参与付费请求 claim，不会额外扣减成员累计额度或全站日预算。

上述客户端代码只为兼容和审计保留，不构成当前成员入口，也不要求继续完成交互验收。

## 关闭态维护检查

1. 运行 `30_webchat_conversation_history.test.sql` 与 `51_webchat_retired_mutations.test.sql`，确认写 RPC 撤权、保留的读取/删除权限、表权限、账号隔离、管理员隔离、上限、删除级联和 180 天清理。
2. 通过本地/CI 测试确认 own-history RPC 删除后不再返回元数据和消息；不得临时恢复生产写权限、发送真实模型请求或使用生产成员验证。
3. 确认管理员后台没有正文入口，数据库审计或错误日志不记录消息内容。
4. 核对 `/privacy`、`PRIVACY.md` 和 `docs/data-lifecycle.md` 与实际保留期一致。
