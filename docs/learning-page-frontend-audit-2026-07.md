# 新手入门页前端审计报告（2026-07-27）

> 范围：`/learning`（`src/pages/LearningPage.tsx` + `src/pages/learning.css`）。
> 方法：代码走查 + 本地 dev 实测（全页对比度扫描、<11px 字号扫描、死选择器扫描、
> 多断点溢出实测、交互联动验证、控制台检查）。axe WCAG A/AA 门禁已覆盖本路由
> （`e2e/accessibility.spec.ts:28`）。

> **整改记录（2026-07-27）**：本报告以下正文保留整改前审计快照。现已完成主要整改：
> `learning.css` 从 3090 行四代叠层压平为 1576 行单一设计层；移除 9 个死选择器族；修复
> 820px 阶段内容裁切、ARIA 悬空、tab 键盘操作、移动端目录当前项可见性、返回阶段一、
> 进度键稳定性与重复数据防御；补齐四周行动入口、周完成度、scrollspy、Hero 元数据和品牌
> accent。阅读内容统一为开放式细线账本，可交互工具保留 12px 面板。自动化验证见文末。

## 总体结论

页面基本面很好：全页实测 **0 处对比度不达标、0 处 <11px 文本**，起点选择器与平台推荐联动正确
（`aria-pressed`/`aria-live` 到位），checklist 有自定义 focus-visible，进度持久化带版本号键。
最后一代样式层已把字号体系对齐首页 token（11px aux / 13px body）。

主要问题：**① 一个真实的布局裁切 bug（iPad 竖屏区间）；② learning.css 四代样式叠层、
死代码近 1/3；③ 若干 ARIA 引用悬空；④ 视觉语言"账本 vs 圆角卡"混搭未定调**。

---

## 一、应修的实际问题

### 1. 781–949px 视口：阶段手风琴右列被裁切（Bug，iPad 竖屏 820px 正中枪）

`learning.css:2445` 的 `.learning-stage-content`：

```css
grid-template-columns: minmax(220px, 0.72fr) minmax(360px, 1.28fr);
padding: 4px 20px 28px 84px;
```

两列下限 220+360 + 28 间隙 + 104 内边距 = 需要 712px，但 781–949px 视口下内容列只有
553–672px。实测 820px 视口：`.learning-stage-notes` 右边缘到 896px，被 `.learning-page`
的 `overflow: clip` 直接裁掉约 76px（"怎么练 / 进入下一阶段前"卡片右侧不可见且不可滚动）。

修复建议：下限改 `minmax(0, …)`，并新增 ~≤950px 断点让内容单列堆叠；84px 左缩进在窄屏
同步收小。

### 2. ARIA 引用悬空 + tablist 缺方向键

- 手风琴触发器 `aria-controls={stage.id}-content`（`LearningPage.tsx:559`），但内容
  **条件渲染**——收起的四个阶段引用不存在的 id。周选项卡同理：只渲染当前 panel，其余三个
  tab 的 `aria-controls`（`LearningPage.tsx:418`）悬空。建议内容常驻 DOM、用 `hidden`
  切换（顺带利好页内查找）。
- `role="tablist"`（`LearningPage.tsx:412`）按 APG 应支持左右方向键切换，目前只能 Tab；
  要么补 `onKeyDown`，要么降级为普通按钮组（去掉 tab 角色族），两者都合规。

### 3. "返回阶段一"不会展开手风琴

`LearningPage.tsx:707` 的 `<a href="#stage-foundation">` 只做锚点跳转；若阶段一已被
收起（或用户打开了其他阶段），跳过去看到的是一行收起的标题。应改为同时
`setOpenStage('stage-foundation')`。

### 4. learning.css 四代样式叠层，死代码约三分之一（2985 行）

文件由四段追加式改版叠成：暗色编辑部版（1–1117）→ 浅色卡片版（1119–1905）→ 交互改版
（1907–2653）→ 规范化收尾（2655–2985）。实测 60 个 `.learning-*` 类中 **9 个整族已死**：

`learning-daily-loop`、`learning-first-month-layout`、`learning-guide-content`、
`learning-hero-aside`、`learning-hero-meta`、`learning-stage-index`、`learning-week-list`、
`learning-week-marker`、`learning-week-name`

连同它们在各断点的响应式覆盖，估计 800+ 行可删。更大的隐患是同名类在四层里含义互相打架
（如 `.learning-stage` 从 grid 变 block、hero 从深色卡变透明），后续任何改动都要跨四层
推演层叠。建议做一次"压平"：以最终渲染结果为准重写为单层（首页 styles.css 做过同类清理，
见 docs/homepage-frontend-audit-2026-07.md 背景）。

### 5. 进度存储的任务键是索引拼接

`LearningPage.tsx:463`：`taskId = ${activeWeek}-${taskIndex}`。任务文案增删/重排后，
旧勾选会错位映射到新任务（键 `usts-acm-land-learning-progress:v1` 已带版本号——改任务
内容时必须记得 bump 版本，或改用内容 slug 作键）。

