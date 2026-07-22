# 训练目标验收证据（2026-07-22）

## 结论

训练目标的数据库结构、私有权限、成功同步快照进度、成员端生命周期交互和个人数据导出接入已实现并部署。自动化测试、生产 Supabase 预检和本地隔离浏览器验收通过。

本记录不证明真实生产成员已完成创建、编辑、完成、归档和导出全流程，也不声称本轮重新执行了 pgTAP。上述两项完成前，`ROADMAP.md` 中训练目标的最终验收项保持未勾选。

## 实现证据

- 范围契约：`docs/training-goals-v1.md`。
- 数据库与 RLS：`supabase/migrations/202607210002_training_goals.sql`。
- 数据库权限与进度测试：`supabase/tests/38_training_goals.test.sql`。
- 成员端页面：`src/pages/TrainingGoalsPage.tsx`。
- 前端 RPC 适配：`src/features/training-goals/trainingGoalsApi.ts`。
- 页面与 API 单元测试：`src/pages/TrainingGoalsPage.test.tsx`、`src/features/training-goals/trainingGoalsApi.test.ts`。
- 个人数据导出测试：`src/lib/personalDataExport.test.ts`。

数据库 migration 使用 `profile_id references profiles(id) on delete cascade` 保留账号注销级联语义；表只向 authenticated 角色授予 select，所有写操作均通过从 `auth.uid()` 推导成员身份的 own-goal RPC 完成。管理员没有跨成员目标 RPC 或额外策略。

## 2026-07-22 执行结果

### 生产 Supabase 预检

执行 `npm run check:supabase-preflight`：

- 项目状态 `ACTIVE_HEALTHY`。
- 预检时远端共 61 个 migration，0 pending；随后推荐计划 migration 部署完成，当前远端共 62 个 migration，仍为 0 pending。
- 8 个 Edge Function、21 个 Function Secret 名称，0 缺失。
- schema lint 0 项。
- Auth 邮件、匿名 REST、Edge Function 边界和队列调度准备状态均为 true。
- Supabase 未启用 PITR 且无物理备份；项目继续依赖已演练的加密逻辑备份。此项属于既有平台风险，不由训练目标功能改变。

### 单元、静态与构建门禁

- 训练目标页面、API、个人数据导出和路由授权：4 个测试文件，30 项测试通过。
- `npm run lint -- --quiet`：通过。
- `npm run build`：通过，包含 TypeScript、Vite 生产构建、SPA fallback、站点元数据和 bundle budget 检查。
- `git diff --check`：通过。

### 浏览器与可访问性

在全新 e2e Vite 服务器上执行训练目标 axe 门禁：

- Chromium：通过。
- Firefox：通过。
- WebKit：通过。
- Mobile Chromium（390 x 844）：通过。
- Wide Chromium（1920 x 1080）：通过。

WebKit 首次启动时，Vite 对懒加载训练目标模块的冷编译超过共享的 7.5 秒断言预算。测试已改为仅对该路由使用 20 秒显式等待；全新服务器复跑和五项目整组复跑均通过，没有放宽全局断言。

随后在 127.0.0.1:4173 的隔离 e2e 配置中通过应用登录页进入成员会话，确认：

- 页面 URL 为 `/training-goals`，标题为“训练目标 | USTS ACM Land”。
- 页面不是空壳，无 Vite 或 React 错误覆盖层。
- 控制台 error/warn 为空。
- 当前目标空状态、创建目标表单和隐私提示正常显示。
- 点击“历史 0”后按钮 `aria-pressed=true`，并显示“还没有历史目标”。

## 尚未证明

- 本轮本地 Docker Desktop 未运行，`supabase test db ... --local` 无法连接本地数据库；不能把 pgTAP 文件的存在等同于本轮执行通过。
- 尚未使用真实生产成员数据完成创建、编辑、达到目标后确认完成、归档和个人数据导出的端到端烟测。
- 尚未在生产移动设备和人工屏幕阅读器上验收训练目标页面。

完成以上生产边界验证后，才能勾选训练目标最终验收项。
