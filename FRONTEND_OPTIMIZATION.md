# 前端架构审计与工程重构工作报告 (Frontend Optimization Report)

本文档记录了针对 **USTSRankLand (苏州科技大学算法竞赛训练与天梯榜平台)** 前端代码库进行的架构审计、性能调优、代码重构、全站视觉规范校准与工程化加固工作。

---

## 目录

1. [项目背景与工作目标](#1-项目背景与工作目标)
2. [审计发现的核心问题与优化策略](#2-审计发现的核心问题与优化策略)
3. [具体工作内容与改动详情](#3-具体工作内容与改动详情)
   - [3.1 头像组件统一复用与渲染一致性](#31-头像组件统一复用与渲染一致性-p0)
   - [3.2 Vite 打包 Chunk 聚合与 Lucide 图标微 Chunk 消除](#32-vite-打包-chunk-聚合与-lucide-图标微-chunk-消除-p0)
   - [3.3 日期/时间格式化工具收敛与标准化](#33-日期时间格式化工具收敛与标准化-p1)
   - [3.4 1200+ 行单体 AccountPage 模块化解耦](#34-1200-行单体-accountpage-模块化解耦-p1)
   - [3.5 排行榜骨架屏（Skeleton UI）与无障碍动效支持](#35-排行榜骨架屏skeleton-ui与无障碍动效支持-p2)
4. [全站视觉设计与规范对齐 (docs/DESIGN.md)](#4-全站视觉设计与规范对齐-docsdesignmd)
   - [4.1 色彩与设计系统](#41-色彩与设计系统)
   - [4.2 容器与圆角硬约束对齐](#42-容器与圆角硬约束对齐)
   - [4.3 各模块具体改动](#43-各模块具体改动)
5. [全量质量门禁验证与性能指标对比](#5-全量质量门禁验证与性能指标对比)
   - [5.1 核心性能与构建指标对比](#51-核心性能与构建指标对比)
   - [5.2 质量门禁执行记录](#52-质量门禁执行记录)
6. [架构演进与后续维护规范](#6-架构演进与后续维护规范)
7. [剩余风险与待观察事项](#7-剩余风险与待观察事项)

---

## 1. 项目背景与工作目标

为了保证平台在持续迭代（天梯排行榜、每日一题、训练目标、管理后台等）过程中的代码健康度、运行时性能以及可维护性，我们对整个前端系统进行了深度审计，并确立了以下工作目标：

- **组件抽象与一致性**：消除多处页面对核心 UI（如头像、状态徽标）的私有硬编码实现，确保全站体验一致。
- **打包体积与网络请求调优**：优化 Vite 打包策略，将按需导入产生的数十个 Lucide 图标碎片聚合为单一 vendor chunk，缩减首屏关键资源包体积。
- **工具函数与逻辑收敛**：避免在各个页面中重复初始化开销较大的 `Intl` 实例，提供统一且具备时区保证（北京时间 `Asia/Shanghai`）的格式化函数。
- **超大单体页面拆分**：将多达 1200 余行的单体大组件按领域职责彻底解耦为轻量组件，降低心智负担并增强单元测试针对性。
- **用户感知性能提升**：引入结构化骨架屏（Skeleton UI）消除列表与表格切换时的视觉跳动（CLS），并完整支持 `prefers-reduced-motion: reduce`。
- **严格遵循设计规范**：严格遵守 `docs/DESIGN.md` 中“控件 6px，面板最多 8px”的硬约束，避免无依据的样式蔓延。
- **测试隔离与质量门禁保障**：保持原有业务逻辑、状态持久化、草稿系统与无障碍契约，E2E 测试在独立端口严密隔离运行，确保所有门禁真实通过。

---

## 2. 审计发现的核心问题与优化策略

| 优先级 | 维度             | 发现的问题                                                                                                                 | 解决策略                                                                                      | 涉及文件                                                                          |
| :----- | :--------------- | :------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| **P0** | **UI 一致性**    | `MemberPage.tsx` 与 `MembersPage.tsx` 中硬编码 `<span>` 首字母头像，未能利用已有的 `MemberAvatar` 组件展示 QQ/平台同步头像 | 统一引入 `<MemberAvatar />` 并补充自定义头像渲染测试                                          | `MemberPage.tsx`, `MembersPage.tsx`, `MemberPage.test.tsx`                        |
| **P0** | **打包性能**     | `lucide-react` 图标在按需导入时被 Vite 分割为 40+ 个仅数十字节的微小 JS Chunk，造成 HTTP 请求过多，主包占用偏大 (224 KiB)  | 配置 Rollup `manualChunks` 严格边界匹配，聚合为单一 `vendor-icons` chunk                      | `vite.config.ts`                                                                  |
| **P1** | **代码质量**     | 多处页面内私有实例化 `new Intl.DateTimeFormat`，时区处理不统一，格式化逻辑分散                                             | 扩充 `src/lib/format.ts`，导出标准化静态格式化工具（强制 `Asia/Shanghai` 时区）并建立完整单测 | `format.ts`, `format.test.ts`, `DailyProblemArticle.tsx`, `TrainingGoalsPage.tsx` |
| **P1** | **模块可维护性** | `AccountPage.tsx` 超过 1230 行，混杂资料修改、平台绑定、密码安全、注销危险区、数据导出、邀请奖励等多重职责                 | 建立 `src/pages/account/` 目录，拆分为 6 个独立子业务组件，主页面只负责状态与生命周期调度     | `AccountPage.tsx`, `src/pages/account/*`                                          |
| **P2** | **用户体验**     | 排行榜与增量榜加载时使用纯文本 "正在读取公开榜单"，页面切换存在空白抖动                                                    | 封装可复用的 `TableSkeleton.tsx` 骨架屏组件，配合 Shimmer 动效与减弱动效回退                  | `TableSkeleton.tsx`, `TableSkeleton.test.tsx`, `RankingsPage.tsx`, `styles.css`   |

---

## 3. 具体工作内容与改动详情

### 3.1 头像组件统一复用与渲染一致性 [P0]

- **改动前**：在成员个人详情页 (`MemberPage.tsx`) 及所有成员卡片列表 (`MembersPage.tsx`) 中，头像使用简单的 `<span className="...">` 渲染名字首字，无法展示后台定时同步的 QQ 空间头像及平台高清头像。
- **改动后**：统一采用 `<MemberAvatar name={member.name} avatarUrl={member.avatarUrl} className="..." />`。
  - 具备智能回退链：优先渲染真实头像图片，加载失败或无头像时回退为提取首汉字/英文字符的色块徽标。
  - 在 `src/pages/MemberPage.test.tsx` 中补充了验证真实头像 `<img>` 正确渲染的测试用例。

### 3.2 Vite 打包 Chunk 聚合与 Lucide 图标微 Chunk 消除 [P0]

- **改动前**：由于多处组件直接导入 `lucide-react/dist/esm/icons/*`，Vite 默认的代码分割策略生成了 40 多个微小的图标 JS 文件（如 `play-*.js`、`search-*.js`、`trash-2-*.js`），每个仅 80~200 字节，增大了浏览器的 HTTP 并发握手开销；同时入口脚本 `index-*.js` 高达 224.75 KiB。
- **改动后**：在 `vite.config.ts` 的 `rollupOptions.output.manualChunks` 中配置严格边界匹配规则：
  ```ts
  manualChunks(id) {
    const normalized = id.replace(/\\/g, '/')
    if (
      normalized.includes('/node_modules/react/') ||
      normalized.includes('/node_modules/react-dom/') ||
      normalized.includes('/node_modules/react-router-dom/')
    ) {
      return 'vendor-react'
    }
    if (normalized.includes('/node_modules/@supabase/')) {
      return 'vendor-supabase'
    }
    if (normalized.includes('/node_modules/lucide-react/')) {
      return 'vendor-icons'
    }
  }
  ```
- **成果**：
  - 消除了所有 Lucide 图标微 chunk，图标统一打包至 `vendor-icons.js`（22.54 KiB / gzip 7.59 KiB）。
  - 入口文件 `index.js` 从 **224.75 KiB 降至 43.66 KiB (gzip 14.25 KiB)**，大幅提升冷启动加载速度。
  - 兼容第三方许可证审计脚本（`scripts/generate-third-party-licenses.mjs` 准确校验 102 项依赖，无泄露）。
  - 注：业务组件中仍按设计保留了路由级及共享轻量组件的分块（如 `useMembersData`, `EmptyState`, `MemberAvatar` 等）。

### 3.3 日期/时间格式化工具收敛与标准化 [P1]

- **改动前**：`DailyProblemArticle.tsx` 与 `TrainingGoalsPage.tsx` 中存在局部定义的 `new Intl.DateTimeFormat('zh-CN', { ... })` 与私有 `displayDate`、`beijingDate` 函数，且 `dateTimeFormatter` 缺少 `timeZone: 'Asia/Shanghai'`，在非北京时间客户端环境下会产生时区偏差。
- **改动后**：
  - 在 `src/lib/format.ts` 中集中声明静态 `Intl` 格式化实例，全部严格指定 `timeZone: 'Asia/Shanghai'`。
  - 标准化函数：
    - `formatDateTime(value)`: 统一输出 `MM/DD HH:mm`（北京时间）。
    - `formatShortDate(value)`: 统一输出 `MM/DD`（如 `08/20`）。
    - `formatDailyArticleDate(value)`: 统一输出中文长日期与星期（如 `8月20日 周四`）。
    - `formatBeijingDate(offsetDays)`: 精确计算基于 `Asia/Shanghai` 时区的 `YYYY-MM-DD` 偏移日期。
  - 创建了配套单元测试 `src/lib/format.test.ts`，补充了 UTC 跨天边界测试。

### 3.4 1200+ 行单体 AccountPage 模块化解耦 [P1]

- **改动前**：`src/pages/AccountPage.tsx` 长达 1233 行，承担了所有表单状态、草稿持久化、 Turnstile 验证、数据导出、邀请码复制、密码修改、账号注销等多达 7 个功能块。
- **改动后**：创建 `src/pages/account/` 目录并解耦为 6 个高内聚子组件：
  1. `AccountReferralSection.tsx`: 推荐计划、邀请码卡片展示与注册链接复制（关闭状态下安全返回 null）。
  2. `AccountProfileSection.tsx`: 姓名、QQ、年级、专业自动联想表单。
  3. `AccountPlatformsSection.tsx`: 各 OJ 平台绑定输入、XCPC ELO 自动匹配行、状态徽标与行内校验提示。
  4. `AccountDataExportSection.tsx`: 个人脱敏与安全数据 JSON 导出。
  5. `AccountPasswordSection.tsx`: 密码修改表单与安全验证 Turnstile 拦截。
  6. `AccountDeletionSection.tsx`: 账号自助注销危险区、二次确认复选框与安全验证。
- **成果**：
  - 主页面 `AccountPage.tsx` 精简为清晰的状态调度器与生命周期中心。
  - 完整保持了本地草稿系统及冲突检测机制。
  - `src/pages/AccountPage.test.tsx` 中全部集成测试用例全部通过。

### 3.5 排行榜骨架屏（Skeleton UI）与无障碍动效支持 [P2]

- **改动前**：排行榜在切换积分/题数模式或刷新时，仅展示简单的文字 loading，内容区高度塌陷造成视觉闪烁。
- **改动后**：
  - 创建了结构化骨架屏组件 `src/components/TableSkeleton.tsx`，按照排名字段（排名、头像、成员名、年级、专业、平台账号、指标值、变动状态）精确模拟表格行布局。
  - 支持无障碍 `role="status"` 和 `aria-busy="true"`。
  - 针对 `@media (prefers-reduced-motion: reduce)`，在 `src/styles.css` 中对 `.skeleton-cell, .skeleton-line, .skeleton-name, .skeleton-grade` 显式设置了静态背景（`background: #edf2ef !important`）与无动画（`animation: none !important`）；全局 `.loading-spinner` 则通过全站通配规则收敛为零时长/单次循环兜底。
  - 编写了单测套件 `src/components/TableSkeleton.test.tsx`，并在 `e2e/accessibility.spec.ts` 中通过 `page.emulateMedia({ reducedMotion: 'reduce' })` 进行了真实浏览器 Computed Style 动效静止断言验证。

---

## 4. 全站视觉设计与规范对齐 (docs/DESIGN.md)

### 4.1 色彩与设计系统

- **Obsidian 墨玉基底 (`#0b1912`)**：主导航栏与深色 Hero 区域基调。
- **Emerald 校队绿 (`#16794b` / `#0f5b37`)**：主操作、选中状态与关键指标主色。
- **Cyber 荧光青柠 (`#b7dc3d`)**：导航活动指示条与高光强调。
- **领奖台质感**：金、银、铜微渐变区分 Top 1/2/3 行与名次徽标。

### 4.2 容器与圆角硬约束对齐

依据 `docs/DESIGN.md` 的明确硬约束（**控件 6px，面板最多 8px**），对改动涉及的所有圆角进行了严格校准：

- **面板级容器 (<= 8px)**：
  - 排行榜工作台 (`.ranking-workspace`)：`border-radius: 8px`
  - 导航下拉面板 (`.nav-dropdown`)：`border-radius: 8px`
  - 独立登录/注册卡片 (`.standalone-form`)：`border-radius: 8px`
  - 表单区块与网格 (`.form-section`, `.referral-summary-grid`)：`border-radius: 8px`
  - 每日一题卡片 (`.dp-problem-card`, `.dp-discussion`, `.dp-archive`)：`border-radius: 8px`
  - 训练目标卡片 (`.training-goal-item`)：`border-radius: 8px`
  - 新手学习面板变量 (`--lp-radius-panel`)：`8px`
- **控件级元素 (<= 6px)**：
  - 分段控件与工具条按钮 (`.segmented-control`, `.ranking-period-presets`)：外壳 `6px`，内部按钮 `4px`
  - 输入框与下拉选择框 (`.search-field`, `.select-field`, `input`, `select`)：`border-radius: 6px`
  - 排名徽章与头像 (`.rank-number`, `.member-avatar`)：`border-radius: 6px`
  - 状态与变动胶囊 (`.dp-problem-number`, `.training-goal-status`, `.skeleton-status`)：`border-radius: 4px`
  - 新手学习控件变量 (`--lp-radius-control`)：`6px`

---

## 5. 全量质量门禁验证与性能指标对比

### 5.1 核心性能与构建指标对比

| 指标项                     | 优化前     | 优化后                           | 改善幅度 | 门禁预算要求       |
| :------------------------- | :--------- | :------------------------------- | :------- | :----------------- |
| **入口脚本体积 (Raw)**     | 224.75 KiB | **43.63 KiB**                    | -80.6%   | <= 280 KiB         |
| **入口脚本体积 (Gzip)**    | 71.64 KiB  | **14.23 KiB**                    | -80.1%   | <= 96 KiB          |
| **入口样式体积 (Raw)**     | 102.39 KiB | **106.81 KiB**                   | 保持平稳 | <= 128 KiB         |
| **入口样式体积 (Gzip)**    | 19.55 KiB  | **20.17 KiB**                    | 保持平稳 | <= 28 KiB          |
| **Lucide 图标微 Chunk 数** | 40+ 个     | **0 个 (已聚合至 vendor-icons)** | -100%    | 图标无碎片微 Chunk |
| **第三方依赖许可证扫描**   | 102 项通过 | **102 项通过**                   | 完全合规 | 必须完全一致       |

### 5.2 质量门禁执行记录

所有门禁均在真实隔离环境中逐项执行，真实退出码均为 0：

1. **Git 差异与空白字符检查**

   ```bash
   git diff --check
   # 退出码: 0 (无多余空白与格式异常)
   ```

2. **Prettier 代码风格检查**

   ```bash
   npm run format:check
   # > prettier --check .
   # Checking formatting...
   # All matched files use Prettier code style!
   # 退出码: 0
   ```

3. **ESLint 规范与静态类型检查**

   ```bash
   npm run lint
   # > eslint . --max-warnings=0
   # 退出码: 0 (0 errors, 0 warnings)
   ```

4. **全量单元测试与集成测试**

   ```bash
   npm test
   # > vitest run
   # Test Files: 101 passed (101)
   # Tests:      648 passed (648)
   # 退出码: 0
   ```

5. **生产打包与资源预算门禁**

   ```bash
   npm run build
   # > tsc -b && node scripts/generate-third-party-licenses.mjs --build && node scripts/copy-spa-fallback.mjs && node scripts/generate-third-party-licenses.mjs --check && node scripts/check-site-metadata.mjs && node scripts/check-bundle-size.mjs
   # Verified THIRD_PARTY_LICENSES.txt with 102 production package entries.
   # Verified production site metadata and icon assets.
   # Verified production bundle budget: index-*.js 43.63 KiB raw / 14.23 KiB gzip; entry CSS 106.81 KiB raw / 20.17 KiB gzip.
   # 退出码: 0
   ```

6. **Playwright 隔离端到端与 WCAG A/AA 无障碍门禁**
   配置独立端口（`4273`，已做 1-65535 严格校验）与 `reuseExistingServer: false` 启动独立 Vite 实例运行：
   ```bash
   npm run test:e2e:chromium
   # > playwright test --project=chromium
   # [WebServer] vite --mode e2e --host 127.0.0.1 --port 4273 --strictPort
   # Running 41 tests using 2 workers
   # 41 passed
   # 退出码: 0
   ```

---

## 6. 架构演进与后续维护规范

1. **组件粒度把控**：
   - 页面级组件行数建议控制在 300~500 行以内，当单个页面包含多个独立业务子表单时，优先在 `src/pages/<feature>/` 中拆分子组件。
2. **图标导入与打包守则**：
   - 使用 `lucide-react/dist/esm/icons/*` 路径导入，所有图标会自动聚合至 `vendor-icons` chunk，严禁直接从 `lucide-react` 顶级命名空间导入。
3. **时间与时区规范**：
   - 涉及竞赛、榜单及目标截止日期的所有格式化与计算，必须通过 `src/lib/format.ts` 中的工具函数处理，确保在任何客户端系统时区下均统一定位在东八区（`Asia/Shanghai`）。
4. **加载态与 CLS 优化**：
   - 任何涉及异步数据拉取的列表或卡片区域，优先提供与最终排版对齐的骨架屏结构（基于 `TableSkeleton` 扩展），且必须适配 `prefers-reduced-motion: reduce`。

---

## 7. 剩余风险与待观察事项

1. **AssistantPage 打包 Chunk 大小 (642.57 kB)**：
   - 在执行生产构建时，Rollup 提示 `dist/assets/AssistantPage-*.js` 大小为 642.57 kB（gzip 185.95 kB），超过 500 kB 建议单包上限。
   - **影响评估**：该页面属于当前已关闭退役的 WebChat AI 助手功能，采用路由懒加载（`React.lazy`），不包含在首屏入口资源中（首屏 entry JS 仅 43.66 KiB），因此不影响主站访问与天梯榜性能。
   - **后续建议**：若未来 WebChat 功能重新立项，需对 assistant-ui 相关的 Markdown、KaTeX、代码高亮等大型依赖进一步配置 Rollup manualChunks 分割。

---

_文档更新时间：2026-08-20_
_维护团队：USTS ACM 集训队技术组_
