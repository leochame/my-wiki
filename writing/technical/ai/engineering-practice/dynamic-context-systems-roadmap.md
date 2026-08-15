# 动态上下文系统：从“摘要卡片”到“可管理的信息系统”（工作笔记）

> 目的：把关于“更成熟的动态上下文系统”的分析内化到写作体系里，作为后续改造 open-manus-java（以及类 Manus/Cursor/Anthropic agent）的设计依据。

## 结论先行（定位）

当前实现更像“增强版单 Agent 上下文治理”：

- 已有：`context trimming`
- 已有：`tool result offload / rehydrate`
- 已有：`task state card`
- 但尚未把“上下文”统一抽象成：
  - **可索引的事实（structured memory）**
  - **可发现的资源（resource catalog）**
  - **可按需读取的文件/工件（workspace-centric loading）**
  - **可隔离的子任务工作记忆（stronger task decomposition）**

也可理解为：系统已做到“上下文治理的 B 阶段前半段”，但离 Manus / Cursor / Anthropic 所说的成熟动态上下文系统还差一层“统一机制”：

> 把“存什么、什么时候取、取多少、取回来后怎么继续工作”做成统一闭环，而不是靠几张摘要卡片 + 工具结果回填。

## 代码锚点（当前系统已有能力）

结构化摘要卡（偏阅读、非检索）：

- `/Users/leocham/Documents/code/04-open-manus-java/branch-01/open-manus-branch-01/src/main/java/com/openmanus/agent/context/compression/HistoricalContextSummarizer.java`
  - 产出 `[Historical Key Memory]`：
    - `lastUserIntent`
    - `lastAssistantOutcome`
    - `recentToolObservations`

MCP 当前定位（仅 tool bridge，不做 resource 融合）：

- `/Users/leocham/Documents/code/04-open-manus-java/branch-01/open-manus-branch-01/docs/TECHNICAL_IMPLEMENTATION.md`
  - 明确当前不进入 “MCP 资源融合”。

任务态卡片（单 Agent 最小任务态）：

- `/Users/leocham/Documents/code/04-open-manus-java/branch-01/open-manus-branch-01/src/main/java/com/openmanus/agent/context/assembly/TaskExecutionStateTracker.java`
- `/Users/leocham/Documents/code/04-open-manus-java/branch-01/open-manus-branch-01/src/main/java/com/openmanus/agent/context/assembly/TaskStateContextInjector.java`
  - 能表达：
    - `plan`
    - `inProgress`
    - `todo`
    - `lastFailure`

## 目标形态：四块能力是一条链（不是四个孤岛）

1. **结构化事实记忆**：解决“什么信息值得长期保留”
2. **MCP resource 融合**：解决“外部上下文从哪里按需拿”
3. **文件级动态装载**：解决“怎么以低 token 成本拿回来”
4. **更强任务分治**：解决“长任务里怎么不让所有上下文混成一锅”

## 1) 结构化事实记忆（structured note-taking）

### 你现在有什么

`HistoricalContextSummarizer` 生成的是面向阅读的摘要文本卡片；相比“纯截断历史”更强，但仍然不是面向检索与推理的结构化记忆。

### 成熟版通常想保存的类型

- `facts`
  - 例：项目默认模型是 `gpt-5.4`
  - 例：MCP 默认关闭
  - 例：某接口返回 `sessionId`
- `decisions`
  - 例：决定采用单 Agent，不启用 Multi-Agent 默认实现
- `constraints`
  - 例：文件操作必须在 sandbox 内
  - 例：不能把 MCP resource 直接塞进初始 prompt
- `open_questions`
  - 例：某个工具输出字段是否稳定，是否要做 schema 约束
- `next_actions`
  - 例：下一轮只需要检查 `agent/context` 包和 artifact store

### 为什么重要

长任务靠的不只是压缩（compaction），还包括 structured note-taking：把关键事实、架构决策、未解决问题用结构化方式记下来，避免只保留一段“自然语言总结”。

### 你现在缺的点（写入链路 + 读链路）

- 没有独立的 `Fact/Decision/Constraint/...` memory schema
- 没有“新观察进来后，抽取并更新结构化记忆”的写入链路
- 没有“按事实类型检索 + 相关性挑选注入”的读链路

