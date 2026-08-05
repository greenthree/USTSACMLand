# 首页前端审计报告（2026-07-27）

> 范围：首页（`/`）除 hero 以外的全部区块；hero 风格按定稿保持不动。
> 方法：代码走查（`src/pages/HomePage.tsx` + `src/styles.css` 的 `home-` 样式层与桥接层）+ 本地 dev 实测
> （getComputedStyle 对比度计算、层叠规则核对、375px 视口溢出与触控目标抽查）。
>
> **2026-08-03 实施更新**：第一、二批全部落地（问题 1–4、建议 5–9、polish 前三项）。行号引用
> 已随改动漂移，以选择器名为准。验证：97 文件 / 617 单测、ESLint、axe WCAG A/AA e2e（8 路由含 `/`）
> 全部通过。移动端 `.home-section-meta` 堆叠在编号下方、375/390px 无横向溢出。

## 2026-08-04 复审发现与修复结果

本轮使用当前工作树重新完成代码走查，并在 Chrome 中检查 1066px、1440px 桌面端与 390px 移动端。页面无横向溢出，移动导航、Hero 双 CTA、章节滚动、字体加载和数据读数均可用，控制台没有应用 warning/error；ESLint、生产构建和首页专项测试 7 项全部通过。复审发现的问题已逐项处理：

1. [x] **P1：公开首页仍宣传已停止开发的 AI 学习助手。** 关闭态现已完全移除该模块，资源面板同步由 `3 MODULES` 变为 `2 MODULES`；启用态代码与后台能力继续保留。专项测试已改为防止 AI 标题、规划文案和入口重新出现在公开首页。
2. [x] **P2：03、04、05 的叙述性正文与其他章节字体不统一。** 六个章节左侧主叙述现统一使用 `'Songti SC', 'Noto Serif SC', 'Source Han Serif SC', serif`，桌面端为 `17px / 1.9`，移动端为 `16px / 1.85`；右侧卡片、数据与标签仍使用无衬线字体。Chrome 计算样式逐项核对一致。
3. [x] **P2：移动端加入我们时间线节点轻微侵入标题。** 390px 断点内节点改为 `left: 87px`，继续与 `left: 96px` 的竖线同心。实测节点右缘为 `124.0px`，标题内容从 `124.67px` 开始，不再侵入文字。
4. [x] **P2：部分章节深链标题会被固定导航遮挡。** `.home-section-heading h2[id]` 现统一设置 `scroll-margin-top: 84px`。桌面端标题落点约 84px（固定导航底部 72px），390px 移动端标题落点约 84px（固定导航底部 64px）；`#competition-overview-title`、`#open-contests-title`、`#home-vision-title`、`#platform-title` 与 `#join-title` 均已验证。

本轮修复后再次通过：首页专项测试 2 文件 / 7 项、ESLint、生产构建与 `git diff --check`。Chrome 1440px / 390px 均无横向溢出，关闭态资源列表只保留两个已上线模块。

## 总体结论

「暗绿野外仪器」语言在 hero 里立得很稳，编号 section、细线账本、mono 标注的骨架统一。
文本对比度实测全部通过 WCAG AA（抽样最低 4.95:1），移动端 375px 无横向溢出。

主要提升空间：

1. 一个真实的 hover 失效问题（action band 主按钮）；
2. 衬线字体在访客机器上的回退退化（影响全站观感的最大单点）；
3. 下半页四个连续浅色 section 节奏单调；
4. hover / 细节语言不统一。

---

## 一、应修的实际问题

### 1. Action band 主按钮 hover 时"溶解"消失

位置：`src/styles.css:6549` 附近的桥接层。

```css
.home-section-link:hover,
.home-primary-action-light:hover {
  color: var(--green-dark);
  background: var(--green-soft);
  border-color: var(--green-soft);
}
```

