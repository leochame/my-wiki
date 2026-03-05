---
title: Manus 上下文管理分享
created_at: 2026-02-26
status: published
---


> In these notes I mainly summarize two big themes of context engineering inspired by Manus: offloading context and reducing context, plus how they connect to retrieval, isolation, and caching.

## 1. Offload Context
Don't put every tool call result back into your message list. Instead, dump it to the file system so it can be retrieved only when needed.
- Use file system for notes (see: [Drew’s post](https://www.dbreunig.com/2025/06/26/how-to-fix-your-context.html), [Anthropic multi-agent](https://www.anthropic.com/engineering/built-multi-agent-research-system)).
- Use file system (e.g., [todo.md](http://todo.md)) to plan/track progress (see: [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)).
- Use file system read/write token-heavy context (see: [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)).
- Use files for long-term memories (see: Ambient Agents [course](https://academy.langchain.com/courses/ambient-agents/)/[repo](https://github.com/langchain-ai/agents-from-scratch)).

Building on this idea of offloading tool outputs to the file system, we can further organize the tool space into a hierarchical action space.

Offload tools by loading them on demand based on the current task or current state. However, you can't reuse the KV cache, and past calls to remove tools are still in the context. As a result, the model may still call invalid tools.

- Context Offloading – Hierarchical Action Space  
  - Three abstraction levels: function calling, sandbox utilities, and packages & APIs.  
  - Each layer balances capability, cost, and cache stability.

- Level 1: Function Calling  
  - Standard, schema-safe.  
  - Cache breaks on every change.  
  - Too many functions → context confusion.

- Level 2: Sandbox Utilities  
  - Each session runs in a full VM sandbox.  
  - The model can call shell utilities (CLI).  
  - Easy to extend without touching model context.  
  - Great for large outputs → write to file.

- Context Offloading – Level 3: Packages & APIs  
  - Manus writes Python scripts to call pre-authorized APIs.  
  - Great for data-heavy or chained tasks.  
  - Example: fetch the city → get its ID → get the weather → summarize.  
  - Keep model context clean; use memory for reasoning only.  
  - Level 3 is similar to CodeAct-style tool usage.

---

**Q: How does Manus manage tool discovery and the hybrid execution of shell commands versus sandboxed code?**

A: Manus employs a hybrid architecture for task execution. For standard operations, it discovers pre-installed shell utilities through a compact list in the system prompt and invokes them directly, using the `--help` flag to understand command formats. For complex tasks or large-scale data processing, it utilizes a "Codex" mode to generate and run scripts within a code sandbox. This allows the agent to process heavy data in runtime memory and return only the relevant results, ensuring better execution control and efficiency compared to a code-only approach.

---
 **Q: How can AI agents perform high-recall summarization without losing critical information?**

**A:** Instead of free-form text, use **structured outputs and schemas**. By enforcing a specific schema, the agent is compelled to capture and summarize predefined essential data points, treating the schema as a "contract" to ensure information integrity.

---

**Q: How do you manage token-heavy tool results (like search) to prevent context bloat while keeping information accessible?**

**A:** Use a tiered approach based on task complexity:

- **Complex Tasks:** Utilize **sub-agents** (or "agent-as-a-tool") that follow a fixed output schema. This encapsulates the complex workflow and returns only the necessary structured results to the main agent.
    
- **Simple Tasks:** Provide full details initially but apply **compaction** later by offloading data to an external state (file system or URLs) and replacing it with unique identifiers.
    
- **Information Persistence:** Instruct the model to record intermediate insights and key findings into files. This ensures that even if message history is compacted, the essential information remains available to the agent for future decisions.


## 2. Reduce context 

Beyond offloading data to external storage, we can also reduce the amount of context we keep in the model by compressing it smartly:

- Summarize agent message history (see: [Drew’s post](https://www.dbreunig.com/2025/06/26/how-to-fix-your-context.html), Claude Code).
- Prune irrelevant parts of the message history (see: [Drew’s post](https://www.dbreunig.com/2025/06/26/how-to-fix-your-context.html)).
- Summarize or prune tool call outputs (see: [open-deep-research](https://github.com/langchain-ai/open_deep_research)).
- Summarize or prune at agent–agent handoffs (see: [Cognition](https://cognition.ai/blog/dont-build-multi-agents#a-theory-of-building-long-running-agents)).

But be careful about information loss (see: [Cognition](https://cognition.ai/blog/dont-build-multi-agents#a-theory-of-building-long-running-agents) and [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus))! The goal is to compress aggressively enough to save context, without destroying the information you’ll need later.



To manage this tradeoff, it helps to structure how you represent each tool call:  
![[Pasted image 20260226224457.png]]
Every tool call and tool result should have two formats: a full version and a compact version.   The compact version strips out any information that can be reliably reconstructed from the filesystem or other external state.

Before you summarize, dump the pre-summary as a text file or simple log file into the filesystem so you can always recover the full details if needed.

Next, define a “pre-rot” threshold for your context window. Once the conversation crosses this threshold, start compacting: for example, compress the oldest 50% of tool calls while keeping the newer ones in full detail.

After compaction, check how much free context you’ve actually gained. If the gain is tiny, you can go further and summarize all remaining full-context segments—while still keeping the very latest segment in full detail, so the model clearly knows where it left off.

> how do you prompt to produce good summaries?



## 3. Retrieve context

Once we’ve offloaded and compressed context, we need good strategies to bring the right pieces back in:

- Use a mix of retrieval methods plus re-ranking (see: Varun’s [take](https://x.com/_mohansolo/status/1899630246862966837?ref=blog.langchain.com) from Windsurf).
- Build systems that assemble retrievals into coherent prompts (see: [Preempt](https://lexfridman.com/cursor-team-transcript) in Cursor).
- Retrieve relevant tools based on tool descriptions (see: [Drew’s post](https://www.dbreunig.com/2025/06/26/how-to-fix-your-context.html)).

Good retrieval keeps the model focused on what matters now, without flooding it with everything that has ever happened.

## 4. Isolate context

- Split context across multiple agents (see: [Drew’s post](https://www.dbreunig.com/2025/06/26/how-to-fix-your-context.html), [Anthropic](https://www.anthropic.com/engineering/built-multi-agent-research-system)).

But be careful (see: [Cognition](https://cognition.ai/blog/dont-build-multi-agents#a-theory-of-building-long-running-agents), [Walden Yan](https://x.com/jxnlco/status/1945490018127987092)):

- Multi-agent setups can make conflicting decisions (same refs as above).
- Sub-agents are safer when they avoid making high-stakes decisions themselves and instead focus on search, analysis, or data gathering (see: [open-deep-research](https://github.com/langchain-ai/open_deep_research)).

In other words, isolate context across agents to reduce overload, but centralize decision-making to avoid chaos.
"communicating" for simple, delegated tasks and "sharing memory" (context) for complex, history-dependent sub-tasks.

## 5. Cache context

Beyond retrieval and isolation, caching can dramatically reduce cost and latency:

- Cached input tokens for Claude Sonnet are up to 10× cheaper.
- Cache agent instructions and tool descriptions in the prompt prefix.
- Add mutable context and recent observations at the suffix.

A good caching strategy keeps the stable parts of your system “always on” in the cache, while letting the dynamic parts change with each step.



## 6. Index And Vector Store

**Q:** How does Manus handle large contexts without on-the-fly vector stores?

**A:** We avoid indexed databases because Manus sandboxes are ephemeral; building indices on the fly is too slow for fast interaction. Instead, we rely on **`grep`** and **`glob`** for codebase operations. While external vector indices are necessary for massive enterprise knowledge bases, the sandbox scale allows us to prioritize speed over pre-indexing.

**Q:** How do you maintain user memory across sessions without persistent files?

**A:** We use **"Knowledge" (explicit memory)**: when Manus learns a preference, it prompts the user to "accept or reject" the update via a dialog. 
Beyond this, we are exploring **"parameter-free online learning."** By leveraging collective feedback—such as users repeatedly correcting CJK font issues in data visualizations—the agent self-improves using online learning without modifying the underlying model parameters.