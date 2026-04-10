# Resource Hook RFC

## 目标

为自动采集的 `resource` 事件提供一套请求级自定义字段能力，满足以下要求：

- 支持请求前写入自定义字段
- 支持请求返回后继续补充字段
- 最终上报的 `resource` 事件包含这些字段
- 未接入该能力的请求保持当前自动上报逻辑不变
- 不依赖 `beforeSend`
- 对外使用 `uuid` 作为 tracker 标识

## 当前方案

当前版本先采用“请求头携带 tracker id”的方案：

```txt
x-rum-resource-id: <uuid>
```

SDK 在请求完成时读取该请求头，若命中已创建的 tracker，则该条 `resource` 进入“受控上报”模式：

- 先缓存 resource event
- 等待用户调用 `finish`
- 合并 tracker context 后再上报

若未命中 tracker，则按现有逻辑直接上报。

## 为什么不能只靠 beforeSend

当前 `fetch/xhr` 自动采集通常早于用户自己的响应回调执行。若用户在响应回调里才补字段，SDK 往往已经完成 `resource` 组装和上报。

因此问题不在于“修改 event”，而在于“延后 finalize 时机”。

## 适用前提

该方案不是零侵入方案，只适用于以下场景：

- 业务允许添加自定义请求头
- 目标请求允许透传该 header
- 该 header 不会触发签名校验失败
- 该 header 不会被网关、服务端或白名单策略拒绝

如果这些前提不成立，则不应启用该方案。

## Public API

建议只保留一组基于 `uuid` 的主 API，避免依赖 `tracker` 实例跨作用域传递。

### 主 API

```js
const resourceId = DATAFLUX_RUM.createResourceTrackerId()

DATAFLUX_RUM.setResourceContext(resourceId, { order_id: '123' })
DATAFLUX_RUM.appendResourceContext(resourceId, { result: 'success' })
DATAFLUX_RUM.finishResource(resourceId)
DATAFLUX_RUM.getResource(resourceId)
```

### API 语义

- `createResourceTrackerId()`
  创建一个新的 resource tracker id

- `setResourceContext(resourceId, context)`
  写入请求前上下文

- `appendResourceContext(resourceId, context)`
  在请求完成后继续补充字段

- `finishResource(resourceId)`
  结束等待并触发受控 resource 上报

- `getResource(resourceId)`
  返回当前 resource 快照

### 不暴露为主 API 的能力

以下能力如果实现需要，可以作为内部方法存在，但不建议作为主 public API 对外推广：

- `clearResourceContext`
- `getResourceContext`
- `getResourceRawEvent`

## 示例

### fetch

```js
const resourceId = DATAFLUX_RUM.createResourceTrackerId()

DATAFLUX_RUM.setResourceContext(resourceId, {
  order_id: '123',
  scene: 'checkout'
})

fetch('/api/order/detail', {
  headers: {
    'x-rum-resource-id': resourceId
  }
})
  .then((res) => {
    DATAFLUX_RUM.appendResourceContext(resourceId, {
      biz_code: res.headers.get('x-biz-code'),
      result: 'success'
    })
    DATAFLUX_RUM.finishResource(resourceId)
    return res
  })
  .catch((err) => {
    DATAFLUX_RUM.appendResourceContext(resourceId, {
      result: 'error',
      error_message: err.message
    })
    DATAFLUX_RUM.finishResource(resourceId)
    throw err
  })
```

### xhr

```js
const resourceId = DATAFLUX_RUM.createResourceTrackerId()

DATAFLUX_RUM.setResourceContext(resourceId, {
  order_id: '123',
  scene: 'checkout'
})

const xhr = new XMLHttpRequest()
xhr.open('GET', '/api/order/detail')
xhr.setRequestHeader('x-rum-resource-id', resourceId)

xhr.addEventListener('load', () => {
  DATAFLUX_RUM.appendResourceContext(resourceId, {
    biz_code: xhr.getResponseHeader('x-biz-code'),
    result: 'success'
  })
  DATAFLUX_RUM.finishResource(resourceId)
})

xhr.addEventListener('error', () => {
  DATAFLUX_RUM.appendResourceContext(resourceId, {
    result: 'error'
  })
  DATAFLUX_RUM.finishResource(resourceId)
})

xhr.send()
```

## 查询 API

用户可以在任意阶段读取当前 tracker 快照：

```js
DATAFLUX_RUM.getResource(resourceId)
```

典型返回值：

