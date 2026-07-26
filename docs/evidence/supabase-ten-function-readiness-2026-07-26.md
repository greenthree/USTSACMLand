# Supabase 十函数生产就绪核对 - 2026-07-26

## 结论

生产 Supabase 的十个 Edge Function 已全部纳入同一套可复跑的就绪检查。检查器不再只验证最早的四个账号与同步函数，而是同时覆盖 WebChat、图片附件、图片清理、缓存探针和两个后台配置函数。

本次只读检查没有修改生产数据库、Function Secret、Auth 设置或功能开关，也没有读取或输出 Secret 值。

## 边界契约

- 面向正式网页调用的八个函数必须精确允许 `https://ustsacm.fun`，响应包含 `Vary: Origin`，且不能向恶意 Origin 返回 `Access-Control-Allow-Origin`。
- `webchat-image-cleanup` 与 `webchat-cache-probe` 是仅供后台调用的函数，必须拒绝所有浏览器 Origin，不能因为正式站点 Origin 合法就开放 CORS。
- 十个函数都必须为 `ACTIVE`、启用 JWT 验证并使用仓库 import map；匿名 GET 只能体现认证或方法边界。
- 对恶意 Origin 返回 `403` 属于明确拒绝，与 `200` 但不授权 CORS 一样安全；检查器不再把前者误报为故障。

## 生产结果

`npm run check:supabase-readiness` 读取到：

- 项目状态 `ACTIVE_HEALTHY`；
- 71 个 migration，0 个 pending；
- 10 个 ACTIVE Edge Function；
- 21 个 Function Secret 名称，0 个必需名称缺失；
- 0 个 public schema lint 问题；
- 匿名 REST 权限边界通过；
- 十函数 JWT、import map、CORS/后台拒绝和方法边界通过；
- 数据库同步队列调度器通过。

严格检查仍以失败退出，因为生产 Auth 仍自动确认邮箱，且服务端 CAPTCHA 尚未启用。Supabase 当前也没有 PITR 或可用物理备份，因此继续依赖已演练的加密逻辑备份。这些独立阻塞没有被本次十函数边界结果掩盖。

## 自动化

- `scripts/check-supabase-readiness.test.ts`：19 项通过；
- `scripts/check-ci-workflow.test.ts`：16 项通过；
- 新增图片函数缺失、JWT/import map 错误、图片函数缺少边界探针和后台函数误开浏览器 Origin 的失败用例；
- 发布检查单的 Deno 类型检查入口已补齐 `webchat-attachment` 与 `webchat-image-cleanup`；
- 推荐计划本地双连接验证器已加入发布检查单和数据库 CI 门禁。

本记录只证明检查器覆盖和当前只读生产状态，不替代真实邮箱确认、Turnstile 注册、视觉模型图片请求或生产推荐计划并发烟测。
