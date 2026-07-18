# WebChat 成员累计总额度生产发布证据（2026-07-18）

## 发布范围

- 成员请求数与 Token 限额从北京时间每日额度迁移为累计总限额。
- 迁移前的全部历史用量继续计入总限额，不执行清零或重算。
- 管理员提高总限额可追加成员余额；降低到历史用量以下会立即阻止新请求，剩余额度按 0 展示。
- 全站请求数与 Token 预算保持北京时间每日重置，不随成员额度迁移。
- 过期 `claimed` 请求释放请求次数与预留 Token；过期 `started` 请求保留请求次数并将预留 Token 计入已用量。

## 生产部署

- 功能 PR：[GitHub #64](https://github.com/greenthree/USTSACMLand/pull/64)
- 主分支提交：`b9cb0aa193ec18ac41148c4fdb42eca6bb049d8a`
- Supabase migration：`202607180003_webchat_total_member_quotas.sql`
- 生产数据库：48 个 migration，0 个待应用 migration
- `webchat` Edge Function：v8，`ACTIVE`，JWT 验证开启
- main CI：[run 29639712128](https://github.com/greenthree/USTSACMLand/actions/runs/29639712128)
- GitHub Pages：[run 29639931670](https://github.com/greenthree/USTSACMLand/actions/runs/29639931670)

## 自动化验证

- PostgreSQL 17 空库应用全部 migration，并执行 28 个 pgTAP 文件、698 项断言，全部通过。
- Vitest：64 个文件、332 项测试通过。
- 通用 Playwright：140 项测试通过。
- WebChat 专用 Playwright：48 项测试通过，12 项按既有项目/环境条件跳过。
- 构建、Prettier、ESLint、CI 静态门禁、Deno check/lint/test 全部通过。
- Pages 的生产榜单独立重算审计 3 项通过。

## 生产静态资源烟测

- 主资源：`index-Cu1-HuTK.js`
- AI 助手资源：`AssistantPage-guKcjj1N.js`
- `/assistant` 资源包含“累计使用额度”和“当前模型”。
- 成员额度资源不再包含北京时间重置或重置时间文案。
- 后台成员详情资源包含“累计请求总上限”“累计 Token 总上限”和“不会每日重置”。
- 后台试运行面板资源包含“累计请求”和“累计占用 Token”。

## 保留边界

- AI 助手总功能仍处于试运行观察阶段，因此 `ROADMAP.md` 的总功能条目继续保持未完成状态。
- 本次发布没有改变中转站、Vault API Key、系统分钟限流、全站日预算和内容不落库边界。