---

## 二、美化建议（按优先级）

### 6. 给"账本 × 工具卡"双声部定调

最后一代已把平台/知识/节奏三个网格改成方角细线账本（贴近首页语言），但页面上仍留着一批
圆角浅卡：`.learning-closing`、`.learning-community`、`.learning-topic-note`、
`.learning-platform-order`。建议明确二分法——**可交互的"工具"**（起点选择器、四周计划
app、手风琴）保留圆角卡以示可操作；**阅读性内容**统一账本化（方角、细线、mono 眉题），
消除现在一半账本一半卡片的犹疑感。

### 7. 与首页的品牌衔接（低成本）

- accent 统一：`--learning-accent: #c9f24a`（`learning.css:1125`）与全局
  `--nav-accent: #b7dc3d` 是两个相近但不同的黄绿，页面上现在只剩"当前推荐"徽章
  （`learning.css:2366`）在用，直接换成 `var(--nav-accent)` 即可归一。
- 衬线栈 `Georgia, 'Noto Serif SC', 'Songti SC', serif`：拉丁与数字由 Georgia 兜底
  （Windows 安全），但中文同样依赖本机字体——与首页审计发现的是同一个问题，自托管
  Noto Serif SC 时两页共享一次修复（本页标题权重 500，退化程度比首页 800 轻）。

### 8. jump-nav 加 scrollspy 与平滑滚动

左侧章节导航目前无"当前所在节"状态。建议 IntersectionObserver 高亮当前节
（`aria-current="true"` + 绿色标记），配合 `scroll-behavior: smooth`（全局
reduced-motion 守卫已存在，`styles.css:4816`）。长页导航的定位感会明显变好。

### 9. 周选项卡显示完成度徽记

进度条是全局 %，但四个周 tab 看不出各自完成情况。在每个 tab 角落加 `2/3` 或小勾
（数据从 `completedTasks` 前缀统计即得），把"进度"与"周"连起来，也鼓励逐周清空。

### 10. 每周都给一个行动入口

`weekActions` 目前只有第 1 周有链接（ab.algoux.cn 环境配置）。第 2–4 周的任务其实都有
明确的外部落点（洛谷入门题单、排序/枚举题单、CF Div.4 场次页），补齐后每个周面板都有
"现在就去做"的出口，和第 1 周体验一致。

### 11. hero 加一行 mono 元数据（口味项）

hero 现在是纯文字 + 起点面板。在 kicker 下加一行首页角标式的 mono 注脚
（如 `PATH v1 · 5 STAGES · 12 TASKS · 60–90 MIN/DAY`），低成本呼应首页仪器语言。

---

## 三、低优先级 polish

- 手风琴展开无过渡，直接跳变；可加 200ms 内的 grid-template-rows 过渡
  （reduced-motion 全局守卫已覆盖）。
- `.learning-start-options button` 高度 43px、checklist 48px、周 tab 94px——触控目标
  全部达标，无需改动。
- 起点选择按钮的 `aria-label={platform.cue}` 与可见文本重复，可以去掉（label-in-name
  已满足，纯冗余）。

## 四、实测数据摘要

- 对比度全页扫描（含 hover 前态）：0 处低于 WCAG AA 阈值。
- 字号扫描：0 处可见文本 <11px（规范化层生效）。
- 溢出：仅第 1 条所述 781–949px 区间的阶段内容裁切；375px 与桌面无横向溢出。
- 交互：起点选择 → 推荐结果/平台卡联动正确，`aria-pressed` 状态正确，无控制台错误。

## 五、建议实施顺序

1. 第一批（bug 与低风险）：问题 1（裁切）+ 3（返回阶段一）+ 2（ARIA/键盘）。
2. 第二批（还债）：问题 4（CSS 压平删死代码），为后续任何视觉调整扫清地基。
3. 第三批（体验）：建议 8（scrollspy）+ 9（周徽记）+ 10（每周行动入口）。
4. 随后按口味：6（双声部定调）、7（品牌衔接，字体与首页共修）、11。

## 六、整改后验证

- `npx vitest run src/pages/LearningPage.test.tsx`：5 项通过。
- `npx eslint src/pages/LearningPage.tsx src/pages/LearningPage.test.tsx e2e/public-routes.spec.ts`：通过。
- `npm run build`：通过，站点元数据与 bundle budget 检查通过。
- Chromium 820×1180：页面无横向溢出，展开阶段 notes 右边缘未越出视口。
- Chromium 390×844：章节目录当前项会在目录内部水平滚入可视区，不改变页面初始纵向位置。
- `/learning` axe WCAG A/AA：0 个自动可检测违规。
- 浏览器实测：起点选择能联动推荐平台，桌面与移动端控制台无新增错误。

仍保留一项跨页面工作：中文衬线字体自托管应与首页统一处理，避免只为单页引入重复字体资源。
