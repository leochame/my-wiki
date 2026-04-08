
# How To Build A Agent


## 1. 你想设计一个怎样的 Agent

专注具有高价值需求的人，去做最好的产品。而不是和 ChatGPT 抢夺最广的，最底层的用户群。服务高价值用户，价格不是核心竞争点。

TOC 专业Agent，不应该给专业人士提供，而是非专业人士。比如：剪辑师对于其中一个环节缺失就会在意，从而这个 AGent 就是0分，而对于有剪辑需求的人做 Agent，给一个做不了的人做，他是一个净增益。

替换人的话，就是从 Risk Control 的角度考虑，应该从提升人的角度考虑。

未来 Agent 是主动性，主动的去做一些任务

Manus 持续优化头部体验，保持很强长尾能力的产品。一个产品不是说你的功能覆盖多数用户的多数需求成功就可以。而是保持长尾能力，Google 和 Bing 相比，搜索普通的大众关键词，都表现的很好，但是 Google 为什么可以更胜一筹？就是因为他可以处理用户的长尾需求。


互联网什么时候出现稳态，我觉得是用户时间瓜分完成的时候才是稳态。但是 AI 时代， AI Agent 可以异步执行，不会因为用户的总注意力时长而产生瓶颈。。

相信github 的一句话，每增加一个功能其实在稀释你之前所做的功能。

## 2. Agent 的本质是什么？

Agent 输出的不是一段话，而是一个 Action


## 3. Memory & Reflection

使用你的 Agent 让用户形成的习惯，才是这个 Agent 的护城河。

在这其中最终的就是Long Term Memory,  
1. 反思的呈现形式应该为自动进化的 Skill。一个用户如果拿通用Agent 做生产力提升。对于一个人，95%的情况下任务就那么几种，内化成 skill 确实是最合适的方法。之前一直考虑反思总结的任务种类如果过多，怎么办，现在想想每个人就那么几种任务类型，针对单个用户做就行。
2. 个人用户偏好，进行记录


Agent 这种长链路与环境强相关的情况下，其实用户是非常关键的。有独特的数据飞轮，winsurf 和 cursor 使用较低成本训练模型。


ChatBot 错了，我们常用的是一个是 Retry 重试，另一个是修改Prompt。但是而对于 Agent ，是教，教他怎么做。


通用的失败模式，用户共识性的东西作为系统原生的一部分，用的人越多，失败率越低，完成任务的轮次开销越小。第一种数据飞轮。
第二种仍然拿用户的朴素反馈，和测试集之间是存在GAP的

作为通用 Agent 应该关注 Coding，错误能够自我意识到并且修复

模型不应该分类，分为输入和输出两个部分。
垂直 Agent 的话，很多信息不可能是来自于用户的主动提供的一个过程，输出也不是一个标准化的形式给出的，可能无缝传给另一个系统。和通用 Agent 有不同。



grep 是个很强的功能，各家厂商都在跟进。Agent 比较好的范式包括：渐进式暴露，按需加载，上下文后管理 - 压缩，卸载等等。

## 4. Context Management

首先应该是确定 context rot 阈值

约 100 行的 `AGENTS.md` 仅作为目录（Map），指向结构化的 `docs/` 目录。设计文档、执行计划和决策日志都被视为一流的工件进行版本控制。这种方式确保了智能体能从一个稳定、微小的切入点开始，根据需要自主导航到深层情境，而不是在任务开始前就被海量信息淹没。

### 4.1 Context Summarization

为了在上下文溢出时既能节省空间又不丢失关键细节，其实现方案如下：

1. 有损摘要 + 无损备份（Lossy Summary + Lossless Backup）
	当对话达到 Token 上限时，Cursor 会触发一个“压缩”步骤：
	
	生成摘要：调用模型对之前的对话进行总结，作为当前窗口的“背景”。
	
	转存为历史文件：这是关键点。Cursor 不会简单地删掉旧对话，而是将完整的原始聊天记录保存为一个隐藏的文本文件（如图片中的 transcript.txt 或 agent transcript）。

2. 基于检索的上下文恢复（Retrieval-Augmented Recovery）

	压缩后的摘要往往会丢失特定细节（例如具体的 S3 路径、复杂的正则代码）。

	实现逻辑：给 Agent 配备专门的检索工具（如 grep、语义搜索或 read_file）。

	工作流（对应你上传图片的流程）：
	
	Agent 在摘要中发现自己“记得做过某事，但不知道具体细节”。
	
	Agent 自主决定调用搜索工具查看 agent transcript 文件。
	
	从全量历史中精准抓取所需的片段，并将其重新拉回当前的活跃上下文中。

### 4.2 渐进式披露

按需加载 tool

将所有集成终端会话视为文件：过去你需要把终端会话的输出复制粘贴到 Agent 的输入中，Cursor 现在会自动将集成终端的输出同步到本地文件系统。

这样你就可以轻松询问“为什么我的命令失败了？”，并让 Agent 理解你具体在引用什么。由于终端历史可能很长，Agent 可以只对相关输出进行 grep，这对于像服务器这类长时间运行的进程所产生的日志尤其有用。

