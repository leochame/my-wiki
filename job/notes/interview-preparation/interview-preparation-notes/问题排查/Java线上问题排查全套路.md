### 先确定是不是发布故障

绝大部分是发布故障引起的，服务熔断，不一定服务挂，限流，不一定都挂。

运营商确定活动节奏，做流量预先排练。理清依赖关系，一个服务可能依赖另一个服务。

摘流，摘流的机器过于多了，正常机器造成压力

线上故障主要会包括 cpu、磁盘、内存以及网络问题。

同时例如 `[jstack](https://zhida.zhihu.com/search?content_id=253084942&content_type=Article&match_order=1&q=jstack&zhida_source=entity)`、`[jmap](https://zhida.zhihu.com/search?content_id=253084942&content_type=Article&match_order=1&q=jmap&zhida_source=entity)` 等工具也是不囿于一个方面的问题的，基本上出问题就是 `df`、`free`、`[top](https://zhida.zhihu.com/search?content_id=253084942&content_type=Article&match_order=1&q=top&zhida_source=entity)` 三连，然后依次 `jstack`、`jmap` 伺候，具体问题具体分析即可。

大部分都是不规范的查询导致大片对象占用

## 一、死锁

### (一) Java 死锁

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1749705791092-7453fae2-0e58-4674-aef5-089a59182b94.png)

#### JSP 配合 Jstack 查看死锁

1. 使用 **jsp** 查找程序进行

jps 是 jdk 提供的一个工具，可以查看正在运行的 java 进程。

```
➜  ~ jps 
57248 Jps
56736 Launcher
56737 DeadLock  # 死锁演示进程
59618
```

2. 使用 **jstack** 查看线程堆栈信息

jstack 是 jdk 提供的一个工具，可以查看 java 进程中线程堆栈信息。

```
➜  ~ jstack 56737
```

![](https://cdn.nlark.com/yuque/0/2025/webp/40540759/1749705933626-cd9c152e-8c4a-44b9-84cf-c930520d5fd4.webp)

从上面的堆栈信息中我们可以发现这个内容：`Found one Java-level deadlock`，表示程序中发现了一个死锁，后面包含更多详细的信息，从上可以看出死锁的数量以及死锁在代码中出现的位置。

#### 通过 jdk 的工具 jconsole 排查死锁问题

jconsole 是 jdk 提供的一个可视化的工具，方便排查程序的一些问题，如：程序内存溢出、死锁问题等等。更详细的用法见文档最后。

jconsole 位于 jdk 的 bin 目录中`➜ bin ./jconsole`

1. 图 1 可以看到我们的程序，点击 connect。
2. 图 2 在 jconsole 窗口中查看线程堆栈信息。
3. 图 3 点击 DetectDeadlock 可以查看详细的死锁信息，和 jstack 展示的类似。

![](https://cdn.nlark.com/yuque/0/2025/webp/40540759/1749706083786-ec07a7d2-71a4-40ca-bb3d-d3204f0a9fd2.webp "图片1")

![](https://cdn.nlark.com/yuque/0/2025/webp/40540759/1749706095352-c96b0bae-7d32-4d77-a97e-c38abc0b9031.webp "图片2")

![](https://cdn.nlark.com/yuque/0/2025/webp/40540759/1749706104303-1bf86ac6-dce9-4505-a256-7e2d27f34967.webp "图片3")

### (二) MySQL 死锁

## 二、非死锁问题

### (一) CPU 问题排查

我们先用`ps`命令找到对应进程的pid(如果你有好几个目标进程，可以先用top看一下哪个占用比较高)。

接着用`top -H -p [pid]`来找到cpu使用率高的线程。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742297257897-9fea11fb-c26a-4e80-a425-aca873588263.png?x-oss-process=image%2Fcrop%2Cx_0%2Cy_0%2Cw_1339%2Ch_376)

然后将占用最高的 pid 转换为16进制`printf '%x\n' pid`得到 nid。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742297260578-375f25d2-c779-47fb-96b4-e8befec30d8f.png?x-oss-process=image%2Fcrop%2Cx_0%2Cy_0%2Cw_435%2Ch_74)

接着直接在 **jstack 中找到相应的堆栈信息****：**`jstack pid | grep '[nid]' -C5 –color`**。**

`jstack pid` 是用来生成Java进程的线程快照

`nid` 是线程ID的十六进制表示，｜ 管道符的作用是将前一个命令的输出作为后一个命令的输入。

grep 过滤出包含 `nid` 的行

-C5参数:是显示匹配行的前后5行上下文，--color是让匹配的关键词高亮显示，方便识别

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742297269389-d42ad900-5d34-4c30-ab8e-3c74342c2a40.png?x-oss-process=image%2Fcrop%2Cx_0%2Cy_0%2Cw_1440%2Ch_272)

可以看到我们已经找到了nid为0x42的堆栈信息，接着只要仔细分析一番即可。当然更常见的是我们对整个 jstack 文件进行分析，通常我们会比较关注 **WAITING、TIMED_WAITING、BLOCKED** 。

使用命令`**cat jstack.log | grep "java.lang.Thread.State" | sort -nr | uniq -c**`来对 jstack 的状态有一个整体的把握，如果 WAITING 之类的特别多，那么多半是有问题啦。

- `cat jstack.log`：读取jstack的输出文件。
- `grep "java.lang.Thread.State"`：过滤出线程状态的行。
- `sort -nr`：按数字逆序排序，可能为了统计数量多的状态排前面。
- `uniq -c`：统计每种状态出现的次数。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742297304597-c70240a1-0ae4-4f56-961f-cf1a6288e041.png?x-oss-process=image%2Fcrop%2Cx_0%2Cy_0%2Cw_1266%2Ch_189)

