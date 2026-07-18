# USTSACMLand

苏州科技大学 ACM 集训队官网。项目使用 GitHub Pages 托管 React SPA，介绍算法竞赛、主要赛事、线上公开赛、学习资源和入队方式，并通过 Supabase 提供认证、Postgres、RLS 和 Edge Functions，展示队员在多个竞赛平台的 Rating 与刷题数据。

> 当前状态：集训队官网首页、生产 Supabase、首管理员、八个 Edge Function 和 53 个 migration 均已部署，前端已连接真实认证与管理接口并由 GitHub Pages 发布。每日一题、完成记录、成员讨论和刷题增量榜已上线；仓库定义 33 个 pgTAP 文件和 845 项断言。主分支 CI、secret scan、Pages build/deploy 与生产榜单审计持续作为发布门禁。XCPC 共享缓存、六平台并发上限、队列 2/4 分钟退避、stale-worker fencing、数据库五分钟队列调度、计划同步分页和 QOJ 单次尝试均有生产烟测证据。Firecrawl 多 Key 管理、逐 Key 额度监控与 QOJ 一次性 operation claim 已部署；数据库池为空时继续兼容旧环境 Key，正式切换仍需管理员录入、检查并启用生产 Key。WebChat 中转站协议、当前模型系统提示词和受控生产对话已通过，服务端与数据库请求开关已对显式授权账号开放；成员请求与 Token 限额现为保留历史用量的累计总限额，全站预算仍按北京时间每日重置。登录且经后台授权的账号可以从导航进入 AI 学习助手；刷新恢复、私有历史会话、“思考中”和稳定提示词缓存路由键已随 PR #67 发布。生产缓存探针已从 Supabase Vault 读取现有中转站配置，并在第二次相同长前缀请求中真实命中 1792 个输入 Token；正式成员多轮请求的缓存命中仍待单独排查。2026-07-19 已完成真实加密备份的隔离恢复演练：7 项行数、4 类孤儿、Auth hooks、密码登录、RLS、匿名边界和受控注销全部通过，数据库自动化恢复 RTO 基线约 3 分钟。自助注销仍缺 GitHub 恢复下限写入令牌，成功注销继续失败关闭；同步失败告警 Webhook 也尚未完成生产投递烟测。

## 已实现

- 集训队官网首页：介绍 ACM 赛制、主要高校赛事、线上公开赛、学习资源、公开训练记录和年度入队比赛。
- 新手学习引导：独立 `/learning` 交互页面可根据当前基础推荐牛客、洛谷或 Codeforces，提供可切换周次、勾选并本地保存进度的四周计划，以及可展开的五阶段进阶路线和开放资源入口。
- 每日一题：访客可查看已到日期的公开题目和匿名完成/讨论数量；启用成员可标记完成、发布或删除本人纯文本讨论，管理员可维护题目并填写原因隐藏或恢复讨论。
- Rating 榜：默认总榜，可切换 Codeforces、牛客、AtCoder、XCPC ELO，显示各平台等级色与文字标签，并支持分页和键盘切换。
- 刷题榜：默认累计总榜，可切换 Codeforces、牛客、AtCoder、洛谷、QOJ，并支持本周、本月、自定义时间范围增量榜和分页；完整口径见 [刷题增量榜统计口径](./docs/practice-increment-rankings.md)。
- 姓名/账号搜索、专业与年级组合筛选、成员列表、成员详情和平台主页链接。
- Supabase 邮箱登录、注册时填写姓名并自动进入资料页、当前密码验证后修改密码、密码重置、普通成员密码复核与二次确认后自助注销、资料和平台账号维护；XCPC ELO 根据成员姓名自动匹配。
- 平台绑定在保存前校验 CF、AtCoder、QOJ 用户名和牛客、洛谷数字 UID；重复绑定仅提示账号已占用，不泄露其他成员身份。
- 资料页专业联想直接读取根目录 `专业目录.txt`，支持目录匹配与目录外专业自由输入。
- `/account` 登录守卫、`/admin` 管理员角色守卫、会话态导航和退出。
- 后台概览、成员管理与详情、当前筛选成员 CSV 导出、平台绑定维护、手工统计录入、平台账号验证、公告管理、同步中心、独立数据源健康页、Firecrawl 多 Key 凭据池和脱敏审计日志 CSV 导出；配置 Supabase 后均使用真实数据。
- 8 张账号/榜单核心业务表、3 张每日题目学习表、2 张 XCPC ELO 私有缓存表、1 张注销恢复下限私有租约表、10 张 WebChat 私有配置/额度/账本/历史/探针表、枚举、约束、索引、触发器、公开视图、RLS 和审计策略。
- `sync-member`、`sync-stats`、`change-password` 和 `delete-account` Edge Functions；同步入口支持成员、单平台、平台组和到期队列同步，改密与注销均在服务端复核当前密码，改密成功后全局撤销刷新会话并退出本设备，注销入口只允许当前普通成员删除本人，并由数据库最终守卫拒绝活动同步或当前管理员。
- WebChat 安全 API、管理员配置、生产缓存探针与按账号授权的前端工作台：`webchat`、`webchat-config`、`webchat-cache-probe` 已部署为 ACTIVE，后台支持 Vault 密钥、全站预算和逐账号授权/额度；默认使用 Supabase 会话、账号状态与私有授权三重边界，仅接收有严格字节/消息上限的纯文本对话。已授权账号的 `/assistant` 显示后端实际解析的当前模型与本人额度，且该模型名会写入同次请求的服务端系统提示词和额度指纹；工作台支持流式输出、首正文前“思考中”、停止、重新生成、复制、Markdown/代码块、刷新恢复、新建/切换/删除私有历史会话，并在每次请求时动态读取最新会话、生成独立请求 ID。生产 `VITE_WEBCHAT_UI_ENABLED=true` 已向登录账号启用 Pages 路由和导航，服务端与数据库仍会逐请求复核账号授权；聊天依赖保持在独立懒加载路由块内。
- Codeforces、牛客、AtCoder、XCPC ELO、洛谷真实适配器；QOJ Firecrawl `/interact` 临时会话自动登录适配器和健康检查。
- 六个平台均保存最小脱敏固定样本，并通过统一成功/失败结果契约测试；样本清单见 [`testdata/README.md`](./supabase/functions/_shared/adapters/testdata/README.md)。
- GitHub Pages 构建/部署、SPA `404.html` 回退和 CI；日更平台每天两次、周更平台每周一次的同步工作流；Dependabot 周更与完整历史 Gitleaks 门禁。
- Chromium、Firefox、WebKit、390px 移动 Chromium 与 1920px 宽屏 Chromium 的 Playwright 深链、键盘、登录返回、后台对话框、XCPC 小数手工录入、页面级横向溢出和 axe WCAG A/AA 门禁。
- 公开成员、平台账号和当前统计按稳定游标完整分页读取；任一页失败或必填字段异常时整批拒绝，不把截断或半份真实数据混入榜单。
- 页面和后台模块按路由懒加载；登录、注册、隐私、账号和后台路由不再无条件读取公开榜单数据。
- 未配置 Supabase 时，本地开发使用演示数据；生产构建缺少配置时认证功能失败关闭。

