# Session Replay Todo List

## Background

当前 session replay 在大 DOM 场景下的主要风险点有两类：

1. SDK 自身的 mutation 序列化链可能在极端场景下放大主线程开销。
2. 页面和浏览器本身的布局/重排成本很高，容易和 SDK 开销混在一起，导致问题边界不清。

前一轮基于“节点预算”的保护已经回退。后续方案改为优先推进“时间片化 mutation 序列化”，目标是限制单次 mutation flush 对主线程的连续占用时长，而不是靠静态节点数阈值硬截断。

## Goals

- 让大 DOM mutation 不再以单个长任务的形式持续占住主线程。
- 保持现有 replay 协议和消费端语义不变。
- 不再引入 full snapshot fallback。
- 先控制 `childList add` 场景，再评估是否扩展到更多 mutation 类型。

## Non-Goals

- 不在第一版里改 full snapshot 序列化。
- 不在第一版里引入 worker 化 DOM 序列化。
- 不在第一版里改 replay event schema。
- 不在第一版里追求极端场景下的 100% 回放完整性。

## Current Findings

### Confirmed

- `deep 2500` 这种极深单链场景，浏览器自身的布局/重排已足够成为主瓶颈，不能再作为 SDK 主验证场景。
- `dashboard 2500` 这种更接近 SPA 路由切换的场景里，SDK 有额外开销，但目前 trace 里主峰仍是浏览器布局链，不是 `dataflux-rum.js`。
- hidden 节点不再默认读取 `getBoundingClientRect()` 的优化已保留，可继续作为现状基线。

### Open Questions

- `childList add` 时间片化后，后续 attribute/text mutation 是否需要延后对齐，避免顺序错乱。
- 一个新增根节点如果跨多个时间片才完成，最稳妥的 emit 时机应该是“根节点完成后统一 emit”，还是允许部分展开后逐步 emit。

## Proposed Design

### Design Principles

- 限制的是单次主线程连续占用时长，不再把静态节点预算作为长期主方案。
- 对外 replay 协议、事件类型和消费端语义保持不变。
- 内部允许分片推进，但对外仍坚持“完整 add 再可见”。
- 第一版只收口 `childList add`，不同时重写全部 mutation 类型。
- 优先保证正确性和可回退性，再逐步追求吞吐。

### Scope Of Phase 1

第一版只覆盖下面这条链：

- `MutationObserver` 收到 `childList` 的 `addedNodes`
- 大子树序列化改成显式任务队列 + 时间片推进
- 根节点完整序列化完成后，再一次性 emit `add`

第一版暂时不改：

- `characterData`
- `attributes`
- `removes`
- full snapshot 序列化
- replay 事件协议

### Internal Task Model

内部新增一层 pending root task，避免继续把“采集”和“提交”绑死在同一个同步调用栈里。

建议结构：

```js
{
  generation,
  rootNode,
  rootSerializedNode,
  rootSerializedNodeId,
  parentId,
  nextId,
  status: 'pending' | 'serializing' | 'completed' | 'cancelled',
  stack,
  pendingAttributeMutations,
  pendingTextMutations,
  pendingRemoveMutations
}
```

核心约束：

- 一个新增根节点对应一个 task
- task 内部维护显式 `stack`
- task 可以跨多个时间片推进
- 只有 `completed` 才允许对外 emit

### Scheduler

引入内部时间片调度器，初始常量：

- `MUTATION_SERIALIZATION_SLICE_MS = 4`

调度规则：

1. `childList add` 到来时创建 pending root tasks。
2. 如果当前没有 active scheduler，立即排一轮消费。
3. 每轮消费最多执行 `4ms`。
4. 超时后用 `setTimeout(..., 0)` 继续下一轮。
5. generation 变化后，旧任务全部失效。

### Stable Identity Before Expansion

为避免跨时间片后 `parentId` / `nextId` 漂移，root task 创建时只做一层很轻的同步工作：

- 计算 `parentId`
- 计算 `nextId`
- 为 root 分配稳定序列化 id

第一版不要求在这一阶段同步展开整棵子树，只要求：

- 根级引用关系稳定
- 后续 task 推进时不再重新计算这些根级引用

### Emit Strategy

第一版固定采用：

- 根节点完整序列化后统一 emit

不采用：

- 半棵树先 emit，后续再补 childNodes

