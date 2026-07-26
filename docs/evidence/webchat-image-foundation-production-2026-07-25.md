# WebChat 图片安全基础生产证据（2026-07-25）

## 结论

WebChat 图片输入的数据库与 Edge Function 安全基础已经部署到生产，但图片功能仍未向
成员开放：前端入口、视觉模型门禁和定时清理开关继续关闭，数据库全站上传状态保持
`image_uploads_paused=true`。本记录只证明“默认关闭时的生产边界可复跑”，不代表图片
消息已经上线。

## 部署状态

- 生产与仓库 migration 均为 71 项，0 项 pending；本轮图片基础包含
  `202607230001_webchat_image_attachments.sql` 与
  `202607230004_webchat_image_global_limits.sql`。
- 生产共有 10 个 ACTIVE Edge Function；`webchat-attachment` 与
  `webchat-image-cleanup` 均为 v1，启用 JWT 验证并使用仓库 import map。
- 私有 `webchat-images` Bucket 为 `public=false`，单对象上限 4 MiB，只允许规范化后的
  `image/webp`。
- `VITE_WEBCHAT_IMAGE_INPUT_ENABLED`、`CHAT_IMAGE_INPUT_ENABLED`、精确视觉模型门禁和
  `WEBCHAT_IMAGE_CLEANUP_ENABLED` 仍保持关闭或未配置为开启。

## 可复跑生产检查

`npm run check:production-security` 已扩展为 47 项，并在生产通过：

```json
{
  "ok": true,
  "checksPassed": 47,
  "assetCount": 64,
  "cleanupFallbacks": 0,
  "cleanupConfirmed": true
}
```

新增图片边界覆盖：

1. 匿名请求不能通过两个图片 Edge Function 的 JWT 网关。
2. 普通成员调用图片清理函数返回 `403 service_role_required`。
3. 使用真实临时成员、本人私有会话和内存中的有效 1×1 PNG，只发送一次 multipart
   上传；生产返回明确的 `503` 安全关闭状态，不重试、不生成附件，也不调用视觉模型。
4. service role 只读核对 Bucket 为私有、4 MiB、仅 WebP。
5. service role 调用 `reconcile_webchat_image_storage_accounting()`，确认数据库记录、附件
   分配、Storage 对象、孤儿对象和缺失对象均为 0，账目一致且全站上传暂停。
6. 受限聚合查询确认三个随机生产夹具没有图片附件、Storage 对象或删除队列残留。
7. 检查器最终注销全部随机夹具；本次没有启用清理兜底，Auth/Profile 清理确认成功。

检查器输出只包含布尔结果、聚合计数和公开部署状态；不输出临时邮箱、成员 UUID、JWT、
图片内容、对象路径、会话 ID 或任何 Secret。

### 真实对象生命周期复核

检查器随后扩展为 56 项，并使用随机临时成员完成一轮真实私有对象生命周期。为保持
全站暂停，预留和验证租约只在一个数据库事务内暂时读取 `image_uploads_paused=false`，
并在提交前恢复为 `true`；其他连接不会观察到开启状态，前端、附件函数外层开关和视觉
模型门禁始终关闭。

覆盖结果：

1. service role 只上传一个仓库内固定的规范 3×2 WebP 夹具，路径由随机成员、会话和
   附件 UUID 组成；不包含用户文件或对话内容。
2. 匿名和已登录成员直接读取私有 Storage 均被拒绝；本人历史 RPC 能恢复附件 URN，
   另一成员读取同一预览元数据得到空结果。
3. 30 秒签名预览返回 `image/webp`，字节数和 SHA-256 与受控夹具一致；签名 URL 不进入
   检查输出或证据。
4. 本人个人数据导出只包含 `mediaType`、字节、尺寸和生命周期时间；另一随机成员导出
   的附件计数为 0。导出中没有签名 URL、对象路径、Bucket、哈希、URN、附件 ID、会话
   ID、消息 ID、验证租约或错误码。
5. 删除历史消息自动创建唯一可领取删除任务；service-role 清理函数领取 1、删除 1、
   重试 0、死信 0，并确认 Storage 对账一致。
6. 清理后对象不可读、全局分配与实际对象字节均为 0、上传仍暂停；三个临时账号注销
   后，附件墓碑、已完成队列和 Storage 对象均物理归零。

首次运行暴露了检查器断言顺序错误：正式清理会在账号注销前保留 `deleted` 附件墓碑和
已完成队列，旧断言错误地要求这些行提前物理消失。异常收尾仍确认生产附件 0、对象 0、
未完成删除 0、全站暂停。修正后权威运行结果为：

```json
{
  "ok": true,
  "checksPassed": 56,
  "assetCount": 64,
  "cleanupFallbacks": 0,
  "cleanupConfirmed": true
}
```

## 受控清理工作流烟测

Pages 与生产榜单审计成功后，手动触发一次默认分支上的
`Clean WebChat image objects` 工作流（run `30158322261`，`limit=1`）。该次运行只调用
service-role 清理端点，不修改仓库变量，也不启用十分钟 schedule。脱敏聚合结果为：

```json
{
  "claimed": 0,
  "deleted": 0,
  "retried": 0,
  "deadLettered": 0,
  "deadLettersOutstanding": false,
  "storageAccountingConsistent": true
}
```

这证明生产函数的 service-role 授权、空删除队列、无重试/死信和 Storage 对账路径可用；
因为生产尚无图片对象，它不能替代正式开放前的真实对象删除与恢复验收。

## 仍然阻塞正式开放的项目

- 生产 Auth 仍为自动确认邮箱，CAPTCHA/Turnstile 尚未完成真实配置与注册滥用烟测。
- 前端粘贴、选择、预览、发送与刷新恢复尚未作为生产功能开放。
- 尚未完成精确视觉模型协议、真实图片 Usage/额度结算和付费请求生产烟测。
- 定时清理工作流仍未开启；空队列和真实对象 service-role 清理烟测均已通过，只有图片入口正式开放并完成失败/过期/孤儿对象验收后才考虑启用。
- 在上述项目完成前，不得开启任何图片 UI、视觉模型门禁或定时清理仓库变量。
