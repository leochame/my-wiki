# Code Review Agent 方案设计

> 定位：面向企业研发场景的 Code Review Agent，作为 Agent OS 平台上的首个落地应用。本文档从架构到落地做完整设计，覆盖核心模块、工作流编排、评估体系与企业级考量。

---

## 1. 问题定义与价值

### 1.1 为什么做 Code Review Agent

| 传统 CR 的痛点 | Agent 能解决什么 |
|---|---|
| 人工审查耗时，每个 PR 平均 15-30 分钟 | 7x24 自动预审，人类只做最终决策 |
| 审查质量依赖个人经验，风格不一致 | 统一规则 + 项目知识库驱动，标准一致 |
| 审查覆盖面窄，容易漏掉隐蔽问题 | 系统性扫描：安全、性能、架构、可读性多轴并行 |
| 新人不知道该审什么 | 项目沉淀的 CR Memory 指导，降低门槛 |

### 1.2 核心价值主张

**不是替代人类审查，而是把人类从"全面扫描"解放到"关键决策"。**

Agent 做第一轮：自动扫描、标注风险等级、给出修改建议。人类做第二轮：确认/修改/忽略，只关注 Agent 标记的高风险项。

### 1.3 成功指标

| 指标 | 目标 | 说明 |
|---|---|---|
| 覆盖率 | ≥ 95% 的 PR 触发自动 CR | 不漏审 |
| 准确率（高风险项） | ≥ 80% 人类确认率 | Agent 说有问题，人看了确实有问题 |
| 噪音率（低风险误报） | ≤ 15% | 不能让人类花大量时间驳回无意义建议 |
| 平均审查时间 | 从 20min → 5min | 人类只做最终确认 |
| 采纳率 | ≥ 40% 的 Agent 建议被人类采纳 | 有实际改进效果 |

---

## 2. 架构总览

### 2.1 系统架构图

