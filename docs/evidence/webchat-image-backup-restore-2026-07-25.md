# WebChat 图片备份与隔离恢复证据（2026-07-25）

## 结论

生产加密备份已经能够识别已安装的 WebChat 图片数据结构，并在一次性本地 Supabase
环境中恢复数据库、重建私有 `webchat-images` Bucket、验证匿名访问拒绝、核对 Storage
清单与数据库引用，并完成 Auth、RLS 和受控注销烟测。

本轮备份时生产 Bucket 中没有图片对象，因此恢复清单的对象数和总字节数均为 0。工作流
额外创建并删除一个不含用户内容的隔离环境 Storage 探针，以验证恢复后的 Bucket 确实为
私有且匿名访问被拒绝。真实图片对象的保存、签名预览、跨成员拒绝和物理清理已经由另一轮
生产生命周期验收覆盖，但本记录不把零对象快照描述为“完成了非空对象字节回放”。

图片前端入口、视觉模型和定时清理仍保持关闭；本记录不代表图片输入已经上线。

## 权威运行

| 项目         | 结果                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| 加密备份     | [run `30161408322`](https://github.com/greenthree/USTSACMLand/actions/runs/30161408322)，成功，约 3 分 51 秒 |
| 隔离恢复     | [run `30162123199`](https://github.com/greenthree/USTSACMLand/actions/runs/30162123199)，成功，约 2 分 12 秒 |
| 备份来源状态 | 图片数据结构已安装；对象数 0、总字节数 0                                                                     |
| 恢复报告     | `ok=true`；数据库恢复与完整性验证阶段 3 秒                                                                   |

脱敏报告只包含公开运行编号、聚合计数、布尔结果和耗时，不包含姓名、邮箱、QQ、成员
UUID、对象路径、签名 URL、会话 ID、SQL、数据库连接或任何 Secret。

## 备份边界

成功备份完成以下图片相关检查：

1. 从 Supabase 导出的 PostgreSQL 数据中结构化识别图片附件表为 `installed`，支持带引号
   和不带引号的 `COPY` 表头。
2. 对缺列、重复数据块、未闭合数据块和非法安装状态保持失败关闭。
3. 生成 Schema v2 Storage 摘要和清单，并把当前零对象状态明确记录为 0，而不是误判为
   功能未安装或跳过图片数据。
4. 将图片 Storage 摘要与数据库逻辑备份一起加密，并完成密文校验和自解密验证；工作流
   只上传密文和脱敏元数据。

## 隔离恢复结果

恢复工作流没有连接生产 Supabase，也没有生产项目写权限。它在 GitHub Runner 的一次性
本地 Supabase/PostgreSQL 17 环境中完成：

- 数据库事务恢复、聚合行数和孤儿引用核对通过。
- `webchat-images` Bucket 重建为私有 Bucket，文件上限和 MIME 约束恢复。
- 因源快照对象数为 0，工作流创建一次性 Storage 探针；匿名无 Bearer 和匿名 Bearer
  两种读取均被拒绝，探针随后删除。
- Storage 清单、数据库引用、对象计数和哈希核对通过；本次对象集合为空。
- Auth 应用触发器、随机临时账号密码登录、本人 Profile RLS、他人 Profile 隔离、匿名
  公共视图和匿名私表边界均通过。
- 临时账号经恢复后的受控注销围栏删除，Auth/Profile 和临时 Storage 探针均无残留。

## 失败关闭与修复记录

成功运行前的两个失败没有修改生产数据，也没有被自动重试或用宽松断言绕过：

1. [备份 run `30160631324`](https://github.com/greenthree/USTSACMLand/actions/runs/30160631324)
   因固定文本匹配不能识别 Supabase 导出的带引号 `COPY` 表头而失败。PR
   [#119](https://github.com/greenthree/USTSACMLand/pull/119) 改为结构化
   `installed/uninstalled` 检测，并补齐异常输入的失败关闭。
2. [恢复 run `30161545455`](https://github.com/greenthree/USTSACMLand/actions/runs/30161545455)
   因 PostgreSQL `false::text` 的输出与工作流错误比较值不一致而失败。PR
   [#120](https://github.com/greenthree/USTSACMLand/pull/120) 改为明确输出并校验
   `private/public` 状态。

两个修复都先通过 PR 的 CI、数据库安全检查和 Secret scan，再进入 `main`。最终成功恢复
复用了同一份成功加密备份，因此验证的是修复后的恢复逻辑，而不是重新生成一份更宽松的
快照。

## 尚未覆盖

- 当前生产快照没有图片对象；仍需在正式开放前用受控非空夹具完成一次“备份、隔离恢复、
  字节和哈希回放、夹具清理”的单次贯通演练。
- 真实视觉模型、多模态请求格式和图片 Token/Usage 结算尚未完成生产烟测。
- CAPTCHA/Turnstile、真实邮箱确认和注册滥用防护尚未达到图片入口开放条件。
- `VITE_WEBCHAT_IMAGE_INPUT_ENABLED`、`CHAT_IMAGE_INPUT_ENABLED`、
  `CHAT_VISION_ENABLED` 和 `WEBCHAT_IMAGE_CLEANUP_ENABLED` 必须继续保持关闭。