```js
{
  trackerId: 'uuid',
  status: 'request_collected',
  context: {
    order_id: '123',
    result: 'success'
  },
  resource: {
    type: 'fetch',
    url: '/api/order/detail',
    method: 'GET',
    status: 200
  },
  rawRumEvent: {
    type: 'resource',
    resource: {
      url: '/api/order/detail',
      status: 200
    }
  }
}
```

约束：

- 返回的是当前快照，不是最终已上报结果
- 在 `request_collected` 之前，`rawRumEvent` 可能为空
- 在 `flushed` 后，SDK 可以短暂保留快照，也可以返回 `undefined`

## 事件流转

### 普通请求

1. 请求发起
2. SDK 自动采集
3. 请求完成
4. `resourceCollection` 直接发送 `RAW_RUM_EVENT_COLLECTED`
5. 按原链路组装并上报

### 受控请求

1. 用户创建 tracker，得到 `uuid`
2. 用户请求前写入 `context`
3. 用户将 `uuid` 放入 `x-rum-resource-id`
4. 请求完成后，SDK 从请求头读取 `uuid`
5. 若命中 tracker，则先缓存 `rawResourceEvent`
6. 用户在响应回调中继续 `append`
7. 用户调用 `finish`
8. SDK 合并 `tracker.context`
9. SDK 发送 `RAW_RUM_EVENT_COLLECTED`
10. 进入原有组装和上报链路

## 状态机

```txt
created
request_collected
finished
flushed
timeout_flushed
cleared
```

状态含义：

- `created`
  tracker 已创建

- `request_collected`
  对应请求已完成，raw resource 已缓存

- `finished`
  用户已显式调用 `finish`

- `flushed`
  resource 已真正上报

- `timeout_flushed`
  用户未 `finish`，由超时兜底上报

- `cleared`
  tracker 已被主动清理

## 内部数据结构

建议维护：

```js
Map<trackerId, {
  id: string,
  context: Record<string, any>,
  rawResourceEvent?: RawRumEvent,
  requestHeaderMatched: boolean,
  finished: boolean,
  flushed: boolean,
  timeoutId?: number
}>
```

## 上报控制逻辑

### 未携带 tracker header

直接按旧逻辑上报：

```txt
processRequest -> RAW_RUM_EVENT_COLLECTED
```

### 携带 tracker header

1. 读取 `x-rum-resource-id`
2. 查找 tracker registry
3. 若未命中 tracker，按旧逻辑上报
4. 若命中 tracker：
   - 缓存 `rawResourceEvent`
   - 不立即上报
   - 等待 `finish` 或超时

### finish 行为

调用 `finishResourceContext(trackerId)` 时：

- 若 `rawResourceEvent` 已存在，立即 flush
- 若 `rawResourceEvent` 还未到达，仅标记 `finished = true`

这样可以覆盖：

- 先 `finish`，后请求完成
- 先请求完成，后 `finish`

## 超时兜底

为防止漏调 `finish`，增加超时兜底：

- 默认 `5s` 或 `10s`
- 超时后若 resource 已缓存但尚未上报，则自动上报
- 上报时带上当前已收集到的 context
- 上报后清理 tracker

目标是保证事件不丢，但允许丢失一部分“响应后补充”的字段。

## Context 合并

tracker 的字段最终进入 `customerContext`，再由 assembly 合并到 `event.context`。

建议顺序：

```txt
commonContext.context
-> viewContext.context
-> tracker.context
```

tracker 优先级最高。

## 兼容性要求

必须保证：

- 未创建 tracker 的 resource 与当前行为完全一致
- 创建了 tracker，但请求没有带 header，仍按旧逻辑上报
- 请求带了 header，但 SDK 未命中 tracker，仍按旧逻辑上报
- 只有“请求带 header 且命中 tracker”的 resource 才走延迟上报
- `tracker.get()` 调用失败不能影响正常请求和正常上报
- `getResource()` 调用失败不能影响正常请求和正常上报
- tracker 关联失败时必须自动降级，不能阻塞原有数据流

## 风险

### 请求头侵入

该方案依赖业务透传自定义请求头，存在以下风险：

- header 白名单限制
- CORS 预检变化
- 网关拒绝未知 header
- 请求签名因 header 变化失效

因此它只能作为显式接入能力，不应被描述为默认无侵入方案。

### finish 漏调

若无超时兜底，resource 可能长期停留在 pending 状态。

### 内存泄漏

tracker registry 需要在以下场景清理：

- `flush`
- `timeout_flush`
- `clear`

### 上报延迟

受控请求相比普通请求会延迟最终上报时间，这是该方案的固定代价。

### 快照一致性

`getTrackedResource()` 返回的是当前快照，不承诺是最终稳定对象。

