# WebSocket 长连接采集

WebSocket 采集用于把浏览器中的每条原生 WebSocket 连接汇总为一个 RUM Resource，
帮助分析握手、收发消息量、入站空闲、发送积压和关闭状态。

该能力当前为实验功能，默认关闭。完整包
`@cloudcare/browser-rum` 和精简包
`@cloudcare/browser-rum-slim` 使用相同配置。

## 开启采集

### NPM

```js
import { datafluxRum } from '@cloudcare/browser-rum'

datafluxRum.init({
  applicationId: '<APPLICATION_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  service: 'websocket-client',
  env: 'production',
  version: '1.0.0',
  sessionSampleRate: 100,
  enableExperimentalFeatures: ['track_websockets']
})
```

精简包只需替换导入：

```js
import { datafluxRum } from '@cloudcare/browser-rum-slim'
```

### CDN

```html
<script
  src="https://static.guance.com/browser-sdk/v3/dataflux-rum.js"
  type="text/javascript"
></script>
<script>
  window.DATAFLUX_RUM &&
    window.DATAFLUX_RUM.init({
      applicationId: '<APPLICATION_ID>',
      clientToken: '<CLIENT_TOKEN>',
      site: '<PUBLIC_DATAWAY_URL>',
      service: 'websocket-client',
      env: 'production',
      version: '1.0.0',
      sessionSampleRate: 100,
      enableExperimentalFeatures: ['track_websockets']
    })
</script>
```

以上示例使用 Public DataWay。DataKit 直连时，用
`datakitOrigin: '<DATAKIT_ORIGIN>'` 替换 `site` 和 `clientToken`，不要同时配置
两种上报地址。

`enableExperimentalFeatures` 必须是数组。直接写成字符串
`'track_websockets'` 不会开启采集。

## 初始化时机

RUM 必须在业务创建 WebSocket 连接之前初始化：

```js
datafluxRum.init({
  // ...
  enableExperimentalFeatures: ['track_websockets']
})

const socket = new WebSocket('wss://example.com/socket')
```

以下连接不会被采集：

- RUM 初始化前已经创建的连接；
- 使用初始化前缓存的原始 `WebSocket` 构造函数创建的连接；
- Web Worker 或 Service Worker 内创建的连接；
- 不经过 `window.WebSocket` 的其他传输实现。

SDK 会保持原生 `WebSocket` 的构造、静态常量、`instanceof`、业务事件监听和
`send()` 返回行为。

## 采集模型

一条 WebSocket 物理连接会按 RUM Session 分段生成：

```text
type = resource
resource.type = websocket
```

Resource 在以下时机生成：

1. 浏览器收到 WebSocket `close` 事件；
2. 当前 RUM Session 到期；
3. 页面触发 `beforeunload`；
4. SDK 停止当前采集实例。

WebSocket 是长连接，因此连接仍处于打开状态时，Network 中没有对应的最终 RUM
Resource 是正常现象。SDK 当前不会周期性上报连接快照。

页面正常刷新、关闭或跳转时，SDK 会在 `beforeunload` 尽力结算并使用退出 transport
发送。如果页面进程被强制结束、浏览器崩溃或设备断电，JavaScript 仍可能没有执行
机会，此时最后一条连接 Resource 可能丢失。

### 正常关闭

浏览器收到 `close` 后：

```text
resource.websocket.tracking_end_reason = close_event
```

事件包含关闭码、关闭原因和 `was_clean`。

### Session 到期

Session 到期时，仍打开的连接会按当前已采集到的数据结算：

```text
resource.websocket.tracking_end_reason = session_end
```

此时浏览器并没有真正关闭业务 WebSocket，因此 `close_code`、`close_reason` 和
`was_clean` 可能不存在。

业务 WebSocket 不会因此关闭。新 Session 建立后，SDK 会为同一物理连接开启新的
统计分段，保留相同 `connection_id`，并重置消息计数和分段起止时间。Session
过期但尚未续期的空档消息不会计入任一 Session；连接若在此空档关闭，也不会在后续
Session 中恢复跟踪。空档中新建且续期时仍保持打开的连接，会从新 Session 的续期
时刻开始统计。

### 页面卸载

页面触发 `beforeunload` 时，仍打开的连接会尽力结算：

```text
resource.websocket.tracking_end_reason = page_exit
```

此时连接不一定触发浏览器 `close` 事件，因此关闭码等字段可能不存在。

### 握手失败

连接从未触发 `open` 就进入 `close` 时：

```text
resource.websocket.handshake_succeeded = false
```

此时 `setup_duration` 表示从构造连接到关闭或 Session 结算的时间，不代表成功握手
耗时。浏览器通常使用关闭码 `1006` 表示异常关闭，但具体值由浏览器事件决定。

## 不采集消息正文

SDK 不读取或上传 WebSocket 消息正文，只统计消息数量与字节数。

