---
title: Harness Engineering: AI Agent 的"操作系统"
tags:
  - AI Agent
  - Harness Engineering
  - Engineering Practice
created: 2026-04-29
description: 深入理解 AI Agent 开发中的 Harness Engineering 概念，以及 Anthropic 和 OpenAI 的相关实践。
---

# Harness Engineering: AI Agent 的"操作系统"

## 什么是 Harness？

在 AI Agent 开发中，"Harness" 是一个核心但容易被忽视的概念。

Anthropic 在 [^1] 中明确定义：

> **Harness** = "the instructions, and the guardrails, that the model operates under"

换句话说，Harness 是模型运行时的**指令系统**和**护栏机制**。

### 四组件框架

Anthropic 提出的 Agent 四组件框架：

```
┌─────────────────────────────────────────┐
│           Agent System                  │
├─────────────────────────────────────────┤
│  ┌─────────┐                           │
│  │  Model  │ ← 底层推理能力             │
│  └─────────┘                           │
│  ┌─────────┐                           │
│  │ Harness │ ← 指令 + 护栏 ← 我们关注   │
│  └─────────┘                           │
│  ┌─────────┐                           │
│  │  Tools  │ ← 外部能力扩展             │
│  └─────────┘                           │
│  ┌─────────┐                           │
│  │   Env   │ ← 运行环境                │
│  └─────────┘                           │
└─────────────────────────────────────────┘
```

**Harness 的职责**：
- 告诉 Agent "什么情况下要上报"
- 定义"提交前需要用户确认"的阈值
- 设置行为边界和决策规则

---

## 为什么 Harness Engineering 是独立的专业方向？

### 1. 模型能力 vs 系统能力

| 维度 | 模型 | Harness |
|------|------|---------|
| 决定因素 | 训练数据、参数规模 | 指令设计、护栏配置 |
| 迭代速度 | 慢（需要重新训练） | 快（配置修改） |
| 成本 | 高 | 低 |
| 对最终效果影响 | 基础 | 关键 |

### 2. 实践中的发现

Anthropic 在 [^2] 中的实验非常有说服力：

> **9 个并行的 Claude Opus 4.6 实例**，每个配备：
> - 沙盒工作区
> - 共享讨论区
> - 代码存储系统
> - 远程评估服务器

关键发现：**Harness 设计（varied prompts）直接影响了 Agent 的表现**。

> "Each AAR receives background knowledge... and a slightly different (but ambiguous) starting point to prevent converging on identical ideas"

### 3. Orchestration 的艺术

同一篇论文还发现：

- **过度结构化反而有害**：指定"先提出想法 → 再生成计划 → 再写代码..."的顺序时，进度反而变慢
- **允许低成本实验**：让 Claude 设计"便宜的实验来验证想法，然后再投入高强度测试"更有效

这说明 Harness 不是"告诉 Agent 怎么做"，而是**设计 Agent 的决策空间**。

---

## 多 Agent 场景下的 Harness

### 层级放大问题

当多个 Agent 协作时，Harness 的质量会被放大：

```
Supervisor (Harness A)
    ↓
Researcher 1 (Harness B) → 上一层理解偏了
Researcher 2 (Harness B) → 下一层不是纠正，而是顺着偏
    ↓
结论看起来完整，但根子是模型自己编的
```

### 对应策略

| 问题 | Harness 策略 |
|------|-------------|
| 幻觉沿链路放大 | 强制每条结论标记来源 |
| 信息失真 | 结构化压缩保留原始引用 |
| 推理脱轨 | 每个节点加 `think_tool` 自我校验 |
| 系统失控 | 护栏：并发数限制、循环次数限制、null 检查 |

---

## Anthropic 的相关研究

### 1. Trustworthy agents in practice [^1]

核心观点：

- **没有单一防线足以保证安全**，需要多层防御
- 防御层次：模型训练识别注入模式 → 生产流量监控 → 外部红队测试
- 提倡生态级"共享基础设施"：NIST 基准、公司间证据共享、开放标准