```
┌──────────────────────────────────────────────────────────────┐
│                     Agent OS 平台层                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ Model    │ │ Prompt   │ │ Tool     │ │ Governance    │  │
│  │ Gateway  │ │ Manager  │ │ Registry │ │ (权限/审计)    │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                    │
│  │ Memory   │ │ RAG /    │ │ Eval     │                    │
│  │ Service  │ │ Knowledge│ │ Platform │                    │
│  └──────────┘ └──────────┘ └──────────┘                    │
└──────────────────────────────────────────────────────────────┘
                            │ 平台能力供给
                            ↓
┌──────────────────────────────────────────────────────────────┐
│                  Code Review Agent 应用层                    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                Orchestrator (编排引擎)               │    │
│  │  Plan → Analyze → Evaluate → Summarize → Report     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────────┐     │
│  │安全  │ │性能  │ │架构  │ │可读性│ │ 业务逻辑      │     │
│  │审查  │ │审查  │ │审查  │ │审查  │ │ 审查          │     │
│  │Sub   │ │Sub  │ │Sub  │ │Sub  │ │ Sub           │     │
│  │Agent │ │Agent│ │Agent│ │Agent│ │ Agent         │     │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────────────┘     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Tool Layer (工具调用)                    │   │
│  │  git_diff │ lint │ test_run │ static_analysis │ ... │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Memory & Knowledge Layer                 │   │
│  │  项目代码风格 │ 历史CR偏好 │ 常见缺陷模式 │ ...       │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
                            │
                            ↓
┌──────────────────────────────────────────────────────────────┐
│                    集成层 (企业系统对接)                      │
│  Git 平台 (GitHub/GitLab) │ IM (飞书/Slack) │ 工单系统      │
│  CI/CD Pipeline │ 文档系统 │ 代码仓库                       │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 设计原则

1. **渐进式披露** — Agent 不一次性加载整个 PR diff，而是先拿概览，再按需深入可疑区域
2. **Eval 驱动迭代** — 每次版本发布前必须通过 Eval Suite，不会出现"改了 A 却破坏了 B"
3. **平台能力复用** — 模型调用、工具注册、记忆管理全部走 Agent OS 平台，不自建
4. **人类决策保留** — Agent 只做建议和标注，所有修改需要人类确认后才合入

---

## 3. 核心模块设计

### 3.1 Orchestrator（编排引擎）

编排引擎是整个 Agent 的大脑，负责规划、调度和汇总。

#### 3.1.1 工作流设计

采用 **Plan-Execute-Summarize** 三阶段编排：

```
┌─────────────────────────────────────────────────────────┐
│ Phase 1: Plan（规划）                                    │
│                                                          │
│  输入: PR metadata (title, description, changed_files)  │
│                                                          │
│  Orchestrator 分析:                                      │
│  ├── 这个 PR 的大致意图是什么？（feat/fix/refactor）      │
│  ├── 涉及哪些模块/文件类型？                              │
│  ├── 变更规模（几行？几十行？上千行？）→ 决定审查深度     │
│  └── 是否涉及高风险区域？（安全模块、数据库操作、API）     │
│                                                          │
│  输出: 审查计划（审查顺序 + 分配给哪个 Sub Agent）        │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│ Phase 2: Execute（并行审查）                              │
│                                                          │
│  Orchestrator 根据计划调度 Sub Agent:                     │
│                                                          │
│  场景A（小 PR, <200行）:                                 │
│    单 Agent 审查，按维度串行                              │
│                                                          │
│  场景B（中等 PR, 200-1000行）:                           │
│    2-3 个 Sub Agent 并行（安全+性能 一组，架构+可读性一组）│
│                                                          │
│  场景C（大 PR, >1000行）:                                │
│    按 file group 拆分，每个 Sub Agent 审查一组文件        │
│    Orchestrator 做跨组汇总                               │
│                                                          │
│  每个 Sub Agent:                                         │
│  ├── 拿到分配的 diff chunk                               │
│  ├── 调用工具获取补充上下文（lint 结果、测试结果等）      │
│  ├── 生成审查意见 + 风险等级                              │
│  └── 按结构化 Schema 输出（见 3.4）                      │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│ Phase 3: Summarize & Report（汇总与报告）                 │
│                                                          │
│  Orchestrator 汇总所有 Sub Agent 的审查意见:              │
│  ├── 去重（多个 Sub Agent 对同一段代码的相似意见合并）    │
│  ├── 优先级排序（高风险优先）                             │
│  ├── 生成人类可读的 CR 报告                               │
│  └── 写入项目 Memory（本次审查发现的模式，供下次参考）    │
│                                                          │
│  输出: 结构化 CR Report → 推送到 Git 平台 / IM           │
└─────────────────────────────────────────────────────────┘
```

#### 3.1.2 为什么不全部并行

小 PR 全并行反而浪费——token 开销大，上下文重复，去重成本高。编排引擎的核心价值是**根据变更规模动态选择审查策略**，而不是盲目并行。

### 3.2 Sub Agent 设计

每个 Sub Agent 是一个**带专业 Prompt + 专业工具集**的窄域审查器。

| Sub Agent | Prompt 核心 | 核心工具 | 输出侧重 |
|---|---|---|---|
| **安全审查** | OWASP Top 10 检查清单，关注注入、认证、数据泄露 | `grep_secret`, `check_dependency_vuln` | 安全漏洞、敏感信息泄露 |
| **性能审查** | 关注循环复杂度、N+1 查询、内存泄漏、不必要的同步 | `run_profiler_hint`, `check_db_query_pattern` | 性能瓶颈、资源浪费 |
| **架构审查** | 关注模块耦合、接口契约、异常处理链、设计模式滥用 | `read_interface_doc`, `check_dependency_graph` | 架构债务、耦合风险 |
| **可读性审查** | 关注命名、注释必要性、函数长度、魔法数字 | `count_complexity`, `check_style_guide` | 可读性问题、风格不一致 |
| **业务逻辑审查** | 关注边界条件、状态转换、数据一致性、幂等性 | `read_test_coverage`, `trace_api_flow` | 逻辑缺陷、遗漏边界 |

### 3.3 Tool Layer

#### 3.3.1 工具分类

```
Code Review Agent 工具集
├── 信息获取类（只读）
│   ├── git_diff          — 获取 PR 的完整 diff
│   ├── git_file_content  — 获取某个文件的完整内容（按需深入）
│   ├── git_pr_metadata   — PR 标题、描述、关联 issue
│   ├── git_blame         — 某行代码的修改历史和作者
│   ├── lint_result       — 静态检查结果（eslint, pylint, checkstyle 等）
│   ├── test_result       — 测试运行结果
│   ├── read_interface    — 读取接口文档/API 定义
│   ├── grep_code         — 在代码库中搜索特定模式
│   └── read_style_guide  — 读取项目代码风格规范
│
├── 分析类（计算）
│   ├── count_complexity    — 计算圈复杂度
│   ├── check_db_pattern    — 检测常见数据库反模式（N+1、缺失索引）
│   ├── check_secret        — 检测硬编码密钥/凭证
│   ├── check_dependency    — 检查依赖漏洞
│   └── trace_api_flow      — 追踪 API 调用链路
│
├── 交互类（写操作，需权限）
│   ├── post_comment      — 在 PR 上发布审查评论
│   ├── request_change    — 标记"请求修改"
│   └── approve_pr        — 标记"通过审查"
│
└── Memory 操作类
│   ├── save_review_pattern   — 沉淀审查发现到项目 Memory
│   ├── load_project_context  — 加载项目历史审查偏好
│   └── search_similar_issue  — 搜索类似的历史审查案例
```

#### 3.3.2 工具调用策略（渐进式披露）

不一次性把所有 diff 喂给 Agent，而是分层加载：

```
Round 1: 获取 PR 概览
  git_pr_metadata → 知道 PR intent
  git_diff --stat → 知道哪些文件改了、改了多少行

