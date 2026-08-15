# Agent Team

## 1. Agent Team 怎么组成的

agent team = 1 个 leader + 0 到多个 teammates + 一套共享状态和消息协议

对 team 的定义不是“临时多开几个 agent”，而是“多个成员共享任务、可以互相通信、可以长期协作”。围绕共享 task list 和自动消息投递来协作.


## 2. Agnet Team 怎么工作的

### 2.1 创建 Agent Team

创建 team 时，系统会先把这套机制需要的基础数据准备好。这里最重要的有三样：成员名单、共享任务列表、还有 leader 自己在当前会话里看到的 team 状态。

成员名单存在 team file 里。它记录这个 team 有谁、谁是 leader、每个成员是什么类型、是不是还活着、在哪个 session 里。这个文件的作用是让 team 不是只存在于当前一轮对话里，而是有一份稳定的本地状态。

共享任务列表存在 tasks 目录里。它的作用是让多个成员看到同一份工作池。谁创建任务、谁领取任务、谁完成任务，都写到这套共享文件里。这样 leader 和 teammate 才能围绕同一批任务协作，而不是每个人各看各的待办。


新 teammate 加入的时候，需要登记到 team file 中。为了让后面的 mailbox、task list、权限处理、生命周期管理都知道“团队里有这个人”。这里有两层：一层是 team config，负责保存大家都能共享的成员信息；另一层是 leader 当前会话里的 teamContext，负责让当前这个 leader 知道现在该怎么使用这些成员信息。

把这个成员的身份参数带进 CLI，启动一个独立的 Claude Code session；如果是 in-process backend，就直接在当前进程里建一个隔离的 teammate runtime

process teammate 的第一条 prompt 不是在启动命令里直接塞进去，而是等 session 起好之后再通过 mailbox 发过去；in-process teammate 则是直接进入 runner。虽然启动方式不一样，但真正“加入 team”，是从它能用统一身份去读 team file、共享 task list、接入同一套 mailbox 协议开始的。

### 2.2 Agent Team 如何协同工作

team 协作主要靠两套东西。

第一套是共享 task list。它负责公开工作。任务先放到共享列表里，成员再去看能不能接。文章现在很谨慎，只把“成员自己扫描任务并认领”写成 in-process teammate 的直接事实，因为这个逻辑我也在 inProcessRunner.ts 里看到了。对于 process teammate，文章没有硬说“一定也这样轮询并认领”，这点处理是对的。

第二套是 mailbox。它负责控制类消息。比如 shutdown、plan approval、permission request、普通成员消息，都是通过 mailbox 来回传递。leader 这边的 useInboxPoller.ts 负责按消息类型分类处理。也就是说，team 不是靠共享内存合作，而是靠共享文件和消息文件合作。

mailbox 优先处理也在同一个文件的 waitForNextPromptOrShutdown(...) 里写得很清楚，甚至注释里直接说了：

- shutdown 要最高优先级，避免被别的消息饿死
- team-lead 的消息要优先于 peer 消息，因为它代表用户意图和协调命令
- peer-to-peer chatter 可能很多，不能把关键控制消息压住

这个顺序重要，是因为 mailbox 里的东西通常比 task pool 更“急”：

- shutdown_request 不先处理，成员可能本来该停却继续干活
- leader 的控制消息不先处理，成员可能会做错方向
- 权限、模式、审批这类消息不先处理，成员可能根本没法继续执行
- 只有这些控制面消息都没挡路了，才适合去任务池里接新活

---

我们通过，核心区别是“这个 teammate 运行在哪儿”，分为

- process teammate 是一个独立进程。通常会开新 pane、新终端，或者新子进程启动，所以它需要在启动参数里先把自己的身份带进去，不然这个新进程一开始不知道自己是谁。
- in-process teammate 不是新进程，它就在当前这个进程里跑，只是并发执行另一条 agent 任务。所以它没法靠 CLI 启动参数区分自己，只能在运行时给这条执行链挂一个隔离上下文，也就是 AsyncLocalStorage。

---
 四层分工
 - 有一层是 team config。这个东西主要管“这个 team 里有哪些成员，他们的身份是什么”。它得放在磁盘上，不然进程一重启，成员关系就断了。
- 有一层是 task list。这个东西主要管“现在有哪些公开任务，谁领了，谁做完了”。它要能被多个成员一起改，所以现在单独做成文件集合，还加了锁。
- 有一层是 mailbox。这个东西主要管“谁给谁发了什么控制消息”，比如关机请求、权限请求、计划审批这些。它和 task list 不是一回事，因为 task list 适合放公开状态，不适合放这种一来一回、谁发给谁很明确的消息。
- 还有一层是当前会话里的 AppState.teamContext。这层不是长期存档，它更像当前进程手边正在用的 team 视图。当前会话要不要轮询 inbox、按谁的名字收消息、自己是不是 leader，很多判断都靠它。
	- leader 更常拿它做整体 team 管理，比如 isTeamLead(teamContext)、维护 teammates、处理 inbox 控制流
	- 普通 teammate 也会有这份本地投影，但更多是为了让当前会话知道“我属于哪个 team、我是谁、lead 是谁”，这样 swarm 功能才能接起来


#### 2.2.2 怎么解决并发冲突的

执行上下文隔离，这样并发跑时不会因为全局变量互相污染（concurrent teammate execution without global state conflicts）。

同时实行任务系统的并发，防止两个 agent 抢同一个 Task。

项目本身支持 same-dir 和 worktree 两种模式；same-dir 是共用当前目录，worktree 是每个 session 一个独立 git worktree。：让多个 agent 先在不同工作副本里改，再由 leader 做 Git 级合并。




### 2.3 Agent Team 关闭

先通过 shutdown_request 让各个 teammate 正常停止，  等成员都停掉之后，再用 TeamDelete 清理整个 team。

所以应该先检查还有没有 active 成员。如果还有，它会拒绝清理，并提示先把 teammates 关掉。只有成员都不活跃了，才会真正删除 team 目录、清掉 task list 关联、清空 teamContext。