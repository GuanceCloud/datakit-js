# Web 应用接入说明

观测云应用监测可以采集各类 Web 应用的指标数据，并以可视化方式分析每个页面与接口的性能表现。

## 前置条件

如果你已经启用了 RUM Headless 服务，前置条件通常已经自动准备好，可以直接接入。

本地或自建接入场景下，通常需要满足：

- 已安装 DataKit
- 已配置 RUM Collector
- DataKit 可被公网访问，并已安装 IP 地理位置数据库

## 应用接入方式 {#access}

登录观测云控制台，进入 **场景测试** 页面，点击左上角 **创建应用**，开始创建新的应用。

观测云支持两类接收方式：

- **Public DataWay**
  - 不需要安装 DataKit
  - 只需要配置 `site` 和 `clientToken`
  - 支持通过控制台上传 SourceMap
- **本地或私有化部署**
  - 通过 DataKit 接收 RUM 数据
  - 配置 `datakitOrigin`
  - 需要满足上面的前置条件

下方主示例使用 Public DataWay。`site` 和 `clientToken` 必须成对配置。使用 DataKit
直连时，请删除这两个字段，改为配置
`datakitOrigin: '<DataKit 域名或 IP>'`。两种接收方式不要同时配置。

Web 应用接入支持三种方式：

| 接入方式 | 说明 |
| --- | --- |
| NPM | 将 SDK 打包进前端工程，对页面加载性能影响最小，但初始化之前的请求和错误可能漏采。 |
| CDN 异步 | 通过 CDN 缓存和异步脚本加载，减少对首屏加载的影响，但初始化之前的请求和错误可能漏采。 |
| CDN 同步 | 通过 CDN 缓存和同步脚本加载，更容易捕获最早期的错误、资源、请求和性能指标，但可能影响页面加载性能。 |

=== "NPM"

    ```javascript
    import { datafluxRum } from '@cloudcare/browser-rum'

    datafluxRum.init({
      applicationId: 'guance',
      clientToken: '<CLIENT_TOKEN>',
      site: '<PUBLIC_DATAWAY_URL>',
      env: 'production',
      version: '1.0.0',
      sessionSampleRate: 100,
      sessionReplaySampleRate: 70,
      trackInteractions: true,
      traceType: 'ddtrace', // 可选，默认 ddtrace
      allowedTracingOrigins: ['https://api.example.com', /https:\/\/.*\.my-api-domain\.com/]
    })
    ```

=== "CDN 异步加载"

    ```javascript
    <script>
      ;(function (h, o, u, n, d) {
        h = h[d] = h[d] || {
          q: [],
          onReady: function (c) {
            h.q.push(c)
          }
        }
        d = o.createElement(u)
        d.async = 1
        d.src = n
        n = o.getElementsByTagName(u)[0]
        n.parentNode.insertBefore(d, n)
      })(
        window,
        document,
        'script',
        'https://static.guance.com/browser-sdk/v3/dataflux-rum.js',
        'DATAFLUX_RUM'
      )

      DATAFLUX_RUM.onReady(function () {
        DATAFLUX_RUM.init({
          applicationId: 'guance',
          clientToken: '<CLIENT_TOKEN>',
          site: '<PUBLIC_DATAWAY_URL>',
          env: 'production',
          version: '1.0.0',
          sessionSampleRate: 100,
          sessionReplaySampleRate: 70,
          trackInteractions: true,
          traceType: 'ddtrace',
          allowedTracingOrigins: ['https://api.example.com', /https:\/\/.*\.my-api-domain\.com/]
        })
      })
    </script>
    ```

=== "CDN 同步加载"

    ```javascript
    <script src="https://static.guance.com/browser-sdk/v3/dataflux-rum.js" type="text/javascript"></script>
    <script>
      window.DATAFLUX_RUM &&
        window.DATAFLUX_RUM.init({
          applicationId: 'guance',
          clientToken: '<CLIENT_TOKEN>',
          site: '<PUBLIC_DATAWAY_URL>',
          env: 'production',
          version: '1.0.0',
          sessionSampleRate: 100,
          sessionReplaySampleRate: 70,
          trackInteractions: true,
          traceType: 'ddtrace',
          allowedTracingOrigins: ['https://api.example.com', /https:\/\/.*\.my-api-domain\.com/]
        })
    </script>
    ```

## 配置说明 {#config}

### 初始化参数

