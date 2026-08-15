本篇文章先从 CPU 的三级缓存讲起，再讲解三级缓存带来的缓存不一致的挑战，最后讲到 Java 中的多线程同步方式。

## CPU 的三级缓存是什么

我们先来看看 CPU 的三级缓存

CPU Cache 通常分为三级缓存：L1 Cache、L2 Cache、L3 Cache，级别越低的离 CPU 核心越近，访问速度也快，但是存储容量相对就会越小。

在多核心的 CPU 里，每个核心都有各自的 L1/L2 Cache，而 L3 Cache 是所有核心共享使用的。

![](https://cdn.xiaolincoding.com/gh/xiaolincoder/ImageHost2/%E6%93%8D%E4%BD%9C%E7%B3%BB%E7%BB%9F/%E5%AD%98%E5%82%A8%E7%BB%93%E6%9E%84/CPU-Cache.png "null")

当程序在运行过程中，会将运算需要的数据从主存复制一份到CPU的高速缓存当中，那么CPU进行计算时就可以直接从它的高速缓存读取数据和向其中写入数据，当运算结束之后，再将高速缓存中的数据刷新到主存当中。

## MESI 协议

在三层缓存的情况下，这样就会带来多核 CPU 下的缓存一致性问题。对于 CPU 的缓存一致性的挑战，我们给出了 MESI 的解决方法。通过标记数据是独占还是共享，在共享的时候是失效的还是没有失效的来达到缓存一致的目的。

我们这里来简单看下 MESI 协议执行流程：

1. CPU 0 试图更新缓存。
2. 发起 Invalidate 消息广播占用总线。
3. CPU 1 接收到 invalidate 广播，使其无效，CPU 1 向 CPU 0 发送 ACK。
4. CPU 0 最后会收到 invalidate ACK，表明其他核心都接收到了广播消息，这时候 CPU 0 再更新自己对应缓存为 Modify 状态。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742024612936-ba169d15-fe84-4484-a944-7f055aebba1d.png)

图片来源：[從硬體觀點了解 memory barrier 的實作和效果](about:blank)

但是我们可以清晰看到 MESI 的问题所在：

1. 如果 CPU 0 发出了多个相互之间无依赖的指令，进行串行化操作阻塞就变得非常低效。
2. 如果 CPU 1 发生阻塞，一直不返回 ACK，CPU 0 也会被动阻塞。

为了解决上述的问题，后来就引入了 Store Buffer 和 Invalidate Queue。

- 有了 StoreBuffer，处理器将多条指令不按照程序规定的顺序分开发送给各个相应的电路单元进行处理。
- 有了 Invalidate Queue，CPU1 可以立即回复 invalidate ack 消息给发出广播的 CPU 0，之后 invalidate queue 再异步执行将缓存行失效。

其实在这里我们也可以看出这是一个典型的 CAP 问题，通过 StoreBuffer 和 Invalidate Queue异步处理，这种设计牺牲了强一致性（Consistency）来保障可用性（Availability）和分区容忍性（Partition Tolerance），使得强一致变为了最终一致性。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742024520231-06f577ef-ca2d-4a4a-8d39-c74444085d35.png)

图片来源：[從硬體觀點了解 memory barrier 的實作和效果](about:blank))

## 我们来简单介绍下 JMM 为后面的 Volatile 做个铺垫

《Java 虚拟机规范》尝试定义一种“Java 内存模型”来屏蔽硬件和操作系统底层的内存访问差异。

Java 内存模型规定所有变量存储在主内存中，每条线程都有自己的工作内存，线程的工作内存中保存了该线程使用的变量的主内存副本。

从两个层次看下 JMM 对应关系：

从 Java 内存区域来说（勉强对应），1️⃣主内存主要对应于 Java 堆中的对象实例数据部分，2️⃣工作内存对应于虚拟机栈中的部分区域。

基础层次来说，1️⃣主内存对应物理硬件内存，2️⃣工作内存优先存储于寄存器和高速缓存中。

---

## Volatile 的可见性和原子性介绍

明白了 JMM，我们接下来看看 volatile 的可见性是怎么根据 JMM 的结构实现的 。

首先我们给出一个这样的结论：从物理存储角度出发，volatile 变量在各个线程工作内存中是可以存在不一致的情况。

实现可见性的关键在于每次读取之前先刷新，每次读取必须重新从主内存加载最新值，变量修改后同步回主内存，执行引擎看不到不一致的情况，因此可认为不存在不一致的问题。

---

volatile 还有一个关键的特性就是禁止指令重排序。

我们来看下面这段代码：

```
// 共享锁对象
private final Object lock = new Object();
private Map configOptions;
private char[] configText;
private volatile boolean initialized = false;

// 线程A执行
void initConfig() {
    configOptions = new HashMap();
    configText = readConfigFile(fileName);
    processConfigOptions(configText, configOptions);
    initialized = true;
}

// 线程B执行
void useConfig() {
    doSomethingWithConfig();
}
```

如果 `initialized` 不加上 volatile 关键字修饰，那么就会可能由于指令重排序的优化，导致位于线程 A 的最后的`initialized = true;`提前执行，这样线程 B 执行，就会导致错误的发生。

---

我们先来看看指令重排序是什么？

指令重排序从硬件角度来说处理器将多条指令不按照程序规定的顺序分开发送给各个相应的电路单元进行处理。

指令重排其实都是因为 storeBuffer 和 invaildQueue 造成的。

当然，并不是允许指令任意重排，处理器要正确处理指令依赖情况保障程序能得出正确的执行指令。

而 volatile 的有序性正是禁止编译器进行指令重排序。

---

## volatile 的有序性和原子性是怎么实现的？

我们开看看《深入理解 Java 虚拟机》中对 volatile 可见性和有序性的探讨，内容已简化：

有 volatile 修饰的变量，赋值后多执行了一个`lock addl #0x0, (%esp)`的操作。

`lock addl #0x0, (%esp)`操作的作用相当于一个内存屏障。

- `lock`把本处理器的缓存写进内存。
- 该写入动作也会引起其他内核或者其他处理器无效化其缓存。

这里操作的关键在于`lock`前缀，它的作用是将本处理器的缓存写入内存，该写入动作会引起别的处理器或者内核无效化其缓存，相当于对缓存中的变量做了一次 Java 内存模型中的`store`和`write`，使得前面 volatile 变量的修改对其他处理器立即可见。

`lock addl #0x0, (%esp)`把修改同步到内存中，这意味着所有之前的操作都已经执行完成，这样就形成了“指令重排序无法越过内存屏障”的效果。

一开始这段话的时候其实是难以理解的，现在我们可以从 CPU 的角度去理解这段话。

Volatile 的有序性是利用CPU提供了读、写屏障指令实现的：

- 写屏障（Store Barrier）保证屏障前的所有写操作完成后才能执行屏障后的写操作；让 storebuffer 内的数据刷新为 cache
- 读屏障（Load Barrier）保证屏障后的读操作前先完成屏障前的所有读操作，让 invaildQueue 中数据全部得到处理。

所以最终使得写核心store buffers的值能立即写入缓存行，其他共享核心能立即处理失效请求（清空无效化队列），避免多核心操作多个变量导致的看似“重排序”情况

## 参考文章

1. 從硬體觀點了解 memory barrier 的實作和效果 ：[ https://medium.com/fcamels-notes/從硬體觀點了解 - memry-barrier - 的實作和效果 - 416ff0a64fc1 ]
2. 小林 Coding - CPU 缓存一致性：[ https://xiaolincoding.com/os/1_hardware/cpu_mesi.html#mesi-%E5%8D%8F%E8%AE%AE ]