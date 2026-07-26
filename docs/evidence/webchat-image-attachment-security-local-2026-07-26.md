# WebChat 图片附件安全与真实编解码本地验收（2026-07-26）

## 结论

图片附件的签名预览 URL 门禁、真实图片规范化、EXIF 清理、上传失败回滚、删除队列和运行时
监控脱敏已经通过本地自动化复核。生产图片前端、视觉模型和定时清理开关继续关闭；本记录不
代表图片输入已经向成员开放，也不替代开放态生产验收。

## 修复的生产阻塞项

原实现尝试将 `npm:` WASM specifier 转换为文件 URL 后交给 `Deno.readFile`。Deno 2 的
`import.meta.resolve('npm:...')` 仍返回 `npm:` specifier，不能作为文件 URL 读取，因此真实
JPEG、PNG 和 WebP 输入都会被安全地归类为 `image_decode_failed`。

现在四个固定版本的非 SIMD WASM 编解码器随 Edge Function 目录交付：

- `@jsquash/jpeg@1.6.0` JPEG decoder；
- `@jsquash/png@3.1.1` PNG codec；
- `@jsquash/webp@1.5.0` WebP decoder；
- `@jsquash/webp@1.5.0` portable WebP encoder。

二进制来源、SHA-256 和许可证均保存在
`supabase/functions/webchat-attachment/codecs/`；`supabase/config.toml` 通过 `static_files`
显式把四个 WASM 文件纳入函数部署包。运行时只读取相对 `import.meta.url` 的仓库内资产，
不依赖开发机 Deno 缓存路径、网络下载、实验性 raw import 或运行时 SIMD 分支。

本地 Supabase Edge Runtime 内部使用 `http://kong:54321` 访问 Storage，不能把这个仅容器可见
的地址直接返回浏览器。函数现在支持显式的 `CHAT_IMAGE_PREVIEW_ORIGIN`：生产仍只接受 HTTPS
源；本地烟测可显式配置 loopback HTTP，并且只替换 Supabase 已签名 URL 的 origin，签名路径与
query 保持不变。带凭据、路径、query、fragment 的 origin 配置和外部 HTTP origin 均失败关闭。

## 安全边界

- 真实 JPEG、PNG 和 WebP 均解码后重新编码为规范 WebP；
- JPEG EXIF 方向在像素层应用，EXIF、注释和尾随元数据不会进入输出；
- 解码后的宽高、像素总量和 RGBA 字节数再次与容器头及服务端上限核对；
- SVG、动图、伪造 MIME、非法尾随容器数据和结构有效但不可解码的输入保持拒绝；
- Storage 签名 URL 只允许生产 HTTPS；本地开发仅允许 loopback HTTP；
- 带用户名、密码、fragment、超长或其他不安全形式的签名 URL 失败关闭；
- 固定错误响应和运行时监控不会包含原始文件名、对象路径、签名 URL、token 或图片内容；
- 首次签名失败、完成状态失败和删除请求均保持对象回滚或 durable outbox 边界。

## 自动化结果

图片附件、清理、WebChat 协议/额度和共享监控专项命令：

```text
npx --yes deno@2 test --allow-read \
  --config supabase/functions/deno.json \
  supabase/functions/webchat-attachment/ \
  supabase/functions/webchat-image-cleanup/ \
  supabase/functions/_shared/error-monitoring_test.ts \
  supabase/functions/webchat/
```

结果为 129 项通过、0 项失败，其中包含真实 JPEG/PNG/WebP 规范化、JPEG EXIF 样例和本地
预览 origin 重写门禁。

全量 Edge Function 测试使用与 CI 相同的 `--allow-read --allow-env` 权限，结果为 462 项通过、
0 项失败、1 项按环境忽略。仓库回归同时通过：

- Vitest：90 个测试文件、553 项通过；
- ESLint：0 warning、0 error；
- Prettier 全仓检查通过；
- TypeScript 与 Vite 生产构建、站点元数据、SPA fallback 和 bundle budget 检查通过。

Docker Desktop 恢复后，48 个 pgTAP 文件、1205 项数据库断言再次全部通过。

## 真实本地 Edge Runtime 烟测

使用 `supabase-edge-runtime-1.74.2`（Deno 2.1.4 compatible）启动完整本地函数环境，并通过
临时已确认成员执行一次真实链路：

1. 创建本人 WebChat 会话并上传真实 PNG；
2. Edge Runtime 从部署包读取 WASM，输出 152 字节规范 WebP；
3. 签名预览内容头为 `RIFF` / `WEBP`，历史预览 RPC 可恢复相同附件；
4. 用户移除附件后，正式清理函数返回 `claimed=1`、`deleted=1`、`retried=0`；
5. Storage 对账一致，死信为零；
6. 使用正式恢复租约和 fenced Auth 删除 RPC 注销临时成员。

烟测结束后已恢复 `image_uploads_paused=true`，并确认临时 Auth 用户、Profile、会话、附件、
待处理删除队列、死信、私有 Bucket 对象和全局已分配 Storage 字节全部为零。输出只记录布尔值、
计数和规范化字节数，不记录成员标识、邮箱、Token、签名 URL、对象路径或图片内容。

## 尚未完成

- 部署包含固定 WASM 资产的新函数版本，并在生产默认关闭状态验证部署包可读取资产；
- 开放态验证真实上传、短时预览、发送、刷新恢复、失败/过期/孤儿清理；
- 使用审核后的真实视觉模型完成图片理解和真实 usage 结算烟测；
- 完成包含非空图片对象的备份恢复贯通演练。