### 2. Automated Alignment Researchers [^2]

核心观点：

- **Harness 设计**（prompt 变化）防止 Agent 收敛到相同思路
- **评估成为瓶颈**：The core bottleneck could become evaluation rather than generation
- 结论：Agent 可以通过"大量低成本实验"弥补缺乏直观"研究品味"

### 3. Long-running Claude for scientific computing [^3]

核心观点：

- 长时间运行的 Agent 需要专门的**基础设施**
- 关键能力：checkpoint、状态管理、超时处理

### 4. Model Context Protocol (MCP)

Anthropic 开发的**开放协议**[^4]，用于标准化 AI Agent 连接外部数据源和工具的方式。

- 已捐给 Linux Foundation 的 Agentic AI Foundation
- 预建服务器：Google Drive, Slack, GitHub, Git, Postgres, Puppeteer
- 早期采用者：Block, Apollo, Zed, Replit, Codeium, Sourcegraph

---

## OpenAI 的相关实践

> ⚠️ 注：OpenAI 官网目前无法直接访问，以下信息基于公开资料整理。

### Building Effective Agents

OpenAI 的官方指南（具体发布日期需手动访问 openai.com/blog），核心原则：

1. **保持设计简洁** (Simplicity)
2. **保持透明** (Transparency)：明确展示 Agent 的规划步骤
3. **精心设计 Agent-Computer Interface (ACI)**：工具文档和测试同等重要

### Agentic Patterns

OpenAI 提到的常见模式：

| Pattern | 说明 |
|---------|------|
| Prompt Chaining | 任务分解为顺序步骤 |
| Routing | 输入分类后导向专门处理 |
| Parallelization | 并行运行独立子任务 |
| Orchestrator-Workers | 中央 LLM 动态分解和委派任务 |
| Evaluator-Optimizer | 迭代优化与反馈循环 |

### Tool Design Best Practices

> "Give the model enough tokens to 'think' before writing itself into a corner"

- 格式接近自然文本
- 最小化格式化开销
- 工具定义像写给初级开发者的文档
- Poka-yoke：让错误更难发生
- 大量测试

---

## Harness vs Infrastructure

很多人把"基础设施"和"Harness"混为一谈，但实际上：

```
┌─────────────────────────────────────────────┐
│         System Architecture                 │
├─────────────────────────────────────────────┤
│  Infrastructure: 基础设施                   │
│  ├── 计算资源、存储、网络                    │
│  ├── 部署、监控、容错                       │
│  └── 偏向"物理层"                           │
├─────────────────────────────────────────────┤
│  Harness: 控制系统                           │
│  ├── 指令系统、护栏、决策规则               │
│  ├── 偏向"逻辑层"                           │
│  └── 决定 Agent "怎么做"                    │
└─────────────────────────────────────────────┘
```

**类比**：Infrastructure 像汽车硬件，Harness 像方向盘和油门刹车的控制系统。

---

## LangChain 的 Harness 组件模型

LangChain 在 [^5] 中给出了更详细的组件拆解：

### 核心组件

| 组件 | 说明 |
|------|------|
| **System Prompts** | 定义 Agent 身份、行为规则、边界 |
| **Tools / MCPs** | 外部能力扩展接口 |
| **Bundled Infrastructure** | 文件系统、沙箱、浏览器等运行环境 |
| **Orchestration Logic** | 子 Agent 生成、任务交接逻辑 |
| **Hooks / Middleware** | 中间件：日志、监控、干预点 |

### 关键能力

- **文件系统**：持久化存储，支持长期任务
- **代码执行**：Bash/Python 沙箱，自主问题解决
- **记忆搜索**：RAG 风格的记忆检索
- **上下文管理**：Context window 的动态调整
- **长时执行**：Ralph Loops 等机制支持跨越多个会话的任务

#### Ralph Loops：攻克长程自主任务