Rating 总榜在每个 Rating 平台分别取当前分最高的 5 名成员，并计算其平均值 `X_k`。成员总 Rating 为 `400 × Σ(a_i,k / X_k)`；总历史最高 Rating 使用相同公式，但成员分数和平台前五平均值均改用历史最高 Rating。某平台不足 5 个有效 Rating 时使用全部有效数据，缺失平台贡献 0，两项总 Rating 均保留两位小数。刷题累计总榜为 CF、牛客、AtCoder、洛谷、QOJ 的已知通过题数之和，并同时展示各平台题数。刷题增量榜用区间开始前最后一次成功累计值作为基线，减去区间内最后一次成功累计值；失败同步和换绑前旧快照不参与，累计题数回退按 0 计并明确标记，缺少基线或区间内成功观测时不猜测增量。

## 架构

GitHub Pages 只能托管静态文件，不能保存密码、Cookie 或 API Secret。浏览器只读取 Supabase 中的快照，第三方平台查询全部在服务端完成。

```mermaid
flowchart LR
    U["访客 / 成员 / 管理员"] --> P["GitHub Pages<br/>React SPA"]
    P --> A["Supabase Auth"]
    P --> D["Supabase Postgres + RLS"]
    P --> F["Supabase Edge Functions"]
    G["GitHub Actions<br/>每日两次 / 每周一次"] --> F
    F --> CF["Codeforces"]
    F --> NC["牛客"]
    F -. WAF 回退 .-> FC["Firecrawl Scrape"]
    FC --> NC
    F --> AT["AtCoder"]
    F --> XE["XCPC ELO"]
    F --> LG["洛谷"]
    F --> QF["Firecrawl 浏览器<br/>每次同步自动登录"]
    QF --> QB["QOJ"]
    F --> D
    QB --> D
```

关键取舍和安全边界见 [架构决策记录](./docs/adr/README.md)，外部平台字段与处理边界见 [第三方数据来源说明](./docs/third-party-data-sources.md)。

## 技术栈

- React 19、TypeScript、Vite、React Router。
- Supabase Auth、Postgres、RLS、Edge Functions。
- Vitest、Testing Library、Playwright、axe、Deno test、ESLint、Prettier。
- GitHub Actions、GitHub Pages。

项目目前没有引入 TanStack Query、React Hook Form 或 Zod。浏览器端数据加载使用 Supabase Client 和 React 状态；仓库级 Playwright 覆盖 Chromium、Firefox、WebKit、移动端与 1920px 宽屏，并以 axe 检查页面级可访问性。部署后另有只读生产榜单复算门禁。

## 数据源状态

| 平台       | 标识         | 指标                           | 当前实现                                                                                                                                                |
| ---------- | ------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codeforces | Handle       | 当前/最高 Rating、唯一 AC 题数 | 已实现官方 `user.info` 和分页 `user.status`，跨页按稳定题目标识去重；后续页失败、页数截断或响应结构漂移时拒绝部分统计；已做真实 smoke test              |
| 牛客       | UID          | 当前/最高 Rating、唯一通过题数 | 已实现公开 Rating 历史和练习汇总解析；普通请求遇到 WAF 时自动回退 Firecrawl，使用 12 小时缓存并保留结构化错误                                           |
| AtCoder    | Username     | 当前/最高 Rating、唯一 AC 题数 | Rating 使用 `/users/{username}/history/json`，题数使用 AtCoder Problems `user/ac_rank` 的 `count`；区分零 AC 与不存在账号，并拒绝畸形或乱序 Rating 历史 |
| XCPC ELO   | 姓名（自动） | 当前/最高 ELO                  | 用户无需填写 ID；注册后按“姓名 + 苏州科技大学”唯一匹配；使用数据库共享缓存、刷新租约与 ETag/Last-Modified 条件请求，同校同名时拒绝绑定                  |
| 洛谷       | UID          | P/B 题目唯一通过数             | 使用专用凭据请求认证 `/record/list`；首次全量建立题号集合，后续按提交记录 ID 增量读取并定期全量校准；不使用 Firecrawl                                   |
| QOJ        | Username     | 唯一 AC 题数                   | 已实现 Firecrawl 每次请求自动登录并读取去重 Accepted problems；失败时记录登录/主页阶段、HTTP 状态或导航异常及 Firecrawl Job ID，不自动重试              |

洛谷统计口径为认证记录接口返回的 Accepted 记录中，PID 以 `P` 或 `B` 开头的题目去重总数，其他前缀不计入。首次同步会读取完整历史并保存私有增量状态；之后从第一页读取到上次成功同步的首条提交记录 ID 即停止，不能用“遇到旧题号”作为边界。记录总数减少、游标异常或距离上次全量同步满 30 天时会自动全量校准。分页间隔为 300ms；达到 `LUOGU_MAX_PAGES` 仍无法确认边界或读完历史时会失败并保留最后一次成功值。

