Chunk :chunk 是每次处理多少个 KV token

ompact probability 数据流\
完整保存所有 probability 会占很多显存，所以系统把 KV 序列切成小段：\
KV 序列\
-> chunk 0：计算 probability\
-> chunk 1：计算 probability\
-> chunk 2：计算 probability\
-> 再用这些 probability 计算 value\
compact probability 的意思是：只保存压缩后的中间权重，之后再读取它计算 V，而不是一次性保存完整的大矩阵。

​

head 调参\
MLA 有多个 attention head。可以决定一个程序一次处理几个 head：

​

persistent 调参：

普通 kernel 通常是

启动程序\
-> 做一点工作\
-> 结束

persistent kernel 更像：

启动少量长期驻留的程序\
-> 程序不断领取多个任务\
-> 处理完后继续处理下一个任务

​

***

​

QK\
-> softmax\
-> probability\
-> V\
-> reduce

​

split-KV producer\
-> QK\_NOPE + QK\_PE\
-> online softmax\
-> 直接 probability × V\
-> 输出 partial O、m、l

reducer\
-> 合并 partial O、m、l

​

***

作者则把长 KV 序列切成多个 KV segment，让多个 producer 并行处理同一个 sequence。

​

​
