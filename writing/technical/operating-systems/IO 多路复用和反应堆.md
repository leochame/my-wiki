# 一、I/O 多路复用

为每个请求分配一个进程/线程的方式不合适，那有没有可能只使用一个进程来维护多个 Socket 呢？
答案是有的，那就是 I/O 多路复用技术。

一个进程虽然任一时刻只能处理一个请求，但是处理每个请求的事件时，耗时控制在 1 毫秒以内，这样 1 秒内就可以处理上千个请求，把时间拉长来看，多个请求复用了一个进程，这就是多路复用。

## (一) Select

`select` 函数在 Linux 网络编程中用于多路复用，它可以帮助程序监控多个文件描述符（例如套接字），并检测哪些文件描述符可读、可写或发生了异常。
这样可以避免使用阻塞式 I/O，允许程序同时处理多个连接。

### 1. Select 函数

```
#include <sys/select.h>
#include <sys/time.h>
#include <unistd.h>

int select(int nfds, fd_set *readfds, fd_set *writefds, 
                   fd_set *exceptfds, struct timeval *timeout);
```

参数解释：

- nfds: 监控的最大文件描述符加1。通常是所有文件描述符中最大值加1。
- readfds: 用于检测可读的文件描述符集合（`fd_set` 类型）。`select` 返回后，`readfds` 中只会留下那些有数据可读的文件描述符。属于传入传出参数。3用于检测可写的文件描述符集合。返回类似 `readfds`，属于传入传出参数。
- exceptfds: 用于检测异常的文件描述符集合。返回条件类似`readfds`，属于传入传出参数。
- timeout: 等待的最大时间。如果为 `NULL`，表示无限期等待；如果为 `0`，表示立即返回；如果设置了具体的时间结构，它会在指定的时间内返回。

返回值：

- 返回大于0的整数，表示可操作的文件描述符数量。
- 返回0，表示超时。
- 返回-1，表示出现错误，`errno` 会被设置。

以下代码就是 fd_set 结构体，fd_set结构体仅包含一个整型数组，该数组的每个元素的每一位（bit）标记一个文件描述符。可以监听的个数依赖于这个数组的大小（1024）。

```
#include＜typesizes.h＞
#define__FD_SETSIZE 1024
#include＜sys/select.h＞
#define FD_SETSIZE__FD_SETSIZE
typedef long int__fd_mask;
#undef__NFDBITS
#define__NFDBITS(8*(int)sizeof(__fd_mask))
typedef struct{
	#ifdef__USE_XOPEN
	__fd_mask fds_bits[__FD_SETSIZE/__NFDBITS];
	#define__FDS_BITS(set)((set)-＞fds_bits)
	#else
	__fd_mask__fds_bits[__FD_SETSIZE/__NFDBITS];
	#define__FDS_BITS(set)((set)-＞__fds_bits)
	#endif
}fd_set;
```

### 2. Select 的原理

select 实现多路复用的方式是，将已连接的 Socket 都放到一个文件描述符集合：

1. 然后调用 select 函数将文件描述符集合拷贝到内核里，让内核来检查是否有网络事件产生。
2. 检查的方式很粗暴，就是通过遍历文件描述符集合的方式，当检查到有事件产生后，将此 Socket 标记为可读或可写。
3. 接着再把整个文件描述符集合拷贝回用户态里。
4. 然后用户态还需要再通过遍历的方法找到可读或可写的 Socket，然后再对其处理。

所以，对于 select 这种方式，需要进行 2 次「遍历」文件描述符集合，一次是在内核态里，一个次是在用户态里 ，而且还会发生 2 次「拷贝」文件描述符集合，先从用户空间传入内核空间，由内核修改后，再传出到用户空间中。

### 3. 创建 select 应用

我们来看下 server 端怎么简易创建一个 select 应用，这是大致代码流程：

```
// 创建套接字
lfd = socket(); 
// 绑定地址结构
bind(); 
// 设置监听上限
listen(); 
// 创建r监听集合
fd_set rset, allset; 
// 将r监听集合清空
FD_ZERO(&allset); 
// 将lfd添加至读集合中
FD_SET(lfd, &allset); 
while (1) {
    // 保存监听集合
    rset = allset; 
    // 监听文件描述符集合对应事件
    int ret = select(lfd+1, &rset, NULL, NULL, NULL); 
    if (ret > 0) {
        // 判断监听文件描述符在不在返回的集合当中 1在，0不在
        if (FD_ISSET(lfd, &rset)) {
            // 建立连接，返回用于通信的文件描述符
            cfd = accept(); 
            // 添加到监听通信描述符集合中
            FD_SET(lfd, &allset); 
        }
		for( i =  lfd + 1; i <= 最大文件描述符; i++){
			FD_ISSET(i,&rset) //有读写事件
			read()
			// 省略发生的操作
			write()
		}
    }
}
```

