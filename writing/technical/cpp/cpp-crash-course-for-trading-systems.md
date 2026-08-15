# C++ 速成指南：交易系统开发方向

> 面向已有编程基础（Java/Python）的读者，聚焦低延迟/高频交易（LL/HFT）场景。
> 不从 Hello World 讲起，直击交易系统关心的四个维度：**零开销抽象、内存控制、并发模型、系统级编程**。

---

## 目录

- [一、现代 C++ 核心](#一现代-c-核心)
- [二、极致性能优化](#二极致性能优化)
- [三、Linux 系统与网络编程](#三linux-系统与网络编程)
- [四、实战项目](#四实战项目)
- [五、面试高频考点速查](#五面试高频考点速查)
- [六、推荐资源](#六推荐资源)

---

## 一、现代 C++ 核心

> 交易系统的铁律：**不为没用的东西付代价**（zero-overhead principle）。
> 所有学习围绕"编译期能搞定的事绝不留到运行期"展开。

### 1.1 内存管理与 RAII

**核心思想：** 资源获取即初始化（Resource Acquisition Is Initialization）。构造函数获取资源，析构函数释放资源，利用栈对象的生命周期自动管理资源。

```cpp
// 反模式：裸 new/delete —— 交易系统严禁
void bad() {
    auto* order = new Order{10001, 150.25, 100, Side::Buy};
    process(order);
    delete order;  // 如果 process 抛异常，这里永远执行不到 → 内存泄漏
}

// 正确做法：RAII + unique_ptr
void good() {
    auto order = std::make_unique<Order>(10001, 150.25, 100, Side::Buy);
    process(order.get());
    // 离开作用域自动销毁，异常安全
}

// 更好的做法：直接用栈对象（零堆分配）
void best() {
    Order order{10001, 150.25, 100, Side::Buy};
    process(&order);
}
```

**交易系统中的 RAII 场景：**
- 锁的获取与释放（`std::lock_guard`、`std::unique_lock`）
- 文件句柄、socket fd 的关闭
- 自定义内存池的分配与回收

**智能指针选择原则：**
| 指针类型 | 开销 | 使用场景 |
|---------|------|---------|
| `std::unique_ptr` | 几乎为零 | 默认选择，独占所有权 |
| `std::shared_ptr` | 引用计数原子操作 | 共享所有权，**交易热路径上禁用** |
| 裸指针 / 引用 | 零 | 不涉及所有权时的观察者 |

**自定义内存分配器（进阶）：**
```cpp
// 交易系统常预分配一大块内存，用自定义 allocator 避免运行时 malloc
template <typename T, std::size_t N>
class RingBufferAllocator {
    alignas(T) char buffer_[N * sizeof(T)];
    std::size_t offset_ = 0;
public:
    using value_type = T;
    T* allocate(std::size_t n) {
        if (offset_ + n > N) throw std::bad_alloc();
        auto* ptr = reinterpret_cast<T*>(buffer_ + offset_ * sizeof(T));
        offset_ += n;
        return ptr;
    }
    void deallocate(T*, std::size_t) noexcept {
        // 环形缓冲区：不真正释放，reset 时统一回收
    }
};
```

### 1.2 移动语义与零拷贝

**为什么交易系统厌恶拷贝：** 一次拷贝 = 一次内存访问 = 数百纳秒延迟。在高频交易中，100ns 足以让你输给竞争对手。

```cpp
class OrderBook {
    std::vector<PriceLevel> bids_;
    std::vector<PriceLevel> asks_;
public:
    // 拷贝构造 —— 昂贵，交易系统禁用
    OrderBook(const OrderBook&) = delete;

    // 移动构造 —— O(1)，只转移内部指针
    OrderBook(OrderBook&& other) noexcept
        : bids_(std::move(other.bids_))
        , asks_(std::move(other.asks_))
    {}
};

// 完美转发：保持值类别不变地传递参数
template <typename T, typename... Args>
void emplace_order(Args&&... args) {
    // std::forward 完美转发，避免不必要的拷贝
    order_book_.emplace(std::forward<Args>(args)...);
}
```

**右值引用的核心规则：**
- `T&&` 绑定到右值（临时对象、`std::move` 的结果）
- 移动后原对象处于"有效但未指定"状态，不要再使用
- `noexcept` 移动构造函数让 STL 容器在扩容时优先移动而非拷贝

**交易系统中的零拷贝实践：**
```cpp
// 反模式：网络收到的行情数据反序列化时拷贝
MarketData parse(const char* buf, size_t len) {
    // 拷贝！buf 的内容被复制到 std::string
    return {std::string(buf, len), ...};
}

// 正确做法：直接在收到的 buffer 上解析，只传递指针/偏移量
class MarketDataView {
    const char* data_;   // 不拥有，只观察
    size_t len_;
public:
    constexpr MarketDataView(const char* data, size_t len) noexcept
        : data_(data), len_(len) {}

    // 返回 string_view 而非 string，零拷贝
    constexpr std::string_view symbol() const noexcept {
        return {data_ + 4, 8};  // 假设 symbol 在 offset 4，长度 8
    }
};
```

### 1.3 模板与编译期计算

**核心目标：** 把运行时开销转移到编译期。交易系统宁可编译慢 10 分钟，也不要运行时慢 1 微秒。

**编译期多态替代虚函数：**
```cpp
// 反模式：虚函数调用 → 间接跳转 → 分支预测失败 → 流水线冲刷
class OrderHandler {
public:
    virtual void on_order(const Order& order) = 0;  // vtable 查找
    virtual ~OrderHandler() = default;
};

// 正确做法：CRTP（Curiously Recurring Template Pattern）
template <typename Derived>
class OrderHandlerBase {
public:
    void on_order(const Order& order) {
        // 编译期静态分发，零开销
        static_cast<Derived*>(this)->on_order_impl(order);
    }
};

class MarketOrderHandler : public OrderHandlerBase<MarketOrderHandler> {
public:
    void on_order_impl(const Order& order) {
        // 具体实现，编译器可内联
    }
};
```

**编译期常量计算（C++14/17）：**
```cpp
// constexpr 函数在编译期求值，运行时零开销
constexpr Price compute_mid_price(Price bid, Price ask) noexcept {
    return (bid + ask) / 2;
}

// 编译期已知 mid price，直接嵌入指令流
static constexpr Price mid = compute_mid_price(100.0, 100.5);

// C++17 constexpr if —— 编译期分支消除
template <typename OrderType>
void process_order(Order& order) {
    if constexpr (std::is_same_v<OrderType, MarketOrder>) {
        // 只有 MarketOrder 才编译这段代码
        execute_immediately(order);
    } else if constexpr (std::is_same_v<OrderType, LimitOrder>) {
        // 只有 LimitOrder 才编译这段代码
        insert_into_book(order);
    }
}
```

**模板注意事项：**
- 模板代码膨胀是真实问题——权衡编译时间和二进制大小
- 交易系统中常用模板的领域：固定大小的数组容器、类型安全的 ID、策略模式的编译期分发

### 1.4 STL 容器的性能特征

**交易系统容器选择铁律：缓存局部性 > 算法复杂度。** `O(n)` 的连续内存遍历通常比 `O(log n)` 的指针追踪快。

```
缓存命中 ~1ns vs 缓存未命中 ~100ns（主存访问）
```

| 容器 | 内存布局 | 适用场景 | 交易系统建议 |
|------|---------|---------|-------------|
| `std::vector` | 连续内存 | 默认首选，缓存友好 | 大量使用 |
| `std::deque` | 分段连续 | 需要头尾高效操作 | 少用 |
| `std::list` | 链表节点 | 几乎不用 | **禁用**——缓存杀手 |
| `std::unordered_map` | 哈希桶 | O(1) 查找 | 可以用，但注意 rehash |
| `std::map` | 红黑树 | 有序遍历 | 少用——每个节点都是缓存未命中 |
| `std::array` | 栈上固定数组 | 编译期已知大小 | 大量使用 |

```cpp
// 限价订单簿的经典数据结构设计
class OrderBook {
    // 每个价位的订单列表 —— 连续内存
    struct PriceLevel {
        Price price;
        std::vector<Order> orders;  // 同价位订单用 vector 管理
    };

    // 用 sorted vector 替代 map —— 缓存友好
    std::vector<PriceLevel> bids_;  // 降序排列
    std::vector<PriceLevel> asks_;  // 升序排列

    // O(log n) 查找 + 连续内存遍历
    PriceLevel* find_level(std::vector<PriceLevel>& levels, Price p) {
        auto it = std::lower_bound(levels.begin(), levels.end(), p,
            [](const PriceLevel& lvl, Price px) { return lvl.price < px; });
        return (it != levels.end() && it->price == p) ? &*it : nullptr;
    }
};
```

**`reserve` 和 `shrink_to_fit`：**
```cpp
std::vector<Order> orders;
orders.reserve(10000);  // 预分配，避免运行时扩容导致的拷贝和内存碎片
// ... 使用后如果大量元素被移除
orders.shrink_to_fit();  // 释放多余内存（慎用，本身有开销）
```

---

## 二、极致性能优化

> 交易系统的性能不是"快一点"，而是"确定性快"——最坏情况比平均情况更重要。

### 2.1 CPU 缓存与伪共享

**缓存行（Cache Line）基础：**
- 现代 CPU 缓存行大小：64 字节
- 一个缓存行从主存加载的开销：~100ns
- 伪共享（False Sharing）：两个无关变量落在同一缓存行，多核互相使对方的缓存行失效

```cpp
// 反模式：多线程频繁写入同一结构体的不同字段
struct Counters {
    uint64_t orders_processed;  // 线程 A 写
    uint64_t trades_executed;   // 线程 B 写
    // 两个字段很可能在同一缓存行 → 伪共享！
};

// 修复方案 1：缓存行填充
struct alignas(64) PaddedCounter {
    uint64_t value;
    char padding[64 - sizeof(uint64_t)];
};

struct Counters {
    PaddedCounter orders_processed;   // 线程 A 写
    PaddedCounter trades_executed;    // 线程 B 写
    // 每个字段独占一个缓存行 → 无伪共享
};

// 修复方案 2：C++17 [[no_unique_address]]（适合嵌入式场景）
// 修复方案 3：thread_local 计数器，定期汇总
```

**数据布局优化原则：**
```cpp
// 热路径结构体：把频繁访问的字段放在一起
struct alignas(64) Order {
    // 热数据 —— 撮合时频繁访问
    Price price;          // 8 bytes
    Quantity qty;         // 8 bytes
    OrderId id;           // 8 bytes
    Side side;            // 4 bytes

    // 冷数据 —— 较少访问
    char padding[36];     // 填充到 64 字节

    // 冷数据可以单独放在另一个结构体中
    // Timestamp submit_time;
    // UserId user_id;
    // std::string symbol;
};
```

### 2.2 CPU 亲和性（Affinity）

**为什么交易系统要绑核：**
1. 避免 CPU 迁移导致的缓存失效
2. 避免 OS 调度带来的延迟抖动
3. 可以隔离专用核，让 OS 不在上面调度其他任务

```cpp
#include <pthread.h>
#include <sched.h>

void pin_thread_to_core(int core_id) {
    cpu_set_t cpuset;
    CPU_ZERO(&cpuset);
    CPU_SET(core_id, &cpuset);
    int rc = pthread_setaffinity_np(pthread_self(), sizeof(cpu_set_t), &cpuset);
    if (rc != 0) {
        // 处理错误
    }
}

// 使用示例：交易线程独占 core 2
void trading_thread() {
    pin_thread_to_core(2);
    // 这个线程现在只会在 core 2 上运行
    // OS 不会再把其他任务调度到 core 2（需要配合 isolcpus 启动参数）
}

// Linux 启动参数：isolcpus=2,3 隔离 core 2 和 3
// 然后 GRUB 配置中添加，重启生效
```

### 2.3 无锁编程与原子操作

**`std::atomic` 与内存顺序：**

```cpp
#include <atomic>

// 最简单的无锁序列号生成器
class SequenceGenerator {
    std::atomic<uint64_t> seq_{0};
public:
    uint64_t next() noexcept {
        // relaxed：只保证原子性，不保证顺序
        // 性能最好，适用于不依赖其他变量的场景
        return seq_.fetch_add(1, std::memory_order_relaxed);
    }
};

// 内存顺序对比（性能从高到低）：
// relaxed    — 无同步，只保证原子操作本身
// acquire    — 后续读写不能重排到此操作之前
// release    — 前面读写不能重排到此操作之后
// acq_rel    — acquire + release
// seq_cst    — 全局顺序一致（默认，最慢）
```

**无锁 SPSC 队列（单生产者单消费者）：**
```cpp
template <typename T, size_t Capacity>
class SPSCQueue {
    static constexpr size_t kMask = Capacity - 1;
    static_assert((Capacity & kMask) == 0, "Capacity must be power of 2");

    alignas(64) std::atomic<uint64_t> head_{0};
    alignas(64) std::atomic<uint64_t> tail_{0};
    alignas(64) std::array<T, Capacity> buffer_;

public:
    bool push(const T& item) noexcept {
        const uint64_t tail = tail_.load(std::memory_order_relaxed);
        const uint64_t head = head_.load(std::memory_order_acquire);

        if (tail - head >= Capacity) return false;  // 满

        buffer_[tail & kMask] = item;
        tail_.store(tail + 1, std::memory_order_release);
        return true;
    }

    bool pop(T& item) noexcept {
        const uint64_t head = head_.load(std::memory_order_relaxed);
        const uint64_t tail = tail_.load(std::memory_order_acquire);

        if (head >= tail) return false;  // 空

        item = buffer_[head & kMask];
        head_.store(head + 1, std::memory_order_release);
        return true;
    }
};
```

**无锁编程的陷阱：**
- ABA 问题（带版本号的指针可以解决）
- 内存回收问题（ Hazard Pointer / Epoch-based Reclamation）
- 不是所有场景都适合无锁——有时一个自旋锁就够了

### 2.4 分支预测优化

```cpp
// CPU 分支预测失败惩罚：~15-20 个时钟周期
// 交易系统热路径应尽量消除分支

// 方法 1：likely/unlikely 提示编译器
if ([[unlikely]] (order.quantity == 0)) {
    return ErrorCode::InvalidQuantity;
}

// 方法 2：用查表替代分支
// 反模式
double get_fee(Tier tier) {
    switch (tier) {
        case Tier::Gold:   return 0.001;
        case Tier::Silver: return 0.002;
        case Tier::Bronze: return 0.003;
    }
}

// 正确做法：编译期已知，查表
constexpr double kFees[] = {0.001, 0.002, 0.003};
double get_fee(Tier tier) noexcept {
    return kFees[static_cast<int>(tier)];
}

// 方法 3：利用数学运算消除条件分支
// 反模式
int clamp(int val, int lo, int hi) {
    if (val < lo) return lo;
    if (val > hi) return hi;
    return val;
}

// 无分支版本（利用 cmov 指令）
int clamp_branchless(int val, int lo, int hi) noexcept {
    return std::max(lo, std::min(val, hi));
}
```

### 2.5 避免动态内存分配

交易系统热路径上**绝对不能**出现 `malloc` / `new`：
- `malloc` 耗时不确定（微秒级）
- 导致内存碎片
- 可能触发系统调用

```cpp
// 预分配内存池
template <typename T, size_t PoolSize>
class MemoryPool {
    union Slot {
        T value;
        Slot* next;
    };
    alignas(64) Slot slots_[PoolSize];
    Slot* free_list_ = nullptr;

public:
    MemoryPool() noexcept {
        for (size_t i = 0; i < PoolSize - 1; ++i) {
            slots_[i].next = &slots_[i + 1];
        }
        slots_[PoolSize - 1].next = nullptr;
        free_list_ = &slots_[0];
    }

    T* allocate() noexcept {
        if (!free_list_) return nullptr;  // 池耗尽
        auto* slot = free_list_;
        free_list_ = slot->next;
        return &slot->value;
    }

    void deallocate(T* ptr) noexcept {
        auto* slot = reinterpret_cast<Slot*>(ptr);
        slot->next = free_list_;
        free_list_ = slot;
    }
};
```

---

## 三、Linux 系统与网络编程

> 交易系统跑在 Linux 上不是偶然——内核调优的空间远大于其他 OS。

### 3.1 epoll 与 Reactor 模式

**为什么交易系统用 epoll 而不是 select/poll：**
- `select`：O(n) 遍历，1024 fd 上限
- `poll`：O(n) 遍历，无 fd 上限
- `epoll`：O(1) 就绪事件通知，`epoll_wait` 只返回活跃的 fd

**Edge Triggered vs Level Triggered：**
- LT（水平触发，默认）：缓冲区有数据就通知 → 可能多次唤醒
- ET（边缘触发）：只在状态变化时通知 → 必须一次性读完所有数据
- 交易系统常用 ET 模式，减少系统调用次数

```cpp
#include <sys/epoll.h>
#include <unistd.h>
#include <fcntl.h>

class EpollReactor {
    int epfd_;
    static constexpr int kMaxEvents = 1024;

public:
    EpollReactor() : epfd_(epoll_create1(EPOLL_CLOEXEC)) {}

    void add_fd(int fd, uint32_t events) {
        epoll_event ev;
        ev.events = events | EPOLLET;  // Edge Triggered
        ev.data.fd = fd;
        epoll_ctl(epfd_, EPOLL_CTL_ADD, fd, &ev);
    }

    void run() {
        epoll_event events[kMaxEvents];
        while (true) {
            int n = epoll_wait(epfd_, events, kMaxEvents, -1);
            for (int i = 0; i < n; ++i) {
                if (events[i].events & EPOLLIN) {
                    handle_read(events[i].data.fd);
                }
                if (events[i].events & EPOLLOUT) {
                    handle_write(events[i].data.fd);
                }
            }
        }
    }

private:
    void handle_read(int fd) {
        // ET 模式必须循环读完
        char buf[4096];
        while (true) {
            ssize_t n = read(fd, buf, sizeof(buf));
            if (n == -1) {
                if (errno == EAGAIN || errno == EWOULDBLOCK) break;  // 读完了
                // 处理错误
                break;
            }
            if (n == 0) {
                // 连接关闭
                break;
            }
            process_data(buf, n);
        }
    }
};
```

**交易系统专用的 Reactor 变体——"跑满一个核"模式：**
```cpp
// trading_thread.cpp
// 独占一个 CPU 核，busy-poll 而非 sleep
void trading_loop(int core_id) {
    pin_thread_to_core(core_id);

    // 设置线程为实时优先级（需要 root 权限）
    struct sched_param param;
    param.sched_priority = 99;
    sched_setscheduler(0, SCHED_FIFO, &param);

    // busy poll —— 不调用 epoll_wait（放弃 CPU）
    // 而是不断轮询共享内存中的标志位
    volatile const std::atomic<bool>* new_data = get_shared_flag();
    while (true) {
        while (!new_data->load(std::memory_order_acquire)) {
            // 自旋等待，不放弃 CPU
            // 延迟 < 10ns
        }
        process_market_data();
    }
}
```

### 3.2 共享内存 IPC

**同一台机器上最快的 IPC 方式：** 共享内存 + 自旋锁/无锁队列，延迟 < 1μs。

```cpp
#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>

// 生产者：行情网关进程
class MarketDataShmWriter {
    int fd_;
    void* ptr_;
    static constexpr const char* kShmName = "/market_data_feed";

public:
    void init() {
        fd_ = shm_open(kShmName, O_CREAT | O_RDWR, 0666);
        ftruncate(fd_, sizeof(MarketDataBlock));

        ptr_ = mmap(nullptr, sizeof(MarketDataBlock),
                    PROT_READ | PROT_WRITE, MAP_SHARED, fd_, 0);

        // 建议内核使用大页（Huge Pages）减少 TLB miss
        madvise(ptr_, sizeof(MarketDataBlock), MADV_HUGEPAGE);
    }

    void write(const MarketData& data) {
        auto* block = static_cast<MarketDataBlock*>(ptr_);
        // 写入数据后 release，确保消费者能看到
        block->data.store(data, std::memory_order_release);
        block->sequence.fetch_add(1, std::memory_order_release);
    }
};

// 消费者：策略进程
class MarketDataShmReader {
    int fd_;
    const void* ptr_;

public:
    void init() {
        fd_ = shm_open("/market_data_feed", O_RDONLY, 0666);
        ptr_ = mmap(nullptr, sizeof(MarketDataBlock),
                    PROT_READ, MAP_SHARED, fd_, 0);
    }

    MarketData read() {
        auto* block = static_cast<const MarketDataBlock*>(ptr_);
        // acquire 保证读到完整数据
        return block->data.load(std::memory_order_acquire);
    }
};
```

**Unix Domain Socket（比共享内存慢，但更灵活）：**
```cpp
// 适用于需要流式传输或双向通信的场景
// 延迟 ~5-10μs（比 TCP 的 ~50μs 快一个数量级）
int uds = socket(AF_UNIX, SOCK_STREAM, 0);
struct sockaddr_un addr;
addr.sun_family = AF_UNIX;
strncpy(addr.sun_path, "/tmp/trading.sock", sizeof(addr.sun_path) - 1);
connect(uds, (struct sockaddr*)&addr, sizeof(addr));
```

### 3.3 网络协议栈优化

**TCP 延迟杀手与对策：**

```cpp
#include <netinet/tcp.h>

void optimize_tcp_socket(int sockfd) {
    // 1. 禁用 Nagle 算法 —— 小包立即发送，不等凑满
    int flag = 1;
    setsockopt(sockfd, IPPROTO_TCP, TCP_NODELAY, &flag, sizeof(flag));

    // 2. 禁用延迟 ACK（对端也需要设置）
    setsockopt(sockfd, IPPROTO_TCP, TCP_QUICKACK, &flag, sizeof(flag));

    // 3. 开启 TCP keepalive
    int keepalive = 1;
    setsockopt(sockfd, SOL_SOCKET, SO_KEEPALIVE, &keepalive, sizeof(keepalive));

    // 4. 增大 socket 缓冲区
    int bufsize = 1024 * 1024;  // 1MB
    setsockopt(sockfd, SOL_SOCKET, SO_RCVBUF, &bufsize, sizeof(bufsize));
    setsockopt(sockfd, SOL_SOCKET, SO_SNDBUF, &bufsize, sizeof(bufsize));
}
```

**内核旁路（Kernel Bypass）概念：**
- 正常路径：应用程序 → 系统调用 → 内核协议栈 → 网卡驱动 → 网卡
- Kernel Bypass：应用程序 → 用户态协议栈 → 直接读写网卡内存
- 代表技术：
  - **DPDK**：Intel 主导的用户态网卡驱动框架，绕过内核协议栈
  - **Solarflare OpenOnload**：Solarflare 网卡的内核旁路方案
  - **eBPF/XDP**：在网卡驱动层处理数据包（较新的方案）
- 延迟从 ~50μs 降至 ~1-5μs

**零拷贝发送：**
```cpp
// sendfile —— 内核空间直接传输，不经过用户态
sendfile(out_fd, in_fd, &offset, count);

// mmap —— 将文件映射到用户空间，避免 read 调用
void* mapped = mmap(nullptr, file_size, PROT_READ, MAP_PRIVATE, fd, 0);
// 直接通过指针访问数据，无拷贝
process(mapped, file_size);
```

### 3.4 时间与延迟测量

```cpp
#include <chrono>
#include <x86intrin.h>  // __rdtsc

// 方法 1：std::chrono —— 可移植但较慢
auto start = std::chrono::high_resolution_clock::now();
// ... do work ...
auto end = std::chrono::high_resolution_clock::now();
auto ns = std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();

// 方法 2：RDTSC —— 直接读 CPU 时间戳计数器，最快
// 需要在初始化时校准 TSC 频率
uint64_t tsc_start = __rdtsc();
// ... do work ...
uint64_t tsc_end = __rdtsc();
uint64_t cycles = tsc_end - tsc_start;
// 转换为纳秒：cycles * 1000 / tsc_freq_mhz
```

---

## 四、实战项目

> 以下三个项目覆盖交易系统开发的核心技能点，建议按顺序完成。

### 4.1 高性能限价订单簿（LOB）

**考察点：** 数据结构选择、内存布局、撮合算法

```
核心需求：
- 支持 Add / Cancel / Execute 三种操作
- 撮合引擎吞吐量 > 100万 ops/s
- 延迟 P99 < 1μs

数据结构设计：
  bids (降序)          asks (升序)
  ┌─────────┐        ┌─────────┐
  │ 105.00  │        │ 105.50  │
  │ 104.50  │        │ 106.00  │
  │ 104.00  │        │ 106.50  │
  └─────────┘        └─────────┘
  每个 PriceLevel 是一个 vector<Order>
```

**框架代码：**
```cpp
#include <vector>
#include <cstdint>
#include <algorithm>

using Price = double;
using Quantity = uint32_t;
using OrderId = uint64_t;

enum class Side { Buy, Sell };

struct Order {
    OrderId id;
    Price price;
    Quantity quantity;
    Side side;
};

class LimitOrderBook {
    struct PriceLevel {
        Price price;
        std::vector<Order> orders;

        Quantity total_quantity() const {
            Quantity total = 0;
            for (const auto& o : orders) total += o.quantity;
            return total;
        }
    };

    std::vector<PriceLevel> bids_;  // 降序
    std::vector<PriceLevel> asks_;  // 升序

public:
    void add_order(Order order) {
        auto& levels = (order.side == Side::Buy) ? bids_ : asks_;
        auto cmp = (order.side == Side::Buy)
            ? [](Price a, Price b) { return a > b; }
            : [](Price a, Price b) { return a < b; };

        auto it = std::lower_bound(levels.begin(), levels.end(), order.price,
            [&cmp](const PriceLevel& lvl, Price p) { return cmp(lvl.price, p); });

        if (it != levels.end() && it->price == order.price) {
            it->orders.push_back(std::move(order));
        } else {
            PriceLevel new_level;
            new_level.price = order.price;
            new_level.orders.push_back(std::move(order));
            levels.insert(it, std::move(new_level));
        }
    }

    // 撮合逻辑：市价单到达时匹配对手方最优价位
    std::vector<Order> match(Side aggressor_side, Quantity qty) {
        auto& counter_levels = (aggressor_side == Side::Buy) ? asks_ : bids_;
        std::vector<Order> fills;
        fills.reserve(16);

        while (qty > 0 && !counter_levels.empty()) {
            auto& best = counter_levels.front();
            while (qty > 0 && !best.orders.empty()) {
                auto& front = best.orders.front();
                Quantity fill_qty = std::min(qty, front.quantity);
                fills.push_back(front);
                fills.back().quantity = fill_qty;

                front.quantity -= fill_qty;
                qty -= fill_qty;

                if (front.quantity == 0) {
                    best.orders.erase(best.orders.begin());
                }
            }
            if (best.orders.empty()) {
                counter_levels.erase(counter_levels.begin());
            }
        }
        return fills;
    }

    Price best_bid() const noexcept {
        return bids_.empty() ? 0.0 : bids_.front().price;
    }
    Price best_ask() const noexcept {
        return asks_.empty() ? 0.0 : asks_.front().price;
    }
};
```

### 4.2 低延迟异步日志库

**考察点：** 环形缓冲区、生产者-消费者模式、IO 隔离

```
设计要点：
  Trading Thread → Ring Buffer → Logger Thread → Disk
  (热路径)        (无锁SPSC)    (后台线程)      (慢IO)

  关键：交易线程只做 memcpy 到 ring buffer，不阻塞
```

```cpp
#include <array>
#include <atomic>
#include <thread>
#include <cstdio>
#include <cstring>

class LowLatencyLogger {
    static constexpr size_t kBufferSize = 1 << 20;  // 1MB
    static constexpr size_t kMaxMsgSize = 256;

    struct alignas(64) Slot {
        char msg[kMaxMsgSize];
        uint32_t len;
    };

    alignas(64) std::atomic<uint64_t> write_pos_{0};
    alignas(64) std::atomic<uint64_t> read_pos_{0};
    std::array<Slot, kBufferSize / sizeof(Slot)> buffer_;
    std::thread writer_thread_;
    std::atomic<bool> running_{true};
    FILE* file_;

public:
    explicit LowLatencyLogger(const char* path)
        : file_(std::fopen(path, "a")) {
        writer_thread_ = std::thread([this] { write_loop(); });
    }

    ~LowLatencyLogger() {
        running_.store(false, std::memory_order_release);
        if (writer_thread_.joinable()) writer_thread_.join();
        if (file_) std::fclose(file_);
    }

    // 热路径：只做 memcpy + 更新 write_pos，纳秒级
    void log(const char* msg, uint32_t len) {
        if (len > kMaxMsgSize) len = kMaxMsgSize;
        uint64_t pos = write_pos_.fetch_add(1, std::memory_order_relaxed);
        size_t idx = pos % buffer_.size();
        std::memcpy(buffer_[idx].msg, msg, len);
        buffer_[idx].len = len;
    }

private:
    void write_loop() {
        uint64_t local_read = 0;
        while (running_.load(std::memory_order_acquire) || local_read < write_pos_.load(std::memory_order_acquire)) {
            uint64_t wp = write_pos_.load(std::memory_order_acquire);
            while (local_read < wp) {
                size_t idx = local_read % buffer_.size();
                std::fwrite(buffer_[idx].msg, 1, buffer_[idx].len, file_);
                ++local_read;
            }
            std::fflush(file_);
        }
    }
};
```

### 4.3 简单回测引擎

**考察点：** CSV 解析、向量化计算、STL 使用

```cpp
#include <fstream>
#include <sstream>
#include <vector>
#include <string>
#include <chrono>

struct Tick {
    uint64_t timestamp;
    double bid_price;
    double ask_price;
    uint32_t bid_size;
    uint32_t ask_size;
};

class Backtester {
    std::vector<Tick> ticks_;

public:
    void load_csv(const char* path) {
        std::ifstream file(path);
        std::string line;
        ticks_.reserve(1'000'000);  // 预分配

        while (std::getline(file, line)) {
            Tick t;
            char comma;
            std::istringstream ss(line);
            ss >> t.timestamp >> comma
               >> t.bid_price >> comma >> t.ask_price >> comma
               >> t.bid_size >> comma >> t.ask_size;
            ticks_.push_back(t);
        }
    }

    // 简单策略：spread 超过阈值时做市
    double run(double threshold) {
        double pnl = 0.0;
        double position = 0.0;

        for (const auto& tick : ticks_) {
            double spread = tick.ask_price - tick.bid_price;
            if (spread > threshold && position == 0.0) {
                // 买入 bid，卖出 ask
                position += tick.bid_size;
                pnl -= tick.bid_price * tick.bid_size;
            } else if (position > 0.0 && spread <= threshold) {
                // 平仓
                pnl += tick.ask_price * position;
                position = 0.0;
            }
        }
        return pnl;
    }
};
```

---

## 五、面试高频考点速查

### 5.1 语言层面

| 考点 | 要点 |
|------|------|
| 虚函数机制 | vtable 指针、每个对象多 8 字节、间接调用无法内联 |
| 移动语义 | 右值引用 `T&&`、`std::move` 只是 cast、移动后源对象不可用 |
| 智能指针开销 | `unique_ptr` 零开销、`shared_ptr` 原子引用计数 |
| RAII | 析构函数自动调用、异常安全、锁的 guard 模式 |
| 模板特化 | 全特化 / 偏特化、SFINAE / `if constexpr` |
| `constexpr` | 编译期求值、`const` vs `constexpr` 区别 |

### 5.2 并发层面

| 考点 | 要点 |
|------|------|
| mutex vs spinlock | mutex 会陷入内核、spinlock 忙等但延迟可预测 |
| `std::atomic` 的开销 | `seq_cst` 最慢、`relaxed` 最快、x86 上 acquire/release 几乎免费 |
| false sharing | 同一缓存行的不同变量被多核写入 |
| lock-free vs wait-free | lock-free 保证系统级前进、wait-free 保证每个操作有限步完成 |
| ABA 问题 | 原子指针从 A → B → A，CAS 误判已变化 |

### 5.3 系统层面

| 考点 | 要点 |
|------|------|
| epoll vs select | O(1) vs O(n)、epoll 只返回就绪 fd |
| ET vs LT | ET 必须一次读完、LT 重复通知 |
| shared memory | `shm_open` + `mmap`、需要同步机制配合 |
| TCP_NODELAY | 禁用 Nagle、小包立即发 |
| context switch 代价 | 寄存器保存恢复、TLB 刷新、~1-10μs |
| huge pages | 2MB/1GB 大页、减少 TLB miss |

### 5.4 经典面试题

**Q1: 实现一个线程安全的单例**
```cpp
// C++11 保证静态局部变量的线程安全初始化
class TradingEngine {
public:
    static TradingEngine& instance() {
        static TradingEngine engine;  // 线程安全
        return engine;
    }
    TradingEngine(const TradingEngine&) = delete;
    TradingEngine& operator=(const TradingEngine&) = delete;
private:
    TradingEngine() = default;
};
```

**Q2: 如何测量函数执行时间**
```cpp
// 禁止用 clock() —— 精度不够
// 用 rdtsc 或 chrono::high_resolution_clock
// 注意：测量本身有开销，需多次测量取最小值
```

**Q3: 解释 cache line 和 false sharing**
```
CPU 缓存以 64 字节行为单位
多线程写同一行的不同变量 → 缓存一致性协议（MESI）不断失效该行
解决方案：padding / alignas(64) / thread_local
```

**Q4: volatile 和 atomic 的区别**
```
volatile：防止编译器优化（不缓存到寄存器），但不保证原子性和内存顺序
atomic：保证原子性 + 可指定内存顺序
交易系统中 volatile 几乎不用（不像 Java 的 volatile 有 happens-before 语义）
```

---

## 六、推荐资源

### 书籍（按优先级排序）

| 书名 | 作用 | 阅读建议 |
|------|------|---------|
| 《Effective Modern C++》 | C++11/14 避坑指南 | 通读，每条都是实战经验 |
| 《C++ Concurrency in Action》 | 并发编程圣经 | 重点读第 5-7 章（内存模型与原子操作） |
| 《Linux System Programming》 | 系统调用详解 | 重点读文件 I/O、内存映射、进程间通信 |
| 《Computer Systems: A Programmer's Perspective》 | 底层原理 | 已有基础可跳读，重点 6/9/12 章 |

### 开源项目（阅读/参考）

| 项目 | 说明 |
|------|------|
| [QuickFIX](https://github.com/quickfix/quickfix) | FIX 协议的 C++ 实现，了解交易协议 |
| [Disruptor-like SPSC queue](https://github.com/rigtorp/SPSCQueue) | 极简无锁队列，适合学习 |
| [LOBSTER](https://lobsterdata.com/) | 限价订单簿数据集，用于回测练习 |

### 工具（必须掌握）

| 工具 | 用途 | 常用命令 |
|------|------|---------|
| `perf` | 性能分析 | `perf stat ./trading_engine`、`perf record -g` |
| `valgrind` | 内存泄漏检测 | `valgrind --leak-check=full ./trading_engine` |
| `CMake` | 构建系统 | `cmake -B build && cmake --build build` |
| `gdb` | 调试 | `gdb ./trading_engine`、`bt full` 查看调用栈 |
| `strace` | 系统调用追踪 | `strace -c ./trading_engine` 查看系统调用耗时分布 |
| `numactl` | NUMA 感知 | `numactl --cpunodebind=0 --membind=0 ./trading_engine` |

### 学习路线建议

```
Week 1-2: C++ 基础 + RAII + 移动语义
          └─ 完成：用 unique_ptr 管理资源，理解 std::move

Week 3-4: 并发编程 + atomic
          └─ 完成：实现 SPSC 队列，理解内存顺序

Week 5-6: Linux 编程 + epoll
          └─ 完成：实现简易 Reactor，能收发 TCP 数据

Week 7-8: 项目实战
          └─ 完成：限价订单簿 + 异步日志库

Week 9-10: 性能调优
          └─ 完成：用 perf 分析瓶颈，做 benchmark
```
