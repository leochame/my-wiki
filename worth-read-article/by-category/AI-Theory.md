## AI Theory（理论与原理）

记录帮助理解 Transformer、注意力机制等理论与直觉的资料。

---

### 为什么 Transformer 需要 Multi-head Attention？（bigpunch 知乎回答）

从直觉和结构上解释 Transformer 中为什么需要使用 Multi-head Attention，说明多头注意力如何带来表达能力的提升，是理解注意力机制设计动机的高价值回答。

- 链接：`https://www.zhihu.com/question/341222779/answer/1983476328704542007`
- 状态：Unread
- 优先级：Medium
- 来源：知乎回答（bigpunch）

（读完后可以整理：自己对“多头”到底解决了什么问题的新理解。）

---

### How Attention Mechanism Works in Transformer Architecture（动画讲解）

通过非常清晰的动画演示 Self-Attention 机制，帮助从可视化角度理解注意力是如何在 Transformer 中工作的，适合作为直观入门资料或用于查漏补缺。

- 链接：`https://www.youtube.com/watch?v=KMHkbXzHn7s`
- 状态：Unread
- 优先级：Medium
- 来源：YouTube 教学视频

（可以记录：动画里哪个例子最帮助你建立了“注意力在干什么”的直觉。）

---

### 为什么我还是无法理解 Transformer？（知乎问答）

围绕“为什么我还是无法理解 Transformer？”这一困惑展开，尝试从更易懂的角度重新解释 Transformer 的核心结构和直觉，有助于补齐自己理解中的盲区。

- 链接：`https://www.zhihu.com/question/596771388/answer/1979919463718593963`
- 状态：Unread
- 优先级：Medium
- 来源：知乎问答

（读完后可以写下：回答中哪个比喻或解释最打通了你的卡点。）

---

### 《The Bitter Lesson / 苦涩教训》（Rich Sutton）

Sutton 的经典短文，核心观点是：长期来看，能充分利用计算与数据的通用方法往往胜过依赖人类先验的手工设计；对做 Agent / RAG / 训练路线的取舍很有启发。

- 链接：`http://www.incompleteideas.net/IncIdeas/BitterLesson.html`
- 状态：Unread
- 优先级：High
- 来源：个人博客（Rich Sutton）

---

### Chain-of-thought prompting elicits reasoning in large language models

CoT 的代表性论文之一：展示在合适的提示与示例下，LLM 能显著提升多步推理能力，是理解 “显式推理轨迹” 的重要起点。

- 链接：`https://arxiv.org/abs/2201.11903`
- 状态：Unread
- 优先级：High
- 来源：arXiv

---

### Large language models are zero-shot reasoners

“Let’s think step by step” 等 zero-shot reasoning 工作的代表论文之一，展示零样本条件下触发推理能力的提示方法与适用边界。

- 链接：`https://arxiv.org/abs/2205.11916`
- 状态：Unread
- 优先级：High
- 来源：arXiv

---

### Self-Consistency Improves Chain of Thought Reasoning in Language Models

Self-consistency：对同一问题采样多条推理链并投票/聚合，从而提升正确率；是 CoT 时代很实用的推理增强基线方法。

- 链接：`https://arxiv.org/abs/2203.11171`
- 状态：Unread
- 优先级：High
- 来源：arXiv

---

### Markovian thinker：算力成本下降、马尔科夫链（待补全）

你记录的一个概念/材料入口（可能在讨论“算力成本下降”背景下的推理/搜索/马尔科夫过程直觉），先占位，后续补全原文链接与要点。

- 链接：`TBD`
- 状态：Unread
- 优先级：Medium
- 来源：待补全


