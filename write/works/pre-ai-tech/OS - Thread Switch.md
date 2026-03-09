# xv6 操作系统中线程切换是怎么样子的

当进程数多于 CPU 核心数时，操作系统需要让多个进程复用硬件 CPU，给每个进程提供拥有独立 CPU 的错觉。

CPU 切换进程的两种场景：
1. 阻塞式切换：进程在等待 I/O、锁或主动休眠时让出 CPU
2. 抢占式切换：CPU 计算密集型任务的时间片用完，强制切换

## 线程切换的核心组件

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742224117577-35b4ca8d-489d-417b-8daf-f3dd22a45c5a.png)

### Scheduler Thread 

xv6 为每个 CPU 核心创建独立的调度线程（保存专用寄存器和栈），通过轮询进程表（`ptable`）选择可运行的`RUNNABLE`进程，通过两次上下文切换完成进程调度。

设计原因：
1. 内核栈安全：避免调度程序在旧进程的内核栈上运行时，其他 CPU 唤醒该进程导致栈数据混乱
2. 多核并发安全：隔离调度线程上下文，确保多 CPU 并行执行调度逻辑而不产生锁冲突
3. 状态隔离：调度线程持有固定上下文（`struct cpu`中的`context`），独立于用户进程

### 上下文切换（Context Switching）机制

#### sched() 和 swtch()

进程调用`sched()`进行上下文切换前必须满足：
1. 持有进程锁`p->lock`
2. 释放其他所有锁（通过`mycpu()->ncli == 1`校验）
3. 更新进程状态为`RUNNABLE`
4. 禁用中断

`sched`会再次检查上述要求，然后调用`swtch`保存当前上下文到`p->context`，切换到调度程序的`cpu->context`。

`swtch()`由汇编实现，仅操作寄存器组，不感知线程状态：

```z80
# RISC-V实现（kernel/swtch.S）
swtch:
  sd ra, 0(a0)     # 保存返回地址
  sd sp, 8(a0)
  ...              # 保存其他寄存器
  ld ra, 0(a1)     # 加载新上下文
  ld sp, 8(a1)
  ...              # 恢复其他寄存器
  ret              # 跳转到新ra地址
```

返回地址寄存器决定切换后的执行流：
- 进程→调度器：保存`sched()`调用点，恢复`scheduler()`循环中的`swtch`返回点
- 调度器→新进程：恢复目标进程的`p->context`中保存的地址

在 xv6 中，一个 CPU 上的内核线程只能切换到该 CPU 对应的调度器线程。`swtch`恢复调度器线程保存的寄存器和栈指针后，在调度器线程的 context 下执行`scheduler`函数。调度器将当前进程设为`RUNNABLE`，遍历进程表找到下一个`RUNNABLE`进程，再次调用`swtch`完成切换。

### 特殊场景处理

#### 新进程的首次调度

`allocproc()`设置新进程的`context->ra`为`forkret`，使得首次切换时绕过`sched()`的正常返回路径，直接执行`forkret`释放进程锁。

```c
// 初始化代码（kernel/proc.c）
static struct proc* allocproc(void) {
  ...
  p->context->ra = (uint)forkret;  // 特殊返回路径
  p->context->sp = p->kstack + KSTACKSIZE;
}
```

#### 协程式切换模式

xv6中`sched()`与`scheduler()`形成协程关系：`sched() → scheduler() → sched()`循环，通过`swtch`的交替调用形成"接力棒传递"的执行流。

### 关键设计约束

`sched()`在切换前进行严格状态验证：

```c
void sched(void) {
  if(!holding(&ptable.lock)) panic("sched ptable.lock");
  if(mycpu()->ncli != 1) panic("sched locks"); 
  if(p->state == RUNNING) panic("sched running");
  if(readeflags()&FL_IF) panic("sched interruptible");
}
```

- ptable锁：确保进程状态修改的原子性
- 中断状态：必须处于关中断状态（通过`pushcli/popcli`计数校验）

旧进程在`sched()`中获取`ptable.lock`，调度器线程在切换后释放该锁。

### 总结流程