Round 2: 按需深入可疑文件
  根据 Round 1 判断，只 git_diff 对可疑文件
  对高风险文件 git_file_content 获取完整上下文

Round 3: 补充验证
  对标记区域调用 lint_result / test_result 交叉验证
  对安全疑点调用 check_secret / check_dependency
```

这样做的核心原因：**一个 2000 行的 PR，全量 diff 可能占 8000+ token，但真正需要深入审查的往往只有 200-300 行**。渐进式披露把 token 成本从 O(N) 降到 O(可疑区域)。

### 3.4 输出 Schema（结构化审查意见）

每个 Sub Agent 的输出必须遵循统一 Schema，让 Orchestrator 能做去重和排序：

```json
{
  "review_id": "uuid",
  "sub_agent": "security",
  "file_path": "src/auth/login.py",
  "line_range": [45, 52],
  "severity": "high",           // high / medium / low / info
  "category": "injection",      // 该 Sub Agent 的分类标签
  "title": "SQL 注入风险",
  "description": "第 48 行的 user_input 直接拼入 SQL 字串，未做参数化",
  "suggestion": "改用参数化查询: cursor.execute('SELECT ... WHERE id=?', (user_id,))",
  "confidence": 0.85,           // Agent 对此判断的置信度
  "evidence": {                 // 支持判断的证据
    "diff_snippet": "...",
    "lint_flag": null,
    "related_history": "项目在 2025-03 有过类似漏洞修复 #1234"
  }
}
```

### 3.5 Memory & Knowledge Layer

#### 3.5.1 三层记忆架构

```
┌─────────────────────────────────────────────┐
│ Layer 1: 项目级 Memory（长期，跨 PR）        │
│                                              │
│  存储内容:                                   │
│  ├── 项目代码风格偏好（命名、注释、异常处理） │
│  ├── 项目架构约定（模块边界、依赖方向）       │
│  ├── 常见缺陷模式（这个项目常犯的错误）       │
│  ├── 历史高风险区域标记                       │
│  └── 项目特定审查规则（如：金融模块必须审幂等性）│
│                                              │
│  来源: 人类确认的审查意见 → 沉淀              │
│  更新: 每次 CR 结束后自动提取模式并更新       │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Layer 2: PR 级 Memory（短期，当前 PR 内）    │
│                                              │
│  存储内容:                                   │
│  ├── 当前 PR 的审查计划                       │
│  ├── 各 Sub Agent 的中间结论                  │
│  ├── 已检查过的文件列表（避免重复审查）       │
│  └── 人类反馈（忽略/采纳/修改）               │
│                                              │
│  生命周期: PR 合入后清理                      │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Layer 3: 组织级 Knowledge（全局知识库）       │
│                                              │
│  存储内容:                                   │
│  ├── 通用安全检查清单（OWASP）                │
│  ├── 通用性能反模式库                         │
│  ├── 通用可读性标准                           │
│  └── 行业/团队特定的编码规范                  │
│                                              │
│  来源: RAG 检索，按项目/语言/模块匹配         │
│  更新: 人工维护 + 从跨项目审查模式中提取      │
└─────────────────────────────────────────────┘
```

#### 3.5.2 Memory 的写入与读取

**写入链路（每次 CR 结束后）：**

```
CR 完成 → 人类确认审查意见
  → 提取确认项的模式（如："这个项目总是忘记做 null check"）
  → 去重：与已有 Memory 比对，不重复写入
  → 写入项目级 Memory
```

**读取链路（每次 CR 开始前）：**

```
新 PR 触发 CR
  → load_project_context: 加载项目级 Memory（代码风格、常见缺陷）
  → search_similar_issue: 检索历史类似审查案例（RAG）
  → 注入 Orchestrator 和各 Sub Agent 的 prompt 中
  → 作为审查时的"偏好"和"重点关注"信号