#### 1. 频繁 GC

当然我们还是会使用 jstack 来分析问题。

但有时候我们可以先确定下 gc 是不是太频繁，使用`jstat -gc [pid] 1000` 命令来对 gc 分代变化情况进行观察：1000 表示采样间隔(ms)，S0C/S1C、S0U/S1U（两个 Survivor 区），EC/EU（Eden 区），OC/OU（老年代），MC/MU（元数据区的容量和使用量）。

- `jstat`：JDK 自带的 JVM 统计工具，用于分析堆内存、GC 行为等运行时指标。
- `-gc`：指定查看垃圾回收相关的内存和 GC 统计信息。

YGC/YGT、FGC/FGCT、GCT则代表 YoungGC、Full GC 的耗时和次数以及总耗时。如果看到 GC 比较频繁，再针对 GC 方面做进一步分析。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742297339907-eafc3601-b697-46ff-9965-975ece712990.png)

---

#### 2. 上下文切换

针对频繁的上下文切换问题，我们可以使用`vmstat`**命令查看上下文切换的次数**

`vmstat`（Virtual Memory Statistics）是Linux/Unix系统中用于监控系统整体性能的轻量级工具，主要功能覆盖**进程、内存、交换空间、磁盘I/O和CPU活动**的实时统计

cs (context switch) 一列则代表了上下文切换的次数。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1743248286876-29801ba6-04c7-4b36-8809-5f36a2edd2c6.png)

如果我们希望对特定的pid进行监控那么可以使用 `**pidstat -w [pid]**`命令， cswch 和 nvcswch 表示自愿及非自愿切换。

- `pidstat`：Linux 性能分析工具，属于 `sysstat` 工具包的一部分，需提前安装（如 `sudo apt install sysstat`）。
- `-w`：指定显示上下文切换统计信息。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742562737938-11db3c0e-9d12-43ea-9230-8bc5d7dce2ec.png?x-oss-process=image%2Fcrop%2Cx_0%2Cy_0%2Cw_922%2Ch_343)

### (二) 磁盘

#### 1. 文件系统状态

磁盘问题和 cpu 一样是属于比较基础的。首先是磁盘空间方面，我们直接使用 `df -hl` 来查看文件系统状态。

- `df`：全称 "disk free"，用于查看文件系统的磁盘空间占用情况**16**。
- `-h`：以人类可读的格式（如 1K、234M、2G）显示容量，避免直接显示原始块数**146**。
- `-l`**：仅显示** 本地文件系统，排除网络文件系统（如 NFS）和虚拟文件系统（如 tmpfs）

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1743248429259-f95cac7e-84c5-40ec-9004-1148077f2de5.png)

#### 2. 磁盘性能

磁盘问题大多数都是性能问题，我们可以通过 `**iostat -d -k -x**` 来进行分析：**

- 最后一列`**%util**`可以看到每块磁盘写入的程度
- 而`**rrqpm/s**`以及`**wrqm/s**`分别表示读写速度

