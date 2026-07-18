# 每日一题生产发布与生命周期烟测

日期：2026-07-18  
目标项目：`qzggoqdmsvktrtnjislw`  
正式站点：`https://greenthree.github.io/USTSACMLand/`

本文只记录脱敏结果，不包含成员 UUID、邮箱、QQ、访问令牌、数据库连接信息或管理员身份。

## 发布链

- 生产数据库先应用 `202607180001_daily_problem_learning.sql`，远端 migration 为 46/46、无 pending。
- PR [#60](https://github.com/greenthree/USTSACMLand/pull/60) 合并提交：`b0073ab5365f006e48da64ed4b7ce467677d8ce7`。
- PR CI run `29634250422`：`verify` 与 `database-security` 通过；PostgreSQL 17 空库执行 26 个 pgTAP 文件、658 项计划断言。
- 主分支 CI run `29634498300`：`verify` 与 `database-security` 再次通过；secret scan run `29634498299` 通过。
- Pages run `29634708322`：`build`、`deploy`、`production-ranking-audit` 全部通过，部署目标为同一合并提交。

## 数据库与匿名边界

- 匿名调用 `read_daily_problem_feed` 返回 HTTP 200 和 JSON 数组。
- 匿名调用 `set_own_daily_problem_completion` 返回 HTTP 401。
- 三张学习基表未授予浏览器角色直表权限；浏览器仅通过受控 RPC 访问。

## 真实成员会话

使用一个已启用的普通成员会话访问正式 `/daily-problem`，确认导航中没有管理后台入口，控制台无 error/warn。

临时发布一条明确标注的烟测题目后，依次确认：

1. 完成数量由 0 变为 1，按钮进入“今天已完成”状态。
2. 撤销后完成数量由 1 回到 0，按钮恢复“标记为已完成”。
3. 发布纯文本讨论后，可见讨论数量由 0 变为 1，页面显示“讨论已发布”。
4. 成员删除本人讨论后，可见讨论数量回到 0，页面显示“讨论已删除”。

## 管理员审核

管理员上下文通过生产 `admin_set_daily_problem_comment_visibility` RPC 执行审核：

1. 填写原因隐藏讨论后，数据库 `hidden_count=1`；普通成员刷新后看不到正文，可见讨论数量为 0。
2. 填写原因恢复讨论后，数据库 `visible_count=1`；普通成员刷新后重新看到原纯文本内容，可见讨论数量为 1。
3. 隐藏与恢复均使用当前 `updated_at` 乐观锁版本并写入不含秘密的审核审计。

## 清理

烟测结束后，成员先撤销完成并删除本人讨论，再由数据库管理员清理临时已发布题目及对应烟测审计。最终复核：

| 项目         | 剩余数量 |
| ------------ | -------- |
| 临时烟测题目 | 0        |
| 临时讨论     | 0        |
| 烟测审计     | 0        |

正式页面随后恢复“这一天还没有公开题目”空状态，控制台仍无 error/warn。烟测没有创建或保留伪造的正式训练内容；后续真实每日题目由管理员在后台维护。
