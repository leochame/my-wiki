## AI Practice（实践 / 工程）

记录偏实践、工程实现和经验分享类的 AI 文章。

---

### 别折腾造 Agent 了，Anthropic 说你该造 Skills

文章讨论 Anthropic 提出的“Skills”思路，认为相比堆砌复杂 Agent，构建清晰、可组合、可测试的技能（Skills）体系在工程实践中更可控、更易维护。

- 链接：`https://zhuanlan.zhihu.com/p/1982541366262257012`
- 状态：Unread
- 优先级：Medium
- 来源：知乎专栏

（读完后可以记录：在自己项目里，哪些地方应该从“Agent 堆叠”转向“Skills 组合”。）

---

### Effective context engineering for AI agents（Anthropic 工程文章）

Anthropic 的上下文工程实践总结，重点在“如何组织/压缩/刷新上下文”以减少 context rot，对做 Agent（尤其长链路、多工具、多轮）非常实用。

- 链接：`https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents#figure-1-context-rot-curve`
- 状态：Unread
- 优先级：High
- 来源：Anthropic Engineering

---

### AI agent 长期记忆：向量数据库存储历史（微信）

偏工程实践：如何用向量数据库存储历史对话/事件形成长期记忆，以及典型的召回与摘要策略。

- 链接：`https://mp.weixin.qq.com/s/uaKrTndOZFoq9oVRWs3G5g?scene=1&click_id=2`
- 状态：Unread
- 优先级：High
- 来源：微信公众号

---

### Manus 团队亲述：AI Agent 上下文工程实战经验（译）

团队实战视角的上下文工程经验，适合对照 Anthropic 的方法论做一次“原则 vs 经验”的交叉验证。

- 链接：`https://mp.weixin.qq.com/s/XHRXjrpbaswQmcbZFnM4kg`
- 状态：Unread
- 优先级：High
- 来源：微信公众号

---

### 货拉拉 MCP（Model Context Protocol）初体验

一篇 MCP 上手体验文章，适合用来了解 MCP 在业务侧落地时的实际感受与坑点。

- 链接：`https://mp.weixin.qq.com/s/2vUvbJJ785n3Aw8E9mcvKQ`
- 状态：Unread
- 优先级：Medium
- 来源：微信公众号

---

### Google AI Edge：`local_agents`（GitHub）

Google AI Edge 侧的本地 agents 示例/接口集合，适合快速看看“端侧/本地” agent 的 API 组织方式与能力边界。

- 链接：`https://github.com/google-ai-edge/ai-edge-apis/tree/main/local_agents`
- 状态：Unread
- 优先级：Medium
- 来源：GitHub

---

### 华人团队开源多智能体记忆系统 MIRIX（微信）

偏系统工程与开源实现：多智能体记忆系统的架构、效果与存储开销权衡（标题来自你提供的链接）。

- 链接：`https://mp.weixin.qq.com/s/qMYpIA5i1qu6pMJQSxSHVQ?scene=1&click_id=7`
- 状态：Unread
- 优先级：Medium
- 来源：微信公众号

---

### 周志华团队新作：首次理论证明 RL 对 LLM 有效性（微信）

偏“研究解读 + 工程启发”的文章：围绕 RL 在 LLM 上的有效性给出理论化阐释（标题来自你提供的链接）。

- 链接：`https://mp.weixin.qq.com/s/6ihvRxk6K_Wm1SaYPn-vAQ`
- 状态：Unread
- 优先级：Medium
- 来源：微信公众号

---

### LLM RAG 值得做吗？（知乎回答：CodeCrafter）

工程视角讨论 RAG 的投入产出与适用边界，适合作为“要不要做、怎么做得值”的决策参考。

- 链接：`https://www.zhihu.com/question/2818756749/answer/1948499915023038288`
- 状态：Unread
- 优先级：High
- 来源：知乎回答（CodeCrafter）

---

### RAG 基础理论概览（mingzilla/video-resource）

一个按标签整理的 RAG 基础理论与概览材料入口，适合用来系统补课或做团队学习清单。

- 链接：`https://github.com/mingzilla/video-resource/blob/main/labels/RAG/01__basic-theory-overview.md`
- 状态：Unread
- 优先级：Medium
- 来源：GitHub

---

### Deep Think With Confidence（视频）

你收藏的视频入口，主题看起来偏“如何更自信地推理/思考”（具体内容待补充）。

- 链接：`https://www.youtube.com/watch?v=s00fy5RkCHc`
- 状态：Unread
- 优先级：Low
- 来源：YouTube

---

### 多 Agent 编排方案：worker 负责澄清与取数，leader 负责任务划分与洞见集成（想法）

你记录的编排思路：用 worker agent 做单步骤澄清与数据获取，用 leader agent 做拆解与整合，并允许用户在界面侧反馈形成闭环；适合后续沉淀为一张“编排模式图 + 适用场景/反例”。

- 链接：`TBD`
- 状态：Unread
- 优先级：Medium
- 来源：个人笔记

---

### （待二次整理）微信文章链接合集（标题待补全）

这批链接目前缺少标题/摘要，先集中收口，后续你补充标题或我再按主题拆分到更细的条目里。

- 链接：`https://mp.weixin.qq.com/s/Gf-3MFX66E9bpYSOITnH_w`
- 相关链接：
  - `https://mp.weixin.qq.com/s/S0IO4HDDjnj71X87e2kNLw`
  - `https://mp.weixin.qq.com/s/Zoln_5MsawDAy_-yaa2vaw`
  - `https://mp.weixin.qq.com/s/LZcfYqHR2Zl6GnBtzLuMSg`
- 状态：Unread
- 优先级：Low
- 来源：微信公众号（待补全）

---

### （待二次整理）知乎文章链接（标题待补全）

- 链接：`https://zhuanlan.zhihu.com/p/1929258695524620197`
- 相关链接：
  - `https://zhuanlan.zhihu.com/p/1891449256340078887?share_code=1n3B9jSTzXBRA&utm_psn=1926726917547074499`
- 状态：Unread
- 优先级：Low
- 来源：知乎（待补全）


