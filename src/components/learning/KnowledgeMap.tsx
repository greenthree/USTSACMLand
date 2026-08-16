import { useState } from 'react'
import Blocks from 'lucide-react/dist/esm/icons/blocks'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right'
import DraftingCompass from 'lucide-react/dist/esm/icons/drafting-compass'
import Flag from 'lucide-react/dist/esm/icons/flag'
import Sigma from 'lucide-react/dist/esm/icons/sigma'
import TableProperties from 'lucide-react/dist/esm/icons/table-properties'
import Terminal from 'lucide-react/dist/esm/icons/terminal'
import TextSearch from 'lucide-react/dist/esm/icons/text-search'
import Waypoints from 'lucide-react/dist/esm/icons/waypoints'
import Workflow from 'lucide-react/dist/esm/icons/workflow'

type KnowledgeDifficulty = 'beginner' | 'foundation' | 'advanced'

interface KnowledgePoint {
  label: string
  difficulty: KnowledgeDifficulty
}

interface KnowledgeSection {
  id: string
  label: string
  description: string
  outcome: string
  points: KnowledgePoint[]
}

interface KnowledgeDomain {
  id: string
  index: string
  label: string
  description: string
  icon: typeof Terminal
  sections: KnowledgeSection[]
}

const difficultyLabels: Record<KnowledgeDifficulty, string> = {
  beginner: '入门',
  foundation: '基础',
  advanced: '进阶',
}