QOJ 统计口径为“去重后的 Accepted 题目数”，不是 Accepted 提交次数。每次同步从 Supabase Function Secrets 读取专用服务账号，先以 `maxAge: 0` 创建全新 Firecrawl scrape 会话，再通过 `/interact` 登录并在同一浏览器中打开目标主页，最后主动结束会话；请求不使用持久 profile，也不读写 Firecrawl 页面缓存。账号密码不会进入前端、源码、Git、统计日志或错误信息，但会作为 Firecrawl interact 作业请求的一部分发送给 Firecrawl，因此只能使用可独立轮换的专用账号。

Firecrawl API Key 可在后台“数据源健康”页管理。每个 Key 的明文只写入 Supabase Vault，浏览器仅接收名称、启用状态、优先级、健康度、剩余额度和时间；新增或轮换后的 Key 固定停用，必须由管理员执行一次无重试额度检查后才能启用，检查结果超过 60 分钟或额度为零时不能重新启用。运行时先排除认证失败、冷却中和零额度 Key，再按较小优先级选择，并在同优先级中选择最久未使用的 Key；QOJ 每个同步操作还会写入一次性数据库 claim，同一 operation ID 无法再次领取或切换到第二个 Key。牛客只有在直接请求命中允许回退的 WAF/可用性错误后才延迟领取 Key。数据库尚无 Key 记录时兼容旧 `FIRECRAWL_API_KEY` Function Secret；一旦建立数据库 Key 池，数据库即成为权威来源，即使全部停用也不会偷偷回退旧 Secret。

XCPC ELO 上游 `data.js` 约 20 MB。同步服务只在数据库缓存过期后由一个持有租约的 Edge Function 下载，并只保存“苏州科技大学”选手的精简版本化记录；其他并发请求等待同一版本发布。上游支持 `304 Not Modified` 时只续期缓存。网络、限流、超大响应或结构变化会记录共享冷却并返回失败，旧榜单统计仍保留，但不会把旧缓存冒充为本次成功或刷新 `last_success_at`。历史最高 ELO 从真实比赛 `history` 计算，不采用官网字段中的人工初始 1500 分。

## 同步计划

- 新用户注册后立即进入资料页，不需要成员审核；资料完整后自动进入公开成员范围。
- 注册建立会话后立即触发本人 XCPC ELO 自动匹配，启动失败会自动重试一次；服务端只在注册后的短时间窗口内放行，并以唯一索引保证每名成员只能消费一次 registration 同步，不能借此手动重放或同步其他平台。
- 平台账号被管理员标记为已验证后，立即同步该平台。单平台任务按“成员 + 平台”独立去重，不同平台并发验证不会互相丢任务；验证结果先保存，首次同步失败不会撤销验证状态。
- Codeforces、牛客、洛谷、AtCoder：北京时间每天 07:00 和 19:00 更新。
- XCPC ELO、QOJ：北京时间每周二 08:00 更新。

数据新鲜度与计划批次对齐：日更平台在下一个 07:00/19:00 批次之后保留 2 小时执行宽限，周更平台在下一个周二 08:00 批次之后保留 24 小时执行宽限。只有宽限结束仍没有新的成功结果才显示“已过期”；宽限期内的手动、平台验证或重试同步失败会记录错误，但不会把仍有效的数据提前标记过期。榜单时间显示最近成功时间。GitHub Actions 的定时任务是 best-effort，繁忙时可能比标称时间略晚启动；管理员仍可在同步中心手动触发。

单平台临时故障使用持久 `sync_jobs` 队列，普通平台最多执行 3 次，失败后分别等待 2 分钟和 4 分钟；Supabase `pg_cron` 每 5 分钟通过 `pg_net` 调用一次仅限 `scope=queue` 的内部入口，使用数据库 `SKIP LOCKED` 原子领取到期任务，并回收超过 15 分钟未结束的 Worker。GitHub Actions 只保留管理员手动 `queue` 应急入口，避免两个自动调度器同时领取不同任务并突破跨平台并发上限。计划批次按 `platform_accounts.id` 稳定游标每页读取 3 个已验证账号，避免牛客等串行平台使单次 Edge 请求超过网关时限；每一页只发送一次 POST，工作流不会进行 `curl` 传输层重试，并在全部页完成后统一报告业务失败。QOJ 任务仍只有一次尝试，避免重复创建 Firecrawl 会话或加重风控。批量同步会拆成单平台任务：Codeforces/AtCoder 并发 2，XCPC ELO 并发 4，牛客/洛谷/QOJ 并发 1。