当 Agent 处理复杂的长程任务时，上下文窗口会逐渐累积中间状态、错误尝试、历史对话等内容。Ralph Loops 是 LangChain 提出的**长程自主执行控制机制**，确保 Agent 能够持续工作直到任务完成。

##### 核心机制

```
检测退出尝试 → 拦截 → 清理上下文 → 重新注入目标 + 环境状态 → 强制继续
```

| 阶段 | 说明 |
|------|------|
| **Hook 拦截** | 通过钩子函数监听模型的退出/停止行为 |
| **状态评估** | 判断任务目标是否真正达成 |
| **上下文净化** | 清理已过载的中间状态，保留关键信息 |
| **重新注入** | 将原始任务目标 + 当前环境最新状态注入新上下文 |
| **强制继续** | 模型在净化后的环境中继续执行 |

##### 为什么需要 Ralph Loops

| 问题 | Ralph Loops 的解决 |
|------|-------------------|
| 上下文膨胀导致推理质量下降 | 定期清理，保持推理效率 |
| 长任务中途 Agent "放弃" | 强制继续，不给 Agent 提前退出的机会 |
| 错误累积导致后续决策质量下降 | 从干净状态重新评估 |
| 跨越多会话的工作无法连贯 | 保留目标 + 最新状态，跨会话接续 |

##### 与 Self-verification 的结合

Ralph Loops 与 **Self-verification（自我验证）** 共同构成完整的反馈回路：

```
Ralph Loop（控制何时继续）
    │
    ├── 检测：任务未完成 → 清理上下文 → 重新注入
    │
    └── 检测：任务失败 → 调用 Self-verification → 修正 → 重试

Self-verification（控制如何修正）
    │
    ├── 验证：检查当前状态是否正确
    │
    ├── 判断：失败原因是什么
    │
    └── 修正：调整策略，重新执行
```

##### 执行流程图

```
┌─────────────────────────────────────────────────────────┐
│                    Ralph Loop                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
	│  Agent 执行 → 检测退出意图                             │
│       │              │                                   │
│       │         任务完成? ──是──→ 正常退出                │
│       │              │                                   │
│       │              ↓否                                 │
│       │         Hook 拦截                                │
│       │              ↓                                   │
│       │         上下文净化                                │
│       │         (压缩/卸载/清理)                          │
│       │              ↓                                   │
│       │         Self-verification                        │
│       │         (检查当前状态)                            │
│       │              │                                   │
│       │         失败? ──是──→ 注入修正后的目标            │
│       │              │                                   │
│       │              ↓否                                 │
│       │         注入当前环境状态                          │
│       │              ↓                                   │
│       │         强制继续执行                              │
│       │              │                                   │
│       └──────────────┴─────────────────────────────────  │
└─────────────────────────────────────────────────────────┘
```

##### 实际应用场景

| 场景 | Ralph Loop 的作用 |
|------|------------------|
| **重构大型代码库** | 跨数十次上下文清理逐步完成，每次保持清晰的执行上下文 |
| **多步骤调试** | 错误累积时重置，每次从正确的状态继续 |
| **长文档生成** | 避免前文记忆衰减，保持写作风格的连贯性 |
| **复杂调查任务** | 多次搜索/分析后，用净化上下文整合结论 |

#### LangChain 文件系统能力详解

根据 LangChain 的 [^5] 研究，文件系统是 Harness 中最基础但最关键的组件，承载四大核心能力：

##### 1. 信息卸载 (Information Offloading)

模型无法在有限上下文窗口中存储无限信息，文件系统作为**外部大脑**：

| 能力 | 说明 |
|------|------|
| **Compaction（压缩）** | 上下文接近满时，智能总结并卸载中间内容，保留头部/尾部的关键引用 |
| **Tool Call Offloading** | 工具调用的中间结果卸载到文件，只保留首尾 token 用于追踪 |
| **渐进式加载** | 按需从文件加载内容，而非一次性塞入上下文 |
| **上下文恢复** | Agent 重启时可从文件恢复之前的工作状态 |

```
上下文窗口满 → Compaction → 压缩摘要 + 原始引用保留 → 继续工作
```

