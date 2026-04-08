`ThreadPoolExecutor` 的线程安全，核心不是“加了一把大锁”，而是把不同问题拆开处理：`ctl` 负责状态和线程数量，`mainLock` 负责 `workers` 集合，任务排队交给 `BlockingQueue`。下面直接结合源码来看。

## 一、线程安全的核心设计

### 1.1 状态与数量的原子控制

```Java
private final AtomicInteger ctl = new AtomicInteger(ctlOf(RUNNING, 0));
```

*   使用 `AtomicInteger` 类型的 `ctl` 变量
*   高3位存储线程池状态（RUNNING/SHUTDOWN/STOP等）
*   低29位存储工作线程数量

### 1.2 全局锁机制

```Java
private final ReentrantLock mainLock = new ReentrantLock();
```

*   `mainLock` 主要保护 `workers` 集合和统计信息

### 1.3 线程安全的任务队列

*   使用 `BlockingQueue` 实现任务入队和出队
*   常见实现有 `LinkedBlockingQueue`、`ArrayBlockingQueue`

***

## 二、线程池并发安全的三层分工

先把这三层说清楚：

1. 第一层：`ctl` 负责状态和线程数量
2. 第二层：`mainLock` 负责 `workers` 集合和整体一致性
3. 第三层：`Worker` 自己的锁负责单个线程的执行状态

### 2.1 第一层：`ctl` 负责状态和线程数量

```Java
public void execute(Runnable command) {
    // 状态校验...
    if (workerCountOf(c) < corePoolSize) {
        if (addWorker(command, true))  // 原子操作
            return;
        // ...
    }
    // ...
}
```

*   `addWorker()` 负责控制线程创建过程
*   线程数量递增主要靠 CAS 完成

线程创建不是全程加锁。源码里先用 CAS 增加 `workerCount`，只有在把 `Worker` 放进 `workers` 集合时才使用 `mainLock`。这样锁的范围比较小。

#### 2.1.1 `addWorker()` 里的计数控制

```Java
    private boolean addWorker(Runnable firstTask, boolean core) {
        retry:
        // 外层循环检查线程池状态
        for (;;) {
            int c = ctl.get();
            int rs = runStateOf(c);

            // 1. 检查线程池状态是否允许创建新线程
            if (rs >= SHUTDOWN &&! (rs == SHUTDOWN &&firstTask == null &&! workQueue.isEmpty()))
                return false;
            // 内层循环检查工作线程数量
            for (;;) {

                // 2. 获取工作线程数量，并判断是否超标
                int wc = workerCountOf(c);
                if (wc >= CAPACITY ||wc >= (core ? corePoolSize : maximumPoolSize))
                    return false;

                // 3. CAS 增加 workerCount
                if (compareAndIncrementWorkerCount(c))
                    break retry;
                c = ctl.get();  // Re-read ctl

                // 4. 如果线程池状态变了，回到外层重试
                if (runStateOf(c) != rs)
                    continue retry;
                // else CAS failed due to workerCount change; retry inner loop
            }
        }
```

### 2.2 第二层：`mainLock` 负责 `workers` 集合和整体一致性

`mainLock` 不负责整个线程池流程，它主要保护 `workers` 集合和相关统计信息。

#### 2.2.1 `Worker` 真正加入线程池，是在这一步完成的

```Java
        // 新线程是否已经启动、是否已经加入 workers 集合
        boolean workerStarted = false;
        boolean workerAdded = false;
        Worker w = null;
        try {
            // 1. 通过线程工厂创建线程
            w = new Worker(firstTask);
            final Thread t = w.thread;
            if (t != null) {
                final ReentrantLock mainLock = this.mainLock;
                // 2. 加锁，把 Worker 放进 workers 集合前再检查一次状态
                mainLock.lock();
                try {
                // 2.1 再次检查线程池状态
                    int rs = runStateOf(ctl.get());
                    if (rs < SHUTDOWN ||
                            (rs == SHUTDOWN && firstTask == null)) {
                        // ThreadFactory 不应该返回一个已经启动的线程
                        if (t.isAlive())
                            throw new IllegalThreadStateException();
                        // 3. Worker 加入 workers 集合
                        workers.add(w);

                        // 4. 更新 largestPoolSize
                        int s = workers.size();
                        if (s > largestPoolSize)
                            largestPoolSize = s;
                        workerAdded = true;
                    }
                } finally {
                    mainLock.unlock();
                }
                // 5. 加入集合成功后再启动线程
                if (workerAdded) {
                    t.start();
                    workerStarted = true;
                }
            }
        } finally {
            // 启动失败时回滚：移除 Worker，并把 workerCount 减回去
            if (! workerStarted)
                addWorkerFailed(w);
        }
```

