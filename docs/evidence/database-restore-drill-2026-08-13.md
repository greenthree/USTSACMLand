# 当前 main Schema v2 加密备份与隔离恢复演练

日期：2026-08-13（Asia/Shanghai）

## 范围

- 生产项目：`qzggoqdmsvktrtnjislw` / `USTSACMLand`
- 备份提交：`29709004dca0d69b3778f512f13c5c8200018042`
- 加密备份运行：[31622577243](https://github.com/greenthree/USTSACMLand/actions/runs/31622577243)
- 隔离恢复运行：[31622919641](https://github.com/greenthree/USTSACMLand/actions/runs/31622919641)
- Supabase CLI：`2.109.1`

本次由项目负责人批准执行。备份只读取生产数据库和私有 Storage 元数据/对象；恢复工作流不使用生产 Supabase 凭据，不连接远端数据库，只在一次性 GitHub Runner 的本地 Supabase/PostgreSQL 17 中恢复。除下述 GitHub 仓库级 `SUPABASE_ACCESS_TOKEN` 轮换外，未修改生产数据库、Supabase Function Secret/Vault、函数或 Pages，也未触发模型、图片或 WebChat 请求。

## 凭据轮换

首次备份 run `31619244319` 与唯一受控重试 `31619567558` 均在配置检查通过后，于首个 `supabase link` 返回 `Unauthorized`。两次运行都没有开始数据库 dump、Storage 下载、加密或 Artifact 上传。项目负责人随后批准轮换仓库级 `SUPABASE_ACCESS_TOKEN`；新令牌由负责人直接写入 GitHub Secret，Agent 未读取、复制或记录令牌值。GitHub Secret 元数据确认更新时间为 2026-08-13 01:24（Asia/Shanghai），之后的正式备份成功。

新 Supabase PAT 于 2026-09-12 到期。维护 Agent 必须在到期前重新生成短期令牌、更新同名 GitHub Secret，并用一次成功备份确认轮换完成；不得等待定时备份因过期失败后再处理。

## 备份结果

备份工作流的配置检查、数据库与 Auth 导出、Schema v2 Storage 快照、动态白名单、AES-256-CBC/PBKDF2 加密、自解密校验、明文清理和密文 Artifact 上传全部通过。Artifact 仅包含加密文件及其校验和，按工作流保留 14 天。

## 隔离恢复结果

脱敏报告确认：

| 项目                   | 结果 |
| ---------------------- | ---: |
| `profiles`             |    8 |
| 平台账号               |   41 |
| 当前平台统计           |   40 |
| 统计快照               | 1411 |
| 同步运行               | 1828 |
| Auth 用户              |    8 |
| migration 历史         |   76 |
| WebChat 图片附件       |    0 |
| WebChat Storage 对象   |    0 |
| WebChat Storage 总字节 |    0 |
| 隔离恢复阶段耗时       | 3 秒 |

Storage 功能状态为 `installed`，Bucket `webchat-images` 保持私有；空清单 SHA-256 为标准空值。数据库引用与 Storage 对账、对象哈希校验和匿名访问拒绝均通过。

7 类孤儿关系全部为 `0`：Profile/Auth 双向、平台账号/Profile、统计/Profile、统计/平台账号、图片/Profile、图片/会话。

三个 `auth.users` 应用触发器已恢复；隔离临时账号的注册建档、密码登录、本人 Profile RLS、其他 Profile 隐藏、匿名公开视图、匿名私表保护、受控注销和 canary 清理全部通过。Runner、解密文件、临时凭据、Storage 对象和探针均在报告上传前清理。

## 结论与边界

本次演练证明当前 `main` 对应的 76-migration 生产快照可以在干净的 Supabase 平台基线中完成 Schema v2 解密、单事务恢复、Auth/RLS 验证、关闭态空 Storage 对账和清理。自动化恢复 RTO 基线为约 3 分钟；不包含新建远端项目、Secrets/Auth 回调、Edge Functions、DNS、第三方凭据和业务复核。

本证据不记录成员姓名、邮箱、QQ、平台账号、密码哈希、消息正文、SQL、连接信息、Token 或加密口令。