```

#### 3.5.3 Memory 沉淀示例

```json
{
  "project_id": "payment-service",
  "patterns": [
    {
      "type": "common_defect",
      "description": "金额计算未使用 BigDecimal，直接用 float/double",
      "severity": "high",
      "frequency": 4,
      "last_seen": "2026-04-12",
      "related_files": ["src/compute/*.java"]
    },
    {
      "type": "style_preference",
      "description": "项目偏好：异常用自定义 BizException，不用 RuntimeException",
      "severity": "info",
      "source": "人类在 CR #456 中确认的偏好"
    }
  ]
}
```

### 3.6 Prompt 体系

#### 3.6.1 Prompt 管理结构

```
Prompt 模板层级
├── system/                          — 系统级 Prompt
│   ├── orchestrator_system.md       — 编排引擎全局指令
│   └── sub_agent_base.md            — Sub Agent 共有基础指令
│
├── role/                            — 角色 Prompt（各 Sub Agent 专用）
│   ├── security_reviewer.md         — 安全审查 Agent
│   ├── performance_reviewer.md      — 性能审查 Agent
│   ├── architecture_reviewer.md     — 架构审查 Agent
│   ├── readability_reviewer.md      — 可读性审查 Agent
│   ├── business_logic_reviewer.md   — 业务逻辑审查 Agent
│
├── guardrails/                      — 护栏 Prompt
│   ├── no_auto_change.md            — 禁止自动修改代码
│   ├── scope_limit.md               — 只审查变更部分，不越界
│   ├── confidence_threshold.md      — 低置信度意见降级为 info
│   ├── human_decision_final.md      — 人类决策优先
│
└── dynamic/                         — 动态注入（由平台运行时拼接）
    ├── project_memory_injection     — 项目级 Memory 注入段
    ├── pr_context_injection         — 当前 PR 概览注入段
    └── style_guide_injection        — 项目风格规范注入段
```

#### 3.6.2 Orchestrator System Prompt 核心片段

```markdown
# Code Review Orchestrator

你是一个企业级代码审查编排引擎。你的职责是规划、调度和汇总代码审查。

## 工作原则
1. 先理解 PR intent，再决定审查策略
2. 小 PR 串行审查，大 PR 拆分并行
3. 所有审查意见必须标注风险等级和置信度
4. 低置信度判断降级为 info，不标记为问题
5. 每次审查后更新项目 Memory

## 规划步骤
1. 读取 PR metadata → 判断 PR 类型（feat/fix/refactor/docs）
2. 读取 diff stat → 判断变更规模和涉及模块
3. 查询项目 Memory → 知道本项目重点关注什么
4. 生成审查计划 → 分配 Sub Agent 和审查顺序

## 护栏
- 禁止自动修改任何代码
- 禁止跳过人类确认步骤
- 对安全模块、数据库操作、金融计算自动升级为高风险
```

#### 3.6.3 安全审查 Sub Agent Prompt 核心片段

```markdown
# Security Review Sub Agent

你是代码安全审查专家，专注于识别安全漏洞。

## 检查清单（按优先级）
1. SQL/NoSQL 注入 — 参数化查询检查
2. 认证与授权 — 权限绕过、硬编码凭证
3. 数据泄露 — 敏感数据未加密、日志泄露
4. XSS / CSRF — 输出编码、token 校验
5. 文件操作 — 路径穿越、不安全的文件上传
6. 依赖安全 — 已知漏洞的第三方依赖

## 输出要求
- 每个发现必须给出：文件路径、行范围、风险等级、修复建议
- confidence < 0.6 的发现标注为 info，不标记为问题
- 没有发现时，明确输出 "no security issues found"
```

---

## 4. 工作流详解

### 4.1 端到端流程

```
PR 创建/更新
    │
    ↓
[触发器] Git 平台 webhook → Agent OS 调度
    │
    ↓
[Phase 1: Plan]
    ├── git_pr_metadata → PR intent
    ├── git_diff --stat → 变更规模
    ├── load_project_memory → 项目审查偏好
    └── 生成审查计划（哪些 Sub Agent、审查顺序）
    │
    ↓
[Phase 2: Execute]
    │
    ├── 小 PR: 单 Agent 串行审查
    │   ├── 读 diff → 分维度审查 → 结构化输出
    │   └── 补充工具调用（lint, test）
    │
    ├── 大 PR: 多 Sub Agent 并行
    │   ├── Orchestrator 按 file group 分配
    │   ├── 各 Sub Agent 独立审查各自区域
    │   └── 各自输出结构化审查意见
    │
    ↓
