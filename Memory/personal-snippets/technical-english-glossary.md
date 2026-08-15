# Technical English Glossary

这个文档用于沉淀英文技术词汇，默认按“工程语境”记录，而不是按通用词典直译。

| English | 中文（技术语境） | Notes | Added |
| --- | --- | --- | --- |
| acyclic | 无环的 | 图论中表示图中不存在环路；DAG（有向无环图）中的 A，保证任务依赖不会形成死循环。 | 2026-05-26 |
| blob storage | 对象存储；二进制大对象存储 | 在云服务和后端语境里，指用于存放图片、视频、文件等非结构化数据的存储服务；BLOB 是 Binary Large Object 的缩写。 | 2026-04-16 |
| branch predication | 分支谓词化／谓词执行 | 编译器把短分支转换为带 predicate 的指令；指令会被发射，但只有 predicate 为 true 的 thread 写回结果，可避免真正的控制流跳转，不等于没有执行成本。 | 2026-07-12 |
| coalesced | 合并的；聚合的 | CUDA 中常见于 coalesced memory access，指将同一 warp 中相邻的内存请求合并为较少的显存事务。 | 2026-07-11 |
| codecs | 编解码器（coder-decoder） | 对音视频数据进行编码压缩和解码解压的软硬件，如 H.264、HEVC、AAC、Opus 等。 | 2026-05-25 |
| compatible bitrate | 兼容码率/兼容比特率 | 编码器输出的码率符合目标设备或平台的解码能力范围；在 DASH 中常指为不同设备准备匹配的码率档位。 | 2026-05-25 |
| completion handler | 完成处理器/回调 | 异步操作完成时被调用的函数，从 completion queue 中取出事件并执行对应业务逻辑。 | 2026-05-24 |
| completion queue | 完成队列 | 异步 I/O 中存放已完成操作结果的队列，应用程序从中取出事件进行处理。常见于 Linux io_uring、Windows IOCP。 | 2026-05-24 |
| computationally | 计算上/从计算角度看 | 常见搭配 computationally expensive（计算开销大）、computationally intensive（计算密集型），形容操作消耗大量 CPU/GPU 资源。 | 2026-05-25 |
| compute scaling is faster than memory scaling | 算力增长速度快于内存系统的增长速度 | 常指计算吞吐量提升快于显存带宽或容量提升，因此系统更容易受到数据搬运限制。 | 2026-07-11 |
| demographics | 人口统计特征 | 在用户画像、数据分析和广告系统中，通常指年龄、地区、性别等人口属性。 | 2026-04-15 |
| distribute requests | 分发请求；分配请求 | 在后端、网关或负载均衡语境里，指把进入系统的请求分配到多个服务实例、节点或处理单元上。 | 2026-04-16 |
| DRAM | 动态随机存取存储器 | 使用电容保存数据并需要周期性刷新；GPU 的 GDDR 和 HBM 都属于 DRAM，容量大但延迟高于片上 SRAM。 | 2026-07-11 |
| encryption | 加密 | 在安全和软件工程里，指把明文通过算法转换成密文，防止未授权访问；常见于传输加密和存储加密。 | 2026-04-16 |
| fast resumable | 快速断点续传 | 上传中断后从断点恢复而非重传全部数据，"fast" 体现在跳过已完成分片。 | 2026-05-26 |
| FLOPS | 每秒浮点运算次数 | 衡量浮点计算吞吐量；FLOP 是一次浮点运算，FLOPS 中的 S 表示 per second。 | 2026-07-11 |
| free up | 释放/腾出 | 让被占用的资源（内存、worker、连接等）重新变为可用状态，如 free up a worker。 | 2026-05-26 |
| GOP alignment | GOP 对齐/关键帧对齐 | 多码率视频中各版本 I 帧在同一时间戳对齐，使 ABR 切换时在 GOP 边界无缝过渡，无画面跳变。 | 2026-05-26 |
| Grid | 线程网格／网格 | 在 CUDA 中指一次 kernel 启动产生的全部 thread block 的组织范围；不是数学中的矩阵。文章首次出现建议写“线程网格（Grid）”，后文保留 Grid。 | 2026-07-12 |
| inference | 推理 | 在 AI 语境里通常指模型执行前向计算生成结果。 | 2026-04-15 |
| lane | 执行通道／通道位置 | 在 GPU warp 中指编号固定的执行位置（如 lane 0～31）；thread 被调度执行时占据一个 lane，lane 是硬件执行位置，不是独立的软件线程。 | 2026-07-12 |
| leverage | 利用；借助 | 在软件和产品语境里，通常指利用现有工具、资源、数据或平台来解决问题、提升效率。 | 2026-04-16 |
| Linear | 线性层／全连接层 | PyTorch nn.Linear 计算 y = xW^T + b；带 bias 时数学上严格属于 affine transformation（仿射变换），主要计算是矩阵乘法。 | 2026-07-18 |
| loosely coupled system | 松耦合系统 | 组件间依赖弱、通过良好接口或消息通信，可独立开发部署替换，故障不级联。与 tightly coupled 相对。 | 2026-05-26 |
| meet performance | 满足性能要求（常见于 meet performance requirements） | 这个短语本身通常不完整；在工程语境里多半是指系统、服务或方案达到预期的性能目标，如延迟、吞吐量或响应速度。 | 2026-04-16 |
| MLP | 多层感知机 | Multi-Layer Perceptron；通常由多层 Linear 与非线性 activation 交替组成，在 Transformer 中也常指前馈网络部分。 | 2026-07-18 |
| overskill | 能力过剩；方案过重（非标准术语） | 这不是很常见的标准技术术语；在上下文里通常表示人或方案的能力超过当前任务所需，接近 overqualified 或 overengineered 的意思。 | 2026-04-16 |
| parallelism | 并行度/并行性 | 多个任务同时执行的能力；流处理中指算子的并行实例数；音视频编码中指同时处理多个帧/宏块。 | 2026-05-26 |
| parallelly | 并行地 | 多个任务同时执行，技术文档中更常用 in parallel。 | 2026-05-26 |
| predicate | 谓词／执行条件 | GPU 指令语境中通常是每个 thread 各自持有的布尔条件，用来决定一条 predicated instruction 是否对该 thread 生效。 | 2026-07-12 |
| predicated instruction | 带谓词指令／谓词化指令 | 指令关联一个逐 thread 的布尔 predicate；指令会被调度，但只有 predicate 为 true 的 thread 产生执行效果。 | 2026-07-12 |
| predication | 谓词执行 | 按每个 thread 的布尔 predicate 决定一条指令是否生效的执行机制；predicated instruction 是具体指令形式，branch predication 是编译器用这类指令替换短分支的优化过程。 | 2026-07-12 |
| scratch | 从零开始（常见于 from scratch） | 单独看 scratch 不一定是技术术语；在工程语境里最常见的表达是 from scratch，表示不复用现成方案、从头实现。 | 2026-04-16 |
| sequentially | 顺序地/依次地 | 一个接一个按顺序执行，前一个完成才开始下一个，与 in parallel 相对。 | 2026-05-26 |
| shared and replicated | 共享且已复制；共享并复制 | 在分布式系统、存储或数据库语境里，通常表示数据或资源可被多个节点共享，并且存在多个副本以提高可用性、容错性或读取性能。 | 2026-04-16 |
| shared and replicated to meet performance | 为了满足性能要求而进行共享和复制 | 在分布式系统、存储或数据库语境里，表示数据或资源会被多个节点共享，并保留多个副本，以满足吞吐量、延迟或可扩展性方面的性能目标。 | 2026-04-16 |
| SM | 流式多处理器 | Streaming Multiprocessor；NVIDIA GPU 中接收 thread block、分配 register/shared memory 并调度 warp 的硬件执行单元。 | 2026-07-18 |
| technologies underneath the simplicity | 简洁背后的技术实现 | 强调表面简单，但底层有具体工程技术在支撑。 | 2026-04-15 |
| thread block | 线程块 | CUDA 编程模型中一组执行同一个 kernel 的 thread；整个 block 分配到同一个 SM，block 内可共享 shared memory 并同步。 | 2026-07-18 |
| warm-up | 预热 | GPU benchmark 中指正式计时前先执行若干次，以完成 JIT compilation、CUDA context、kernel/module、allocator 和 library cache 等初始化，测量 steady-state 性能；不同于 learning-rate warmup。 | 2026-07-18 |
| warp | 线程束 | NVIDIA GPU 的主要指令调度单位，通常由同一 block 中连续编号的 32 个 thread 组成。 | 2026-07-18 |
| watermarks | 水印 | 音视频中嵌入的不可见标记用于版权保护和来源追踪（如 Netflix 用户 ID 水印）；流处理中表示某个时间点前所有数据已到达的进度标记。 | 2026-05-26 |
| wave | 调度批次／执行波次 | 在 CS336 的 “thread blocks scheduled onto SMs in waves” 中指一批同时驻留或执行的 thread block，不是 NVIDIA warp。AMD 的 wave/wavefront 是另一种语境，概念更接近 NVIDIA warp。 | 2026-07-18 |