## 测试场景

测试需要覆盖正常链路、降级链路、竞态时序和查询能力，不能只覆盖 happy path。

### 单元测试

- `resourceTracker` registry 的 create / set / append / finish / flush / clear 状态流转
- 多次 `setResourceContext` 与多次 `appendResourceContext` 的字段合并与覆盖顺序
- 先请求完成后 `finishResource`，以及先 `finishResource` 后请求完成，两种顺序都能正确 flush
- `finishResource` 多次调用不会重复上报
- `getResource` 在不同状态下返回正确快照
- `getResource` 查询不存在的 id 返回空结果且不抛异常
- timeout flush 能触发自动上报并完成清理
- `flush`、`timeout_flush`、`clear` 后 tracker 正常清理，不残留脏状态
- tracker miss 时按普通 resource 路径降级

### 集成测试

- `fetch` 未携带 `x-rum-resource-id`，按当前逻辑正常上报
- `xhr` 未携带 `x-rum-resource-id`，按当前逻辑正常上报
- 普通 resource 的上报内容与改造前一致
- 请求前 `setResourceContext`，最终 resource 正常带上自定义字段
- 请求前 `setResourceContext`，请求后 `appendResourceContext`，最终 resource 同时包含两部分字段
- 仅请求后 `appendResourceContext` 也能在 `finishResource` 后正常上报
- 请求带了 `x-rum-resource-id` 但 registry 中找不到对应 id，自动降级为普通上报
- 创建了 tracker 但请求未携带 `x-rum-resource-id`，自动降级为普通上报
- 命中 tracker 但一直不调用 `finishResource`，到达超时时间后自动上报
- 多个不同 `resourceId` 并发请求时，context 不串数据
- 一个请求有 tracker，另一个请求无 tracker，两者都能各自正常上报
- `fetch` reject、`xhr` error、`xhr` abort 场景下仍能按预期追加字段和上报
- `fetch` / `xhr` 两条链路在 header 读取、pending、flush、timeout 上行为一致
- action / view / error / long_task 不受影响
- 未使用 tracker 时 batch 序列化结果不变

## 实现落点

### Public API

- [rumPublicApi.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/boot/rumPublicApi.js)
- [perStartRum.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/boot/perStartRum.js)

新增：

- `createResourceTrackerId`
- `setResourceContext`
- `appendResourceContext`
- `finishResource`
- `getResource`

### Tracker Registry

建议新增模块：

- `packages/rum/src/domain/resourceTracker/resourceTracker.js`

职责：

- create
- merge context
- cache raw event
- finish
- flush
- timeout cleanup
- snapshot query

### Request Collection

需要在请求完成时读取 `x-rum-resource-id`，并透传给后续 resource 链路。

可能涉及：

- [requestCollection.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/requestCollection.js)
- [fetchObservable.js](/Users/dengchangliang/www/rum/browser-sdk/packages/core/src/browser/fetchObservable.js)
- [xhrObservable.js](/Users/dengchangliang/www/rum/browser-sdk/packages/core/src/browser/xhrObservable.js)

### Resource Collection

在 resource event 生成时判断是否命中 tracker：

- 未命中：直接上报
- 命中：缓存，等待 `finish`

主要落点：

- [resourceCollection.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/rumEventsCollection/resource/resourceCollection.js)

## 伪代码

```js
function handleTrackedResource(rawResourceEvent, trackerId) {
  const tracker = trackerRegistry.get(trackerId)

  if (!tracker) {
    notifyRawRumEvent(rawResourceEvent)
    return
  }

  tracker.rawResourceEvent = rawResourceEvent

  if (tracker.finished) {
    flushTracker(tracker)
    return
  }

  scheduleTimeoutFlush(tracker)
}

function finishResourceContext(trackerId) {
  const tracker = trackerRegistry.get(trackerId)
  if (!tracker || tracker.flushed) {
    return
  }

  tracker.finished = true

  if (tracker.rawResourceEvent) {
    flushTracker(tracker)
  }
}

function flushTracker(tracker) {
  if (tracker.flushed) {
    return
  }

  tracker.flushed = true
  clearTrackerTimeout(tracker)

  notifyRawRumEvent({
    ...tracker.rawResourceEvent,
    customerContext: tracker.context
  })

  trackerRegistry.delete(tracker.id)
}
```

## 推进顺序

1. 实现 tracker registry
2. 支持 `x-rum-resource-id` 关联
3. 支持 `setResourceContext/appendResourceContext/finishResource/getResource`
5. 保证普通 resource 零回归
6. 补 demo 和测试