一般就能帮助定位到具体哪块磁盘出现问题了。

`iostat` 是 Linux/Unix 系统中用于 监控系统输入输出（I/O）设备负载及 CPU 使用情况 的性能分析工具，全称为 I/O Statistics。

`-d`：仅显示 磁盘设备的统计信息，隐藏默认的 CPU 统计信息

`-k`：将磁盘读写数据量的单位设置为 KB/s（默认以块为单位，1 块 = 512B）。例如，`rkB/s` 表示每秒读取的千字节数。

`-x`：显示 扩展的磁盘统计信息，包括更细粒度的性能指标（如请求合并、队列长度、响应时间等）

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1743248482339-9ac37701-a3a3-45f5-87f4-a02ca369cd89.png)

#### 3. 文件读写来源

用**iotop命令来进行定位文件读写的来源**，也就是哪个哪个进程在进行读写，一般来说开发自己心里有数。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742302619255-5c974001-0bd0-42ac-a28e-21d972a66ffa.png?x-oss-process=image%2Fcrop%2Cx_0%2Cy_0%2Cw_1440%2Ch_287)

不过这里是 tid，我们要转换为 pid，**可以通过 readlink 来将 tid 找到 pid** **:**`readlink -f /proc/*/task/[tid]/../..`。

递归解析 `/proc` 文件系统中线程（TID）所属进程（PID）的绝对路径

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742302708832-67226b15-d7a7-4f86-b168-59227086642d.png)

找到pid之后就可以**看这个进程具体的读写情况**`**cat /proc/[pid]/io**`

`cat /proc/[pid]/io` 是 Linux 系统中用于查看特定进程 I/O 统计信息的命令。

该命令通过访问 `/proc` 虚拟文件系统提供的进程级 I/O 数据接口，帮助用户分析进程的磁盘读写行为。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742544291562-56da5570-034d-459f-bddf-68977071e45e.png)

我们还可以**通过lsof命令来确定具体的文件读写情况**`**lsof -p [pid]**`

`lsof`：全称 "List Open Files"，用于列出系统打开的文件及相关进程

`-p [pid]`：指定目标进程的 PID（进程 ID），仅显示该进程打开的资源

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742544338558-75775025-a98e-43e8-aeb4-a6c793b0283f.png?x-oss-process=image%2Fcrop%2Cx_0%2Cy_0%2Cw_1436%2Ch_721)

### (三) 内存

内存问题排查起来相对比 CPU 麻烦一些，场景也比较多。主要包括 OOM、GC 问题和堆外内存。一般来讲，我们会**先用**`**free**`**命令先来检查一发内存的各种情况**。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742544488880-b06228bc-4993-47d8-a9d1-fcb05acf2fad.png)

#### 1. 堆外内存

内存问题大多还都是堆内内存问题。表象上主要分为 OOM 和 StackOverflow。

#### 2. OOM

1. `Exception in thread "main" java.lang.OutOfMemoryError: unable to create new native thread` 这个意思是没有足够的内存空间给线程分配java栈**。**

- 比如说忘记shutdown，所以说应该首先从代码层面来寻找问题，使用jstack或者jmap。
- 如果一切都正常，JVM方面可以通过指定`Xss`来减少单个 thread stack 的大小。
- 另外也可以在系统层面，可以通过修改`/etc/security/limits.conf`nofile和nproc来增大os对线程的限制

2. `Exception in thread "main" java.lang.OutOfMemoryError: Java heap space` 这个意思是堆的内存占用已经达到-Xmx设置的最大值，应该是最常见的OOM错误了。

解决思路仍然是先应该在代码中找，怀疑存在内存泄漏，通过jstack和jmap去定位问题。

3. `Caused by: java.lang.OutOfMemoryError: Meta space` 这个意思是元数据区的内存占用已经达到`XX:MaxMetaspaceSize`设置的最大值，排查思路和上面的一致。

#### 3. MAT 分析内存泄漏

通过 MAT(Eclipse Memory Analysis Tools) 导入 dump 文件进行分析，内存泄漏问题一般我们直接选 Leak Suspects 即可，MAT 给出了内存泄漏的建议。

比如说每次请求都 new 对象，导致大量重复创建对象；进行文件流操作但未正确关闭；手动不当触发 GC ； ByteBuffer 缓存分配不合理等都会造成代码 OOM。