##### 2. 工具空间 (Tool Space)

文件系统不仅是存储，更是 Agent 的**工作台**：

| 功能 | 作用 |
|------|------|
| **工作空间** | Agent 的"桌面"，可以读写代码、数据、文档 |
| **AGENTS.md 标准** | 跨会话记忆文件，Agent 可编辑和添加，下次启动时自动加载 |
| **临时缓冲区** | 中间计算结果、下载文件、临时脚本的暂存区 |
| **知识库接口** | 通过 MCP 工具访问外部知识（如 Context7 访问训练后信息） |

##### 3. 版本控制 (Version Control)

**Git 集成**是文件系统能力的倍增器：

```
├── 追踪工作：每个改动可回溯
├── 分支实验：新思路开分支尝试，不影响主分支
├── 回滚错误：发现问题可撤销到上一个稳定状态
└── 协作基础：多 Agent、人类协作者通过 Git 协调
```

##### 4. 协同工作 (Collaboration)

文件系统是 Agent 与人类、其他 Agent 之间的**自然协作界面**：

| 协作模式 | 说明 |
|----------|------|
| **人类-Agent** | 人类编辑文件，Agent 读取并响应；Agent 写文件，人类审查 |
| **Agent-Agent** | 共享文件系统作为消息传递媒介，避免直接上下文污染 |
| **人类-人类-Agent** | 多人可同时在项目目录工作，Agent 作为"参与者"加入 |

#### Bash + 代码执行：通用工具的哲学

LangChain 强调 **Bash 工具的本质不是预配置的命令集，而是给 Agent 一台电脑**：

```
传统工具设计：定义工具集 → Agent 选择使用
Bash 通用工具：给 Agent shell 权限 → Agent 自己设计工具
```

| 能力 | 说明 |
|------|------|
| **ReAct 循环** | 模型推理 → 工具调用 → 观察结果 → 重复 |
| **自主工具创建** | Agent 可以写 Python 脚本、Shell 脚本作为自己的工具 |
| **不受预置限制** | 不需要提前想到所有工具，Agent 可按需创造 |
| **自我验证** | Agent 可运行测试套件，观察失败信息并自我修正 |

#### 沙盒环境：安全执行与自我验证

沙盒是 Harness 的**安全隔离层**，支持 Agent 自主观察和验证：

| 能力 | 说明 |
|------|------|
| **隔离执行** | 避免 Agent 生成的代码影响宿主机 |
| **按需创建/销毁** | 每个任务创建独立环境，完成后销毁 |
| **预装工具链** | 预装语言运行时、git、测试工具、浏览器等 |
| **日志与观测** | 完整记录执行日志，支持 Agent 观察分析 |
| **自我验证回路** | 运行测试 → 观察失败 → 修正代码 → 再运行 |

```
Agent 写代码 → 沙盒执行 → 观察结果/日志 → 判断正误 → 修正或继续
```

---

## 控制平面 (Control Plane)

Google Cloud 在 [^8] 中提出了企业级 Agent 的控制平面架构：

### 核心组件

| 组件 | 职责 |
|------|------|
| **Agent Gateway** | 中央化的"空中交通管制"，管理 Agent 间通信 |
| **Agent ID** | 密码学标识，每个 Agent 可追溯 |
| **Model Armor** | 防护提示注入、工具投毒、数据泄露 |
| **Agent Studio** | 低代码开发环境 |
| **Agent Runtime** | 快速持久化执行，支持 Agent 间委托 |

---

## 职业视角：Harness Engineer

根据 LinkedIn 数据，"Harness Engineer AI Agent" 相关职位全球约 **326 个**：

### 典型职位

| 公司 | 职位 | 方向 |
|------|------|------|
| OpenAI | Software Engineer, Agent Infrastructure | ✅ |
| Anthropic | (未明确标注，但研究大量涉及) | ✅ |
| NVIDIA | Autonomous Agent Engineer | 相关 |
| LangChain | Deployed Engineer | 相关 |

