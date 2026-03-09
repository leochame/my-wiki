# How Build A Agent

## Memory

使用你的 Agent 让用户形成的习惯，才是这个 Agent 的护城河。

在这其中最终的就是Long Term Memory,  
1. 反思的呈现形式应该为自动进化的 Skill。一个用户如果拿通用Agent 做生产力提升。对于一个人，95%的情况下任务就那么几种，内化成 skill 确实是最合适的方法。之前一直考虑反思总结的任务种类如果过多，怎么办，现在想想每个人就那么几种任务类型，针对单个用户做就行。
2. 个人用户偏好，进行记录


Agent 这种长链路与环境强相关的情况下，其实用户是非常关键的。
有独特的数据飞轮，winsurf 和 cursor 使用较低成本训练模型


Remote Labor Index，远程劳动力指标。以这个 AI 系统完成的工作，是否让人愿意付款，并且分不清是人类还是AI 做的。

ChatBot 错了，一个是 Retry 重试，另一个是修改Prompt。
而对于 Agent ，是教，教他怎么做


通用的公用的失败模式，用户共识性的东西作为系统原生的一部分，用的人越多，失败率越低，完成任务的轮次开销越小。第一种数据飞轮。
第二种仍然拿用户的朴素反馈，和测试集之间是存在GAP的

作为通用 Agent 应该关注 Coding，错误能够自我意识到并且修复

模型不应该分类，分为输入和输出两个部分。
垂直 Agent 的话，很多信息不可能是来自于用户的主动提供的一个过程，输出也不是一个标准化的形式给出的，可能无缝传给另一个系统。和通用 Agent 有不同。


TOC 专业Agent，不应该给专业人士提供，而是非专业人士。比如：剪辑师对于其中一个环节缺失就会在意，从而这个 AGent 就是0分，而对于有剪辑需求的人做 Agent，给一个做不了的人做，他是一个净增益。
替换人的话，就是从 Risk Control 的角度考虑，应该从提升人的角度考虑。


专注具有高价值需求的人，去做最好的产品。而不是和 ChatGPT 抢夺最广的，最底层的用户群。


Agent 输出的不是一段话，而是一个 Action


未来 Agent 是主动性，主动的去做一些任务

Manus 持续优化头部体验，保持很强长尾能力的产品



Gemini 静态前端的美学方面非常领先。

服务高价值用户，价格不是核心竞争点。

互联网什么时候出现稳态，我觉得是用户时间瓜分完成的时候才是稳态。但是 AI 时代， AI Agent 可以异步执行，不回因为用户的总注意力市场产生瓶颈。


相信github 的一句话，每增加一个功能其实在稀释你之前所做的功能。

Anthropic 关注高经济价值的事情。


Gemini 不知道在 pre-tranning 解决了什么问题。多模态和数据的积累。Google 可能在信息方面和多模态方面会持续的领先。


XAI pixelIn pixelOut，直接生成一切。

关注多模态的输入，比如我查看当前结果其实是ToolResult


RLVR 本质上解决 Pass@1，让模型在一次推理中达到正确答案的概率更高。但是模型本身解决问题还是在于基座的质量。差一点的基座模型，多次采样，还是可以找到正确答案的，但这个只是类似搜索的方式解决这个问题。
latent 在大模型输出的过程中，没有smaple，近乎平行的维度同时考虑多种可能性

## 相关论文

### Coconut (Chain of Continuous Thought) - 田渊栋
**论文标题：** Training Large Language Models to Reason in a Continuous Latent Space  
**作者：** Shibo Hao, Sainbayar Sukhbaatar, DiJia Su, Xian Li, Zhiting Hu, Jason E Weston, Yuandong Tian  
**会议：** COLM 2025  
**链接：** https://openreview.net/forum?id=Itxz7S4Ip3

**核心内容：**
- 提出 Coconut（Chain of Continuous Thought）范式，让 LLM 在连续隐空间而非自然语言中进行推理
- 利用 LLM 最后隐藏层状态作为推理状态（"连续思想"），直接将其作为后续输入嵌入反馈给 LLM
- 连续思想可以编码多个替代推理步骤，使模型能进行广度优先搜索（BFS），而非 CoT 的确定性路径
- 在需要大量回溯的逻辑推理任务上优于 CoT，推理过程中思维 token 更少
- 与 RLVR 相关：都关注提升 Pass@1 性能，但 Coconut 通过隐空间并行推理而非采样

### FLAN-T5
**论文标题：** The Flan Collection: Designing Data and Methods for Effective Instruction Tuning  
**作者：** Shayne Longpre, Le Hou, Tu Vu, Albert Webson, Hyung Won Chung, Yi Tay, Denny Zhou, Quoc V Le, Barret Zoph, Jason Wei, Adam Roberts  
**发表：** ICML 2023  
**链接：** https://arxiv.org/abs/2301.13688

**核心内容：**
- 研究指令微调方法的设计决策，通过消融研究分析 Flan 2022 的开发过程
- 发现任务平衡和数据增强技术对有效指令微调至关重要
- 混合提示设置（零样本、少样本、思维链）训练能在所有设置中获得更强性能（+2%）
- Flan-T5 相比先前工作性能提升 3-17%+，且作为下游任务的起点检查点计算效率更高
- 公开了 Flan 2022 数据集、模板和方法：https://github.com/google-research/FLAN