const knowledgeDomains: KnowledgeDomain[] = [
  {
    id: 'programming',
    index: '01',
    label: '程序基础',
    description: '先把题意稳定翻译成能运行、能调试的 C++ 程序。',
    icon: Terminal,
    sections: [
      {
        id: 'language-tools',
        label: '语言与工具',
        description: '掌握竞赛里最常用的语言结构，形成从读入数据到输出答案的完整闭环。',
        outcome: '能独立完成一道包含多组数据、条件分支和数组处理的入门题。',
        points: [
          { label: '输入输出', difficulty: 'beginner' },
          { label: '判断与循环', difficulty: 'beginner' },
          { label: '函数', difficulty: 'beginner' },
          { label: '数组', difficulty: 'foundation' },
          { label: '字符串', difficulty: 'foundation' },
        ],
      },
      {
        id: 'standard-library',
        label: 'STL 常用容器',
        description: '使用标准库保存、查找和维护数据，避免重复实现已经成熟的基础结构。',
        outcome: '能根据“顺序、去重、映射、优先级”选择合适的 STL 容器。',
        points: [
          { label: 'vector', difficulty: 'beginner' },
          { label: 'pair', difficulty: 'beginner' },
          { label: 'map 与 set', difficulty: 'foundation' },
          { label: 'priority_queue', difficulty: 'foundation' },
          { label: 'bitset', difficulty: 'advanced' },
        ],
      },
      {
        id: 'debug-engineering',
        label: '调试与工程习惯',
        description: '让程序不仅“样例能过”，还能够稳定处理边界、极值和多组测试。',
        outcome: '能快速定位越界、未初始化和复杂度超限，并写出便于复查的代码。',
        points: [
          { label: '边界与极值', difficulty: 'beginner' },
          { label: '初始化与类型', difficulty: 'beginner' },
          { label: '断言与对拍', difficulty: 'foundation' },
          { label: '时间与空间复杂度', difficulty: 'foundation' },
          { label: '代码规范', difficulty: 'foundation' },
        ],
      },
    ],
  },
  {
    id: 'basic-algorithms',
    index: '02',
    label: '基础算法',
    description: '建立排序、枚举、区间处理和答案判定的基础工具箱。',
    icon: Workflow,
    sections: [
      {
        id: 'sorting-enumeration',
        label: '排序与枚举',
        description: '通过重排数据或系统遍历候选方案，把无序问题转换为可检查的过程。',
        outcome: '能判断何时直接枚举，并能解释常见排序算法的复杂度与稳定性。',
        points: [
          { label: '选择与插入排序', difficulty: 'beginner' },
          { label: '归并排序', difficulty: 'foundation' },
          { label: '快速排序', difficulty: 'foundation' },
          { label: '枚举', difficulty: 'beginner' },
          { label: '模拟', difficulty: 'beginner' },
        ],
      },
      {
        id: 'prefix-difference',
        label: '前缀与差分',
        description: '预处理区间的累计信息，或把多次区间修改转换为少量端点变化。',
        outcome: '能把重复区间查询或修改从逐个处理优化到线性预处理。',
        points: [
          { label: '一维前缀和', difficulty: 'beginner' },
          { label: '二维前缀和', difficulty: 'foundation' },
          { label: '差分', difficulty: 'foundation' },
          { label: '离散化', difficulty: 'foundation' },
        ],
      },
      {
        id: 'two-pointers-binary-search',
        label: '双指针与二分',
        description: '利用单调性缩小搜索范围，用更少的检查找到区间、位置或最优答案。',
        outcome: '能识别单调条件，并写出不会死循环或越界的二分模板。',
        points: [
          { label: '双指针', difficulty: 'foundation' },
          { label: '滑动窗口', difficulty: 'foundation' },
          { label: '二分查找', difficulty: 'beginner' },
          { label: '二分答案', difficulty: 'foundation' },
        ],
      },
      {
        id: 'greedy-divide-conquer',
        label: '贪心与分治',
        description: '尝试用局部选择构造全局答案，或把大问题拆成结构相同的小问题。',
        outcome: '能为简单贪心给出交换论证，并实现合并式的分治过程。',
        points: [
          { label: '贪心策略', difficulty: 'foundation' },
          { label: '交换论证', difficulty: 'foundation' },
          { label: '分治', difficulty: 'foundation' },
          { label: '随机化', difficulty: 'advanced' },
        ],
      },
    ],
  },
  {
    id: 'data-structures',
    index: '03',
    label: '数据结构',
    description: '用合适的结构组织数据，让查询与修改都保持高效。',
    icon: Blocks,
    sections: [
      {
        id: 'linear-structures',
        label: '线性结构',
        description: '理解元素进入、离开和访问顺序，这是搜索与更复杂结构的共同基础。',
        outcome: '能从先进先出、后进先出和双端操作需求中选择正确结构。',
        points: [
          { label: '栈', difficulty: 'beginner' },
          { label: '队列', difficulty: 'beginner' },
          { label: '双端队列', difficulty: 'foundation' },
          { label: '链表', difficulty: 'foundation' },
        ],
      },
      {
        id: 'set-maintenance',
        label: '集合维护',
        description: '高效判断元素归属、合并连通关系，并为静态范围查询建立预处理。',
        outcome: '能用并查集维护动态合并，并根据数据是否变化选择哈希或静态查询结构。',
        points: [
          { label: '并查集', difficulty: 'foundation' },
          { label: '哈希表', difficulty: 'foundation' },
          { label: 'ST 表', difficulty: 'foundation' },
          { label: '启发式合并', difficulty: 'advanced' },
        ],
      },
      {
        id: 'range-maintenance',
        label: '区间维护',
        description: '在数据持续变化时，快速完成前缀或任意区间的统计、更新与查询。',
        outcome: '能区分单点与区间操作，并选择树状数组或线段树完成维护。',
        points: [
          { label: '树状数组', difficulty: 'foundation' },
          { label: '线段树', difficulty: 'foundation' },
          { label: '懒标记', difficulty: 'advanced' },
          { label: '可持久化结构', difficulty: 'advanced' },
        ],
      },
      {
        id: 'tree-structures',
        label: '树上结构',
        description: '把层级关系转成可遍历、可跳转、可分解的结构，处理祖先和路径问题。',
        outcome: '能完成树的遍历与深度统计，并理解祖先查询和路径维护的基本思路。',
        points: [
          { label: '树的遍历', difficulty: 'foundation' },
          { label: '倍增与 LCA', difficulty: 'foundation' },
          { label: '树链剖分', difficulty: 'advanced' },
          { label: '点分治', difficulty: 'advanced' },
        ],
      },
    ],
  },
  {
    id: 'graph-search',
    index: '04',
    label: '图论与搜索',
    description: '把关系建成点和边，在状态空间中有序地探索可达路径。',
    icon: Waypoints,
    sections: [
      {
        id: 'search',
        label: '搜索',
        description: '从一个状态出发系统扩展候选状态，并通过回溯或队列控制探索顺序。',
        outcome: '能为小规模状态空间选择 DFS 或 BFS，并加入安全的剪枝。',
        points: [
          { label: '递归与回溯', difficulty: 'beginner' },
          { label: '深度优先搜索', difficulty: 'foundation' },
          { label: '广度优先搜索', difficulty: 'foundation' },
          { label: '剪枝', difficulty: 'foundation' },
        ],
      },
      {
        id: 'graph-basics',
        label: '图论基础',
        description: '用邻接结构表示关系，处理先后依赖、最短代价和最小连接成本。',
        outcome: '能建立图模型，并根据边权和目标选择拓扑、最短路或生成树算法。',
        points: [
          { label: '图的存储与遍历', difficulty: 'beginner' },
          { label: '拓扑排序', difficulty: 'foundation' },
          { label: '最短路', difficulty: 'foundation' },
          { label: '最小生成树', difficulty: 'foundation' },
        ],
      },
      {
        id: 'connectivity',
        label: '连通性',
        description: '识别图中彼此可达的整体，以及删除点边后结构发生变化的位置。',
        outcome: '能判断二分图，并理解强连通分量、割点和割边所描述的结构。',
        points: [
          { label: '二分图', difficulty: 'foundation' },
          { label: '强连通分量', difficulty: 'advanced' },
          { label: '割点与割边', difficulty: 'advanced' },
          { label: '双连通分量', difficulty: 'advanced' },
        ],
      },
      {
        id: 'network-flow',
        label: '网络流',
        description: '在容量与费用约束下分配流量，表达匹配、调度和资源分配问题。',
        outcome: '能把简单匹配问题建成流网络，并理解增广路为什么能改进答案。',
        points: [
          { label: '增广路', difficulty: 'advanced' },
          { label: '最大流', difficulty: 'advanced' },
          { label: '最小割', difficulty: 'advanced' },
          { label: '费用流', difficulty: 'advanced' },
        ],
      },
    ],
  },
  {
    id: 'dynamic-programming',
    index: '05',
    label: '动态规划',
    description: '定义状态与转移，把重复子问题组织成可复用的计算过程。',
    icon: TableProperties,
    sections: [
      {
        id: 'dp-foundations',
        label: 'DP 基础',
        description: '明确状态代表什么、答案从哪里转移而来，以及计算顺序如何保证依赖已知。',
        outcome: '能为简单线性问题写出状态、转移、初值和答案位置。',
        points: [
          { label: '状态设计', difficulty: 'foundation' },
          { label: '状态转移', difficulty: 'foundation' },
          { label: '无后效性', difficulty: 'foundation' },
          { label: '记忆化搜索', difficulty: 'foundation' },
        ],
      },
      {
        id: 'knapsack',
        label: '背包问题',
        description: '围绕容量、选择次数和物品分组，练习最典型的一类动态规划模型。',
        outcome: '能从选择限制区分背包类型，并正确处理一维状态的循环顺序。',
        points: [
          { label: '01 背包', difficulty: 'foundation' },
          { label: '完全背包', difficulty: 'foundation' },
          { label: '多重背包', difficulty: 'foundation' },
          { label: '分组背包', difficulty: 'advanced' },
        ],
      },
      {
        id: 'dp-models',
        label: '常见模型',
        description: '根据题目的结构选择区间、树、数字位或概率状态，而不是死背单一模板。',
        outcome: '能识别状态维度与题目结构的对应关系，并选择合适的枚举顺序。',
        points: [
          { label: '区间 DP', difficulty: 'foundation' },
          { label: '树形 DP', difficulty: 'advanced' },
          { label: '数位 DP', difficulty: 'advanced' },
          { label: '概率 DP', difficulty: 'advanced' },
        ],
      },
      {
        id: 'dp-optimization',
        label: 'DP 优化',
        description: '利用转移中的单调性、凸性或可分治结构，减少无效的决策枚举。',
        outcome: '能先写出正确的朴素转移，再判断它是否满足某种优化前提。',
        points: [
          { label: '滚动数组', difficulty: 'foundation' },
          { label: '单调队列优化', difficulty: 'advanced' },
          { label: '斜率优化', difficulty: 'advanced' },
          { label: '分治优化', difficulty: 'advanced' },
        ],
      },
    ],
  },
  {
    id: 'mathematics',
    index: '06',
    label: '数学基础',
    description: '把整数、计数与矩阵规律转化为可靠而高效的算法。',
    icon: Sigma,
    sections: [
      {
        id: 'number-theory',
        label: '数论',
        description: '处理整除、素数和模运算，是组合计数与大量算法题的共同底座。',
        outcome: '能安全完成模运算，并用筛法与快速幂处理常见整数问题。',
        points: [
          { label: 'gcd 与 lcm', difficulty: 'beginner' },
          { label: '素数筛法', difficulty: 'foundation' },
          { label: '快速幂', difficulty: 'foundation' },
          { label: '扩展欧几里得', difficulty: 'advanced' },
          { label: '乘法逆元', difficulty: 'advanced' },
        ],
      },
      {
        id: 'combinatorics',
        label: '组合计数',
        description: '从“怎样选择和排列”出发，系统计算方案数量并处理重复或遗漏。',
        outcome: '能计算基础组合数，并在重叠计数问题中使用容斥思想。',
        points: [
          { label: '排列与组合数', difficulty: 'foundation' },
          { label: '容斥原理', difficulty: 'foundation' },
          { label: '鸽巢原理', difficulty: 'foundation' },
          { label: '卡特兰数', difficulty: 'advanced' },
        ],
      },
      {
        id: 'linear-algebra',
        label: '线性代数',
        description: '用矩阵表达线性转移和方程组，把重复迭代或约束求解转为代数运算。',
        outcome: '能实现矩阵乘法，并理解快速幂与消元各自解决的问题。',
        points: [
          { label: '矩阵乘法', difficulty: 'foundation' },
          { label: '矩阵快速幂', difficulty: 'advanced' },
          { label: '高斯消元', difficulty: 'advanced' },
          { label: '线性基', difficulty: 'advanced' },
        ],
      },
      {
        id: 'polynomials',
        label: '多项式',
        description: '高效处理卷积与多项式运算，是计数和高级字符串算法中的重要工具。',
        outcome: '理解卷积的含义，并能说清 FFT 或 NTT 相比朴素乘法优化了什么。',
        points: [
          { label: '卷积', difficulty: 'advanced' },
          { label: 'FFT', difficulty: 'advanced' },
          { label: 'NTT', difficulty: 'advanced' },
          { label: '多项式求逆', difficulty: 'advanced' },
        ],
      },
    ],
  },
  {
    id: 'strings',
    index: '07',
    label: '字符串',
    description: '从逐字符比较走向快速匹配、前缀组织和重复结构分析。',
    icon: TextSearch,
    sections: [
      {
        id: 'string-matching',
        label: '基础匹配',
        description: '利用哈希、失配信息或前缀结构，减少模式串与文本的重复比较。',
        outcome: '能根据单模式、多模式或前缀查询需求选择哈希、KMP 或字典树。',
        points: [
          { label: '字符串哈希', difficulty: 'foundation' },
          { label: 'KMP', difficulty: 'foundation' },
          { label: 'Z 函数', difficulty: 'foundation' },
          { label: '字典树', difficulty: 'foundation' },
        ],
      },
      {
        id: 'string-automata',
        label: '字符串自动机',
        description: '把匹配过程建成状态转移，在一段文本中同时查找多个模式。',
        outcome: '理解 fail 指针的作用，并能用 AC 自动机完成多模式匹配。',
        points: [
          { label: '有限状态思想', difficulty: 'foundation' },
          { label: 'fail 指针', difficulty: 'advanced' },
          { label: 'AC 自动机', difficulty: 'advanced' },
          { label: '自动机上的 DP', difficulty: 'advanced' },
        ],
      },
      {
        id: 'advanced-string-structures',
        label: '高级结构',
        description: '组织字符串的全部后缀或子串状态，回答排序、重复和包含关系问题。',
        outcome: '能区分后缀数组与后缀自动机维护的信息，并理解它们的典型用途。',
        points: [
          { label: '后缀数组', difficulty: 'advanced' },
          { label: '最长公共前缀', difficulty: 'advanced' },
          { label: '后缀自动机', difficulty: 'advanced' },
          { label: '回文自动机', difficulty: 'advanced' },
        ],
      },
    ],
  },
  {
    id: 'computational-geometry',
    index: '08',
    label: '计算几何',
    description: '用向量和几何判定把图形关系转化为可计算的代数条件。',
    icon: DraftingCompass,
    sections: [
      {
        id: 'points-lines',
        label: '点与线',
        description: '从向量运算建立方向、投影、距离和相交关系的基础判定。',
        outcome: '能用点积与叉积稳定判断方向、共线和线段相交。',
        points: [
          { label: '向量与坐标', difficulty: 'foundation' },
          { label: '点积', difficulty: 'foundation' },
          { label: '叉积', difficulty: 'foundation' },
          { label: '线段相交', difficulty: 'foundation' },
        ],
      },
      {
        id: 'polygons',
        label: '多边形',
        description: '用有向面积和转向信息分析多边形边界、包含关系与外壳。',
        outcome: '能计算多边形面积，并用单调链构造二维点集的凸包。',
        points: [
          { label: '多边形面积', difficulty: 'foundation' },
          { label: '点在多边形内', difficulty: 'foundation' },
          { label: '凸包', difficulty: 'advanced' },
          { label: '最近点对', difficulty: 'advanced' },
        ],
      },
      {
        id: 'advanced-geometry',
        label: '进阶几何',
        description: '利用凸性、半平面与圆的关系处理更复杂的最值和可行域问题。',
        outcome: '理解旋转卡壳与半平面交的适用条件，并能构建基本的几何工具库。',
        points: [
          { label: '圆与切线', difficulty: 'advanced' },
          { label: '旋转卡壳', difficulty: 'advanced' },
          { label: '半平面交', difficulty: 'advanced' },
          { label: '闵可夫斯基和', difficulty: 'advanced' },
        ],
      },
    ],
  },
]

