# 训练目标验收证据（2026-07-22）

## 结论

训练目标的数据库结构、私有权限、成功同步快照进度、成员端生命周期交互和个人数据导出接入已实现并部署。自动化测试、生产 Supabase 预检和本地隔离浏览器验收通过。2026-07-26 又使用真实生产成员完成创建、编辑、刷新恢复、归档和个人数据导出生成烟测。

本记录仍不证明真实生产目标已经通过成功同步达到阈值并完成“确认完成”流程，也不声称 2026-07-26 重新执行了 pgTAP。ROADMAP 已把完成的生产生命周期步骤与这两个剩余边界拆开记录。

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

- 2026-07-26 本地 Docker Desktop 引擎不可用，`supabase test db ... --local` 无法连接本地数据库；不能把 pgTAP 文件的存在或历史 CI 结果等同于本轮本地执行通过。
- 尚未使用真实生产成员数据完成“成功同步使目标达到阈值 → 确认完成”的路径。
- 尚未在生产移动设备和人工屏幕阅读器上验收训练目标页面。

## 2026-07-26 真实成员生产生命周期烟测

使用一名已登录的真实生产成员执行以下流程：

1. 页面初始状态为 0 个进行中目标、1 个历史目标；
2. 创建一个明确标记为生产烟测的总题数目标，页面提示基线已按最近成功同步数据冻结；
3. 编辑目标名称和目标增量，保存后页面提示原始基线保持不变；
4. 重新打开生产页面，编辑后的名称、增量、基线与进度仍然存在，证明刷新恢复有效；
5. 通过确认对话框归档目标，页面提示“目标已归档”，进行中数量恢复为 0，历史数量由 1 增至 2；
6. 在账号页执行“导出我的数据”，页面在三个私有导出 RPC 均成功返回并完成 JSON 组装后显示带时间戳的导出文件名。

烟测没有修改成员资料、平台绑定、平台统计或同步状态，也没有发送 AI 消息。临时目标以归档状态保留在成员本人私有历史中，没有留下进行中目标。导出内容未写入仓库，证据不记录成员姓名、邮箱、QQ、UUID、平台账号、会话或 Token。

生产桌面端和 390px 移动端的 `/training-goals` 刷新保持、页面宽度、地标、跳转链接和交互控件名称同时通过，见 `docs/evidence/authenticated-responsive-accessibility-production-2026-07-26.md`。

由于目标进度只能由新的成功同步快照推进，本轮没有篡改成员平台统计来制造达标状态。“确认完成”流程继续保持未完成，等待真实训练进度满足目标或使用专门的受控生产夹具验证。