### 核心技能

- LLM Prompt Engineering
- Agent 架构设计
- 安全护栏设计
- 多 Agent 协作机制
- 测试与评估 (Evals)

---

## Eval 驱动的 Harness 迭代

LangChain 提出的 [^6] 方法论：

### 核心思想：Eval 作为学习信号

> **将机器学习的训练范式应用于 Agent 开发**

在经典机器学习中，训练数据产生的**梯度**会更新模型权重。Better-Harness 将这一逻辑应用于 Agent 开发：

```
经典 ML 训练：
训练数据 → 前向传播 → 计算 Loss → 反向传播 → 更新权重

Better-Harness：
Evals → 前向传播（Agent 执行）→ 评估结果 → 分析失败 → 更新 Harness
```

| ML 概念 | Better-Harness 对应 | 说明 |
|---------|---------------------|------|
| **训练数据** | Evals（评估集） | 编码了期望 Agent 在生产环境中表现的行为 |
| **Loss Function** | Evaluator | 判断 Agent 输出是否符合预期 |
| **梯度** | 失败信号 | 指出 Harness 需要改进的方向 |
| **权重更新** | Harness 修改 | 调整 prompt、工具、护栏等 |
| **训练循环** | Hill-Climbing | 迭代优化直到性能收敛 |

### Eval = "训练数据" 的含义

Evals 不仅仅是测试用例，更是**行为规范的具体化**：

| 维度 | 说明 |
|------|------|
| **期望行为** | 每个 eval 对应一个具体场景和期望输出 |
| **边界条件** | 覆盖正常流程 + 异常处理 + 边界输入 |
| **质量标准** | 定义"什么是好的回答"的可量化标准 |
| **回归防护** | 确保改进不会破坏已有能力 |

### 为什么用 ML 类比理解 Harness 开发

1. **系统性**：避免"头痛医头"的点修，通过评估驱动全面优化
2. **可测量**：每次改动都有量化指标，而非主观感觉
3. **可复现**：eval 通过意味着回归测试通过
4. **可积累**：每次迭代的 eval 集构成组织的智能资产

```
Harness 不是一次性设计出来的，而是通过"评估-迭代"循环逐步优化的。

Evaluation → Insight → Modification → Repeat
```

### Better-Harness 优化循环流程

Better-Harness 提供了一个**自主改进 Harness 的框架**，操作步骤如下：

#### 1. 数据准备与基准测试

| 阶段 | 说明 |
|------|------|
| **标注与拆分** | 将评估数据按类别拆分为**优化集（Optimization set）** 和**留出集（Holdout set）** |
| **留出集的作用** | 衡量泛化能力的核心，防止系统仅针对已知任务进行过拟合 |
| **运行基准** | 在进行任何编辑前，在两个数据集上运行基准测试以确立对比底线 |

#### 2. 优化迭代（自主运行）

| 阶段 | 说明 |
|------|------|
| **诊断（Diagnose）** | 通过 LangSmith 等平台的 traces 分析失败原因 |
| **实验（Experiment）** | 进行针对性的 Harness 变更。为避免变量干扰，每次通常只进行一项变更 |
| **验证（Validate）** | 检查提议的变更是否在通过新评估的同时，未导致旧案例的性能退化（回归） |

#### 3. 人工复核

> 人工干预作为**第二信号**，旨在检查系统是否产生了过拟合指令（如虽然提高了得分但浪费了 Token 的冗余指令）或不符合预期的边缘情况。

### 评估数据的来源与管理

评估是 Harness 爬山过程的基础，Better-Harness 采用多维度的来源渠道：

| 来源 | 特点 |
|------|------|
| **人工策展** | 团队针对特定任务手动编写案例，规模受限但价值极高 |
| **生产 Traces** | 最高效的来源。挖掘生产中的失败案例或用户纠错记录，转化为评估案例 |
| **外部数据集** | 使用现有基准测试，需手动调整以确保反映预期的特定行为 |
| **分类标注** | 为每个评估添加行为类别标签（如"工具选择"、"多步推理"），支持针对性实验和成本节省 |