这与基于 CLI 的编码 Agent 所看到的情况相似：它们同样可以在上下文中访问先前的 shell 输出，但这里是动态发现的，而不是静态注入的。


## Continue Learning



## 5. Harness Engineering

1. 可观测性的追溯，关注 LLM 的输入与输出
	我们希望跟踪分析能够重复进行，因此将其做成了一项 Agent Skill
	获取实验运行的详细输入输出记录 -> 生成多个并行错误分析智能体，识别失败模式（如推理错误、不遵守指令、缺乏验证等） - > 主智能体合成分析发现，并针对安全壳提出改进建议 -> 人类验证建议并调整 Harness , 同时避免过度拟合某个任务的修改不利于模型的泛化能力，并可能导致在其他任务中出现退化。


2. Build & Self-Verify
	Self-verification allows agents to self-improve via feedback within a run However, they don’t have a natural tendency to enter this  [build-verify loop].
	
	我们在系统提示中添加了解决问题的指导。
		1. Read the task, scan the codebase, and build an initial plan based on the task specification and how to verify the solution 
		2. Implement the plan with verification in mind. Build tests, if they don’t exist and test both happy paths and edge cases
		3. Run tests, read the full output, compare against what was asked (not against your own code).
		4. Analyze any errors, revisit the original spec, and fix issues
	在智能体尝试退出任务前拦截它，强制执行针对任务说明的最终验证步，防止其在未经验证的情况下盲目自信。


2. 为 Agent 注入上下文信息
	本地上下文中间件 (LocalContextMiddleware)：自动映射工作目录（cwd）和目录树，并自动发现系统中的工具（如 Python 环境）。
	强制测试标准：通过提示词告知智能体其工作将接受自动化测试评分，要求其严格遵守文件路径规范并处理边界情况。
	时间预算预警: 注入时间提醒，帮助智能体在接近限制时从开发转向验证。

3. Encouraging Agents to Step Back & Reconsider Plans
	智能体在决策失误后往往会陷入对同一文件进行微小且无效修改的死循环。监控对同一文件的编辑次数。当编辑次数达到阈值 N 时，注入上下文提示智能体“重新考虑整体方案”，从而跳出死循环。

4. Practical Takeaways for Building Agent Harnesses
	a. 智能体在上下文组装方面依然存在短板，harness 应负责交付目录结构、工具信息和最佳实践。
	b. 模型倾向于首个看似合理的方案。必须积极地提示其通过运行测试来不断精炼方案。
	c. 使用 Trace 数据来共同调试工具和推理过程，识别模型是因为缺乏工具还是缺乏指令而走错方向。
	d. 不同模型（如 Codex 与 Claude）对提示词的反应不同，harness 的迭代必须针对特定模型进行。


日志、指标和追踪记录会通过一个本地可观测性堆栈展示给 Codex，对任何给定的工作树来说，该堆栈都是临时的。Codex 在该应用程序的一个完全独立的版本上运行，一旦任务完成，该版本的所有内容，包括日志和指标，都会被删除。智能体可以使用 LogQL 查询日志，使用 PromQL 查询指标。

增强智能体的感知能力而不是人类的感知能力
- UI 可读性：接入 Chrome DevTools 协议，使智能体能处理 DOM 快照和屏幕截图，从而复现错误并验证修复。
- 可观测性： 智能体可以使用 LogQL 查询日志，使用 PromQL 查询指标，从而直接推理系统的性能和行为。
- 动态环境：Codex 可以为每次代码更改启动独立的 git worktree 实例，在隔离环境中运行并验证任务。



## 6. Evaluation

Remote Labor Index，远程劳动力指标。以这个 AI 系统完成的工作，是否让人愿意付款，并且分不清是人类还是AI 做的。

当前做的一些 Harness 或者约束编码等等，我们需要定期去评估，查看是否会随着模型的能力变强，而效果更好，如果没有发现提升，思考是不是因为当前的机制拖累了 Agent。


## 7. Multi-Agent

### 7.1 Agent Communication

通过让主 Agent define output 来符合特定 Schema。Sub Agent 执行完搜索或分析后，调用 `submit_result`，被强制要求必须按这个格式填写。


## 8. 对比各家 AI


Gemini 在静态前端的视觉和美学设计上，真的走在很前面。
Anthropic 的路线比较务实，基本都在盯着「怎么创造更高的经济价值」。
Gemini 在预训练阶段到底解决了哪些具体问题，其实外界现在还看不太清楚，只能猜它在多模态能力和数据积累上有很深的功夫。Google 本身在信息检索和多模态上就有长期优势，这块大概率会一直保持领先。
XAI 的 Pixel-in Pixel-out 路线，可以理解成「把一切都当像素，直接从像素输入到像素输出，什么都能生成」。
接下来更值得关注的是多模态输入的使用方式。比如现在我在看的一些结果，本质上已经是一种 ToolResult，而不再是传统意义上的「文本回答」。


## 9. 如果你去设计一个 Agent，最重要的是什么？
最重要的一定是数据