这样做的原因是：

- 时序最稳
- 对现有 replay 消费端影响最小
- 更容易和后续 `attributes` / `text` 对齐

## Correctness Strategy

### Attribute / Text Reordering

如果某个 attribute/text mutation 命中的节点属于 pending root：

- 不立刻 emit
- 先缓存在对应 task 的 pending 队列
- 等 root add emit 后，再按原顺序补发

目标是避免：

- 节点还没出现，属性先改了
- 文本先变了，但节点树还没建立

### Remove Cancels Pending Root

如果一个 pending root 在 emit 前就被移除：

- 直接将 task 标记为 `cancelled`
- 清掉该 task 相关的 pending attribute/text
- 不再发这条 root add

目标是避免“节点已经被删，后面又补出一棵旧树”。

### Generation Isolation

所有 pending task 都必须带 `generation`。

遇到下面场景时，直接推进 generation：

- `takeSubsequentFullSnapshot()`
- recorder `stop()`
- session replay recorder 重新启动

旧 generation 的 task 即使后续异步完成，也不能再：

- 写回当前状态
- emit add
- emit pending attribute/text/remove

### Order Guarantees

第一版要守住这几个顺序约束：

1. 同一批新增根节点仍按当前 topological 排序进入 task 队列。
2. 同一个 root task 内部仍按 DOM 顺序展开。
3. root add 必须早于它的 pending attribute/text。
4. 被取消的 root 不能在 remove 之后再次出现。

## Implementation Outline

### Step 1

在 `mutationObserver.js` 抽出一层只负责 `childList add` 的任务构建逻辑：

- 收集新增根节点
- 生成 pending root tasks
- 启动内部 scheduler

### Step 2

在 `serialize.js` 新增仅供 mutation 使用的显式队列遍历器：

- 不走递归
- 支持分次推进
- 支持返回 `completed / pending`

### Step 3

在 `mutationObserver.js` 增加 pending mutation 缓存逻辑：

- attribute
- characterData
- remove

只要命中 pending root 子树，就挂起而不是立刻 emit。

### Step 4

在 `record.js` 接 generation reset：

- full snapshot
- stop
- restart

## Rollback Safety

为了保证这条改动可控，第一版需要保留清晰的回退边界：

- 新逻辑仅包裹 `childList add`
- 其余 mutation 继续走原同步路径
- 内部 scheduler 只在检测到 pending root tasks 时启用
- 如验证失败，可整体回退到同步 `childList add` 路径，不影响 canvas / segment / session 主逻辑

## Success Criteria

可以认为 Phase 1 成功的标志是：

- `dashboard 2500` 场景下，SDK 不再形成明显单个长任务主峰
- 不出现 add/attribute/text 顺序错乱
- 不出现 full snapshot 与 pending task 污染
- 不引入新的 public API 和配置项
- demo 和真实业务页中，页面可交互性优于当前同步 mutation 序列化路径

## Phase Plan

## Phase 1: Baseline And Instrumentation

- [ ] 固化一个更接近真实路由切换的 demo 大 DOM 场景，避免继续依赖极深单链。
- [ ] 建立 replay on/off 的 trace 对照基线。
- [ ] 在本地记录以下指标，先不对外暴露：
  - 单轮 childList mutation 处理耗时
  - 单轮新增根节点数量
  - 单轮实际展开的任务数量
  - 单轮切片次数

## Phase 2: Time-Sliced ChildList Add Serialization

- [ ] 将 `processChildListMutations()` 里的新增子树序列化从同步递归/同步整批处理，改成显式任务队列。
- [ ] 只时间片化 `childList add` 路径。
- [ ] `removes`、`attributes`、`characterData` 第一版仍保持现有同步语义。
- [ ] 引入内部时间片常量，建议起始值：
  - `MUTATION_SERIALIZATION_SLICE_MS = 4`
- [ ] 使用显式队列保存待展开节点，不使用递归。
- [ ] 保持现有 topological 排序逻辑，避免 parent/next sibling 引用错乱。
- [ ] 第一版按“根节点完成后再 emit add mutation”实现，优先保证正确性。

## Phase 3: Correctness Hardening

