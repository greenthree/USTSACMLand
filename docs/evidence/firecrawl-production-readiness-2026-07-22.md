# Firecrawl 生产就绪核对 — 2026-07-22

本文只记录脱敏的配置状态、函数状态和聚合统计，不包含 Firecrawl API Key、QOJ 服务账号、成员身份、平台账号、请求体、Job ID 或第三方响应正文。

## 生产边界核对

- Supabase 项目：`qzggoqdmsvktrtnjislw`
- 项目状态：`ACTIVE_HEALTHY`
- 生产 migration：61，待应用：0
- Edge Functions：8 个，均为 `ACTIVE`
- Function Secret 名称：21 个，路线图要求的 Firecrawl 与 QOJ Secret 均存在
- schema lint：0 项
- Auth / REST / Edge Function 边界：通过

本次只读取 Secret 名称及脱敏摘要，未读取或打印任何 Secret 值。

## 线上统计观察

通过匿名公开统计视图进行只读观察：

- 牛客最近成功记录包含直连版本 `nowcoder-rating-history-practice-v1`，也包含 Firecrawl 回退版本 `nowcoder-firecrawl-profile-v1`。
- QOJ 最近成功记录均使用 `qoj-firecrawl-interact-v1`，状态为 `fresh`。
- 观察到的 QOJ 自动同步记录均保留非零题数和最近成功时间，没有发现失败后被写成 `0` 的记录。

这证明当前已部署函数能够写入并公开呈现最近的牛客/QOJ 成功快照，但不等同于额度接口或每个 Key 的后台状态检查已完成。

## 实现与固定样本验证

本地使用仓库 import map 执行 Firecrawl/QOJ/牛客相关 Deno 测试：

- 57 passed，0 failed
- 覆盖 Key 池选择、数据库 Key 优先级、额度告警阈值、单 Key 故障隔离、冷却/轮换选择、QOJ 临时会话关闭、登录失败、Cloudflare challenge、限流、目标用户匹配和单次 attempt 无自动重试。

## 尚未宣称完成的项目

以下项目仍需要管理员在受控生产环境中执行，因其会访问真实 Firecrawl 额度或第三方登录：

1. 对每个已启用 Key 执行一次额度检查，确认启用状态、剩余额度、冷却和轮换结果。
2. 使用脱敏的牛客回退和 QOJ 健康检查各执行一次，记录请求是否成功及会话是否关闭。
3. 使用无效 QOJ 凭据、Cloudflare challenge、Firecrawl `429` 做一次受控失败演练；确认失败分类、冷却和一次队列重试边界。

因此 `ROADMAP.md` 中 P0 Firecrawl/QOJ 条目继续保持未完成，不能仅凭本次只读观察和固定样本测试勾选。