#### 4. GC 问题和线程

GC 问题除了影响 cpu 也会影响内存，排查思路也是一致的。

- 一般先使用 `jstat` 来查看分代变化情况，比如 young GC 或者 full GC 次数是不是太多呀；EU、OU等指标增长是不是异常呀等。
- 线程的话太多而且不被及时 GC 也会引发 OOM，大部分就是之前说的`unable to create new native thread`。除了 jstack 细细分析dump文件外，我们一般先会**通过**`**pstreee -p [pid] |wc -l**`**看下总体线程**。

- 以树状结构显示指定进程（`[pid]`）及其所有子进程的层次关系，并标注每个进程的 PID（进程 ID）
- 通过管道符 `|` 将 `pstree` 的输出传递给 `wc -l`，统计输出的总行数

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742545065177-bfb19ff1-a2cb-42f4-9d2c-07b25554896e.png)

**直接通过查看**`**/proc/[pid]/task**`**的数量即为线程数量****。**

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742545113477-422c0ba5-6d6b-46fa-a4d2-447c4a9c7989.png)

#### 5. 堆外内存溢出

堆外内存溢出表现就是物理常驻内存增长快，报错的话视使用方式都不确定。

堆外内存溢出往往是和NIO的使用相关，一般我们先**通过**`**pmap**`**来查看下进程占用的内存情况**`**pmap -x [pid] | sort -rn -k3 | head -30**`，这段意思是查看对应pid倒序前30大的内存段。

这边可以再一段时间后再跑一次命令看看内存增长情况，或者和正常机器比较可疑的内存段在哪里。

`pmap -x [pid]`：显示进程 `[pid]` 的扩展内存映射信息，包含内存区域地址、大小、实际驻留内存（RSS）、脏页大小、权限及映射文件等。

`| sort -rn -k3`：对 `pmap` 的输出进行排序：`-r`：逆序排列（从大到小）。`-n`：按数值而非字符排序。`-k3`：指定以第3列（RSS）作为排序依据**。**

`| head -30`：截取排序后的前30行结果，聚焦内存占用最高的部分。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742545974958-e9637a19-d220-44f4-88f8-df688c70c04b.png?x-oss-process=image%2Fcrop%2Cx_0%2Cy_0%2Cw_971%2Ch_403)

如果确定有可疑的内存端，需要通过**gdb来分析**`**gdb --batch --pid {pid} -ex "dump memory filename.dump {内存起始地址} {内存起始地址+内存块大小}"**`**。**

---

#### 6. 堆外内存缓慢增长直到爆炸

对于堆外内存缓慢增长直到爆炸的情况来说，也可以先**设一个基线**`jcmd [pid] VM.native_memory baseline`

`jcmd` 用于 **为指定 Java 进程的本地内存使用建立基准快照**

通过 `baseline` 参数记录当前进程的本地内存使用状态（包括堆外内存、线程栈、元数据区、JIT 代码缓存等）

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742552526856-2a7e2477-2f98-405a-9937-a4b4a76b87e2.png)

然后等放一段时间后再去看看内存增长的情况，**通过**`**jcmd [pid] VM.native_memory detail.diff/summary.diff**`**做一下summary或者detail级别的diff**。

通过对比 **当前内存状态** 与 **基准快照（baseline）** 的差异，定位内存增长或泄漏的区域

- `summary.diff`：按内存类别（如 Heap、Class、Thread）汇总差异，适合快速定位问题方向。
- `detail.diff`：提供更细粒度数据（如具体内存分配调用点），适合深度排查

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742552573901-2885dc67-cc51-4b8f-873b-2eeeecdc9ed7.png)

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742552585632-5a6fa3b1-ee18-4eb2-9bb4-9ab32fab2d65.png)

可以看到 `jcmd` 分析出来的内存十分详细，包括堆内、线程以及 `gc` (所以上述其他内存异常其实都可以用 `nmt` 来分析)，这边堆外内存我们重点关注 `Internal` 的内存增长，如果增长十分明显的话那就是有问题了。 `detail` 级别的话还会有具体内存段的增长情况：

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742552730192-e10ab118-1f6c-489e-be0b-315aa4c3f059.png)