- [ ] 验证 add/remove 顺序在跨时间片时不乱。
- [ ] 验证 attribute/text mutation 不会早于对应 add 被消费。
- [ ] 验证 shadow root、privacy hidden、ignore 节点在新路径下语义一致。
- [ ] 验证 `takeSubsequentFullSnapshot()` 与时间片中的 pending add 不会互相污染。

## Phase 4: Performance Validation

- [ ] 在 demo 的 dashboard 场景下，对比 replay on/off 的 trace：
  - 总长任务数
  - 最长 task
  - `dataflux-rum.js` 占比
  - `Layout / UpdateLayoutTree` 占比
- [ ] 对比时间片化前后的 UX：
  - 页面是否仍然长时间卡死
  - 是否从“单个长任务”变成“多个小任务”
- [ ] 如有必要，再考虑增加内部 telemetry 或开发态 debug。

## Test Plan

### Unit Tests

- [ ] 宽树场景：大量 sibling roots 的 childList add 不应出现长链递归依赖。
- [ ] 深树场景：显式队列遍历不应爆栈。
- [ ] 顺序场景：add 后紧跟 attribute/text mutation，最终输出顺序必须正确。
- [ ] reset/full snapshot 场景：pending mutation tasks 不应污染 subsequent full snapshot。

### Required Boundary Tests

下面这些测试不是可选增强，而是第一版必须具备的边界验证：

- [ ] 宽树极限：单轮插入大量 sibling roots，不应形成单个长任务，也不应丢失根级顺序。
- [ ] 深树极限：超深子树在时间片化路径下不应爆栈，不应因为显式队列推进而漏节点或死循环。
- [ ] 混合场景：宽树 + 深树同时存在时，不应因为一个大 root 阻塞其他 root 的完成和提交。
- [ ] add 后立即 attribute：节点尚未 emit 时收到 attribute mutation，必须挂起并在 add 后按顺序补发。
- [ ] add 后立即 text：节点尚未 emit 时收到 characterData mutation，必须挂起并在 add 后按顺序补发。
- [ ] add 后立即 remove：pending root 在 emit 前被移除时，必须取消 task，不能稍后又补发旧树。
- [ ] sibling 引用边界：多个新增兄弟节点跨多个时间片完成时，`nextId` 和 parent 关系必须稳定。
- [ ] reorder 边界：同一批新增根节点仍需保持 topological 排序，不允许因时间片化而交换顺序。
- [ ] generation reset：`takeSubsequentFullSnapshot()`、`stop()`、restart 发生时，旧 generation 的 pending task 必须整体失效。
- [ ] pending + full snapshot：full snapshot 后，旧 pending task 不得回写、不得 emit、不得污染后续 mutation。
- [ ] shadow root：含 shadow root 的新增子树在新路径下语义要与现有路径一致。
- [ ] hidden / ignored 节点：privacy hidden、ignore 节点在时间片化路径下仍按原规则处理。

### Test Strictness

第一版实现时，测试策略需要满足下面这些约束：

- 必须同时覆盖宽树、深树、混合树三类最坏输入，不能只测“普通结构”。
- 必须覆盖时序交叉场景，不能只测单纯的 add 成功路径。
- 必须有“失败即说明设计不成立”的回归测试，不接受只做 happy path 验证。
- 每次主链改动后，优先跑最窄的定向单测；如果 Karma 仍出现 bundling 慢或 Chrome 断连，需要在变更说明里明确记录。
- 手工验证不能只看“页面没崩”，还要核对 replay 顺序和节点完整性。

### Manual Validation

- [ ] demo `dashboard 2500`，replay off
- [ ] demo `dashboard 2500`，replay on
- [ ] 采集 trace 对比主线程占用
- [ ] 确认页面不再因 SDK 形成明显单个长任务

## Risks

- 时间片化会把现有同步 flush 语义改成异步消费，最容易引入 replay 时序问题。
- 若设计不谨慎，可能出现：
  - add 未完成就收到 attribute/text
  - next sibling id 尚未存在
  - subsequent full snapshot 与 pending add 交叉

## Rollout Strategy

- 第一版仅在内部实现，不暴露配置项。
- 先以固定时间片常量验证正确性和性能收益。
- 如果效果稳定，再评估是否需要让时间片策略可配。

## Notes

- 预算式节点数量截断不是最终方向，只作为已验证但已回退的探索记录。
- 后续评估应尽量使用真实 SPA 风格结构，而不是继续用极深单链场景做主判断。