这里存在一个问题，就是即使是监听一个，但是轮询还是全部轮询。

当然这里可以用数组存储监听的集合，只轮询这个数组，就降低了轮询事件。检测满足条件的 fd,只能自己添加业务逻辑提高。提高了编码难度。如果不然只能轮询全部找出来。

## (二) Poll

poll 其实是一个半成品。

poll 用动态数组，以链表形式来组织关注的文件描述符，突破了 select 的文件描述符个数限制，当然还会受到系统文件描述符限制。

但本质上没有改变。

```
#include＜poll.h＞
int poll(struct pollfd*fds,nfds_t nfds,int timeout);
```

pollfd结构体的定义如下：

```
struct pollfd{
	int fd;/*文件描述符*/
	short events;/*注册的事件*/
 	short revents;/*实际发生的事件，由内核填充*/
};
```

做的改进就是将传入传出分开。根据 revents 成员判断发生了什么事件。

nfds参数指定实际上被监听事件集合fds的大小。

```
struct pollfd pfs[1024];
pfs[0].fd = lfd;
pfs[0].events = POLLIN;
pfs[0].revents = 0;
pfs[1].fd = cfd1;
pfs[1].events = POLLIN;
pfs[1].revents = 0;
pfs[2].fd = cfd2;
pfs[2].events = POLLIN;
pfs[2].revents = 0;
//省略 ...
while (1) {
    int ret = poll(pfs, 5, -1);
    for (i = 0;i < 5; i++)
        if (pfs[i].revents & POLLIN) {
            Accept();
            Read/write();
        }
}
```

## (三) Epoll

epoll 相较于 select 能明显提高程序在大量并发连接中只有少量活跃情况下的 CPU 利用率。

- 因为它会复用文件描述符集合来传递结果而不用开发者每次等待事件之前都必须重新准备要被侦听的文件描述符集合。
- 另一点原因就是获取事件的时候，它无须遍历整个被侦听的描述符集，只要遍历那些被内核 IO 事件异步唤醒而加入 Ready 队列的描述符集合就行了。


### 1. Epoll 常用函数

Epoll 本质是一棵红黑树。

Epoll把用户关心的文件描述符上的事件放在内核里的一个事件表中，从而无须像`select`和`poll`那样每次调用都要重复传入文件描述符集或事件集。但`epoll`需要使用一个额外的文件描述符，来唯一标识内核中的这个事件表。

`epoll_create`: 创建 epoll 模型，efd 指向红黑树 root 节点 fd，也就是唯一标识内核中事件表的文件描述符。

```
#include＜sys/epoll.h＞
int epoll_create(int size);
```

---

`epoll_ctl`： 用于控制 epoll 实例，向 epoll 实例中添加、修改或删除监听的文件描述符。

```
int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event);
```

- `epfd`：`epoll_create` 返回的 epoll 文件描述符。
- `op`：操作类型，常用的操作有：

- `EPOLL_CTL_ADD`：将文件描述符添加到 epoll 实例。
- `EPOLL_CTL_MOD`：修改已添加的文件描述符。
- `EPOLL_CTL_DEL`：从 epoll 实例中删除文件描述符。

- `fd`：需要监听的文件描述符。
- `event`：`epoll_event` 结构体，事件结构体，指定要监听的事件类型。

`epoll_event` 结构体用于描述需要监听的事件以及返回的事件类型。

```
struct epoll_event {
    uint32_t events;  // 需要监听的事件类型
    epoll_data_t data; // 用户自定义数据，通常为文件描述符
};
```

- `events`：指定需要监听的事件，可以是以下之一或多个的组合：

- `EPOLLIN`：文件描述符可读（带数据到达或可接受连接）。
- `EPOLLOUT`：文件描述符可写（可以写数据）。
- `EPOLLERR`：发生错误。
- `EPOLLHUP`：文件描述符挂起。
- `EPOLLPRI`：有优先级数据可读取。
- `EPOLLET`：边缘触发模式（Edge Triggered）。
- `EPOLLONESHOT`：事件发生后删除监听（适用于需要一次性处理的事件）。

- `data`：可以用来存放任何类型的数据，通常存放文件描述符，用于标识事件关联的对象。

---

`epoll_wait`： 返回发生事件的文件描述符的数量，即事件的个数.

