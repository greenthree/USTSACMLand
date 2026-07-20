# 个人数据导出生产发布与烟测证据（2026-07-20）

日期：2026-07-20（Asia/Shanghai）  
目标项目：`qzggoqdmsvktrtnjislw`  
正式站点：`https://greenthree.github.io/USTSACMLand/`

本文只记录运行标识、聚合数量和布尔验收结果，不记录姓名、邮箱、QQ、平台账号、成员 UUID、AI 对话正文、访问令牌、数据库连接或服务密钥。真实导出文件只保存在执行烟测的本机下载目录，不提交到仓库或 CI Artifact。

## 发布链

- PR [#93](https://github.com/greenthree/USTSACMLand/pull/93) 合并提交：`2a6e40cef60942d6354edc84d9334236a84256a3`。
- PR CI run [`29727968354`](https://github.com/greenthree/USTSACMLand/actions/runs/29727968354)：`verify` 与 `database-security` 成功；Secret scan run [`29727968386`](https://github.com/greenthree/USTSACMLand/actions/runs/29727968386) 成功。
- PostgreSQL 17 空库执行 36 个 pgTAP 文件、898 项断言，覆盖本人绑定、管理员只能导出自己、匿名拒绝、字段裁剪、WebChat 私有会话和自动 XCPC 行等边界。
- 生产应用 `202607190005_personal_data_export.sql` 后，migration list 为 56/56、0 pending。
- 主分支 CI run [`29728544612`](https://github.com/greenthree/USTSACMLand/actions/runs/29728544612) 全部通过；Pages run [`29729048673`](https://github.com/greenthree/USTSACMLand/actions/runs/29729048673) 的 `build`、`deploy` 和 `production-ranking-audit` 全部成功。

## 真实成员烟测

使用一个已登录的普通测试成员访问正式 `/account`：

1. 页面显示“导出个人数据”区域与唯一“导出我的数据”按钮。
2. 点击后页面返回成功状态，并生成 `usts-acm-land-personal-data_<UTC 时间>.json`。
3. 下载文件可被解析为 JSON，文件大小约 43 KiB，`schemaVersion` 为 `1`。
4. 顶层只包含 `account`、`profile`、`platformAccounts`、`platformStats`、`statSnapshots`、`syncHistory`、`dailyProblem`、`webchat`、`schemaVersion` 与 `exportedAt`。
5. 导出账号邮箱与当前测试成员一致；递归检查 `userId`、`memberId`、`profileId` 等归属引用，没有发现指向其他成员的值；文件内唯一邮箱也属于当前成员。
6. 本次账号的导出包含非空平台绑定、同步历史、WebChat 请求账本和本人私有会话，证明 RPC 不是仅返回空壳结构；证据文档不记录其中的值或正文。

## 敏感字段边界

对全部 JSON 键执行不区分大小写的递归检查，以下敏感类别命中数为 `0`：

- 密码、Access/Refresh Token、service role；
- API Key、Base URL；
- WebChat owner token、请求 fingerprint；
- `admin_id`、`approved_by`、`updated_by`、`hidden_by` 等管理员标识。

该扫描与数据库 pgTAP 边界共同确认：导出只面向当前认证主体，管理员不能借此指定或读取其他成员，浏览器也不会保存额外的服务端导出副本。

## 结论与剩余范围

个人数据导出子项已完成生产发布与真实成员验收，可在 ROADMAP 中单独标记为完成。其父项仍包含尚未实现的“训练目标”和“连续活跃天数”，因此父项继续保持未完成。