| 消息类型 | 字节计算 |
| --- | --- |
| string | UTF-8 字节数 |
| `ArrayBuffer` | `byteLength` |
| TypedArray、`DataView` | 当前 view 的 `byteLength` |
| `Blob` | `size` |
| 无法识别的类型 | 0 |

例如字符串 `你好` 按 UTF-8 统计为 6 字节，而不是 JavaScript 字符串长度 2。

## View 归属

一个 WebSocket Session 分段可能跨越多个 RUM View。Resource 额外记录：

- `start_view_id`：当前分段开始时所在 View；
- `end_view_id`：关闭或结算时所在 View。

分段开始与结束跨页面时，这两个 ID 不同。Resource 本身仍按分段开始时间进入 RUM
事件管道，使用两个额外字段可以分析连接是否跨 View 存活。

## 上报字段

`beforeSend` 中可以读取嵌套的
`event.resource.websocket`；最终 intake 会将字段转换为
`resource_websocket_*`。

### 基础 Resource 字段

| `beforeSend` 路径 | intake 字段 | 说明 | 单位 |
| --- | --- | --- | --- |
| `resource.type` | `resource_type` | 固定为 `websocket` | - |
| `resource.url` | `resource_url` | 浏览器解析后的 `ws://` 或 `wss://` URL | - |
| `resource.url_host` | `resource_url_host` | URL host | - |
| `resource.url_path` | `resource_url_path` | URL path | - |
| `resource.url_query` | `resource_url_query` | URL query 参数 | - |
| `resource.duration` | `duration` | 当前 Session 分段从开始到关闭或结算的时长 | ns |

WebSocket Resource 没有 HTTP response，因此不要依赖
`resource_status`、`resource_method`、TTFB、下载大小或 HTTP timing 字段。

### 连接字段

| `resource.websocket.*` | intake 字段 | 说明 | 单位 |
| --- | --- | --- | --- |
| `connection_id` | `resource_websocket_connection_id` | 物理连接唯一 ID，跨 Session 分段保持不变 | - |
| `handshake_succeeded` | `resource_websocket_handshake_succeeded` | 是否收到 `open` | boolean |
| `start_time` | `resource_websocket_start_time` | 当前 Session 分段开始时间；首段为连接构造时间 | Unix ms |
| `end_time` | `resource_websocket_end_time` | 关闭或结算时间 | Unix ms |
| `start_view_id` | `resource_websocket_start_view_id` | 当前分段开始时的 View ID | - |
| `end_view_id` | `resource_websocket_end_view_id` | 连接结束时的 View ID | - |
| `tracking_end_reason` | `resource_websocket_tracking_end_reason` | `close_event`、`session_end` 或 `page_exit` | - |
| `protocol` | `resource_websocket_protocol` | 服务端最终协商的子协议 | - |
| `setup_duration` | `resource_websocket_setup_duration` | 首段为构造到 `open` 的耗时；已打开连接的新 Session 分段为 0 | ns |

### 消息字段

| `resource.websocket.*` | intake 字段 | 说明 | 单位 |
| --- | --- | --- | --- |
| `messages_in.count` | `resource_websocket_messages_in_count` | 收到的消息数量 | count |
| `messages_in.size` | `resource_websocket_messages_in_size` | 收到的消息总字节数 | byte |
| `messages_out.count` | `resource_websocket_messages_out_count` | 成功调用 `send()` 的消息数量 | count |
| `messages_out.size` | `resource_websocket_messages_out_size` | 发送消息总字节数 | byte |
| `time_to_first_message_in` | `resource_websocket_time_to_first_message_in` | `open` 到首条入站消息 | ns |
| `time_to_first_message_out` | `resource_websocket_time_to_first_message_out` | `open` 到首条出站消息 | ns |
| `last_message_in_at` | `resource_websocket_last_message_in_at` | 最后一条入站消息时间 | Unix ms |
| `longest_inbound_silence` | `resource_websocket_longest_inbound_silence` | 相邻入站消息之间的最长间隔 | ns |
| `inbound_idle_duration_before_close` | `resource_websocket_inbound_idle_duration_before_close` | 最后一条入站消息到关闭或结算的时间 | ns |
| `buffered_amount_max` | `resource_websocket_buffered_amount_max` | 每次调用 `send()` 前观察到的 `bufferedAmount` 峰值 | byte |

`buffered_amount_max` 是发送调用前的采样峰值，不是每次 `send()` 后浏览器实际排队
量的连续监控值。

### 关闭字段

| `resource.websocket.*` | intake 字段 | 说明 |
| --- | --- | --- |
| `close_code` | `resource_websocket_close_code` | 浏览器 CloseEvent 的关闭码 |
| `close_reason` | `resource_websocket_close_reason` | 关闭原因 |
| `was_clean` | `resource_websocket_was_clean` | 浏览器是否认为连接正常关闭 |

Session 到期结算时，这些字段可能不存在。

## 使用 `beforeSend`

### 检查或补充 WebSocket 事件