```
int epoll_wait(int epfd, struct epoll_event *events, int maxevents, int timeout);
```

- `epfd`：`epoll_create` 返回的 epoll 文件描述符。
- `events`：传出参数。存放返回的发生事件的 `epoll_event` 数组。该数组在函数返回后会被填充，表示发生了哪些事件，应用程序需要通过检查这些事件来进行相应的处理。
- `maxevents`：`events` 数组的大小，即最多能返回多少个事件。
- `timeout`：超时时间，单位为毫秒。`timeout` 为 0 表示非阻塞，`timeout` 为 -1 表示阻塞直到有事件发生。

`epoll_wait`函数如果检测到事件，就将所有就绪的事件从内核事件表（由epfd参数指定）中复制到它的第二个参数`events`指向的数组中。

这个数组只用于输出`epoll_wait`检测到的就绪事件，而不像`select`和`poll`的数组参数那样既用于传入用户注册的事件，又用于输出内核检测到的就绪事件。

---
### 2. Epoll 的工作过程

1. **收集与管理** (`epoll_create` & `epoll_ctl`)： 单线程将所有需要处理的 Socket 文件描述符（FD）注册到内核中。内核底层会维护一个红黑树（Red-Black Tree）来高效存储和管理这些数以万计的连接。
2. **事件感知 (网卡中断)**： 当某个客户端的数据包通过网络到达网卡时，网卡会向 CPU 发起硬件中断。Linux 内核的网络协议栈解析出数据后，会将对应的 FD 标记为“就绪”状态，并通过回调机制将其放入一个就绪链表（Ready List）中。
3. **按需处理** (`epoll_wait`)： 处理线程平时只会阻塞在 `epoll_wait` 这一个系统调用上。一旦就绪链表中有连接准备好（无论是可读还是可写），`epoll_wait` 就会立刻返回，把这些“活跃”的连接打包交给应用层线程。线程随后只需要通过循环去处理这些真正有数据交互的连接即可。

### 3. Epoll 的优势与优化

**突破 1024 上限**
epoll 的个特点就是突破了 1024 文件描述符上限，epoll 的上限由硬件决定。
- 可以使用 cat 命令查看一个进程可以打开的 socket 描述符上限：`cat /proc/sys/fs/file-ma`
- 如有需要，可以通过修改配置文件的方式修改该上限值：`sudo vi /etc/security/limits.conf`
----
**数据结构和 Copy 过程发生改变**

第一点，epoll 在内核里使用红黑树来跟踪进程所有待检测的文件描述字，把需要监控的 socket 通过 `epoll_ctl()`函数加入内核中的红黑树里。（红黑树是个高效的数据结构，增删改一般时间复杂度是 `O(logn)`）。

而 `select/poll` 内核里没有类似 `epoll` 红黑树这种保存所有待检测的 `socket` 的数据结构，所以 `select/poll` 每次操作时都传入整个 `socket` 集合给内核，而 `epoll` 因为在内核维护了红黑树，可以保存所有待检测的 `socket`，所以只需要传入一个待检测的 `socket`，减少了内核和用户空间大量的数据拷贝和内存分配。

_第二点_， epoll 使用事件驱动的机制，内核里维护了一个链表来记录就绪事件，当某个 socket 有事件发生时，通过回调函数内核会将其加入到这个就绪事件列表中，当用户调用 `epoll_wait()` 函数时，只会返回有事件发生的文件描述符的个数，不需要像 select/poll 那样轮询扫描整个 socket 集合，大大提高了检测的效率。

![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1740909152329-aa017d17-e15e-4674-94c3-9b60f2572903.png)

## (四) LT 和 ET 模式

epoll对文件描述符的操作有两种模式：

- LT（Level Trigger，水平触发）模式
- ET（Edge Trigger，边沿触发）模式。上升沿和下降沿。

