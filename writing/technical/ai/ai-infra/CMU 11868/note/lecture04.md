# CMU 11-868 第 4 讲：深度学习框架与自动微分

核心问题：`loss.backward()` 怎样自动计算网络中每个参数的梯度？

## 核心概念

- **损失与梯度**：损失衡量预测误差，梯度描述参数变化对损失的局部影响。
- **计算图**：用节点表示变量和运算，用边表示依赖，按拓扑顺序进行计算。
- **自动微分**：利用各算子的局部导数和链式法则反向传播；同一变量来自多条路径的梯度需要累加。
- **框架设计**：组织 Tensor、参数、算子及其前向和反向接口，支持计算与自动求导。

## 第一部分：损失、梯度与更新

以 $\hat y=wx$ 为例：输入 $x=2$ 和答案 $y=6$ 固定，训练调整参数 $w$。选择平方误差：

$$
L(w)=(2w-6)^2,\qquad \frac{dL}{dw}=4(2w-6)
$$

损失衡量预测好坏，梯度给出局部变化方向，更新规则决定怎样调整参数：

$$
\theta_{t+1}=\theta_t-\eta\nabla_{\theta}L(\theta_t)
$$

其中 $\theta$ 是参数，$\eta$ 是学习率。单参数时，梯度为负则增大参数，为正则减小参数。

从 $w=1$ 出发，梯度为 $-16$。取 $\eta=0.1$，更新到 $w=2.6$，损失从 $16$ 降到 $0.64$；若 $\eta=1$，则更新到 $w=17$，损失反而增至 $784$。负梯度是局部下降方向，步长过大仍可能使损失上升。

一次更新对应四步：

```python
prediction = w * x
loss = (prediction - y) ** 2
gradient = 2 * (prediction - y) * x
w = w - learning_rate * gradient
```

以上为补充教学示例。接下来的计算图与自动微分，解释框架如何自动完成 `gradient` 的计算。

## Sources

- [CMU 11-868 2026 Fall 官方授课计划](https://llmsystem.github.io/llmsystem2026fall/docs/Syllabus/)
- [第 4 讲官方讲义：Deep Learning Framework and Auto Differentiation](https://llmsystem.github.io/llmsystem2026fall/slides/llmsys-04-dlframework.pdf)
