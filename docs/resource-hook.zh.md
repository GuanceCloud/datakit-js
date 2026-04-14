# Resource Hook 接入指南

## 说明

Resource Hook 用来给自动采集的 `resource` 事件补充请求级业务字段。

适用场景：

- 请求发起前就要写入业务上下文
- 响应返回后还要继续补充字段
- 最终上报的 `resource` 事件需要同时带上这两部分数据

该能力同时支持 `fetch` 和 `XMLHttpRequest`。

## 工作方式

1. 通过 `createResourceTrackerId()` 创建一个 tracker id
2. 将该 id 放到请求头 `x-rum-resource-id`
3. 用 `setResourceContext()` 写入请求前上下文
4. 用 `appendResourceContext()` 补充响应后上下文
5. 调用 `finishResource()` 触发最终的 tracked resource 上报

如果请求没有携带 `x-rum-resource-id`，SDK 会继续走原有的普通 resource 自动采集链路。

## Public API

```javascript
const resourceId = DATAFLUX_RUM.createResourceTrackerId()

DATAFLUX_RUM.setResourceContext(resourceId, { order_id: '123' })
DATAFLUX_RUM.appendResourceContext(resourceId, { result: 'success' })
DATAFLUX_RUM.finishResource(resourceId)
DATAFLUX_RUM.getResource(resourceId)
```

API 语义：

- `createResourceTrackerId()`
  创建新的 tracker id
- `setResourceContext(resourceId, context)`
  覆盖当前 tracker 的上下文
- `appendResourceContext(resourceId, context)`
  追加更多字段到当前 tracker 的上下文
- `finishResource(resourceId)`
  表示这条 tracked resource 已准备好结束。如果请求已经完成，会立即触发上报；如果请求还没完成，SDK 会等到请求完成后再上报
- `getResource(resourceId)`
  返回当前 tracker 快照，主要用于调试

## Fetch 示例

```javascript
const resourceId = window.DATAFLUX_RUM.createResourceTrackerId()

window.DATAFLUX_RUM.setResourceContext(resourceId, {
  order_id: '123',
  scene: 'checkout'
})

fetch('/api/order/detail', {
  headers: {
    'x-rum-resource-id': resourceId
  }
})
  .then((response) => {
    window.DATAFLUX_RUM.appendResourceContext(resourceId, {
      result: 'success',
      response_status: response.status
    })
    window.DATAFLUX_RUM.finishResource(resourceId)
    return response
  })
  .catch((error) => {
    window.DATAFLUX_RUM.appendResourceContext(resourceId, {
      result: 'error',
      error_message: error.message
    })
    window.DATAFLUX_RUM.finishResource(resourceId)
    throw error
  })
```

## XHR 示例

```javascript
const resourceId = window.DATAFLUX_RUM.createResourceTrackerId()

window.DATAFLUX_RUM.setResourceContext(resourceId, {
  order_id: '123',
  scene: 'checkout'
})

const xhr = new XMLHttpRequest()
xhr.open('GET', '/api/order/detail', true)
xhr.setRequestHeader('x-rum-resource-id', resourceId)

xhr.addEventListener('load', () => {
  window.DATAFLUX_RUM.appendResourceContext(resourceId, {
    result: 'success',
    response_status: xhr.status
  })
  window.DATAFLUX_RUM.finishResource(resourceId)
})

xhr.addEventListener('error', () => {
  window.DATAFLUX_RUM.appendResourceContext(resourceId, {
    result: 'error',
    error_message: 'xhr_error'
  })
  window.DATAFLUX_RUM.finishResource(resourceId)
})

xhr.send()
```

## Trace 场景示例

如果同一个请求还需要注入 trace id，需要继续保留 `x-rum-resource-id`，并确保请求 origin 已经配置到 tracing 白名单里。

```javascript
window.DATAFLUX_RUM.init({
  // ...
  traceType: 'ddtrace',
  allowedDDTracingOrigins: [window.location.origin]
})
```

然后照常发送 tracked request：

```javascript
const resourceId = window.DATAFLUX_RUM.createResourceTrackerId()

window.DATAFLUX_RUM.setResourceContext(resourceId, {
  scene: 'checkout'
})

fetch('/api/order/detail', {
  headers: {
    'x-rum-resource-id': resourceId
  }
})
  .then((response) => {
    window.DATAFLUX_RUM.appendResourceContext(resourceId, {
      trace_expected: 'true',
      response_status: response.status
    })
    window.DATAFLUX_RUM.finishResource(resourceId)
    return response
  })
```

最终 tracker 快照里的 `rawRumEvent._gc` 可能包含 `traceId` 和 `spanId`。

## 调试方式

你可以在任意时刻查看当前 tracker 快照：

```javascript
const snapshot = window.DATAFLUX_RUM.getResource(resourceId)
console.log(snapshot)
```

典型快照结构：

```javascript
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
    _gc: {
      traceId: '...',
      spanId: '...'
    }
  }
}
```

当前状态值包括：

- `created`
- `request_collected`
- `finished`
- `flushed`
- `timeout_flushed`
- `cleared`

## 超时行为

如果业务没有调用 `finishResource()`，SDK 会在 `30s` 后自动 flush 这条 tracked resource。

这里最容易误解的一点是：

- 这个 `30s` 是从**请求完成之后**开始算
- 不是从**请求开始时**开始算

实际时序是：

1. 请求开始
2. 请求完成
3. SDK 通过 `x-rum-resource-id` 关联到这条 resource
4. 如果这时还没调用 `finishResource()`，SDK 最多再等 `30s`
5. 到时后自动以 `timeout_flushed` 状态上报

这样可以避免 tracked request 长期处于 pending 状态，同时也给业务代码保留一段“请求完成后再补充响应上下文”的窗口。

## 时序说明

- 如果在**请求完成前**调用 `finishResource()`，SDK 不会立刻上报，而是先把 tracker 标记为 `finished`，等请求真正完成后再 flush。
- 如果在**请求完成后**调用 `finishResource()`，SDK 会立即 flush。
- 如果始终不调用 `finishResource()`，就走上面的“请求完成后等待 `30s` 再自动 flush”的逻辑。

## 注意事项

- 业务请求必须允许自定义头 `x-rum-resource-id`
- 如果请求没有带这个 header，会自动降级为普通 resource 采集
- 如果 header 携带的 tracker id 不存在，也会自动降级为普通 resource 采集
- `getResource()` 主要用于调试，不建议作为业务逻辑依赖
