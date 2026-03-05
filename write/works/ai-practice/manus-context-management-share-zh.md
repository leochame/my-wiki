---
title: Manus Context Management (CN)
created_at: 2026-02-26
status: published
---

> 这篇笔记主要总结了受 Manus 启发的两大类「上下文工程」思路：「卸载上下文」和「压缩上下文」，以及它们分别如何和检索、隔离、缓存等机制结合起来。

## 1. Offload Context

不要把每一次工具调用的完整结果都塞回到消息列表里。相反，应该把这些结果写进 File System 里的 file，需要的时候再按需检索回来。

- 把 File System 当做 Note（参考：[Drew 的文章](https://www.dbreunig.com/2025/06/26/how-to-fix-your-context.html)、[Anthropic Multi Agent System](https://www.anthropic.com/engineering/built-multi-agent-research-system)）。
- 用 File System（例如 `todo.md`）做计划和进度跟踪（参考：[Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)）。
- 用 File System 读写那些 token 量很大的上下文（参考：[Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)）。
- 用 file 保存长期记忆（参考：Ambient Agents 的[课程](https://academy.langchain.com/courses/ambient-agents/) / [仓库](https://github.com/langchain-ai/agents-from-scratch)）。

在把工具输出卸载到 File System 的基础上，我们可以进一步把「工具空间」组织成一个分层的动作空间（hierarchical action space）。

根据当前任务或当前状态，按需加载工具，而不是一次性把所有工具都挂在模型前面。但这样做有几个副作用：KV Cache 不能复用，而且「曾经使用过、后来被卸载的工具」这些历史调用仍然留在上下文中，会导致幻觉问题，模型有时还是会尝试去调用那些已经不可用的工具。

在这个前提下，可以把工具层次大致分成三个抽象层级：函数调用层、沙箱工具层、以及脚本 / 包 & API 层。

- **L1：函数调用（Function Calling）**  
  - 标准化、Schema 安全。  
  - 只要函数列表有改动，缓存几乎就要重建。  
  - 函数太多会造成上下文混乱。

- **L2：沙箱工具（Sandbox Utilities）**  
  - 每个会话在一个完整的 VM 沙箱中运行。  
  - 模型可以直接调用 shell 工具（CLI）。  
  - 非常容易扩展新能力，不用改动模型的系统提示或函数列表。  
  - 对于输出很大的任务，可以直接写入文件，不挤占上下文。

- **L3：脚本 / 包 & APIs（Packages & APIs）**  
  - Manus 会写 Python 脚本来调用预授权的 API。  
  - 特别适合数据量大、需要多步调用的复杂流程。  
  - 可以在运行时内存中处理大体量数据，只把最后关键信息返回给模型。  
  - 保持模型上下文干净，把上下文留给「推理」，而不是「搬运数据」。  
  - 第 3 层的用法和 CodeAct 风格的工具调用很相似。

---

**Q：Manus 是如何管理工具发现，以及在 shell 命令和沙箱代码之间进行混合执行的？**

**A：** Manus 采用了一种**混合架构**来执行任务。对于标准化的操作，它会在系统提示中维护一份精简的「预装 shell 工具列表」，并直接调用这些命令，通过 `--help` 来理解命令的参数格式和用法。对于更复杂的任务或需要大规模数据处理的场景，它会启用「Codex 模式」，在代码沙箱里生成并运行脚本。这样，代理可以在运行时内存里处理大批量数据，只把真正相关的最终结果返回给模型，相比「只写代码、不用工具」的方式，这种模式具有更好的执行控制能力和效率。

---

Q：AI Agent 如何在不丢失关键信息的前提下，做高召回率（high-recall）的总结？

A：不要只用自由文本总结，而要用结构化输出和 Schema。通过强制输出符合特定 Schema 的结构化结果，Agent 就必须去捕捉并总结那些预先定义好的关键数据点，把 Schema 当成一种「信息提取契约」，从而尽量保证重要信息不会在总结过程中被遗漏或扭曲。

---

Q：如何管理像 search result 这种 token 量很大的工具输出，一方面防止上下文膨胀，另一方面又保证信息可访问？

A：可以用一个分层策略，按任务复杂度区分处理方式：

- **复杂任务：** 使用 **sub-agents（或 “agent-as-a-tool”）**，并为其定义固定的输出 Schema。  
  这样可以把复杂的工作流封装在子 Agent 内部，只把结构化的、必要的结果返回给主 Agent。

- **简单任务：** 在一开始可以直接返回完整细节，但**在后续阶段进行压缩（compress）**：  
  把原始数据卸载到 external state（比如 File System 或 URL 等），在对话上下文中只保留唯一标识符（ID）。

- **信息持久化：** 明确指示模型把中间洞见和关键发现记录到文件中。即使之后对话历史被压缩或裁剪，这些关键信息仍能通过文件被重新加载回来。

---

## 2. Reduce Context

除了把数据卸载到外部存储，我们也可以在「留在模型里的上下文」上动手脚，更聪明地压缩它：

- 总结 Agent 的消息历史（参考：[Drew 的文章](https://www.dbreunig.com/2025/06/26/how-to-fix-your-context.html)、Claude Code）。
- 裁剪与当前任务无关的消息片段（参考：[同一篇 Drew 的文章](https://www.dbreunig.com/2025/06/26/how-to-fix-your-context.html)）。
- 对工具调用结果进行总结或裁剪（参考：[open-deep-research](https://github.com/langchain-ai/open_deep_research)）。
- 在 Agent 与 Agent 之间进行「交接」时，对上下文进行总结或裁剪（参考：[Cognition](https://cognition.ai/blog/dont-build-multi-agents#a-theory-of-building-long-running-agents)）。

但要非常小心信息损失（参考：[Cognition](https://cognition.ai/blog/dont-build-multi-agents#a-theory-of-building-long-running-agents) 和 [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)）！目标是在尽可能节省上下文的同时，避免毁掉后续还需要的信息。

为了更好管理这个取舍，可以先统一工具调用的内部表示方式：

每一次工具调用及其结果，都应该同时维护两种版本：**full version** 和 **compact version**。  
compact version 会剔除所有那些可以从 File System 或其他 external state 中可靠重建的信息，只保留真正必要的 summary 和 index 信息。

在进行任何总结之前，先把「summarize 之前的 raw content」以 text file 或简单 log 的形式写入 File System，这样一旦需要，就能从 File System 中恢复全部细节。

接下来，为你的 context window 设置一个「pre-rot threshold」。如果对话长度一旦超过这个阈值，就开始执行压缩策略：例如，优先压缩最早的那 50% 工具调用记录，而把最近的调用保持原样。

压缩完成后，再检查一下你实际释放出来的 context space。如果节省得不多，可以进一步压缩：  
比如把剩余仍保留 full context 的部分也再 summarize 一遍——但**始终保留最新的一小段上下文为完整形态**，这样模型才能清楚地知道「自己是在哪里停下来的」。

> 问：该如何提示模型，才能得到高质量的总结？

（这里可以结合自己的系统，设计针对「Functioncall / 工作流片段 / Agent Handoff」的专门总结模板和示例。）

---

## 3. Retrieve Context

当我们已经把上下文卸载和压缩之后，就需要一套好的策略把「正确的那一小部分」重新带回到模型上下文里：

- **混合检索 + 重排序（re-ranking）**（参考：Windsurf 团队 Varun 的[分享](https://x.com/_mohansolo/status/1899630246862966837?ref=blog.langchain.com)）。
- **构建可以把多个检索结果自动组装成连贯提示的系统**（参考：Cursor 中的 [Preempt](https://lexfridman.com/cursor-team-transcript)）。
- **按工具描述对工具本身做检索**（参考：[Drew 的文章](https://www.dbreunig.com/2025/06/26/how-to-fix-your-context.html)）。


---

## 4. Isolate Context

- **在多个 Agent 之间拆分上下文负载**（参考：[Drew 的文章](https://www.dbreunig.com/2025/06/26/how-to-fix-your-context.html)、[Anthropic 多 Agent 系统](https://www.anthropic.com/engineering/built-multi-agent-research-system)）。

但这里也有不少坑（参考：[Cognition](https://cognition.ai/blog/dont-build-multi-agents#a-theory-of-building-long-running-agents)、[Walden Yan](https://x.com/jxnlco/status/1945490018127987092)）：

- Multi Agent System 很容易做出互相冲突的决策（原因见上面同一批参考）。  
- 子 Agent 在设计上最好避免直接做高风险决策，而是把重心放在检索、分析、信息收集等工作上（参考：[open-deep-research](https://github.com/langchain-ai/open_deep_research)）。

换句话说：在 Agent 之间隔离上下文，以减少单一上下文的负担；但在决策层面尽量集中控制，避免系统整体陷入混乱。

可以粗略区分两类协作模式：  
- 只需要简单委派的任务，更偏向「Communication」；  
- 与历史高度相关、依赖长期记忆的子任务，则更强调在 Agent 之间「Share Context」。

---

## 5. Cache Context

除了检索和隔离之外，缓存也可以显著降低成本和延迟：

- 对 Claude Sonnet 来说，缓存中的输入 token 价格最多可以便宜 10 倍。
- 把 Agent 指令和工具描述放在提示词前缀中，并尽可能缓存。  
- 把可变上下文和最近观察到的信息放在提示词后缀中，每步更新。

一个好的缓存策略，会让系统中那些「Stable 的部分」始终维持在 Message 的前半部分，而把那些「随每一步变化的部分」放在后半部分，按步更新。

---

## 6. Index And Vector Store

Q：Manus 在没有实时构建向量库的前提下，如何处理大规模上下文？

A：由于 Manus 的沙箱是短暂的，在会话过程中现建索引数据库会非常慢，影响交互体验。因此我们尽量避免使用需要预构建索引的数据库，而是在代码操作上更多依赖 `grep` 和 `glob` 这样的工具。在需要大规模企业知识库时，外部向量索引当然是必需的，但在沙箱这个规模下，我们更倾向于优先保证速度，而不是事先建立索引。

Q：在没有持久化文件的前提下，如何跨会话维持用户记忆？

A：我们使用一种叫做「显式记忆」的机制：当 Manus 学到一个用户偏好时，会通过对话框提示用户「是否接受这条偏好」，由用户明确「接受 / 拒绝」。  
除此之外，我们还在探索一种「无参数的在线学习（parameter-free online learning）」方式。例如：用户不断纠正可视化中的 CJK 字体问题，这是一个共性问题，就要考虑Long Term Memory，在不改动底层模型参数的前提下，让 Agent 基于这些反馈持续自我改进。


