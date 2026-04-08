---
id: T-023
title: 阅读 LangChain Agent Builder 内存系统文章
status: todo            # todo | in-progress | waiting | done | cancelled
due: 2026-03-08
priority: medium        # low | medium | high | urgent
---

## Description

今天阅读 LangChain Blog 文章《How we built Agent Builder’s memory system》，理解 LangSmith Agent Builder 的记忆系统设计思路、技术方案以及对自己搭建有记忆的 agent 的启发。  
原文链接：`https://blog.langchain.com/how-we-built-agent-builders-memory-system/`

## Next Actions

- [ ] 打开并通读文章，整体把握背景：为什么在 Agent Builder 中优先做内存系统  
- [ ] 重点阅读「How we built our memory system」部分，理解：文件系统式内存、AGENTS.md / skills / tools.json 的角色划分  
- [ ] 理解三种记忆类型（procedural / semantic / episodic）在这个系统中的映射关系，思考和自己理想的 agent 架构有何异同  
- [ ] 记录 3–5 条对自己有用的设计经验（例如：用虚拟文件系统来统一记忆、如何做 memory editing、人类审批 in-the-loop 的模式）  
- [ ] 在个人笔记中用几句话总结：如果自己要实现一个带记忆的 agent，哪些做法可以直接借鉴，哪些想尝试不同设计

## Article Summary

### 核心问题
LangChain 为任务特定的 Agent（如邮件助手、文档助手）构建了 Agent Builder，这些 agent 需要反复执行相同任务。如果没有记忆系统，用户每次都要重复指令，体验很差。

### 技术方案

**记忆即文件系统**：将记忆表示为文件，agent 通过标准文件系统操作读写。这利用了 LLM 对文件系统的熟悉度，无需专门工具。

**存储架构**：文件存储在 Postgres 中，但以"虚拟文件系统"形式暴露给 agent——结合了 LLM 友好的接口和数据库效率。

**行业标准**：
- `AGENTS.md` 存储核心指令
- Agent skills 处理专门任务
- 自定义 `tools.json` 用于 MCP server 访问（工具子集，避免上下文溢出）
- Subagent 定义

**记忆类型**（基于 COALA 框架）：
- **Procedural（程序性）**：规则/行为（`AGENTS.md`、`tools.json`）
- **Semantic（语义性）**：事实/知识（skills 文件、自定义知识文件）
- **Episodic（情节性）**：过去行为序列（计划中，尚未实现）

### 实现细节

**迭代学习**：Agent 在工作过程中"热更新"自己的记忆。例如：会议总结 agent 通过用户纠正，从基础摘要演化为包含领域术语的复杂格式——无需手动配置。

**验证层**：自定义文件 schema 在提交前验证；错误返回给 LLM 修正。

**人类在环**：记忆编辑需要明确批准，防止 prompt injection 攻击（可选"yolo 模式"）。

**关键挑战**：
- Prompting 是最难的部分——一个人全职负责记忆 prompting
- Agent 擅长添加信息，但难以压缩/泛化学习内容
- 显式用户提示（如"反思并更新记忆"）仍然有用

### 成果与洞察

**优势**：
- 使用熟悉格式（markdown/JSON）的无代码体验，而非专有 DSL
- 更好的迭代——用户给自然语言反馈，而非手动更新配置
- 使用标准约定的可移植 agent

**计划改进**：
- Episodic memory（将过去对话暴露为文件）
- 后台记忆进程（每日 cron 任务进行反思/泛化）
- `/remember` 命令用于显式记忆更新
- 记忆的语义搜索
- 多级记忆（用户级、组织级目录）

该系统使 agent 能够真正从交互中学习，通过使用而非前期文档构建复杂的行为规范。


