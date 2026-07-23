# WebChat 图片安全基础本地证据（2026-07-23）

日期：2026-07-23（Asia/Shanghai）

## 范围

本轮只完成图片输入的上线前安全基础，不代表图片功能已发布：

- `202607230001_webchat_image_attachments.sql` 未部署生产。
- `webchat-attachment` 与 `webchat-image-cleanup` 未部署生产。
- `VITE_WEBCHAT_IMAGE_INPUT_ENABLED`、`CHAT_IMAGE_INPUT_ENABLED`、
  `CHAT_VISION_ENABLED` 继续为 `false`。
- 仓库变量 `WEBCHAT_IMAGE_CLEANUP_ENABLED` 保持缺失或为 `false`，定时清理任务
  不会调用未部署的生产端点；`workflow_dispatch` 只保留给未来受控烟测。

## 已验证改动

1. 上传频率从固定一小时桶改为真正的滚动窗口：预约函数在每账号状态行
   `FOR UPDATE` 锁内统计最近一小时 `reserved_at` 记录。重复附件 ID 幂等返回，
   删除 tombstone 在保留期间仍计入频率，避免上传后立即删除绕过限制。
2. WebChat 在上游启动前失败时释放额度 claim；释放 RPC 返回 `false` 或抛错都会
   安全上报，监控服务自身抛错也不会覆盖原始结构化业务错误。
3. 备份任务临时导出 `storage.objects` metadata，以真实对象的 MIME、Cache-Control、
   字节数与数据库引用共同生成清单。属性缺失、漂移或对象行缺失都会终止备份。
4. 隔离恢复按清单中的 MIME/Cache-Control 上传对象，再查询恢复后的
   `storage.objects.metadata` 与数据库引用、清单、对象哈希逐项比对。
5. 十分钟图片清理 schedule 只有在仓库变量
   `WEBCHAT_IMAGE_CLEANUP_ENABLED=true` 时运行，避免未部署 migration/函数期间产生
   持续 404/500 与错误告警。
6. 全站上传数量、原始字节、Storage 容量和 validation 并发共用既有 WebChat 全局
   quota singleton，所有包装 RPC 先取得全局行锁，再进入账号、会话和附件状态机。
   默认 `image_uploads_paused=true`，容量只在 Storage 删除 worker 确认后释放。
7. 清理 worker 每轮对比全局计数、附件分配和 `storage.objects` metadata；计数漂移、
   孤儿对象或 ready 对象缺失时自动暂停新上传，并以 HTTP 207 和稳定字段告警。
8. 独立 Supabase 实例从空数据库顺序应用全部 migration；真实两个 PostgreSQL 连接
   观测到 B 等待 A 的全局优先 quota 锁，A 提交第 30 个预留后，B 的第 31 个预留以
   SQLSTATE `54000` 被账号滚动限额拒绝。验证结束后全局配置逐项恢复且夹具为零。
9. 图片请求除 `CHAT_VISION_ENABLED=true` 外还要求当前数据库运行模型与
   `CHAT_VISION_MODEL` 精确一致；管理员更换模型后，请求会在额度 claim、附件绑定和
   上游调用前恢复失败关闭。预览和模型读取签名 URL 的 TTL 均不超过 120 秒。
10. 额度结算明确区分上游启动边界：启动前失败释放预留；启动后有可信 usage 时按
    真实用量结算，无法取得 usage 时把完整预留转入 `unknown_tokens`，避免主动中止
    绕过成员和全站总限额，同时不留下悬挂预留。

## 自动化结果

| 检查                                      | 结果                                     |
| ----------------------------------------- | ---------------------------------------- |
| 完整 Vitest                               | 87 个文件、526 项通过                    |
| Deno check                                | 10 个 Edge Function 入口通过             |
| Deno lint                                 | 131 个文件通过                           |
| Deno test                                 | 439 项通过                               |
| 干净 migration 安装                       | 从空库顺序应用全部 50 个受保护 migration |
| 完整 pgTAP                                | 45 个文件、1149 项通过                   |
| 图片附件状态机                            | 114 项通过                               |
| 图片全局限额                              | 26 项通过                                |
| 真实双连接第 30/31 个预留                 | 通过，发生锁等待且最终严格保留 30 个     |
| `db lint --schema public --level warning` | 通过，无 warning                         |
| ESLint / Prettier                         | 通过                                     |
| 生产构建与 bundle/metadata 检查           | 通过                                     |
| CI、备份、恢复工作流检查器                | 通过                                     |
| actionlint v1.7.7                         | 5 个相关工作流通过                       |
| WebChat 图片 Playwright                   | 5 项通过、3 项按项目条件预期跳过         |
| `git diff --check`                        | 通过                                     |

日常本地数据库已经应用过旧版 pending 图片 migration，因此未清空开发数据。本轮另起
独立端口的临时 Supabase 实例，从空数据库安装当前 migration 链并完成完整 pgTAP、
warning 级 schema lint 和真实双连接验证；实例随后停止，不接触生产数据库。

Playwright 已覆盖图片单独发送与刷新恢复、Chromium 剪贴板粘贴、单条第 5 张图片
拒绝、移除后恢复发送、390 px 移动端无横向溢出与 axe 检查，以及移动端图片发送与
恢复。3 项跳过均为测试代码明确限定的非目标项目组合：非 Chromium 不运行剪贴板与
第 5 张限制用例，非 mobile-chromium 不重复运行移动端 axe 用例。

Codex 内置 Browser 当前无法访问 Windows 主机上的 `127.0.0.1:5173` 与
`localhost:5173`，只能得到连接错误页，因此本轮没有把内置 Browser 截图作为视觉
验收证据；这不等同于页面渲染失败。5173 开发服务保持运行，E2E 专用的 4175/4176
服务已在验证完成后停止。

## 未完成边界

- 匿名注册滥用防护、真实视觉模型、真实对象清理和 Schema v2 备份恢复演练尚未完成。
- 图片 UI、历史恢复、视觉消息组装与生产级端到端自动化尚未全部收口；精确模型
  绑定仍需真实视觉模型受控烟测。
- 上述项目完成前，生产三层图片开关和清理 schedule 门控不得开启。