action band 自身背景也是 `var(--green-soft)`（实测同为 `rgb(231,244,236)`），边框同色——hover
一瞬间按钮面完全融进背景，只剩绿色文字悬浮。「查看完整榜单」（`.home-section-link`）在纸面底色
`#f4f7f5` 上也是同类问题：绿白 vs 纸白几乎不可辨。

建议：hover 改成与 hero 主 CTA 同语言——`--nav-accent` 底 + `--nav` 深字，或白底 + 深绿描边，
保持"实心按钮始终有面"的原则。

### 2. 衬线大标题在普通访客机器上严重退化（保真修复，非风格改动；会连带影响 hero）

站点没有自托管任何 webfont，衬线栈 `'Songti SC', 'Noto Serif SC', 'Source Han Serif SC', serif`
全靠本机字体：

- 本开发机装了 Noto Serif SC，所以本地显示正常（canvas 宽度对比法实测命中 Noto Serif SC）；
- 普通 Windows 访客三个家族都没有，回退到默认 serif（宋体系）；
- 且 `:root` 上有 `font-synthesis: none`（`src/styles.css:13`），禁止伪加粗——**所有 800 重的
  巨型衬线标题（hero 主语 + 六个 h2 + 各 serif 导语）会以细体宋体渲染**，设计感损失是全页性的。

建议：自托管 Noto Serif SC 的 unicode-range 分片版本（cn-font-split 或
`@fontsource/noto-serif-sc`），只带 700/900 两档，`font-display: swap`；从 `public/` 以独立
`<link>` 引入，避开入口 CSS 的 28KB gzip 门禁（`scripts/check-bundle-size.mjs`）。

### 3. 文案方位词在移动端失真

`src/pages/HomePage.tsx:737`："**右侧**所列赛事均属于我校认定的Ⅰ乙比赛"——≤900px 时赛事列表
堆叠在文案下方，"右侧"不成立。改为"以下赛事 / 这里所列的赛事"。

### 4. 跑马灯深色未走 token

`src/styles.css:6947`：`.home-letter-strip { background: #111310 }` 是旧版 hero 深色硬编码，
而 hero 已桥接为 `var(--nav)` `#0b1912`。两块深色仅隔一条金线，色温略有差异。统一为
`var(--home-dark)`。

---

## 二、美化建议（按优先级）

### 5. 给下半页造第二个"仪器时刻"——05 训练记录记分牌化（性价比最高）

现状：只有 02 赛事版图是深色，03→06 连续四个浅色面（`#f4f7f5` 与 `#eef2f0` 几乎无法区分），
下半页读起来是一长段均质账本。而 05 的内容恰好就是"记分牌"（累计通过题数 + 平台账本 + 同步
节奏），文案里也埋了气球梗（"教室早就装不下了"）。

建议：把 `.home-data-summary` + 平台列表包进一块 hero 同款 FIELD NOTE 面板——深底、mono 头条
`FIELD NOTE / 002 — SCOREBOARD`、硬投影——形成 浅-深-浅-浅-**深面板**-浅 的节奏，同时收拢
"气球×记分牌"叙事。

轻量替代：把 `--home-paper-alt` 加深一档（如 `#e9eeea`），并给浅色 section 复用 hero 的三分
竖线纹理。

### 6. 统一 hover 语法，补齐 06 的缺位

目前五套列表五种 hover：

| 区块             | 现状                       |
| ---------------- | -------------------------- |
| 能力列表（01）   | 左侧金条 + 缩进            |
| 赛事列表（02）   | 左侧绿条 + 底色 + 双侧缩进 |
| 公开赛平台（03） | 底部金条 + 白底            |
| 平台账本（05）   | 仅白底                     |
| 学习资源（04）   | 仅图标上浮                 |
| 加入我们（06）   | **无任何 hover**           |

建议收敛为一种语法（accent 色条 + 微底色，色条方向可随布局），至少给
`.home-join-events article` 补上一致的反馈。

### 7. 累计通过题数 count-up