### 防止过拟合：奖励黑客与泛化

> **智能体倾向于通过"奖励黑客"（reward hacking）行为在评估中作弊**

| 问题 | 对策 |
|------|------|
| **Agent 针对已知 evals 优化** | 留出集（Holdout set）是泛化能力的代理 |
| **评估集中得分高但实际不行** | 人工审查作为第二信号 |
| **过拟合到特定评测集** | 定期移除饱和或不再有用的 evals |
| **指令冗余但得分提高** | 人工检查是否有 Token 浪费 |

### 评估集的动态管理

Better-Harness 强调评估集的**动态管理**，而非盲目增加数量：

| 策略 | 说明 |
|------|------|
| **回归测试** | 将已解决的案例转化为回归测试，确保未来的改进不会损害现有功能。这类似于软件工程中的测试驱动开发（TDD） |
| **评估集清理** | 定期评估旧案例的价值。随着模型能力的增强或业务逻辑的变更，不再有用或已"饱和"的评估应被移除 |
| **核心 evals 套件** | 选择必须通过的子集作为质量门槛，异常时重点关注 |
| **TDD 思维** | 先定义期望行为 → 运行评估 → 通过后再部署，类似传统软件的测试驱动开发 |

| 生命周期阶段 | 说明 |
|--------------|------|
| **新增** | 从生产 traces、用户反馈、人工策展中添加新案例 |
| **活跃** | 用于优化迭代，每次改动都验证这部分 |
| **饱和** | Agent 已稳定通过，保留为回归测试 |
| **移除** | 业务变更或模型能力提升后，不再适用的案例清理出活跃集 |

### 闭环飞轮效应

```
更多使用 → 更多 traces → 更多 evals → 更好 harness → 更多使用
```

### Better-Harness 未来愿景：自动化闭环

Better-Harness 的愿景是利用**智能体计算**直接指向痕迹数据，实现完全自动化的闭环：

| 能力 | 说明 |
|------|------|
| **自动推导错误** | 持续监控生产痕迹，对失败案例进行自动分类和聚类，无需人工逐条审查 |
| **从生产中生成评估** | 用户的纠错行为是最高质量的评估素材，系统自动将纠正后的 trace 转化为新评估 |
| **版本横向对比** | 通过侧边对比不同 Harness 版本的追踪记录，直观展现行为变更的差异 |

#### 自动化闭环架构

```
┌─────────────────────────────────────────────────────────────┐
│                    完全自动化闭环                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  生产环境                                                    │
│      ↓                                                      │
│  痕迹收集（Traces）→ 自动聚类失败案例                          │
│      ↓                                                      │
│  用户纠错行为 → 最高质量评估素材                              │
│      ↓                                                      │
│  评估生成 → 自动添加到评估集                                  │
│      ↓                                                      │
│  Harness 优化 → 新版本部署                                    │
│      ↓                                                      │
│  版本对比 → 验证行为变更                                      │
│      ↓                                                      │
│  生产验证 → 继续收集痕迹                                      │
│      ↓                                                      │
│      └──────────────────────────────────────────────→ 循环   │
└─────────────────────────────────────────────────────────────┘
```

#### 关键收益

| 收益 | 说明 |
|------|------|
| **降低人工成本** | 从人工策展评估转向自动从生产数据派生 |
| **提高评估质量** | 用户真实纠错比人工模拟的场景更贴近实际 |
| **加速迭代** | 自动化闭环减少人工介入，加快优化速度 |
| **可追溯性** | 每个评估可追溯到具体的生产失败案例 |

### LangSmith 评估器模板

LangChain 提供 [^7]：

| 类别 | 说明 |
|------|------|
| Safety | 内容安全、注入检测 |
| Response Quality | 回答质量、结构化输出 |
| Trajectory | 推理路径完整性、步骤覆盖率 |
| Multimodal | 多模态理解评估 |

---