```js
datafluxRum.init({
  // ...
  enableExperimentalFeatures: ['track_websockets'],
  beforeSend(event, domainContext) {
    if (
      event.type === 'resource' &&
      event.resource?.type === 'websocket'
    ) {
      event.context = {
        ...event.context,
        socket_channel: 'notifications'
      }

      console.debug(
        'WebSocket closed',
        event.resource.websocket,
        domainContext?.webSocket
      )
    }

    return true
  }
})
```

WebSocket Resource 的 `domainContext` 包含：

```text
domainContext.isWebSocket = true
domainContext.webSocket = 原生 WebSocket 实例
```

`domainContext` 只在 `beforeSend` 回调期间使用，不会被序列化上传。

### 过滤特定连接

```js
beforeSend(event) {
  if (
    event.type === 'resource' &&
    event.resource?.type === 'websocket' &&
    event.resource.url.includes('/health-stream')
  ) {
    return false
  }

  return true
}
```

返回 `false` 会丢弃该 WebSocket Resource。

## 隐私与安全

SDK 会采集完整 WebSocket URL，并解析 URL query。不要在 WebSocket URL 中放置
密码、长期 Token、身份证号等敏感值。

`beforeSend` 允许修改 `resource.url`，但 URL 解析出的其他 Resource 字段不属于
全部可修改字段。如果现有 URL query 已包含敏感信息，最稳妥的做法是：

1. 调整业务鉴权设计，避免把敏感值放入 URL；
2. 或在 `beforeSend` 中返回 `false`，丢弃该连接事件。

WebSocket 的网络连接仍受页面 CSP `connect-src` 和服务端 Origin 校验约束。开启
RUM WebSocket 采集不会绕过这些浏览器安全策略，也不会向握手注入自定义 trace
header。

## 与常见 WebSocket 封装库配合

只要第三方库最终在 RUM 初始化后调用 `window.WebSocket`，底层连接就会被采集。
SDK 看到的是实际 WebSocket 连接，而不是库的逻辑 channel：

- 自动重连每建立一次新连接，就生成一个新的 `connection_id` 和 Resource；
- 一个连接上复用多个业务 topic 时，SDK 只提供连接级汇总；
- HTTP long polling 阶段仍按 XHR 或 fetch Resource 采集；
- `WebSocketStream` 当前不在采集范围内。

## 验证接入

### 浏览器验证

1. 打开 DevTools Network。
2. 确认业务 WebSocket 成功连接并产生消息。
3. 主动执行 `socket.close(1000, 'done')`。
4. 过滤 `/v1/write/rum`。
5. 在请求数据中查找 `resource_type=websocket`。
6. 检查 `handshake_succeeded`、消息 count/size 和关闭字段。

如果连接一直不关闭，可以等待 Session 到期后检查
`tracking_end_reason=session_end`，再触发新 Session 活动并确认后续消息形成相同
`connection_id` 的新分段。刷新页面时应看到
`tracking_end_reason=page_exit`；该发送属于页面退出阶段的尽力上报。

### 仓库 Smoke Demo

```bash
npm run dev
```

打开：

```text
http://localhost:8082/websocket-smoke.html
```

Demo 会连接本地 `/ws-echo`，跨两个 View 发送 UTF-8 文本和二进制消息，然后正常
关闭连接。页面同时检查：

- 原生 WebSocket 行为未改变；
- `beforeSend` 收到完整嵌套事件；
- `/v1/write/rum` 中存在最终扁平字段；
- 消息数量、字节数、子协议、关闭码和起止 View ID 正确。

页面显示 `Passed` 表示验证通过。

## 常见问题

### 配置后没有 WebSocket Resource

按以下顺序检查：

1. `enableExperimentalFeatures` 是否为包含
   `'track_websockets'` 的数组；
2. RUM 是否在连接创建前初始化；
3. 当前 Session 是否命中 `sessionSampleRate`；
4. 连接是否已关闭，或 Session 是否已到期；
5. `beforeSend` 是否返回了 `false`；
6. 连接是否由 window 之外的 Worker 创建。

### WebSocket 已收到 `error`，但暂时没有 Resource

SDK 在 `close` 或 Session 结算时生成最终事件，不单独在 `error` 事件上结算。等待
后续 `close`；如果页面仍存活但没有 close，则等待 Session 到期。

### `handshake_succeeded=false`

浏览器没有触发 `open`。检查 WebSocket URL、TLS 证书、CSP `connect-src`、反向代理
Upgrade 配置、服务端 Origin 校验和鉴权。

### 消息 size 为 0

确认数据类型是 string、`ArrayBuffer`、TypedArray、`DataView` 或 `Blob`。SDK 不会
序列化任意对象来估算大小。

### 看不到 HTTP 状态码

WebSocket Resource 是连接级事件，不是普通 HTTP response timing。浏览器
WebSocket API 不向页面暴露握手 HTTP 状态码，因此该事件没有
`resource_status`。