参考项目：[FCYXSZY/astrbot_plugin_acm_helper](https://github.com/FCYXSZY/astrbot_plugin_acm_helper)。本项目借鉴其 Codeforces 分页/Accepted 去重思路，以及 `luogu_api/ckp.py` 的洛谷 Cookie、CSRF 和记录列表请求方式；凭据改由 Supabase Secrets 管理，不进入源码。

## 数据模型

迁移文件 [supabase/migrations/202607120001_initial_schema.sql](./supabase/migrations/202607120001_initial_schema.sql) 已创建：

| 表                          | 用途                                           |
| --------------------------- | ---------------------------------------------- |
| `profiles`                  | 姓名、QQ、年级、专业、角色、启用状态和公开设置 |
| `platform_accounts`         | 平台账号、标准化 ID、验证状态和唯一绑定        |
| `platform_stats`            | 最新 Rating、最高 Rating、刷题数、新鲜度和错误 |
| `stat_snapshots`            | 历史统计快照                                   |
| `sync_jobs`                 | 同步任务、重试、冷却和去重信息                 |
| `sync_runs`                 | 单平台运行结果、耗时、错误码和源版本           |
| `announcements`             | 公告                                           |
| `audit_logs`                | 平台验证、角色、绑定和同步等敏感操作审计       |
| `daily_problems`            | 每日题目、公开时间、训练提示和管理版本         |
| `daily_problem_completions` | 成员完成记录与完成时间                         |
| `daily_problem_comments`    | 仅成员可读的题目讨论及管理员可恢复的隐藏状态   |
| `xcpc_elo_cache_state`      | XCPC ELO 活跃版本、条件请求元数据、租约与冷却  |
| `xcpc_elo_cache_players`    | 我校选手的版本化精简 XCPC ELO 缓存             |

按时间排序的数据库迁移定义仓库目标结构；新 profile 必须从注册 metadata 写入姓名并自动启用，历史待审核/已驳回成员会自动迁移为启用，已停用成员保持停用。公开视图只返回姓名、年级和专业均完整且选择公开的成员。成员年级由 `profiles.grade` 维护；XCPC ELO 账号行由 Profile 姓名触发器创建和失效，普通成员不能直接写入、修改或删除。成员管理 RPC 仅允许正常管理员读取私有目录与详情、编辑资料、维护非 XCPC 平台绑定、停用/恢复成员和手工录入统计，并使用行锁、更新时间乐观锁和原子限流防止并发误操作与重复滥用。公告表撤销浏览器直写权限，管理员通过带行锁和严格递增版本时间戳的 RPC 新建、发布、归档或删除公告；公开视图仍只返回已到发布时间且尚未过期的已发布公告，所有写操作继续由触发器审计。平台账号只有在适配器确认存在后才会标记为已验证并写入首次统计；CF 使用上游返回的规范 Handle，牛客和洛谷 UID 去除前导零，活动同步期间禁止并发改号或解绑。普通成员注销后 Auth、资料、平台绑定、统计和同步记录级联删除，相关审计记录在同一数据库事务内移除全部个人标识。完整策略见 [账号与数据生命周期](./docs/data-lifecycle.md)。手工统计会原子创建成功运行记录、当前统计、历史快照和审计日志，来源标记为 `admin-manual/v1`，AtCoder 同时允许 Rating 与题数，XCPC ELO 手工 Rating 保留至多两位小数，下一次成功自动同步会覆盖。带上游观测时间的成功快照由唯一索引保证幂等，失败运行不冒充新的源观测；洛谷使用专用原子纠正 RPC，其他平台使用通用原子 RPC，在同一事务中锁定并复核成员仍为启用、账号与运行记录仍可写，再更新当前统计、写入幂等快照并关闭 run，避免停用后提交或公开半提交数据。XCPC ELO 当前分、历史最高分和共享缓存使用两位小数存储，不再隐式丢失官网精度。生产 Schema 类型已生成到 `src/types/database.ts` 并接入 Supabase Client，XCPC 服务端缓存表与 RPC 也受 CI 类型存在性门禁保护；同步中心支持全体、指定成员和指定平台三种管理员触发范围，并在执行前确认影响范围。数据库身份矩阵、XCPC 缓存租约、快照幂等、平台账号规范化、删除生命周期、持久队列、后台队列进度、公告管理、管理员限流、手工统计平台矩阵、洛谷幂等序列、非洛谷原子提交和注销事务 fencing 已在 PostgreSQL 17 空库 CI 通过。

## 页面

- `/`：集训队官网首页，包含 ACM 介绍、赛事版图、线上公开赛、学习资源、训练记录和加入方式。
- `/learning`：交互式新手学习引导，包含起点推荐、可持久化四周进度、周任务、可展开五阶段路线、知识地图、训练节奏，以及一键环境配置、算法竞赛 Wiki、XCPC Link 和 ACM 群组坐标汇总等资源入口。
- `/daily-problem`、`/daily-problem/:date`：每日题目、训练提示、最近题目、完成记录入口和成员讨论；访客只能看到题目与匿名聚合数量。
- `/rankings`：Rating 榜、刷题累计榜，以及北京时间本周、本月和自定义范围的刷题增量榜。
- `/members`、`/members/:id`：成员列表与详情；详情页展示平台主页、当前 Rating、历史最高 Rating、通过题数和数据状态。
- `/privacy`：公开数据范围、第三方处理方和资料删除说明。
- `/login`、`/register`、`/forgot-password`、`/reset-password`：登录、注册、发送重置邮件和恢复链接设置新密码流程。
- `/account`：当前用户资料、平台绑定和密码修改；XCPC ELO 显示姓名自动匹配状态，不提供 ID 输入框。普通成员不能手动同步，数据由计划任务和管理员更新。
- `/admin`：成员账号、已验证平台账号、失败任务和数据新鲜度概览。
- `/admin/members`：成员私有目录、关键词/状态筛选、当前结果 CSV 导出、编辑资料、停用和恢复；不包含成员审批。
- `/admin/members/:id`：成员详情、平台账号新增/修改/验证/同步/解绑、手工统计录入和最近活动。
- `/admin/accounts`：平台绑定验证、无效原因、停用和重新验证，使用更新时间乐观锁防止误审旧 UID；XCPC ELO 仅展示服务端自动匹配结果。
- `/admin/announcements`：公告草稿、发布、定时发布、过期、归档、游标分页、乐观锁编辑和审计删除。
- `/admin/daily-problems`：每日题目草稿、发布、归档、乐观锁编辑、无历史草稿删除和讨论审核入口。
- `/admin/sync`：活动队列进度、真实运行记录、全体/成员/平台范围同步确认和失败重试。
- `/admin/health`：24 小时、7 天或 30 天窗口内的六平台成功率、耗时、最近故障、凭据异常和无样本状态。
- `/admin/audit`：脱敏审计日志和防公式注入 CSV 导出。

后台路由已经做前端管理员守卫，数据库仍以 RLS、最小表权限和管理员 RPC 作为真正安全边界。平台账号验证使用乐观锁防止基于旧页面误审；验证后的首次同步独立执行，同步失败不会回滚验证状态。统计、快照和同步表仅允许管理员读取，由 service role 写入。普通成员调用同步函数会被服务端拒绝；管理员手动与平台账号验证触发的同步均通过 Edge Function 鉴权，并写入脱敏审计记录。

### 首管理员初始化

首次部署时，先让管理员账号完成注册并在 `/account` 填写姓名、QQ、年级和专业。随后在 Supabase SQL Editor 中以数据库管理员身份执行一次：

```sql
select public.bootstrap_first_admin('admin@example.edu.cn');
```

该函数只允许 `service_role` 或 Supabase SQL 管理员调用，并且在已有管理员后永久拒绝再次引导。生产项目已完成首管理员初始化。不要把 service role key 放入浏览器环境变量或前端代码；后续交接在后台成员管理中完成，提升或降级必须填写原因、确认权限影响、通过乐观锁与速率限制，并由数据库保证始终保留至少一名启用管理员。

## 快速开始

要求 Node.js 22 或更高版本。

```bash
npm ci
npm run dev
```

本地访问 `http://127.0.0.1:5173/`。如需连接 Supabase，可在被 Git 忽略的 `.env.development.local` 中配置 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY`；测试环境不会读取该文件。未配置时，开发服务器使用明确标注的演示数据和演示认证模式，生产构建则不会启用演示认证。

常用检查：

```bash
npm run format:check
npm run lint
npm run check:sync-workflow
npm test
npx playwright install chromium firefox webkit
npm run test:e2e
npm run build
npm run check:bundle
npx --yes deno check --config supabase/functions/deno.json supabase/functions/sync-member/index.ts supabase/functions/sync-stats/index.ts supabase/functions/delete-account/index.ts supabase/functions/change-password/index.ts supabase/functions/webchat/index.ts supabase/functions/webchat-config/index.ts supabase/functions/webchat-cache-probe/index.ts supabase/functions/firecrawl-config/index.ts
npx --yes deno lint --config supabase/functions/deno.json supabase/functions
npx --yes deno test --allow-read --allow-env --config supabase/functions/deno.json supabase/functions
npm run test:db
```

`npm run test:e2e:production` 是部署后的只读榜单复算门禁，需要在环境中提供 `PRODUCTION_E2E_BASE_URL`、`VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`。它只读取公开视图，拒绝演示数据回退，并独立复算全部公开成员在总榜和各平台榜的排序、总 Rating、总历史最高 Rating 与总题数；Pages workflow 会在新版本部署完成后自动执行。

生产构建还会自动执行 bundle budget：入口 JS 必须不超过 500 KiB 原始体积和 160 KiB gzip，并保留首页、榜单、登录、账号、后台概览和同步中心的独立路由块。`npm run check:bundle` 可在已有 `dist` 上单独复核。

数据库安全测试需要 Docker。它会从空的本地 Supabase 实例应用全部迁移，再以匿名访客、成员、停用成员和管理员身份验证 RLS、列权限、XCPC ELO 写保护、每日题目隐私边界、统计表只读边界与受控管理员 RPC；清单驱动矩阵会自动对照全部 34 个 `admin_*` 函数，保证 25 个浏览器入口对普通/停用成员统一拒绝，9 个内部实现不向浏览器角色开放。CI 在独立任务中执行同一套测试。

## 环境变量与 Secrets

公开浏览器变量：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_WEBCHAT_UI_ENABLED`（仅接受 `true`/`false`；默认关闭）
- `VITE_WEBCHAT_API_URL`（仅供本地回环测试；生产固定使用当前 Supabase 项目的 `webchat` Function）

只读生产验收变量：

- `PRODUCTION_E2E_BASE_URL`（正式 Pages 根路径，不进入前端构建）

GitHub Actions Variables：

- `VITE_WEBCHAT_UI_ENABLED`（Pages 构建开关；未配置时 workflow 明确回退为 `false`）

GitHub Actions Secrets：

- `SUPABASE_PROJECT_REF`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_ACCESS_TOKEN`（仅供加密数据库备份；CLI 每次运行动态取得短期数据库登录，不保存长期数据库密码）
- `BACKUP_ENCRYPTION_PASSPHRASE`（独立随机口令，至少 32 个字符）
- WebChat 首次接入或更换中转站时的完整协议/Abort 验收另需 `CHAT_RELAY_BASE_URL`、`CHAT_RELAY_API_KEY`、`CHAT_RELAY_MODEL`；三者只供手动 `WebChat relay compatibility` 工作流使用，不能配置为 `VITE_*`，也不会在 PR、push 或定时任务中自动消费模型额度。已写入管理员后台和 Supabase Vault 的生产配置使用独立 `WebChat production cache probe` 复核缓存，只复用现有 `SUPABASE_PROJECT_REF`、`SUPABASE_SERVICE_ROLE_KEY`，无需在 GitHub 再保存一份中转站地址、Key 或模型。

Supabase Function Secrets/配置：

- `FIRECRAWL_API_KEY`（数据库多 Key 池尚未建立时的兼容 Key；只允许配置在 Supabase Function Secrets）
- `QOJ_SERVICE_USERNAME`（专用 QOJ 服务账号）
- `QOJ_SERVICE_PASSWORD`（专用 QOJ 服务账号密码）
- `LUOGU_COOKIE`（专用洛谷会话 Cookie）
- `LUOGU_CSRF_TOKEN`（与 Cookie 对应的 CSRF Token）
- `SYNC_QUEUE_TOKEN`（独立随机值，32-256 个可打印 ASCII 字符；只授权 `scope=queue`）
- 可选：`SYNC_ALERT_WEBHOOK_URL`（仅 HTTPS）、`SYNC_ALERT_WEBHOOK_TOKEN`
- 可选：`WEBCHAT_CACHE_PROBE_TIMEOUT_MS`（单次上游缓存探针超时，默认 120000ms；两次请求共享的数据库租约会据此保持足够余量）
- `DELETION_RECOVERY_REPOSITORY`、`DELETION_RECOVERY_GITHUB_TOKEN`（注销前更新 GitHub 恢复下限；Token 仅授予目标仓库 Variables write）
- WebChat 默认由三层开关关闭：浏览器 `VITE_WEBCHAT_UI_ENABLED=false` 隐藏导航并拒绝 `/assistant`，服务端 `CHAT_ENABLED=false` 是最高优先级的环境熔断，数据库 `requests_enabled=false` 允许管理员在 `/admin/webchat` 立即暂停新请求。管理员还可修改中转站 Base URL、固定模型、API Key 和全站北京时间每日请求/Token 上限：地址、模型、开关、预算和版本保存在 `private` 单例表，Key 只写入 Supabase Vault，读取接口只返回“已配置/未配置”，浏览器永远拿不到旧 Key；每次修改还要求原因、实时管理员复核、速率限制和乐观锁，并写入不含 Key 的审计。后台同时读取当天全站请求数、已结算/预留 Token、剩余额度与北京时间重置时间；请求和 Token 预算首次阻断分别在固定全局锁下原子标记，每类每天最多投递一次 `webchat_budget_exhausted` 脱敏 Webhook，Payload 不含成员、请求、消息、中转站地址或 Key，投递失败不改变原额度拒绝结果且不自动重试。管理员还必须在账号详情的“AI 助手访问”中逐人授权并设置累计请求与 Token 总限额；无私有授权行、授权关闭、账号停用或角色不是成员/管理员均默认拒绝。已授权账号的 `/assistant` 只读取后端当前模型名和自己的累计已用、预留、总限额与剩余额度，不返回其他账号、全站预算、中转站地址或 Key；成员额度不会每日重置，管理员提高总限额可追加可用额度，历史用量始终保留。WebChat 请求会先检查账号授权，再读取含 Vault Key 的运行时配置；数据库原子 claim 在付费请求前二次读取账号授权、累计成员额度、数据库总开关和全站日预算，管理员撤权、暂停或降额不会被预读竞态绕过。只有数据库中转站配置行尚不存在时才会使用 `CHAT_RELAY_BASE_URL`、`CHAT_RELAY_API_KEY`、`CHAT_RELAY_MODEL`、`CHAT_GLOBAL_REQUESTS_PER_DAY` 与 `CHAT_GLOBAL_TOKENS_PER_DAY` 环境变量；逐账号累计额度不使用环境变量回退。数据库行一旦存在，其暂停开关和全站预算始终优先；若管理员开启请求但地址、模型或 Vault Key 不完整，请求会失败关闭。原子并发、滑动分钟、逐账号累计总额度、跨全部账号的全站日预算以及 `request_id + fingerprint + owner_token` 幂等租约均由数据库 RPC 实现；全站账本在 claim、释放、超时回收和已知/未知 Usage 结算时使用固定锁序更新，动态模型会进入请求指纹，并写入该次请求的服务端系统提示词。启用时还须配置 `CHAT_ALLOWED_ORIGINS` 和 `CHAT_SYSTEM_PROMPT_VERSION`。请求、消息、总字符、输出与超时上限使用 `.env.example` 中的 `CHAT_MAX_*` / `CHAT_REQUEST_TIMEOUT_MS`；系统分钟限流与租约使用 `CHAT_REQUESTS_PER_MINUTE`、`CHAT_CLAIM_LEASE_SECONDS`，逐账号累计请求与 Token 总限额只由管理员后台配置，其中租约必须至少比上游超时多 30 秒。禁止添加任何 `VITE_CHAT_RELAY_*` 密钥变量。
- `ALLOWED_ORIGIN`
- 可选：`FIRECRAWL_API_URL`、`CODEFORCES_MAX_PAGES`、`LUOGU_MAX_PAGES`、`XCPC_ELO_DATA_URL`
- 可选 XCPC 缓存调优：`XCPC_ELO_CACHE_TTL_SECONDS`、`XCPC_ELO_CACHE_LEASE_SECONDS`、`XCPC_ELO_CACHE_RETRY_SECONDS`、`XCPC_ELO_CACHE_WAIT_MS`、`XCPC_ELO_CACHE_POLL_MS`、`XCPC_ELO_MAX_SOURCE_BYTES`、`XCPC_ELO_MIN_SOURCE_PLAYERS`

`service_role`、第三方服务凭据和其他敏感信息不得使用 `VITE_*` 前缀，也不得进入 Git 历史。`ALLOWED_ORIGIN` 支持逗号分隔的 Origin 白名单，例如 `http://localhost:5173,http://127.0.0.1:5173,https://greenthree.github.io`；Origin 不包含 `/USTSACMLand/` 路径。

WebChat 的 Origin 白名单是浏览器跨域边界，不代替身份认证。没有 `Origin` 的受控 CLI/服务端请求仍必须携带有效 Supabase Bearer Token，并通过 Profile 启用状态检查；浏览器请求只允许 `CHAT_ALLOWED_ORIGINS` 中的精确 Origin。

WebChat 配额表位于 `private` Schema，浏览器角色和 `service_role` 都没有配额表直表权限，只能由 Edge Function 通过最小权限 `SECURITY DEFINER` RPC 执行 claim、开始、结算、开始前释放、聚合用量读取和一次性告警标记。Supabase `service_role` 本身是可访问 Vault 的平台高权限后端凭据，因此只允许部署在受控 Edge Function 中；网站配置读取和审计接口永远不向浏览器返回 Key。额度账本只保存用户 UUID、请求 ID、SHA-256 指纹、租约、聚合用量以及中转站返回的缓存输入/写入 Token 计数，不保存消息正文；同一成员同时最多有一个生成任务。GPT-5.6 及以后模型使用 Responses typed `input_text`、历史用户消息显式缓存断点和请求级 `explicit` 模式；当前生产中转站会对“显式断点 + 省略模式”的官方默认隐式形状返回 HTTP 400，因此不能直接采用该形状。旧模型和自定义中转模型保持原有隐式缓存请求，避免发送不支持的字段。管理员后台只显示达到 1024 Token 门槛的请求数、命中请求数和聚合输入缓存率，不展示成员、会话、请求 ID 或正文；成员和全站额度仍按完整 `total_tokens` 结算，不因缓存折扣改变产品额度。生产缓存探针另用 service-role-only 账本固定计入全站 2 次请求，并按首轮与追加轮完整请求 JSON 的 UTF-8 字节数、最大输出和协议余量动态计算保守 Token 预留，不占任何成员额度，30 分钟冷却且无自动重试；异常 Usage 超过预留时会清除不可信计数、按预留上限记入未知用量并让探针失败，不能越过全站硬额度。其 Edge Function 拒绝浏览器 `Origin`，只从 Vault 读取当前中转站配置，180 天内仅保留模型 Usage、缓存 Token 计数、租约和结果，不保存 Prompt、回复、Base URL 或 Key。会话正文另存于私有历史表，只能通过绑定 `auth.uid()` 且不接受目标成员 ID 的 own-history RPC 访问，普通管理员默认也不能读取成员正文。

AI 学习助手会把成员提交的问题、当前会话的可见上下文和固定系统指令转发给管理员配置的中转站及其上游模型。为支持刷新恢复和历史会话，本站私有数据库最多为每个账号保存 100 个会话，单会话最多 120 条消息/1 MiB，最后活动超过 180 天自动清理；成员可自行删除，注销时随 Profile 级联删除。历史接口只绑定当前登录账号，额度账本仍不保存正文。中转站和上游模型的留存、训练、删除与跨境政策必须由维护者持续核对。站内披露见 [`/privacy`](https://greenthree.github.io/USTSACMLand/privacy)，工程边界见[WebChat 私有历史会话](./docs/webchat-conversation-history.md)。

`npm run test:e2e:webchat` 使用本地脱敏流式服务覆盖 Chromium、Firefox、WebKit、390px 移动端和宽屏：登录返回、动态 Token、流式输出、键盘停止、403 权限刷新、429 限流不重试、502/504 手动恢复、会话失效、减少动画和 axe 均进入门禁；Chromium 还会同时驱动 10 个独立页面验证回复不串流，并用 10 路并行 HTTP 流确认服务端传输层可同时完成且无残留活动连接。该测试只证明本地协议与客户端隔离，不能替代真实中转站费用、Usage 和 Abort 验收。

真实中转站上线前必须先运行手动兼容性验收：非流式响应需要返回可见文本、实际模型 ID 和 Usage；流式响应需要使用 Responses typed SSE，并依次观察 `response.created`、至少一个 `response.output_text.delta`/`response.refusal.delta` 和带 Usage 的 `response.completed`；Abort 检查必须在首个增量后两秒内结束客户端流。生产请求与验收请求都携带由模型和系统提示词版本派生的稳定 `prompt_cache_key`；GPT-5.6+ 真实会话发送 `prompt_cache_options.mode=explicit` 和历史用户消息缓存断点，以符合当前中转站已验证的参数边界。官方缓存仍要求断点前至少 1024 个输入 Token 和精确重复前缀，短对话 `cached_tokens=0` 不代表配置失败。完整中转站工作流继续验证非流式、流式、Abort 和可选缓存；已配置生产环境则由 service-role-only `webchat-cache-probe` 发送“长首轮 + 追加第二轮”的真实会话形状，要求第二次 `input_tokens_details.cached_tokens > 0`。生产探针只使用现有 Supabase GitHub Secrets，从 Vault 读取中转站值，脱敏 Artifact 保留 14 天。配置与发布顺序见 [WebChat 中转站兼容性验收](./docs/webchat-relay-compatibility.md)。

数据库队列调度器在 Supabase Vault 保存 `sync_queue_endpoint`、公开的 `sync_queue_anon_key` 和与 `SYNC_QUEUE_TOKEN` 相同的 `sync_queue_scheduler_token`。Vault 不保存 service role key；cron catalog 只保存私有函数调用。`read_sync_queue_scheduler_health()` 仅向 service role 返回配置是否齐全、最近调度时间、HTTP 状态和近 15 分钟 cron 聚合，不返回 URL、请求头、正文、Token 或响应正文。

永久注销采用“禁止恢复到注销前”的恢复下限策略。`delete-account` 的目标绑定数据库租约覆盖完整临界区：取得 `owner + target_user_id` 租约 → 将一个不含用户 ID、姓名、邮箱或账号的 UTC 时间写入 GitHub 仓库变量 `BACKUP_RECOVERY_NOT_BEFORE` 并回读确认 → 续期并停止外部阶段心跳 → 调用仅限 service role 的最终 RPC。RPC 先锁定租约单例行和目标 Profile，再次验证 owner、target、有效期、普通成员角色和无活动同步，设置事务内 fence 标记，并在同一事务删除 `auth.users` 与消费租约；Auth 删除触发器拒绝任何没有匹配 owner/target 标记的旧 HTTP 或旁路删除，因此部署切换期间的旧 Edge 请求也会失败关闭。Auth/Profile 级联和审计匿名化只会整体提交或回滚。租约冲突、取得或删除前续期失败，或恢复下限写入与确认失败时，函数不执行 Auth 删除并返回 `503`；管理员、活动同步、Storage 所有权或其他受控约束拒绝删除时返回 `409`，账号与业务数据保持不变。数据库行锁使最终删除不再依赖 Edge Runtime 定时心跳：即使租约墙钟到期，竞争请求也只能等待首个删除事务结束。备份会记录当时的下限，恢复前还必须用仓库变量当前值执行 `npm run verify:backup-recovery-floor -- <metadata.txt>`。

仓库提供每日加密逻辑备份工作流：分别导出角色、应用 Schema、挂在 `auth.users` 上的三个本站触发器、业务数据、Auth 用户数据和 migration 历史，并在密文内保存 7 个关键表的聚合恢复清单，只上传 AES-256 加密密文并保留 14 天。完整的 Supabase 管理型 `auth` Schema 不进入归档；只从同次临时 dump 提取注册 Profile、注销清理和恢复下限围栏触发器。手动 `Encrypted database restore drill` 会验证备份来源和恢复下限，在一次性本地 Supabase 中单事务恢复，逐项比对行数、确认三个 Auth 触发器，并烟测注册 Profile、密码登录、RLS、匿名边界与受控注销；解密数据和临时凭据会在上传脱敏报告前删除。Supabase Free 项目没有自动每日备份保障；付费套餐的实际备份窗口仍须在 Dashboard 核对。配置、恢复演练和 Storage 限制见 [数据库备份与恢复方案](./docs/backup-and-recovery.md)。

终态同步失败、Firecrawl 低额度和六个 Edge Function 的非业务型 500 可发送脱敏 Webhook。运行时通知只包含固定函数名、固定错误类别、时间和安全格式的请求 ID，不发送异常 message/stack、成员身份、请求体或第三方响应；通知失败不会改变原业务结果。浏览器端不保存告警 Token，只提供顶层错误边界和脱敏本地运行时事件。配置与验收方式见 [运行时与同步告警](./docs/sync-alerting.md)。

洛谷 Cookie 与 CSRF Token 必须来自独立、可轮换的服务账号，并且保持成对更新。`LUOGU_MAX_PAGES` 默认 100、最大 1000；它只用于阻止异常分页无限消耗请求，不应调低到无法覆盖成员完整提交历史。

### QOJ 自动登录

`QOJ_SERVICE_USERNAME` 和 `QOJ_SERVICE_PASSWORD` 只配置在 Supabase Function Secrets。适配器每次创建不使用缓存的临时 Firecrawl 浏览器，通过 `/interact` 填写 QOJ 登录表单、确认 `Logout` 登录态、读取目标用户主页，并在 `finally` 中请求结束会话。不要把真实值写入 `.env.example`、命令历史、CI 日志或截图。

在受控环境中注入三项 Secret 后，可使用任一公开 QOJ 用户名做完整登录健康检查：

```bash
npx --yes deno run \
  --allow-env=FIRECRAWL_API_KEY,FIRECRAWL_API_URL,QOJ_SERVICE_USERNAME,QOJ_SERVICE_PASSWORD \
  --allow-net --config supabase/functions/deno.json \
  scripts/check-qoj-login.ts <public-QOJ-username>
```

当前 Firecrawl 账户未开通 Zero Data Retention，作业请求可能由 Firecrawl 按其策略保留。该账号必须与任何个人账号和其他系统密码完全隔离；轮换密码时同时更新 Supabase Secret，并重新运行健康检查。

## 部署

生产 Supabase 项目已关联，`sync-member`、`sync-stats`、`delete-account`、`change-password`、`webchat-config`、`webchat`、`webchat-cache-probe` 与 `firecrawl-config` 均已部署为 ACTIVE；截至 2026-07-19 共有 53 个 production migration，`sync-member` 为 v41，`sync-stats` 为 v29，`firecrawl-config` 为 v1，`webchat` 为 v10，`webchat-cache-probe` 为 v2。仓库 migration 必须按时间顺序应用；部署前先使用 `supabase migration list --linked` 核对远端状态，再应用尚未部署的 migration。函数部署需要显式传入 Deno import map：

`202607140010_platform_account_canonicalization.sql` 会在修改数据前检查历史牛客/洛谷绑定：如果两个成员的 UID 只差前导零，或存在超过 20 位的旧 UID，migration 会带修复提示安全终止。管理员应先在成员管理中确认归属并改正或解绑冲突记录，再重新应用 migration；脚本不会自动选择账号所有者或删除成员数据。

```bash
npm run check:supabase-preflight
npx --yes supabase@2.109.1 db push --linked --include-all
npx --yes supabase@2.109.1 functions deploy sync-member sync-stats delete-account change-password \
  --use-api --import-map supabase/functions/deno.json
npx --yes supabase@2.109.1 functions deploy firecrawl-config \
  --use-api --import-map supabase/functions/deno.json
# 可先在三层关闭态部署；正式启用前必须通过 WebChat 发布检查单。
npx --yes supabase@2.109.1 functions deploy webchat webchat-config webchat-cache-probe \
  --use-api --import-map supabase/functions/deno.json
npm run check:supabase-readiness
```

Vite 生产 `base` 已设置为 `/USTSACMLand/`，构建脚本会复制 `dist/index.html` 为 `dist/404.html`。`.github/workflows/deploy-pages.yml` 仅在 `main` 的完整 CI 成功后运行，并检出通过 CI 的精确提交再构建、发布 Pages；数据库安全任务失败不会覆盖线上版本。Pages 会校验并注入仓库变量 `VITE_WEBCHAT_UI_ENABLED`，未配置时固定为 `false`；生产 WebChat API 地址由 `VITE_SUPABASE_URL` 推导为同项目 `/functions/v1/webchat`，不允许把登录 Token 发往任意覆盖域名。正式地址约定为 `https://greenthree.github.io/USTSACMLand/`；Supabase Auth 回调配置保留 localhost 并加入正式路径，`ALLOWED_ORIGIN` 则使用不含路径的 `https://greenthree.github.io`。

## 当前限制与下一步

1. 配置生产同步失败 Webhook，并完成 Firecrawl 额度告警投递烟测。
2. 配置注销恢复下限 GitHub Token，完成成功注销、Storage/约束 `409`、双连接 fencing、旧 JWT RLS 和响应丢失对账。
3. 验证生产邮箱确认、密码重置、会话恢复和管理员登录完整流程。
4. 完成持久队列 stale-worker、退避、跨平台并发限额，以及同步中心/公告/限流的生产 UI 烟测。
5. 由项目负责人确定源码许可证和学校、集训队、赛事标识授权范围。
6. 使用真实队员小范围试运行，修复后按 [正式发布检查单](./docs/release-checklist.md) 准备 `v1.0.0`。

视觉规范见 [docs/DESIGN.md](./docs/DESIGN.md)，架构取舍见 [docs/adr/](./docs/adr/README.md)，部署与故障处理见 [生产运维手册](./docs/operations-runbook.md)，数据恢复见 [数据库备份与恢复方案](./docs/backup-and-recovery.md)，发布门禁见 [正式发布检查单](./docs/release-checklist.md)，详细进度见 [ROADMAP.md](./ROADMAP.md)。

## 许可证与归属

许可证尚未确定；在补充 `LICENSE` 前，源码默认不授予复制、修改或再分发许可。数据处理说明见 [PRIVACY.md](./PRIVACY.md) 与 [第三方数据来源说明](./docs/third-party-data-sources.md)，漏洞报告方式见 [SECURITY.md](./SECURITY.md)。正式使用学校及 ACM 集训队相关标识前仍需确认授权范围。