此外在系统层面，我们还可以**使用** `**strace**` **命令来监控内存分配** `strace -f -e "brk,mmap,munmap" -p pid` 这边内存分配信息主要包括了pid和内存地址。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742552867540-aef62200-b0c7-4bec-b933-6a705ea6b4b6.png?x-oss-process=image%2Fcrop%2Cx_0%2Cy_0%2Cw_1440%2Ch_346)  
  

### (四) 网络

#### 1. TCP 队列溢出（重要）

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742554913783-00407c62-783a-465b-8248-539aa7cb5d90.png)

如上图所示，这里有两个队列：syns queue(半连接队列）、accept queue（全连接队列）。

1️⃣ 在 server 收到 client 的`syn`后，把消息放到`syns queue`，回复`syn+ack`给 client 。

2️⃣ server 收到 client 的`ack`：如果这时`accept queue`没满，那就从`syns queue`拿出暂存的信息放入 `accept queue` 中；否则按 `tcp_abort_on_overflow` 指示的执行。

3️⃣

- `tcp_abort_on_overflow 0`表示如果三次握手第三步的时候`accept queue`满了，那么 server 扔掉client 发过来的`ack`。
- `tcp_abort_on_overflow 1`则表示第三步的时候如果全连接队列满了，server发送一个`rst`包给 client ，表示废掉这个握手过程和这个连接，意味着日志里可能会有很多`connection reset / connection reset by peer`。

`**netstat**` **命令，执行**`**netstat -s | egrep "listen|LISTEN"**` TCP 队列溢出：

`overflowed`表示全连接队列溢出的次数，`sockets dropped`表示半连接队列溢出的次数。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1743248721729-dfa0b21a-3ced-4c8c-b609-47ae6fa095b5.png)

#### 2. RST异常

RST包表示连接重置，用于关闭一些无用的连接，通常表示异常关闭，区别于四次挥手。

在实际开发中，我们往往会看到`connection reset / connection reset by peer`错误，这种情况就是RST包导致的。

- **端口不存在****：**如果像不存在的端口发出建立连接 SYN 请求，那么服务端发现自己并没有这个端口则会直接返回一个RST报文，用于中断连接。
- **主动代替FIN终止连接****：**一般来说，正常的连接关闭都是需要通过 FIN 报文实现，然而我们也可以用 RST 报文来代替 FIN ，表示直接终止连接。实际开发中，可设置 SO_LINGER 数值来控制，这种往往是故意的，来跳过 TIMED_WAIT ，提供交互效率，不闲就慎用。
- **客户端或服务端有一边发生了异常****，该方向对端发送RST以告知关闭连接：**我们上面讲的 TCP 队列溢出发送 RST 包其实也是属于这一种。这种往往是由于某些原因，一方无法再能正常处理请求连接了(比如程序崩了，队列满了)，从而告知另一方关闭连接。
- **接收到的 TCP 报文不在已知的 TCP 连接内****：**比如，一方机器由于网络实在太差 TCP 报文失踪了，另一方关闭了该连接，然后过了许久收到了之前失踪的 TCP 报文，但由于对应的 TCP 连接已不存在，那么会直接发一个 RST 包以便开启新的连接。
- **一方长期未收到另一方的确认报文，在一定时间或重传次数后发出RST报文：**这种大多也和网络环境相关了，网络环境差可能会导致更多的RST报文。

之前说过**RST报文多会导致程序报错，在一个已关闭的连接上读操作会报**`**connection reset**`**，而在一个已关闭的连接上写操作则会报**`**connection reset by peer**`。

通常我们可能还会看到`broken pipe`错误，这是管道层面的错误，表示对已关闭的管道进行读写，往往是在收到RST，报出`connection reset`错后继续读写数据报的错，这个在`glibc`源码注释中也有介绍。

我们在排查故障时候怎么确定有RST包的存在呢？当然是使用`[tcpdump](https://zhida.zhihu.com/search?content_id=253084942&content_type=Article&match_order=1&q=tcpdump&zhida_source=entity)`命令进行抓包，并使用[wireshark](https://zhida.zhihu.com/search?content_id=253084942&content_type=Article&match_order=1&q=wireshark&zhida_source=entity)进行简单分析了。`tcpdump -i en0 tcp -w xxx.cap`，en0表示监听的网卡。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742555396435-f686a89c-696f-4294-838f-5fac6e17b58d.png)

接下来我们通过wireshark打开抓到的包，可能就能看到如下图所示，红色的就表示RST包了。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742555396582-1ea25980-e820-481d-8c34-f4873104f28c.png)