### 形态示例

不是一张 `[Historical Key Memory]` 文本卡，而是类似：

```json
{
  "facts": ["tool-result-offload-enabled default=true"],
  "decisions": ["single-agent architecture remains default"],
  "constraints": ["MCP resources not in current phase"],
  "open_questions": ["whether file graph retrieval should be added"]
}
```

然后在模型前置上下文只注入最相关几条，而不是整段摘要。

## 2) MCP resource 融合（tool-oriented → resource-oriented）

### 你现在有什么

MCP 目前更多是 tool bridge：

- 系统知道“我能调用哪些工具”
- 但不会系统性地先想“我应该先挂载/读取哪些资源（文档/设计/日志/手册），再决定要不要调用工具”

### 两种 MCP 的根本差异

tool-oriented MCP：

- 我知道有 `jira.searchIssues`
- 我调用它拿结果

resource-oriented MCP：

- 我知道有 Jira 文档、设计稿、日志目录、运行手册等资源
- 我先按需读取少量资源（progressive disclosure / on-demand loading）
- 资源不足时才调用工具做动作

### 你现在缺的点

- 没有统一的 resource catalog 进入上下文治理
- 没有 “resource metadata -> relevance scoring -> load subset” 链路
- 没有把 `resource read` 与 `tool call` 当成两种不同的 context primitive

### 成熟版通常会多出（示意）

- `list_resources`
- `read_resource_summary`
- `read_resource_chunk`
- resource 元数据进入检索层：`name / type / source / tags / updatedAt / size`

## 3) 文件级动态装载（workspace-centric / artifact-centric）

### 你现在有什么

- 对工具结果做了卸载与回填（artifactId 驱动）
- 但对文件系统本身，还没有形成统一的“按需发现上下文”机制

### Manus / Cursor 的典型做法

它们更偏向：

- Use the file system as context
- 大上下文默认外置到文件系统或外部索引里
- 模型只在需要时自己去找、自己去读（而不是把原始内容塞进对话历史）

### 你现在缺的点（能力栈）

- 没有统一的 “workspace/file graph as context index”
- 没有“当前任务 -> 找哪些文件 -> 读哪些 section”的策略层
- 没有把 terminal history / MCP metadata / long observations 用统一文件抽象收口
- 当前回填主要围绕 `artifactId` 和 tool 结果，不是围绕“任务需要哪些文件节点”

### 成熟版通常会有（示意）

- 文件图谱：路径、语言、模块归属、最近修改、符号索引
- 轻量发现工具：`glob`、`grep`、`symbol search`、`semantic search`
- 分块读取策略：先 metadata，再 head/tail，再 chunk，再全文
- 工作区工件：中间分析结果写文件，不直接塞对话历史

## 4) 更强任务分治（从 task state card 到 task tree）

### 你现在有什么

已有“最小任务态”（`plan / inProgress / todo / lastFailure`），但仍然是一条主线程里把所有内容混在一起。

### 成熟版想解决的问题

长任务真正炸上下文的，不只是“内容多”，更是“所有内容混在一个线程里”：

- 主任务上下文
- 子任务上下文
- 子任务各自的工具输出
- 子任务压缩结果
- 主任务只接收摘要/结论/产物引用

### 你现在缺的点

- 子任务隔离上下文
- 子任务级压缩与结果回传协议
- 主任务只接收子任务产物引用（文件/工件指针，而非全文）
- 任务树或 task journal

## 一句话版判断

当前系统更像“增强版单 Agent 上下文治理”。

更成熟的动态上下文系统（Manus / Cursor / Anthropic 语境）目标是：把上下文变成一个可管理的信息系统，而不仅是对聊天历史做压缩与回填。

## 参考（后续补读/引用）

- Manus：Context Engineering for AI Agents（Use the file system as context）
  - https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
- Cursor：Dynamic context discovery（把 tool/metadata/history 也文件化 + 按需发现）
  - https://cursor.com/blog/dynamic-context-discovery
- Anthropic：Effective context engineering for AI agents（compaction / structured note-taking / multi-agent）
  - https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic：Code execution with MCP（progressive disclosure / on-demand loading）
  - https://www.anthropic.com/engineering/code-execution-with-mcp