const domainById = new Map(knowledgeDomains.map((domain) => [domain.id, domain]))

const defaultDomain = knowledgeDomains[0]
const defaultSection = defaultDomain.sections[0]

export default function KnowledgeMap() {
  const [activeDomainId, setActiveDomainId] = useState(defaultDomain.id)
  const [activeSectionId, setActiveSectionId] = useState(defaultSection.id)

  const activeDomain = domainById.get(activeDomainId) ?? defaultDomain
  const activeSection =
    activeDomain.sections.find((section) => section.id === activeSectionId) ??
    activeDomain.sections[0]

  const selectDomain = (domain: KnowledgeDomain) => {
    setActiveDomainId(domain.id)
    setActiveSectionId(domain.sections[0].id)
  }

  return (
    <div className="learning-knowledge-map">
      <div className="learning-knowledge-toolbar">
        <p>
          选择一个算法领域，再沿着分支查看学习顺序。先完成入门与基础节点，进阶内容可以在参赛后按需补齐。
        </p>
        <ul className="learning-knowledge-legend" aria-label="知识点难度说明">
          {(Object.entries(difficultyLabels) as [KnowledgeDifficulty, string][]).map(
            ([difficulty, label]) => (
              <li key={difficulty} data-difficulty={difficulty}>
                <span aria-hidden="true" />
                {label}
              </li>
            ),
          )}
        </ul>
      </div>

      <div className="learning-knowledge-explorer">
        <div className="learning-knowledge-domains" aria-label="算法领域">
          <div className="learning-knowledge-column-heading">
            <span>LEVEL 01</span>
            <strong>选择领域</strong>
          </div>
          <div className="learning-knowledge-domain-list">
            {knowledgeDomains.map((domain) => {
              const Icon = domain.icon
              const isActive = domain.id === activeDomain.id

              return (
                <button
                  type="button"
                  className="learning-knowledge-domain"
                  aria-label={domain.label}
                  aria-pressed={isActive}
                  aria-controls="learning-knowledge-branch-panel"
                  onClick={() => selectDomain(domain)}
                  key={domain.id}
                >
                  <span className="learning-knowledge-domain-index">{domain.index}</span>
                  <span className="learning-knowledge-domain-icon" aria-hidden="true">
                    <Icon size={19} />
                  </span>
                  <span className="learning-knowledge-domain-copy">
                    <strong>{domain.label}</strong>
                    <small>{domain.sections.length} 个子板块</small>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </div>

        <div
          className="learning-knowledge-branches"
          id="learning-knowledge-branch-panel"
          aria-label={`${activeDomain.label}的子板块`}
        >
          <div className="learning-knowledge-column-heading">
            <span>LEVEL 02</span>
            <strong>{activeDomain.label}</strong>
          </div>
          <p className="learning-knowledge-domain-description">{activeDomain.description}</p>
          <div className="learning-knowledge-branch-list">
            {activeDomain.sections.map((section, index) => (
              <button
                type="button"
                className="learning-knowledge-branch"
                aria-label={section.label}
                aria-pressed={section.id === activeSection.id}
                aria-controls="learning-knowledge-detail-panel"
                onClick={() => setActiveSectionId(section.id)}
                key={section.id}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{section.label}</strong>
                <small>{section.points.length} 个知识点</small>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>

        <article
          className="learning-knowledge-detail"
          id="learning-knowledge-detail-panel"
          aria-labelledby="learning-knowledge-detail-title"
          aria-live="polite"
        >
          <div className="learning-knowledge-column-heading">
            <span>LEVEL 03</span>
            <strong>学习节点</strong>
          </div>

          <div className="learning-knowledge-breadcrumb" aria-label="当前学习路径">
            <span>{activeDomain.label}</span>
            <ChevronRight size={14} aria-hidden="true" />
            <strong>{activeSection.label}</strong>
          </div>

          <header className="learning-knowledge-detail-heading">
            <p>当前子板块</p>
            <h3 id="learning-knowledge-detail-title">{activeSection.label}</h3>
            <p>{activeSection.description}</p>
          </header>

          <div className="learning-knowledge-outcome">
            <Flag size={18} aria-hidden="true" />
            <div>
              <span>完成目标</span>
              <p>{activeSection.outcome}</p>
            </div>
          </div>

          <div className="learning-knowledge-sequence">
            <div className="learning-knowledge-sequence-heading">
              <strong>建议学习顺序</strong>
              <span>{activeSection.points.length} STEPS</span>
            </div>
            <ol>
              {activeSection.points.map((point, index) => (
                <li key={point.label} data-difficulty={point.difficulty}>
                  <span className="learning-knowledge-step-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <CheckCircle2 size={17} aria-hidden="true" />
                  <strong>{point.label}</strong>
                  <span className="learning-knowledge-difficulty">
                    {difficultyLabels[point.difficulty]}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </article>
      </div>
    </div>
  )
}