#### 3. TIME_WAIT和CLOSE_WAIT 数量查看

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1743475769864-9ac06879-f0fc-4837-814f-3a24e96d7ac8.png?x-oss-process=image%2Fcrop%2Cx_0%2Cy_0%2Cw_344%2Ch_326)

`TIME_WAIT` 和 `CLOSE_WAIT` 是啥意思相信大家都知道。

在线上时，我们可以直接用命令`netstat -n | awk '/^tcp/ {++S[$NF]} END {for(a in S) print a, S[a]}'`来查看time-wait和close_wait的数量

用ss命令会更快`ss -ant | awk '{++S[$1]} END {for(a in S) print a, S[a]}'`

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742555577784-183a5709-8b48-4ace-817b-ca42858370b5.png)

---

`**time_wait**`的存在一是为了丢失的数据包被后面连接复用，二是为了在2MSL的时间范围内正常关闭连接。它的存在其实会大大减少RST包的出现。

过多的`time_wait`在短连接频繁的场景比较容易出现。这种情况可以在服务端做一些内核参数调优:

```
#表示开启重用。允许将TIME-WAIT sockets重新用于新的TCP连接，默认为0，表示关闭
net.ipv4.tcp_tw_reuse = 1
#表示开启TCP连接中TIME-WAIT sockets的快速回收，默认为0，表示关闭
net.ipv4.tcp_tw_recycle = 1
```

当然我们不要忘记在NAT环境下因为时间戳错乱导致数据包被拒绝的坑了，另外的办法就是改小`tcp_max_tw_buckets`，超过这个数的`time_wait`都会被干掉，不过这也会导致报`time wait bucket table overflow`的错。

---

`close_wait` 出现的概率甚至比 `time_wait` 要更高，后果也更严重。往往是由于某个地方阻塞住了，没有正常关闭连接，从而渐渐地消耗完所有的线程。

如果一直保持在`CLOSE_WAIT`状态，那么只有一种情况：**就是在对方关闭连接之后服务器程序自己没有进一步发出 ACK 信号，或者没有在 ACK 后再次发起 FIN 报文。**

换句话说，就是在对方连接关闭之后，程序里没有检测到，或者程序压根就忘记了这个时候需要关闭连接，于是这个资源就一直被程序占着，`**close_wait**` **往往都是因为应用程序写的有问题**。

个人觉得这种情况，通过服务器内核参数也没办法解决，服务器对于程序抢占的资源没有主动回收的权利，除非终止程序运行。

想要定位这类问题，最好是通过jstack来分析线程堆栈来排查问题。

这里仅举一个例子：

开发同学说应用上线后CLOSE_WAIT就一直增多，直到挂掉为止，jstack后找到比较可疑的堆栈是大部分线程都卡在了`countdownlatch.await`方法；

找开发同学了解后得知使用了多线程但是确没有catch异常，修改后发现异常仅仅是最简单的升级sdk后常出现的`class not found`。

---

### (五) 单独总结 GC 问题

堆内内存泄漏总是和GC异常相伴。不过GC问题不只是和内存问题相关，还有可能引起CPU负载、网络问题等系列并发症，只是相对来说和内存联系紧密些，所以我们在此单独总结一下GC相关问题。

我们在cpu章介绍了使用jstat来获取当前GC分代变化信息。**而更多时候，我们是通过GC日志来排查问题的**，在启动参数中加上`-verbose:gc -XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintGCTimeStamps`来开启GC日志。 常见的Young GC、Full GC日志含义在此就不做赘述了。

针对gc日志，我们就能大致推断出youngGC与fullGC是否过于频繁或者耗时过长，从而对症下药。我们下面将对**G1垃圾收集器**来做分析，这边也建议大家使用G1`-XX:+UseG1GC`。

---

1. **youngGC过频繁** youngGC频繁一般是短周期小对象较多，先考虑是不是Eden区/新生代设置的太小了，看能否通过调整-Xmn、-XX:SurvivorRatio等参数设置来解决问题。如果参数正常，但是young gc频率还是太高，就需要使用Jmap和MAT对dump文件进行进一步排查了。
2. **youngGC耗时过长** 耗时过长问题就要看GC日志里耗时耗在哪一块了。以G1日志为例，可以关注Root Scanning、Object Copy、Ref Proc等阶段。