[Phase 3: Summarize]
    ├── 汇总所有审查意见
    ├── 去重：相似意见合并（同一代码段不同维度的看法保留，相同维度的重复合并）
    ├── 排序：severity + confidence 综合排序
    ├── 生成人类可读报告
    │
    ↓
[输出]
    ├── post_comment → 在 PR 上发布审查评论
    ├── 标记 risk level（自动 request_change for high severity）
    ├── 推送到 IM（飞书/Slack）通知相关人员
    │
    ↓
[人类确认]
    ├── 采纳 → 合入建议
    ├── 修改 → 人类调整建议后采纳
    ├── 忽略 → 标记忽略原因
    │
    ↓
[Memory 沉淀]
    ├── 提取被采纳/修改的模式 → 更新项目级 Memory
    ├── 记录忽略的模式 → 降低后续同类建议的 confidence
    └── 审查结果写入 Eval 数据集
```

### 4.2 大 PR 的拆分策略

```python
# 拆分逻辑伪代码
def plan_review(pr_metadata, diff_stat, project_memory):
    total_lines = sum(stat.changed_lines for stat in diff_stat)

    if total_lines < 200:
        # 小 PR: 单 Agent 串行
        return Plan(mode="sequential", sub_agents=["general_reviewer"])

    elif total_lines < 1000:
        # 中等 PR: 按维度并行
        dimensions = determine_dimensions(diff_stat, project_memory)
        return Plan(mode="parallel_by_dimension", sub_agents=dimensions)

    else:
        # 大 PR: 按 file group + 维度拆分
        file_groups = group_by_module(diff_stat.file_paths)
        # 每个 file_group 分配一个审查组
        # 每个审查组内部按维度并行
        return Plan(mode="parallel_by_group", groups=file_groups)
```

### 4.3 上下文管理策略

参考 Harness Engineering 和动态上下文系统中的设计原则：

| 原则 | 在 CR Agent 中的实现 |
|---|---|
| 渐进式披露 | 先 diff stat → 再可疑文件 diff → 再完整文件内容 |
| 信息卸载 | 大 diff 不塞进上下文，存文件、按需 grep |
| 结构化记忆 | 项目偏好用结构化 Memory 而非自然语言摘要 |
| 子任务隔离 | 每个 Sub Agent 有独立上下文窗口，不污染主 Orchestrator |
| 自我验证 | Agent 对低置信度判断自动降级，不做虚假高置信标注 |

---

## 5. Eval 体系

### 5.1 Eval 驱动的迭代飞轮

这是从你的 Harness Engineering 文章中提炼的核心方法论，直接应用于 CR Agent：

```
生产 CR traces → 人工标注正确/误报/遗漏
    → Eval Suite 运行 → 发现问题
    → 修改 Prompt / Harness / Memory 策略
    → 新版本回归测试 → 部署
    → 继续收集 traces → 循环
```

### 5.2 Eval 分类

| 类别 | 说明 | 数据来源 |
|---|---|---|
| **准确率 Eval** | Agent 报的问题，人类是否确认？ | 人类对 CR 意见的采纳/忽略记录 |
| **覆盖率 Eval** | 真实存在的问题，Agent 是否发现？ | 安全团队人工审计结果作为 ground truth |
| **噪音率 Eval** | Agent 报了多少误报？ | 人类忽略的审查意见统计 |
| **轨迹 Eval** | Agent 的推理路径是否合理？ | LangSmith traces 人工审查 |
| **成本 Eval** | 单次 CR 的 token 消耗是否在预算内？ | 调用监控数据 |

### 5.3 典型 Eval 用例

```json
// Eval Case: 安全漏洞检测
{
  "eval_id": "SEC-001",
  "category": "security",
  "input": {
    "pr_diff": "diff showing raw SQL concatenation in login handler",
    "project_language": "java"
  },
  "expected_output": {
    "must_find": [{
      "severity": "high",
      "category": "injection",
      "file_path": "src/auth/LoginHandler.java"
    }],
    "must_not_find": [{
      "severity": "high",
      "category": "performance"  // 不应把安全问题误标为性能问题
    }]
  }
}