![](https://cdn.nlark.com/yuque/0/2025/jpeg/40540759/1737437284898-cf6a33e6-0bf7-4ddb-a780-d331b4b75c1f.jpeg)

LT模式（Level-Triggered）：状态驱动。 只要 Socket 的接收缓冲区里还有数据，内核就会一直通知。
具体表现为： `epoll_wait` 检测到文件描述符上有事件发生后，事件会被通知应用程序。如果应用程序没有处理该事件，下一次调用 `epoll_wait` 时，事件仍然会被再次通知，直到事件被处理。

---

ET模式（Edge-Triggered）：事件驱动。内核只在状态发生变化（比如从无数据变成有数据，或者新来了一批数据）的那一瞬间，通知一次。
具体表现为：当 `epoll_wait` 检测到文件描述符上有事件发生后，事件会通知应用程序。但是，一旦事件被通知，应用程序必须立即处理。如果没有处理，后续的 `epoll_wait` 调用不会再通知该事件。因此，应用程序必须在一次 `epoll_wait` 调用中完成事件的处理。

---

在 ET 模式中你需要意识到，这一次读的字符串不一定是导致触发的字符串。比如上一次发送了`aaaa\nbbbb\n`，只读了`aaaa\n`，你需要等待下一次`cccc\n`传递过来，再读取`bbbb\n`。

ET 模式是一种高效模式，只支持非阻塞模式—忙轮询。LT 当然也可以设置为非阻塞通过设置 `connectfd` 为非阻塞。

---

```
/*监听连接事件lfd*/
lfd = socket（）;			
bind();
listen();

/* epfd, 监听红黑树的树根*/
int epfd = epoll_create(1024);

/*tep, 用来设置单个fd属性， ep 是 epoll_wait() 传出的满足监听事件的数组*/
struct epoll_event tep, ep[1024];			

/* 初始化  lfd的监听属性*/
tep.events = EPOLLIN;					
tep.data.fd = lfd

/*将 lfd 添加到监听红黑树上*/
epoll_ctl(epfd， EPOLL_CTL_ADD, lfd, &tep);		

while (1) {
	
	/*实施监听*/
	ret = epoll_wait(epfd， ep，1024， -1);			

	for (i = 0; i < ret; i++) {

		if (ep[i].data.fd == lfd) {		//lfd 满足读事件，有新的客户端发起连接请求	

			cfd = Accept();
			
			/*初始化  cfd的监听属性*/
			tep.events = EPOLLIN;				
			tep.data.fd = cfd;

			epoll_ctl(epfd， EPOLL_CTL_ADD, cfd, &tep);

		} else { //cfd 们 满足读事件， 有客户端写数据来。						

			n = read(ep[i].data.fd, buf, sizeof(buf));

			if ( n == 0) {

				close(ep[i].data.fd);

				/* 将关闭的cfd，从监听树上摘下*/
				epoll_ctl(epfd， EPOLL_CTL_DEL, ep[i].data.fd , NULL);	

			} else if （n > 0） {

				小--大
				write(ep[i].data.fd, buf, n);
			}
		}
	}
}
```

# 二、Reactor 和 Proactor

| **维度**             | **Reactor (同步非阻塞 I/O)**                 | **Proactor (异步 I/O)**                                                                      |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| **内核态通知的内容**       | 状态**就绪** (数据在内核，可以读了)                   | 操作**完成** (数据已在用户空间，可以用了)                                                                   |
| **谁负责从内核拷贝数据到用户态** | **应用程序** (调用 `read()` 占用应用线程 CPU)       | **操作系统内核** (后台完成，应用线程不参与拷贝)                                                                |
| **I/O 耗时的体现**      | 网络等待耗时不阻塞，但**数据拷贝阶段依然占用应用线程时间片**。       | 应用线程完全不参与 I/O 等待与拷贝，**真正做到了零等待**。                                                          |



## epoll 和反应堆

事件节点直接记录文件描述符（`fd`）。事件就绪返回 `fd` 时，程序必须通过哈希表或数组进行二次查表，才能定位到该连接对应的缓冲区和回调逻辑，产生查找开销。

事件节点记录泛型指针（`ptr`），该指针指向包含 `fd`、状态、缓冲区及回调函数的上下文对象（如 `Channel`）。事件就绪时，内核原样返回此内存指针。程序获取后直接执行类型强转，瞬间定位上下文对象并触发业务逻辑，彻底消除查表寻址的性能损耗。

所以在这里我们以 ptr 为例子，来讲解整个内容。


![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1740914524932-8de592cd-89ac-40b3-af66-ab185120cf0f.png)

1. `epoll_wait`返回的时候，返回有变化的事件节点，节点中保存的事件信息就是调用`epoll_ctl`函数上树的事件信息。

2. 由此可以获得`ptr`指向的结构体信息，也就能够获取对应的文件描述符、事件和回调函数，最终调用回调函数处理该事件，而回调函数是由用户自己编写的。

3. `ptr`实际指向的是一个结构体，这个结构体中至少包含文件描述符、事件和回调函数。

4. 完成读操作后将该文件描述符对应的事件修改为写事件。


![](https://cdn.nlark.com/yuque/0/2025/png/40540759/1740916664743-db4ce828-fb33-47fe-87cd-1741cde8c895.png)