| 参数 | 类型 | 是否必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `applicationId` | `string` | 是 |  | 观测云中创建应用后生成的应用 ID。 |
| `clientToken` | `string` | Public DataWay 接入必填 |  | 公网接入 token。 |
| `site` | `string` | Public DataWay 接入必填 |  | 公网接入地址。 |
| `datakitOrigin` | `string` | DataKit 接入必填 |  | DataKit 上报地址，格式为 `协议 + 域名/IP + 可选端口`。 |
| `env` | `string` | 否 |  | 当前环境，例如 `prod`、`gray`、`pre`、`common`、`local`。 |
| `version` | `string` | 否 |  | 当前应用版本。 |
| `service` | `string` | 否 | `browser` | 服务名。 |
| `sessionSampleRate` | `number` | 否 | `100` | 指标类数据采样率，`100` 为全量，`0` 为不采集。 |
| `sessionReplaySampleRate` | `number` | 否 | `100` | Session Replay 采样率。 |
| `trackSessionAcrossSubdomains` | `boolean` | 否 | `false` | 是否在同主域不同子域之间共享会话缓存。 |
| `usePartitionedCrossSiteSessionCookie` | `boolean` | 否 | `false` | 是否启用 partitioned secure cross-site session cookie。 |
| `useSecureSessionCookie` | `boolean` | 否 | `false` | 是否启用 secure session cookie。启用后，非 HTTPS 连接不会发送依赖该 cookie 的 RUM 数据。 |
| `trackUserInteractions` | `boolean` | 否 | `false` | 是否自动采集用户行为。 |
| `traceType` | `string` | 否 | `ddtrace` | 链路追踪类型，支持 `ddtrace`、`zipkin`、`skywalking_v3`、`jaeger`、`zipkin_single_header`、`w3c_traceparent`。 |
| `traceId128Bit` | `boolean` | 否 | `false` | 是否生成 128 位 `traceId`。当前适用于 `zipkin`、`jaeger`。 |
| `allowedTracingOrigins` | `array` | 否 | `[]` | 允许注入 trace header 的 origin 列表或正则。 |
| `allowedTracingUrls` | `array` | 否 | `[]` | 允许注入 trace header 的 URL 列表、正则或函数。 |
| `actionNameAttribute` | `string` | 否 |  | 自定义行为名称属性。 |
| `beforeSend` | `function` | 否 |  | 事件发送前的拦截与改写函数。 |
| `storeContextsToLocal` | `boolean` | 否 |  | 是否将用户与上下文信息缓存到 localStorage。 |
| `storeContextsKey` | `string` | 否 |  | 自定义 localStorage key。 |
| `compressIntakeRequests` | `boolean` | 否 |  | 是否在 Worker 中压缩上报请求。 |
| `workerUrl` | `string` | 否 |  | 现有 deflate/session replay worker 的自托管地址。 |
| `replayCanvasWorkerUrl` | `string` | 否 |  | canvas snapshot 编码专用 worker 地址，不替代 `workerUrl`。 |
| `replayCanvasEnabled` | `boolean` | 否 | `false` | 是否开启 canvas 录制。不开启则不会采集 canvas。 |
| `replayCanvasMode` | `'manual' \| 'auto'` | 否 | `auto` | canvas 录制模式。`manual` 需要手动调用 `snapshotCanvas(canvas)`；`auto` 为自动录制。 |
| `replayCanvasSampling` | `number \| 'all'` | 否 | `2` | 仅在 `replayCanvasMode: 'auto'` 下生效。<br>填正数（建议从 `2` 开始）：选择更稳健的自动 snapshot 路径；数值本身不控制采集频率，采集节奏由 `replayCanvasAutoInterval` 及 cooldown/backoff 配置控制。<br>填 `'all'`：走更高还原度的自动录制，尽量保留绘制过程；复杂场景下仍可能自动回退为 snapshot。 |
| `replayCanvasQuality` | `'low' \| 'medium' \| 'high' \| number` | 否 | `0.4` | canvas snapshot 编码质量。字符串预设还会同时调整采样与自动调度预算。 |
| `replayCanvasAutoInterval` | `number` | 否 | `250` | 每个 canvas 的自动 snapshot 目标间隔，单位为毫秒。多 canvas 仍受公平轮转与全局采集预算限制。 |
| `replayCanvasAutoCooldown` | `number` | 否 | `250` | 同一 canvas 自动 snapshot 的最小冷却时间，单位为毫秒。 |
| `replayCanvasAutoUnchangedBackoff` | `number` | 否 | `3000` | 轻量签名持续未变化时，触发下一次完整编码校验的间隔，单位为毫秒；期间仍会以有界、自适应节奏探测变化。 |
| `replayCanvasAutoFailureBackoff` | `number` | 否 | `5000` | 自动采集失败后的退避时间，单位为毫秒。 |
| `replayCanvasAutoMaxPerRun` | `number` | 否 | `2` | 单次自动调度最多处理的 canvas 数。 |
| `replayCanvasFlushImmediately` | `boolean` | 否 | `manual: true`<br>`auto: false` | canvas 帧成功进入 replay 后是否优先 flush。 |
| `trackBfcacheViews` | `boolean` | 否 |  | 是否采集浏览器前进后退缓存（BFCache）恢复的页面访问。 |
| `silentMultipleInit` | `boolean` | 否 |  | 是否静默忽略重复初始化。 |

