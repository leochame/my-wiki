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