## Agent 自演进：ReasoningBank

Google Research 的 [^10] 提出了 Agent 从经验中学习的框架：

### Memory Items 结构

```json
{
  "title": "问题描述",
  "description": "简要说明",
  "content": "蒸馏后的推理步骤"
}
```

### 闭环流程

```
检索记忆 → 执行任务 → LLM-as-Judge 自评 → 整合洞察
```

### MaTTS 策略

| 策略 | 说明 |
|------|------|
| **Parallel Scaling** | 并行尝试多种方法 |
| **Sequential Scaling** | 逐步深入，每步评估后再继续 |

### 效果

- WebArena 成功率提升 **8.3%**
- SWE-Bench-Verified 提升 **4.6%**
- 平均每个任务减少 **~3 步**

---

## 总结

Harness Engineering 是 AI Agent 开发中**被低估但至关重要的专业方向**：

1. **不是写 Prompt**，而是设计 Agent 的决策空间和行为边界
2. **不是基础设施**，而是连接模型能力与系统目标的控制系统
3. **不是一次性配置**，而是需要持续迭代和测试的工程实践

随着 Agent 系统越来越复杂，Harness Engineering 的重要性只会继续增长。

## 引用

[^1]: [Trustworthy agents in practice](https://www.anthropic.com/research/trustworthy-agents) - Anthropic, Apr 2026
[^2]: [Automated Alignment Researchers](https://www.anthropic.com/research/automated-alignment-researchers) - Anthropic, Apr 2026
[^3]: [Long-running Claude for scientific computing](https://www.anthropic.com/research/long-running-claude) - Anthropic, Mar 2026
[^4]: [Model Context Protocol (MCP)](https://www.anthropic.com/news/model-context-protocol) - Anthropic
[^5]: [The Anatomy of an Agent Harness](https://www.langchain.com/blog/the-anatomy-of-an-agent-harness) - LangChain
[^6]: [Better Harness: A Recipe for Harness Hill-Climbing with Evals](https://www.langchain.com/blog/better-harness-a-recipe-for-harness-hill-climbing-with-evals) - LangChain
[^7]: [Reusable Evaluators in LangSmith](https://www.langchain.com/blog/reusable-langsmith-evaluator-templates) - LangChain, Apr 2026
[^8]: [The new Gemini Enterprise](https://cloud.google.com/blog/products/ai-machine-learning/the-new-gemini-enterprise-one-platform-for-agent-development) - Google Cloud
[^9]: [AWS launches frontier agents](https://aws.amazon.com/blogs/machine-learning/aws-launches-frontier-agents-for-security-testing-and-cloud-operations/) - AWS
[^10]: [ReasoningBank](https://research.google/blog/reasoningbank-enabling-agents-to-learn-from-experience/) - Google Research, Apr 2026
[^11]: [Ranking Engineer Agent (REA)](https://engineering.fb.com/2026/03/17/ranking-engineer-agent-rea-the-autonomous-ai-agent-accelerating-metas-ads-ranking-innovation/) - Meta Engineering, Mar 2026
[^12]: [KernelEvolve](https://engineering.fb.com/2026/04/02/kernelevolve-how-metas-ranking-engineer-agent-optimizes-ai-infrastructure/) - Meta Engineering, Apr 2026
[^13]: [Capacity Efficiency at Meta](https://engineering.fb.com/2026/04/16/capacity-efficiency-at-meta-how-unified-ai-agents-optimize-performance-at-hyperscale/) - Meta Engineering, Apr 2026
[^14]: [Anthropic Cookbook](https://github.com/anthropics/anthropic-cookbook) - GitHub
[^15]: [OpenAI Cookbook](https://github.com/openai/openai-cookbook) - GitHub

---

*相关话题：[Agent Memory 设计](/writing/technical/ai/engineering-practice/agent-memory)，[多 Agent 协作](/writing/technical/ai/engineering-practice/agent-team)，[Context 管理](/writing/technical/ai/engineering-practice/dynamic-context-systems-roadmap)*