数字从 `--` 直接跳到终值，浪费了最有"仪表读数"感的时刻。建议 IntersectionObserver 一次性触发
~900ms 计数动画：只改 textContent、不碰 opacity（不违反 axe 门禁约束）；
`prefers-reduced-motion` 时直接落终值。`tabular-nums` 已就位，数字不会抖动。

### 8. 标题横线右端加 mono 元数据

六个 section 的标题块构图完全相同（眉题 + 大字 + 顶部粗线）。在标题横线右端加一枚小 mono 标注，
低成本打破重复并强化仪器感，呼应 hero 角标。示例：

- 01 `MODE / TEAM×3`
- 02 `CLASS / Ⅰ-B`
- 03 `FREQ / 10+ WEEKLY`
- 05 `SYNC / 2×DAILY`
- 06 `SELECT / 3 ROUNDS`

### 9. 公开赛平台行加真实链接

`.home-open-contests-platforms` 五行有白底 + 金条 hover（强烈的可点击暗示）但不可点。对新手而言
"去哪打比赛"正是这一节的价值，建议每行链到对应平台的比赛页（`src/lib/platforms.ts` 的
`platformUrls` 已有基础，`target="_blank" rel="noopener"`）。若不想加链接，则应弱化 hover，
避免假可供性。

---

## 三、低优先级 polish

- **跑马灯离屏暂停**：`.home-letter-strip-inner` 的 36s 无限动画滚出视口后仍在跑；项目已有
  "离屏全停"口径（扫描线、气球均已做），给它同样加 IO 切 `animation-play-state`。
- **watermark 预加载降级**：`index.html:16` 对 `icpc-foundation.png` 用了
  `fetchpriority="high"` 预加载，但它在 hero 里只是 3.5% 不透明度的装饰底纹（LCP 是文字），
  建议去掉 high 或整条 preload。
- **品牌化 `:focus-visible`**：目前只有榜单页有，首页 CTA 用浏览器默认焦点环；补一条
  `2px solid var(--nav-accent)` + offset 的全局规则更成套。
- **移动端"已上线" chip 高度 34px**：高于 WCAG 最低线（24px）但低于 44px 舒适线，≤680px 时
  可提到 40px。
- **（口味项）06 时间线节点气球化**：金色方钉可换成 `home-balloon-dot` 同款小气球，接上
  "参赛→拿到第一只气球"的隐喻；嫌腻可不做。

---

## 四、明确不动的部分与约束

不动：hero 全部（气球物理、扫描线、入场动画）、跑马灯 AC 黄绿/WA 金配色、A–F 气球字母徽章、
02 深色区 sticky 备注栏。

所有改动需守住既有约束：

- 正文区禁止 opacity 入场动画（axe 中途取样误判；hero 的 `home-rise` 是已验证例外）；
- 气球三层节能守卫（IO 离屏全停、闲置隔帧、reduce-motion 不启动）不可破坏；
- `.home-balloon` 不加 CSS transform（transform-box 陷阱，见 styles.css 尾部注释）；
- e2e 有 axe WCAG A/AA 门禁覆盖 `/`，配色改动需保持 AA。

## 附：实测数据摘要

- 对比度抽样 29 组（含深色区、绿底、跑马灯），全部 ≥4.95:1，AA 通过；最低为 02 区
  `.home-competition-list small`（`#858e85` on `#102119`，4.95:1）。
- 375px 视口：`scrollWidth == innerWidth`，无横向溢出；越界元素均在 `overflow` 裁剪容器内
  （hero 水印、跑马灯）。
- 触控目标抽查：学习资源区 chip 34px 高，其余 CTA ≥40px。

## 建议的实施顺序

1. 第一批（低风险高收益）：问题 1（hover 修复）+ 2（自托管字体）+ 3（文案）+ 4（token）。
2. 第二批（视觉重点，先定方向再做）：建议 5（记分牌面板）。
3. 随后按需：6 → 7 → 8 → 9 与 polish 项。