// Eval Case: 可读性建议的噪音控制
{
  "eval_id": "READ-003",
  "category": "readability",
  "input": {
    "pr_diff": "diff showing a well-named, well-structured new function",
    "project_language": "python"
  },
  "expected_output": {
    "must_find": [],  // 没有问题就不应该报问题
    "must_not_find": [{
      "severity": "medium",  // 不应对良好代码报 medium 级别的可读性问题
      "category": "readability"
    }]
  }
}
```

### 5.4 Eval 动态管理

| 生命周期 | 说明 |
|---|---|
| **新增** | 从生产 traces 中提取失败案例，或安全团队提供的新漏洞模式 |
| **活跃** | 每次 Harness 变更后验证 |
| **饱和** | Agent 稳定通过 → 转为回归测试 |
| **清理** | 模型能力提升后不再需要的旧 eval 移除 |

### 5.5 防过拟合策略

- **Holdout Set** — 20% 的 eval 不参与优化，只用于验证泛化能力
- **跨项目验证** — 在项目 A 优化的策略，在项目 B 的 eval 上也要通过
- **人工复查** — 每次版本发布前，人类抽检 Agent 的 CR 报告，确认没有"为了过 eval 而过度报问题"的倾向

---

## 6. 企业级考量

### 6.1 权限控制

```
权限矩阵
┌────────────────────────┬──────────┬──────────┬──────────┐
│ 操作                   │ Agent    │ 开发者   │ 审查者   │
├────────────────────────┼──────────┼──────────┼──────────┤
│ 读取 PR diff           │ ✅       │ ✅       │ ✅       │
│ 读取代码文件内容       │ ✅       │ ✅       │ ✅       │
│ 读取项目 Memory        │ ✅       │ ❌       │ ✅(只读) │
│ 发布审查评论           │ ✅       │ ✅       │ ✅       │
│ 标记 request_change    │ ✅(高风险)│ ❌       │ ✅       │
│ Approve PR            │ ❌       │ ❌       │ ✅       │
│ 修改代码               │ ❌       │ ✅       │ ✅       │
│ 写入项目 Memory        │ ✅(自动) │ ❌       │ ✅(手动) │
│ 修改项目审查规则       │ ❌       │ ❌       │ ✅       │
└────────────────────────┴──────────┴──────────┴──────────┘
```

关键原则：
- **Agent 不能自动修改代码** — 所有修改必须人类确认
- **Agent 不能自动 Approve** — 最终决策权在人类
- **高风险项 Agent 可以自动 request_change** — 但人类可以 override

### 6.2 安全审计

- 所有 Agent 调用记录写入审计日志（谁触发、审查了什么、给出了什么建议）
- 审查意见中如果涉及敏感代码路径，自动脱敏处理（不暴露内部实现细节到 IM 通知）
- Agent 读取代码的范围受项目权限约束（不能跨项目读取）

### 6.3 成本治理

```
成本控制策略
├── Token 预算
│   ├── 小 PR: max 2000 token input + 1000 token output
│   ├── 中等 PR: max 8000 token input + 3000 token output
│   ├── 大 PR: max 20000 token input (含并行调度)
│   └── 超预算时: 降级为概览审查，不深入
│
├── 模型选择
│   ├── 规划阶段: 用高能力模型（Claude Opus / GPT-4o）
│   ├── 执行阶段: 按维度选模型（安全审查用强模型，可读性审查用快模型）
│   └── 汇总阶段: 用中等模型（性价比最优）
│
└── 调用限流
    ├── 单项目 max 50次 CR/天
    ├── 单文件 max 3次深入读取
    └── 避免同一个 PR 被反复触发（幂等检查）
```

### 6.4 可观测性

```
监控指标
├── 业务指标
│   ├── CR 触发率（% PR 被审查）
│   ├── 平均审查耗时
│   ├── 人类采纳率 / 忽略率
│   ├── 高风险项发现数
│   └── 噪音率
│
├── 技术指标
│   ├── 单次 CR token 消耗
│   ├── 单次 CR 工具调用次数
│   ├── Sub Agent 并行度
│   ├── 规划→执行→汇总各阶段耗时
│   └── 模型调用成功率 / 降级率
│
└── Trace 数据
    ├── 完整推理轨迹（Orchestrator 规划、Sub Agent 审查过程）
    ├── 工具调用链（调用顺序、参数、返回）
    ├── Memory 读写记录
    └── 人类反馈闭环记录
```

---

## 7. 与 Agent OS 平台的集成

### 7.1 CR Agent 如何使用平台能力

```
CR Agent 不自建的基础设施，全部走 Agent OS 平台:

┌──────────────────┐     ┌──────────────────────────────┐
│                  │     │         Agent OS 平台          │
│  Code Review     │     │                              │
│  Agent            │────→│  Model Gateway               │
│                  │     │  ├── 多模型路由                │
│                  │     │  ├── Fallback / 降级           │
│                  │     │  ├── Token 计量               │
│                  │     │                              │
│                  │────→│  Tool Registry                │
│                  │     │  ├── 工具注册与发现            │
│                  │     │  ├── 权限检查                  │
│                  │     │  ├── 沙箱执行                  │
│                  │     │                              │
│                  │────→│  Memory Service               │
│                  │     │  ├── 结构化 Memory 存储        │
│                  │     │  ├── 按项目/维度检索           │
│                  │     │  ├── 版本管理                  │
│                  │     │                              │
│                  │────→│  Knowledge / RAG              │
│                  │     │  ├── 企业知识库索引            │
│                  │     │  ├── 混合检索                  │
│                  │     │  ├── 权限过滤                  │
│                  │     │                              │
│                  │────→│  Prompt Manager               │
│                  │     │  ├── 模板版本化                │
│                  │     │  ├── A/B 测试                  │
│                  │     │  ├── 动态注入                  │
│                  │     │                              │
│                  │────→│  Eval Platform                │
│                  │     │  ├── Eval 套件管理            │
│                  │     │  ├── 自动回归检测             │
│                  │     │  ├── 版本对比                 │
│                  │     │                              │
│                  │────→│  Governance                  │
│                  │     │  ├── 权限矩阵                 │
│                  │     │  ├── 审计日志                 │
│                  │     │  ├── 成本分摊                 │
│                  │     │  ├── 调用限流                 │
└──────────────────┘     └──────────────────────────────┘
```

### 7.2 CR Agent 向平台贡献什么

CR Agent 不只是平台能力的消费者，也是贡献者：

1. **工具贡献** — CR 场景的专用工具（`check_secret`, `check_db_pattern`）注册到平台 Tool Registry，其他 Agent 可复用
2. **Prompt 模板贡献** — 审查类 Sub Agent 的 Prompt 模板沉淀到平台，其他审查场景可继承
3. **Memory 模式贡献** — CR 的 Memory Schema（项目级代码风格偏好、常见缺陷模式）成为平台 Memory Service 的标准类型之一
4. **Eval 数据贡献** — CR traces 和人类反馈成为平台 Eval 数据集的重要来源

---

## 8. 落地路线

### 8.1 Phase 分期

| Phase | 目标 | 周期 | 核心交付 |
|---|---|---|---|
| **P0: 单维度 MVP** | 验证核心价值 | 2-3 周 | 单 Agent（安全+可读性）串行审查，手动触发，结果输出到 PR comment |
| **P1: 多维度编排** | 覆盖全维度 | 4-6 周 | Orchestrator + 5 Sub Agent，按 PR 规模自动选择策略，webhook 自动触发 |
| **P2: Memory + Eval** | 持续优化 | 4-6 周 | 项目级 Memory 沉淀，Eval Suite 建立，Eval 驭动的 Harness 迭代飞轮跑起来 |
| **P3: 平台化** | 可复用 | 4-6 周 | CR Agent 的工具、Prompt、Memory Schema 注册到 Agent OS 平台，支持多项目复用 |
| **P4: 扩展** | 更多场景 | 持续 | 支持更多语言、对接更多 Git 平台、支持增量审查（只审新增变更） |

### 8.2 P0 MVP 的最小实现

```
P0 架构（最简版）

触发: 人工调用 API / CLI
模型: 单一模型（Claude Sonnet / GPT-4o-mini）
编排: 无 Orchestrator，单 Agent 串行审查
维度: 安全 + 可读性（两个最直观的维度）
工具: git_diff + lint_result
Memory: 无（P0 不做）
输出: PR comment + IM 通知
评估: 人工看效果，收集反馈

