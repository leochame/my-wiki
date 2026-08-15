
## DeepSeek V4 之前的特性


**MTP** 要求模型在给定当前文本时，**同时预测接下来的多个词元**（例如同时预测第 i+1、i+2 个词）


## DeepSeek 新特性

V4这一代，是DeepSeek系列里动刀最多的一版。相比V3，V4在三个地方做了升级。

第一，引入mHC（Manifold-Constrained Hyper-Connections）强化残差连接。

第二，设计hybrid attention架构，CSA和HCA交替叠加，解决长文效率问题。

第三，采用Muon作为主优化器。


### CSA & HCA

V4的注意力层不是一种，是两种交替使用的结构，CSA（Compressed Sparse Attention）和HCA（Heavily Compressed Attention）。

CSA做两件事，**先压缩，再稀疏选择**。

第一步，KV压缩。 每m个token的KV entries，通过一个带学习权重的attention-like机制压成一个。

第二步，lightning indexer + top-k选择。**这部分继承自V3.2的DSA。对每个query token，用一个轻量的indexer计算它和每个压缩KV块的相关性分数。

第三步，core attention。 在选中的这top-k压缩KV块上做Multi-Query Attention，得到注意力输出。

第四步，grouped output projection。 因为V4把head dimension c设成了512（比V3.2的128大得多），如果直接把所有head的输出投影回d维会很贵，所以做了分组投影，把n_h个head分成g组，每组先投影到一个中间维度d_g，最后再合并投影回d。

整个CSA等于做了两层压缩。第一层是序列长度压缩，n变成n/m。第二层是稀疏选择，n/m变成top-k。对1M token的序列，原本需要attend 1M个token，现在只需要attend 1024个压缩块。

HCA的思路更简单粗暴，压得更狠，但不做稀疏。

压缩率m’=128，每128个token压成一个。压缩过程也没有CSA那样的overlap，直接每m’个一组压。然后对所有压缩后的KV做dense attention。

CSA的压缩温和、靠稀疏把关，适合做token-level的精细检索。HCA的压缩凶猛、保持dense，适合做长距离的全局信号汇总。


### Muon优化器

传统的优化器（如 AdamW）是逐元素（Element-wise）工作的。它为每一个参数独立计算学习率和梯度缩放。Muon 的不同之处在于：确保整个参数矩阵作为一个整体，始终沿着效率最高且最稳定的正交路径向终点前进。