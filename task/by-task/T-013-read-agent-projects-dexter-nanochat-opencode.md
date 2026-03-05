---
id: T-013
title: 阅读并梳理 Dexter / nanochat / OpenCode 这三个 Agent 项目源码
status: todo            # todo | in-progress | waiting | done | cancelled
due: 2026-03-05
priority: medium        # low | medium | high | urgent
---

## Description

明天安排一段高质量的深度阅读时间，把三个代表性的 Agent 项目源码过一遍，并做对比梳理：

- Dexter
- nanochat
- OpenCode

目标是从工程角度理解它们在 Agent 架构、工具体系、记忆/上下文管理、任务规划与执行等方面的设计取舍，并形成自己的设计 checklist。

## Next Actions

- [ ] 确认三个项目的代码仓库地址（GitHub / 文档等），本地 clone / 更新到最新版本
- [ ] 快速浏览各项目的 README / 架构文档，画出粗略模块图（手绘或简单文本均可）
- [ ] 选择其中一个项目（建议 Dexter 或你最感兴趣的），深入阅读核心 Agent 流程（请求入口 -> 计划 -> 工具调用 -> 结果汇总）
- [ ] 对比另外两个项目的关键差异：状态/记忆管理方式、工具/插件机制、并发与可靠性设计
- [ ] 在笔记中整理一份「Agent 工程实践要点」清单（例如：状态流转、错误重试、日志与监控、评估指标等）