- Ref Proc 耗时长，就要注意引用相关的对象。
- Root Scanning 耗时长，就要注意线程数、跨代引用。
- Object Copy 则需要关注对象生存周期。

而且耗时分析它需要横向比较，就是和其他项目或者正常时间段的耗时比较。比如说图中的Root Scanning和正常时间段比增长较多，那就是起的线程太多了。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1742554459120-39e01e64-5f62-4809-914c-3f9c5d916bce.png?x-oss-process=image%2Fcrop%2Cx_0%2Cy_0%2Cw_1440%2Ch_976)

---

**触发fullGC** G1中更多的还是mixedGC，但mixedGC可以和youngGC思路一样去排查。触发fullGC了一般都会有问题，G1会退化使用Serial收集器来完成垃圾的清理工作，暂停时长达到秒级别。 fullGC的原因可能包括以下这些，以及参数调整方面的一些思路：

- 并发阶段失败：在并发标记阶段，MixGC之前老年代就被填满了，那么这时候G1就会放弃标记周期。这种情况，可能就需要增加堆大小，或者调整并发标记线程数`-XX:ConcGCThreads`。
- 晋升失败：在GC的时候没有足够的内存供存活/晋升对象使用**，所以触发了Full GC。**这时候可以通过`-XX:G1ReservePercent`来增加预留内存百分比，减少`-XX:InitiatingHeapOccupancyPercent`来提前启动标记，`-XX:ConcGCThreads`来增加标记线程数也是可以的。
- 大对象分配失败：大对象找不到合适的region空间进行分配**，就会进行fullGC**，这种情况下可以增大内存或者增大`-XX:G1HeapRegionSize`。
- 程序主动执行System.gc()：不要随便写就对了。

---

另外，我们可以在启动参数中配置`-XX:HeapDumpPath=/xxx/dump.hprof`来dump fullGC相关的文件，并通过jinfo来进行gc前后的dump

```
jinfo -flag +HeapDumpBeforeFullGC pid 
jinfo -flag +HeapDumpAfterFullGC pid
```

这样得到2份dump文件，对比后主要关注被gc掉的问题对象来定位问题。

### 进程监控命令

`pidstat` 的主要功能是监控 **进程级别** 的系统资源使用情况（如 CPU、内存、I/O 等），但通过特定参数（如 `-t` 或 `-T`）可以扩展到 **线程级别** 的监控。

默认情况下，`pidstat` 关注 **进程整体** 的资源消耗

- **CPU 使用**：`pidstat -u`（默认）显示进程的用户态和内核态 CPU 占比。
- **内存使用**：`pidstat -r` 查看进程的物理内存（RSS）、虚拟内存（VSZ）及内存百分比。
- **I/O 统计**：`pidstat -d` 分析进程的磁盘读写速率（kB_rd/s、kB_wr/s）。
- **上下文切换**：`pidstat -w` 显示进程的自愿/非自愿上下文切换次数。

这些参数直接反映 **进程整体的资源开销**，常用于定位高 CPU 进程、内存泄漏或 I/O 密集型任务

- **线程资源分析**：`pidstat -t -p [PID]` 显示指定进程下各线程的 CPU、内存、上下文切换等数据。
- **线程上下文切换**：`pidstat -wt -p [PID]` 单独统计线程的自愿（cswch/s）和非自愿（nvcswch/s）切换次数。

# 附录

### (一) 线上日志查看

```
命令格式: tail[必要参数][选择参数][文件]

-f 循环读取
-q 不显示处理信息
-v 显示详细的处理信息
-c<数目> 显示的字节数
-n<行数> 显示行数
-q, --quiet, --silent 从不输出给出文件名的首部
-s, --sleep-interval=S 与-f合用,表示在每次反复的间隔休眠S秒
```

```
tail  -n  10   test.log   查询日志尾部最后10行的日志;
tail  -n +10   test.log   查询10行之后的所有日志;
tail  -fn 10   test.log   循环实时查看最后1000行记录(最常用的)
```

```
 tail -fn 1000 test.log | grep '关键字'
```

logback 会设置日志输出地址，设计日志过期时间。分类，error，正常日志。

# 参考资料

2. Java 如何快速排查死锁？

作者：PC_Repair  
链接：https://www.jianshu.com/p/e9de87bc2906