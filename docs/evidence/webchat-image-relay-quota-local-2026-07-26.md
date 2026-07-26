# WebChat 图片中转格式与额度生命周期本地验收（2026-07-26）

## 结论

图片消息的服务端中转格式、视觉模型门禁和 WebChat 额度生命周期已经完成本地代码审计与
自动化复核。服务端只在当前运行模型与管理员审核的视觉模型完全一致时接受图片；图片以
Responses API 的 `input_image` 高精度部件发送，不会静默丢图、转换为 OCR 文本或自动切换
模型。

生产的前端、视觉模型和附件全局开关继续关闭。本记录不代表图片输入已经向成员开放，也不
替代真实视觉模型和真实中转站 usage 的生产烟测。

## 多模态协议与门禁

- 请求解析只接受本人历史消息中的私有附件 URN，文件部件只能出现在用户消息；
- 当前运行模型必须与 `CHAT_VISION_MODEL` 完全一致，并且 `CHAT_VISION_ENABLED=true`；
- 不兼容或未审核模型稳定返回 `vision_not_enabled`，且不会领取额度或读取附件；
- 服务端绑定附件到本人会话和消息后，才生成短时 HTTPS 签名 URL；
- 中转请求使用 `input_text` 与 `input_image`，图片固定 `detail: high`；
- 请求固定 `tools: []`、`tool_choice: none`，不存在 OCR 或模型替换分支；
- 附件指纹只包含附件 UUID，不包含签名 URL、对象路径、原始文件名、尺寸或内容。

## Token 预留与结算

- 图片请求沿用相同的单次 claim、成员累计请求上限、成员累计 Token 上限和全站预算；
- 领取额度前无法读取附件尺寸，因此每张图片按 2,048 × 2,048 的高精度最坏情况预留；
- 图片估算使用 32 px patch、每 patch 4 Token、固定 256 Token 框架开销；
- 成功响应只接受中转站 `response.completed` 或受支持的 `response.incomplete` 中可信且内部
  一致的 input/output/total usage；
- 上游启动后超时、HTTP 错误、协议错误、客户端取消或缺失 usage 均以 `usage=null` 结算，
  数据库把原预留计入未知用量；
- 每次请求只调用一次上游 fetch，没有自动重试。

## 本轮边界修正

本轮将完整请求体和图片 URL 校验移动到数据库“上游已启动”围栏之前，并将上游超时计时器
移动到围栏确认之后。因此：

- 本地图片 URL 或序列化失败不会被误记为未知上游用量，而是由处理层释放尚未启动的 claim；
- 数据库围栏耗时不再侵占上游响应超时时间；
- 围栏确认后发生的失败只走未知用量结算，处理层不再额外尝试释放已经启动的 claim；
- 围栏响应丢失等不确定状态仍由数据库状态机拒绝不安全释放，保持保守计费边界。

## 自动化结果

执行：

```text
npx --yes deno@2 test --config supabase/functions/deno.json \
  supabase/functions/webchat/quota_test.ts \
  supabase/functions/webchat/upstream_test.ts \
  supabase/functions/webchat/handler_test.ts \
  supabase/functions/webchat/request_test.ts
```

四个图片与额度核心文件结果为 67 项通过、0 项失败；随后完整
`supabase/functions/webchat/` 目录为 79 项通过、0 项失败。新增门禁覆盖：

- 无效图片 URL 在围栏前失败，mark、fetch 和 finalize 均不执行；
- 图片请求只发送一次，并以真实上游 usage 完成结算；
- 上游超时从数据库围栏确认后开始计算；
- 围栏确认后的失败不会再调用 pre-start release。

仓库回归同时通过：

- Vitest：90 个测试文件、553 项通过；
- ESLint：0 warning、0 error；
- Prettier 全仓检查通过；
- TypeScript 与 Vite 生产构建通过，站点元数据、SPA fallback 和 bundle budget 检查通过。

## 尚未完成

- 使用真实视觉模型完成图片理解与真实 usage 生产烟测；
- 生产开放态的上传、签名预览、发送、刷新恢复和异常结算贯通验收；
- 开放态对象清理、个人数据导出、日志脱敏和非空对象备份恢复演练。