核心代码量估计: ~2000 行
```

### 8.3 P0 → P1 的关键跃迁

从 MVP 到完整版需要解决的核心问题：

1. **编排引擎** — 从单 Agent → Orchestrator + Sub Agent，需要设计通信协议（mailbox / structured output）
2. **并行调度** — 需要考虑 token 成本和去重逻辑
3. **上下文隔离** — 每个 Sub Agent 需要独立上下文窗口（参考 Agent Team 的设计）
4. **工具权限** — Sub Agent 只能调用分配给它的工具集

---

## 9. 面试如何讲这个方案

### 9.1 讲述框架

**1 分钟版本（快速介绍）：**

> Code Review Agent 是一个企业级代码审查 Agent，核心设计是 Orchestrator + Sub Agent 的多维度审查架构。Orchestrator 根据 PR 规模动态选择审查策略，小 PR 串行、大 PR 拆分并行，避免盲目并行的 token 浪费。每个 Sub Agent 专注一个审查维度（安全、性能、架构、可读性、业务逻辑），输出结构化审查意见，由 Orchestrator 去重排序后生成报告。整个系统跑在 Agent OS 平台上，复用平台的模型调用、工具注册、记忆管理和评估能力，不自建基础设施。评估采用 Eval 驭动的飞轮迭代——收集生产 traces、构建 eval suite、驱动 Harness 持续优化。

**5 分钟版本（详细展开）：**

按以下顺序展开，每个模块 1 分钟：

1. **为什么做** — 传统 CR 痛点 → Agent 价值（人类从全面扫描解放到关键决策）
2. **架构** — Orchestrator + Sub Agent + Tool + Memory 四层，画架构图
3. **编排策略** — Plan-Execute-Summarize，根据 PR 规模动态选择串行/并行
4. **Memory 设计** — 三层记忆（项目级/PR级/组织级），人类确认 → 沉淀 → 下次注入
5. **Eval 驱动迭代** — 飞轮闭环，防止过拟合，holdout set

**10 分钟版本（深度设计讨论）：**

如果面试官追问具体模块，重点展开以下三个方向（都是你 wiki 里有积累的）：

- **上下文管理** — 渐进式披露策略，从 diff stat 到可疑文件再到完整内容，token 成本从 O(N) 到 O(可疑区域)
- **Multi-Agent 协作** — 参考 Claude Code 的 Agent Team 设计（共享 task list + mailbox），讲清楚 Sub Agent 的通信协议和冲突解决
- **Harness Engineering** — Eval 驭动的迭代飞轮，Better-Harness 方法论，防止过拟合的 holdout 策略

### 9.2 预判追问

| 可能的追问 | 回答要点 |
|---|---|
| "为什么不用单个强模型直接审？" | 单模型全量审查 → token 成本高、维度混在一起容易遗漏；拆维度后各 Sub Agent 专注，准确率更高，且可以按维度选模型（安全用强模型，可读性用快模型） |
| "Memory 怎么防止误沉淀？" | 只沉淀人类确认的模式；忽略的审查意见记录为"降低 confidence"信号而非正面知识；定期清理过时模式 |
| "大 PR 怎么拆？" | 按 module/目录分组，每组独立审查；Orchestrator 跨组汇总做去重；对跨组影响（如接口变更）单独标记 |
| "和现有工具（SonarQube、CodeGuru）的区别？" | 它们是静态分析工具，CR Agent 是语义审查——理解代码意图、判断架构合理性、结合项目上下文做判断，是互补而非替代 |
| "如何保证不误报太多？" | 低置信度自动降级为 info；噪音率 eval 专项监控；项目 Memory 记录"这个项目忽略什么"的偏好 |
| "Agent OS 平台的价值在哪？" | 不用每个 Agent 应用都自建模型调用、工具注册、Memory 管理、权限审计；CR Agent 的工具和 Prompt 模板可以注册到平台，其他 Agent 复用 |

---

## 参考

- [Harness Engineering: AI Agent 的"操作系统"](/writing/technical/ai/engineering-practice/harness-engineering) — Agent 四组件框架、Eval 驭动迭代飞轮、Better-Harness 方法论
- [Agent Team](/writing/technical/ai/engineering-practice/agent-team) — Multi-Agent 协作机制（共享 task list + mailbox + 并发冲突解决）
- [Agent Memory](/writing/technical/ai/engineering-practice/agent-memory) — Memory 架构设计（短期/长期/结构化）
- [动态上下文系统 Roadmap](/writing/technical/ai/engineering-practice/dynamic-context-systems-roadmap) — 渐进式披露、信息卸载、结构化记忆
- [Anthropic: Trustworthy Agents](https://www.anthropic.com/research/trustworthy-agents) — 多层防御、护栏设计
- [Anthropic: Automated Alignment Researchers](https://www.anthropic.com/research/automated-alignment-researchers) — Harness 设计影响 Agent 表现
- [LangChain: Anatomy of an Agent Harness](https://www.langchain.com/blog/the-anatomy-of-an-agent-harness) — 文件系统作为上下文、Ralph Loops
- [LangChain: Better Harness](https://www.langchain.com/blog/better-harness-a-recipe-for-harness-hill-climbing-with-evals) — Eval 驭动的迭代方法论
- [OpenAI: Building Effective Agents](https://openai.com/blog) — Agentic Patterns、ACI 设计
- [Google: Gemini Enterprise Agent Platform](https://cloud.google.com/blog/products/ai-machine-learning/the-new-gemini-enterprise) — 控制平面架构