文章
- https://www.oreilly.com/radar/why-multi-agent-systems-need-memory-engineering/
- https://blog.langchain.com/how-we-built-agent-builders-memory-system/



github
- 
- https://github.com/mem0ai/mem0




## 想做一个怎样的记忆系统呢？

1. summary log, (you must have a log system) , By log to get Long Term Memory
	- Case, some your quey Case(Must Rag ? )
	- personal preference
	- From error , what agent can get, so agent dont make same mistake again.
2. 可以结构化的设置个人偏好, KV Scheme  store
3. File System  Store Data . 


> 1. 图数据库构建混合检索 (GraphRAG + Vector)
> 2. 它关注的是当提取出相互矛盾的信息时，系统该如何决策

## 参考学习的例子

### Open AI 
**在撰写本文时，ChatGPT 会在系统提示中附加关于用户的四类信息：

1. Interaction Metadata 交互元数据，这个用来判断此刻你的状态
    如何与服务交互的全面元数据。根据系统自身的描述，这些数据是“由用户的请求活动自动生成的”。它包括设备信息（屏幕尺寸、像素比、浏览器/作系统细节、暗/亮模式偏好）和使用模式（主题偏好、消息长度、对话深度、模型使用情况和近期活动水平）。
2. Recent Conversation Context 最近对话内容  
    最近对话内容模块会保存你最近与 ChatGPT 的对话记录，每次对话都有主题、选定的消息以及时间戳。就我而言，其中包含了我最近的 40 次对话。有趣的是，这里只显示用户的消息，并不包括助手的回复。

> 最近对话的格式： MMDDT[HH:MM] Conversation Topic: Your first message in that conversation Any follow-up messages you sent initially

这个“连续性日志”将过去的讨论与当前的对话连接起来。虽然没有明确的指示说明如何使用这些数据，但我们可以推测 OpenAI 加入它的原因。有数百万用户的使用数据，他们可能已经观察到人们与 ChatGPT 互动的某些模式 —— 比如注意到用户经常会在多个对话中处理相互关联的问题，却并未明确地将这些对话关联起来。

仅包含用户消息的选择从实用角度来看是合理的。

3. Model Set Context
	    当你对 ChatGPT 说“我对贝类过敏”时，它会将这句话存储为一个记忆条目，并在每次对模型的请求中提供给模型。这些记忆被存为简短的、带有时间戳的条目 —— 通常就是一句话。
	    用户可以完全控制这些记忆。通过设置界面，他们可以查看和删除这些条目。若要添加或编辑记忆，他们需要在与 ChatGPT 的对话中直接告知。与另外三个记忆模块不同，模型设定上下文中的所有内容都是透明的，用户可以直接管理。
	    当各个记忆模块之间出现冲突时，模型设定上下文将优先处理。它充当“事实来源”（source of truth）的角色 —— 就像一个补丁层，可以覆盖其他模块的信息。这么做是有道理的：如果你明确地告诉了 ChatGPT 某件事，那么这条信息应当凌驾于它从其他地方收集到的任何相矛盾的数据之上。
4. User Insight 用户洞察，这部分是维护用户的档案卡，来分析这个用户的偏好，职业等等个人信息
	用户知识记忆是 ChatGPT 记忆系统中高度浓缩的 AI 生成摘要，OpenAI 会定期根据对话历史生成它们。
	它们捕捉到的是模式，而不仅仅是事实。ChatGPT 知道我更喜欢 Airbnb、会仔细记录开支、而且热爱 Next.js —— 即使某些具体旅行从未发生或项目被放弃，这些真相依然成立



## 疑惑整理

Tool Result 我想要换成占位符，但是我担心 AI 在Reflect 的时候因为占位符收到影响。