1. 用户态→内核态：通过系统调用/中断陷入内核，保存用户寄存器到`trapframe`
2. 内核线程→调度线程：通过`swtch`保存当前内核上下文到`proc->context`，切换到调度器的`cpu->scheduler`上下文
3. 调度决策：调度器遍历进程表，选择`RUNNABLE`进程，更新其状态为`RUNNING`
4. 调度线程→新进程内核线程：再次`swtch`加载目标进程的`proc->context`
5. 返回用户态：通过`trapret`恢复用户寄存器，完成整个切换周期

# Linux 系统的进程切换又是怎么样的？

Linux 内核不严格区分进程和线程，调度的基本单位是`task_struct`（任务）。进程和线程的区别在于是否共享`mm_struct`（地址空间）等资源。线程切换的本质是内核调度器选择另一个`task_struct`来占用 CPU，并进行上下文切换。

## 何时切换（触发时机）

1. **内核抢占 (Preemption)**：当前线程被动被换下
   - 时间片用完：CFS 使用基于`vruntime`的公平调度算法，时钟中断时判断线程是否用超配额，如果需要让出 CPU，内核会设置一个“需要重新调度”的标志（`TIF_NEED_RESCHED`），在安全点触发调度。
   - 更高优先级任务就绪：高优先级线程被唤醒后，CFS 根据权重和`vruntime`比较，触发抢占式切换

2. **主动让出 (Voluntary Yield)**：线程主动放弃 CPU
   - 阻塞式系统调用：等待 I/O、等待锁、主动休眠（`sleep()`/`yield()`）
   - 线程被置为休眠状态（如`TASK_INTERRUPTIBLE`），内核在阻塞路径中调用`schedule()`让出 CPU

## 如何切换

触发切换后陷入内核态，调用`schedule()`挑选下一个任务，执行上下文切换。

假设线程 A 切换到线程 B：

1. **中断/系统调用入口**
   - 硬件中断或系统调用触发，CPU 切换到内核态
   - 硬件保存 PC/标志等寄存器，Linux 中断入口代码将这些状态安置到当前任务的内核栈

2. **调用`schedule()`函数**
   - 内核态执行路径上检查`TIF_NEED_RESCHED`标志，调用`schedule()`。
   说明：`TIF_NEED_RESCHED` 是一个“需要重新调度”的标志，内核会在多处检查它，一旦发现需要，就调用 `schedule()` 触发调度。
   - `schedule()` 主要就是挑选下一个线程运行。比如：它会调用调度器类（如 CFS）的`pick_next_task`方法，选出线程 B

2. **执行`context_switch()`函数**，是上下文切换的核心。它接收当前任务 `prev` 和下一个任务 `next` 作为参数。
   - **切换虚拟内存空间**（`switch_mm()`）：更新页表基址寄存器（也就是记录“当前使用哪一份页表”的寄存器），让 CPU 按新任务的地址空间转换虚拟地址。同一进程内的线程切换会跳过此步（共享`mm_struct`），这是线程切换比进程切换快的核心原因
   - **切换处理器状态**（`switch_to()`）：由平台相关汇编实现。异常/中断入口代码已将 PC/标志位和大部分通用寄存器压入内核栈（`pt_regs`结构）。`switch_to()`只保存/恢复内核需要长期持有的上下文（callee-saved 寄存器、内核栈指针、线程本地寄存器等），通过`task_struct->thread`/`thread_info`关联。从 A 切到 B 时，保存 A 的"内核线程上下文"，恢复 B 的寄存器和内核栈指针

4. **恢复执行**
   - 切换内核栈指针并恢复"内核线程上下文"寄存器后，内核执行上下文变为线程 B 的。`switch_to()`在 B 的内核调用路径上"返回"，继续执行 B 上次调用调度后的内核代码

5. **返回到用户态**
   - 中断或系统调用处理完毕，执行架构相关的返回指令，从内核栈恢复用户态上下文（弹出`pt_regs`中的用户态 PC 和 SP 等）。CPU 控制权交还给线程 B 的用户态程序

## 性能考虑

进程切换时，如果切换到不同地址空间，内核需要更新页表基址寄存器，导致 TLB（Translation Lookaside Buffer）条目失效或被刷新，带来性能损耗。TLB 是硬件缓存"虚拟地址 → 物理地址"转换结果的加速结构。

在多处理器系统上，多级 CPU Cache 的一致性开销也会放大频繁进程切换的成本：不同核上的进程频繁切换、访问共享数据时，Cache 一致性协议带来额外的总线流量和延迟。