前面 `addWorker()` 的这第二段代码，就是这一层的典型用法：先加锁，再把 `Worker` 放进 `workers` 集合，同时更新 `largestPoolSize`。

这一层的重点不是提高并发度，而是保证这些共享结构在修改时保持一致。

### 2.3 第三层：`Worker` 自己的锁负责执行状态

`Worker` 继承 AQS，实现了一把独占锁。它的作用不是保护共享队列，而是区分当前线程是不是正在执行任务。

```Java
protected boolean tryAcquire(int unused) {
    if (compareAndSetState(0, 1)) {
        setExclusiveOwnerThread(Thread.currentThread());
        return true;
    }
    return false;
}

protected boolean tryRelease(int unused) {
    setExclusiveOwnerThread(null);
    setState(0);
    return true;
}

public void lock()        { acquire(1); }
public boolean tryLock()  { return tryAcquire(1); }
public void unlock()      { release(1); }
```

#### 2.3.1 执行任务前后，用 `Worker` 锁标记状态

看 `runWorker()` 更容易理解这把锁的作用。

```Java
final void runWorker(Worker w) {
    Thread wt = Thread.currentThread();
    Runnable task = w.firstTask;
    boolean completedAbruptly = true;
    try {
        while (task != null || (task = getTask()) != null) {
            w.lock();  // 获取Worker锁
            try {
                beforeExecute(wt, task);
                try {
                    task.run();
                } finally {
                    afterExecute(task, null);
                }
            } finally {
                task = null;
                w.completedTasks++;
                w.unlock();  // 释放锁
            }
        }
        completedAbruptly = false;
    } finally {
        processWorkerExit(w, completedAbruptly);
    }
}
```

执行任务前先加锁，执行完再解锁。这样关闭线程池时，就可以区分某个 worker 是正在跑任务，还是正空闲着等任务。

#### 2.3.2 关闭线程池时，靠这把锁区分空闲和忙碌

再看关闭 worker 时的中断逻辑：

```Java
void interruptIfStarted() {
    Thread t;
    if (getState() >= 0 && (t = thread) != null && !t.isInterrupted()) {
        try {
            t.interrupt();
        } catch (SecurityException ignore) {
        }
    }
}
```

### 2.4 状态切换：`ctl` 负责推进生命周期

```Java
private void advanceRunState(int targetState) {
    for (;;) {
        int c = ctl.get();
        if (runStateAtLeast(c, targetState) ||
            ctl.compareAndSet(c, ctlOf(targetState, workerCountOf(c))))
            break;
    }
}
```

*   使用 CAS 保证状态转换的原子性
*   状态转换顺序是 `RUNNING -> SHUTDOWN -> STOP -> TIDYING -> TERMINATED`

***

## 3. 性能和安全是怎么兼顾的

### 3.1 锁粒度优化

*   `Worker` 使用独立锁
*   全局锁主要用于 `workers` 集合修改

### 3.2 无锁化设计

```Java
private boolean compareAndIncrementWorkerCount(int expect) {
    return ctl.compareAndSet(expect, expect + 1);
}
```

*   用 CAS 处理高频计数更新
*   减少不必要的锁竞争

### 3.3 内存可见性保障

*   `volatile` 修饰关键配置字段
*   保证配置变更对工作线程可见

***

## 4. 从源码中收获什么？

从源码里可以直接看出几个设计点。

### 4.1 状态优先原则

```Java
if (isRunning(c) && workQueue.offer(command)) {
    // ...
}
```

*   状态判断优先于数量判断

### 4.2 失败回退机制

```Java
if (!workQueue.offer(command)) {
    if (!addWorker(command, false))
        reject(command);
}
```

### 4.3 拒绝策略是最后一道边界

*   当线程数和队列都到上限时，交给拒绝策略处理
