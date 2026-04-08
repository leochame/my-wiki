## 1. 进程管理

### 1.1 创建进程

自然的想法是：

创建状态机 spawn(path, argv)
销毁 _exit

但是 UNIX 不一样

-  fork 做一份状态机的复制
- execve 复位