## Canvas 录制说明

canvas 录制默认不会自动生效。要让它真正工作，至少需要同时满足：

- Session Replay 已被采样到
  - 也就是 `sessionReplaySampleRate > 0`，或者命中 `sessionReplayOnErrorSampleRate`
- 已调用 `startSessionReplayRecording()`
- 已配置 `replayCanvasEnabled: true`
- 目标元素是 `2d canvas`；WebGL/WebGL2 还需要在 `auto` 模式注册可选的
  `@cloudcare/browser-rum-webgl` 插件

如果使用 `manual` 模式，还必须由业务代码主动调用：

```js
datafluxRum.snapshotCanvas(canvas)
```

### Canvas 相关参数中哪些应视为必填

实际接入时，建议把下面这些项视为必填：

- `sessionReplaySampleRate`
- `replayCanvasEnabled: true`
- `replayCanvasMode`

如果 `replayCanvasMode === 'auto'`，再显式配置：

- `replayCanvasSampling`
  - `2`：推荐默认值，适合作为大多数页面的自动 snapshot 起点
  - 其他正数：同样选择自动 snapshot 路径，不用于调节采集频率
  - `'all'`：更高还原度的自动录制，适合更看重绘制过程还原的页面

自动 snapshot 的采集节奏由 `replayCanvasAutoInterval` 以及 cooldown/backoff 配置控制。
这里的默认高频节奏用于 Canvas 2D；WebGL 插件未显式配置 interval/cooldown 时会
保留更保守的 GPU 读回节奏，避免默认放大 `readPixels` 成本。
WebGL/WebGL2 始终使用可选插件的有预算像素快照；`'all'` 只让 Canvas 2D
尝试 command capture。

上表是没有使用 `low`、`medium`、`high` 字符串预设时的运行时基线默认值。
字符串预设会同时替换质量、sampling、interval、cooldown、unchanged/failure
backoff 和 max-per-run；显式传入的单项配置会覆盖预设中的对应值。如果只想改变
图片质量而不改变调度预算，请给 `replayCanvasQuality` 传 `0` 到 `1` 之间的数字。
完整预设矩阵见 [Canvas 录制使用手册](../replay-canvas.md)。

### 三套推荐最小配置

#### 手动录制

```js
datafluxRum.init({
  applicationId: 'Your Application ID',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  sessionReplaySampleRate: 100,

  replayCanvasEnabled: true,
  replayCanvasMode: 'manual',
  replayCanvasQuality: 'medium'
})

datafluxRum.startSessionReplayRecording()
```

#### 自动 snapshot

```js
datafluxRum.init({
  applicationId: 'Your Application ID',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  sessionReplaySampleRate: 100,

  replayCanvasEnabled: true,
  replayCanvasMode: 'auto',
  replayCanvasSampling: 2,
  replayCanvasQuality: 'medium'
})

datafluxRum.startSessionReplayRecording()
```

#### 自动高还原度录制

```js
datafluxRum.init({
  applicationId: 'Your Application ID',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  sessionReplaySampleRate: 100,

  replayCanvasEnabled: true,
  replayCanvasMode: 'auto',
  replayCanvasSampling: 'all',
  replayCanvasQuality: 'medium'
})

datafluxRum.startSessionReplayRecording()
```

### CSP 场景

如果站点 CSP 不允许 `worker-src blob:`，可以配置：

```js
datafluxRum.init({
  // ...
  replayCanvasWorkerUrl: '/canvas-worker.js'
})
```

需要注意：

- `replayCanvasWorkerUrl` 只影响 canvas snapshot 编码
- 它不替代 `workerUrl`
- 并不是所有 canvas 帧都会用到 canvas worker

更多说明见 [CSP 安全策略](./content-security-policy.zh.md)。
