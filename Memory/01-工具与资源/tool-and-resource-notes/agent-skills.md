# Agent Skills（addyosmani/agent-skills）

来源：https://github.com/addyosmani/agent-skills

用途：一组“工程工作流”型 skills，用来指导 AI coding agent 在不同阶段如何做（写 spec / 拆任务 / 增量实现 / 测试 / code review / 上线等）。

## Skills 清单（21）

- using-agent-skills：发现/选择该用哪个 skill（meta-skill）
- idea-refine：把模糊想法做发散/收敛迭代，提炼成更清晰的方向
- spec-driven-development：先写规格/需求/验收标准，再开始编码
- planning-and-task-breakdown：把已有 spec 拆成可执行、按顺序的任务清单（含并行机会/估时）
- incremental-implementation：用“小步可落地”的方式实现跨多文件/较大改动
- api-and-interface-design：设计稳定 API/模块边界/类型契约（REST/GraphQL/前后端边界等）
- frontend-ui-engineering：做“可上线质量”的前端 UI（组件/布局/状态/交互/观感）
- source-driven-development：实现以官方文档/一手资料为准，避免过时写法
- test-driven-development：用测试驱动实现/修 bug/改行为，确保可证明正确
- browser-testing-with-devtools：在真实浏览器里用 DevTools 调试/验证（DOM/console/network/perf/视觉）
- debugging-and-error-recovery：系统化定位根因并修复（测试挂了、构建坏了、行为异常等）
- code-review-and-quality：多维度 code review（合并前质量把关）
- code-simplification：不改行为前提下做简化/重构，让代码更易读易维护
- performance-optimization：做性能诊断与优化（含 Core Web Vitals/加载/瓶颈 profiling）
- security-and-hardening：面向安全的加固（不可信输入、鉴权、存储、第三方集成等）
- deprecation-and-migration：弃用/迁移方案（移除旧系统/API/功能，迁移用户与兼容期）
- documentation-and-adrs：写文档与 ADR，记录架构决策/上下文
- ci-cd-and-automation：搭建/修改 CI/CD 流水线与自动化（质量门禁/部署策略等）
- git-workflow-and-versioning：规范 git 工作流（分支/提交/冲突/并行工作组织）
- shipping-and-launch：上线前准备与发布（检查清单、监控、灰度、回滚策略）

## 在 Codex 安装（本机）

安装策略：把仓库克隆到 `~/.codex/skills/agent-skills`，然后把每个 `skills/<name>` 软链到 `~/.codex/skills/<name>` 顶层；同时把 `references/` 软链到 `~/.codex/skills/references`，以兼容 SKILL.md 里的相对路径引用。

```bash
mkdir -p ~/.codex/skills
cd ~/.codex/skills
git clone https://github.com/addyosmani/agent-skills.git agent-skills

ln -sfn ~/.codex/skills/agent-skills/references ~/.codex/skills/references
for d in ~/.codex/skills/agent-skills/skills/*; do
  ln -sfn "$d" ~/.codex/skills/$(basename "$d")
done
```

