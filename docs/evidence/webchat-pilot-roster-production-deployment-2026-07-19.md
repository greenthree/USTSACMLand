# WebChat 正式观察名单独立部署证据（2026-07-19）

日期：2026-07-19（Asia/Shanghai）

## 目标

把“允许使用 AI 助手”与“纳入 3–5 人正式试运行观察”拆成两个独立策略。现有获权账号继续使用 AI，但不会自动被当作已经进入 168 小时正式观察。

## 数据库与权限边界

- 生产应用 migration `202607190004_webchat_pilot_roster.sql`，生产 migration 总数从 54 增至 55。
- 部署后的 `db push --linked --include-all --dry-run --yes` 返回 `Remote database is up to date`，migration list 显示本地与远端均包含 `202607190004`，无 pending。
- `private.webchat_member_access.pilot_observation_enabled` 默认 `false`，所以 7 个既有获权账号不会被自动纳入正式观察，AI 使用权限不受影响。
- 独立私有单例状态保存名单版本和观察起点；加入、移出、正式成员权限/额度变化，以及正式成员账号停用或恢复都会重置观察时钟。
- 管理员策略 RPC 使用事务 advisory lock 串行化名单变更，最多允许 5 个显式名单成员；停用成员仍占用名单槽位，避免恢复时形成 6 人名单。
- 普通成员、匿名角色和 Edge `service_role` 均不能直接读取名单策略或观察时钟；管理员观测仍不返回对话正文、请求编号、密钥或其他成员私密消息。

## 自动化验证

Draft PR [#91](https://github.com/greenthree/USTSACMLand/pull/91) 的功能提交 `d4c1c13` 通过：

- CI run [`29671595896`](https://github.com/greenthree/USTSACMLand/actions/runs/29671595896)：`verify` 与 `database-security` 成功。
- Secret scan run [`29671595912`](https://github.com/greenthree/USTSACMLand/actions/runs/29671595912)：`gitleaks` 成功。
- PostgreSQL 17 空库执行 35 个 pgTAP 文件、882 项断言，覆盖管理员授权、五人上限、并发锁、旧 RPC 兼容、停用/恢复、审计、无变化写入和观察时钟。
- 五种浏览器配置验证管理员可区分“已授权”和“正式观察”，并能从观测表进入真实存在的演示成员详情修改独立开关。
- 本地再次通过 74 个 Vitest 文件、397 项测试、Lint、生产构建，以及针对管理后台的 10 个 Playwright 跨浏览器用例。

## 剩余验收

该部署只提供独立、安全的名单选择能力，不声称正式试运行已完成。管理员仍需在成员详情中选择 3–5 名正常获权账号；名单稳定后连续观察 168 小时，并人工复核成员覆盖、失败请求、未知 Usage、活动生成和缓存命中情况，才能完成 WebChat 总功能条目。
