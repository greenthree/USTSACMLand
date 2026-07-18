# WebChat 私有历史会话

本文定义 AI 学习助手的刷新恢复、历史会话和正文保留边界。实现由 `202607180005_webchat_conversation_history.sql`、前端 assistant-ui 线程适配器和站内隐私说明共同约束。

## 数据边界

- `private.webchat_conversations` 保存当前用户的会话标题、状态、消息数、内容体积、版本和活动时间。
- `private.webchat_messages` 保存 `ai-sdk/v6` 消息内容、父消息 ID 和稳定位置。
- 浏览器、`authenticated` 与 `service_role` 都没有两张表的直表读取权限。
- 浏览器只能调用绑定 `auth.uid()` 的 own-history RPC；接口不接受目标用户 ID，因此普通管理员也不能借助站内后台读取成员正文。
- 生产浏览器只在 `localStorage` 保存当前会话 UUID，用于刷新后选择同一线程；正文由 Supabase 私有数据库保存。未配置 Supabase 的本地演示环境使用按演示账号隔离的本机存储。

## 上限与保留

- 每个账号最多 100 个会话。
- 每个会话最多 120 条消息。
- 单条序列化消息不超过 64 KiB，单会话序列化正文不超过 1 MiB。
- 会话最后活动超过 180 天后，由 `webchat-history-retention` 每日任务删除。
- 用户删除单个会话时，消息随外键级联删除；永久注销 Profile 时，全部会话和消息级联删除。

消息 upsert 会锁定所属会话，校验父消息已经存在，并原子更新消息数、总字节、位置和版本。重复写入同一消息 ID 只更新内容，不重复计数。历史列表按 `(user_id, status, last_message_at, id)` 游标分页，每页 30 条。

## 客户端行为

- 一次生成结束后，assistant-ui 历史适配器保存本轮用户消息和模型可见回复。
- 刷新页面会读取上次活动会话 UUID，再从私有 RPC 恢复消息链。
- “新建对话”创建新的空线程；侧栏可切换或删除历史线程。
- 请求已经提交但首个可见正文尚未到达时显示“思考中”；首个正文、失败、停止或超时都会清除该状态。
- 历史持久化不参与付费请求 claim，不会额外扣减成员累计额度或全站日预算。

## 发布检查

1. 应用 migration，并运行 `30_webchat_conversation_history.test.sql`，确认表权限、账号隔离、管理员隔离、上限和 180 天清理。
2. 部署前端后，使用已授权账号发送一轮对话，刷新并继续提问，再新建线程并切回旧线程。
3. 确认删除会话后 own-history RPC 不再返回元数据和消息。
4. 确认管理员后台没有正文入口，数据库审计或错误日志不记录消息内容。
5. 核对 `/privacy`、`PRIVACY.md` 和 `docs/data-lifecycle.md` 与实际保留期一致。
