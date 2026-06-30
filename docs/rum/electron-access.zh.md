# Electron 应用接入说明

Electron 应用由 main process 和 renderer process 共同组成。RUM SDK 运行在浏览器环境中，因此只应在 renderer process 中初始化，用于采集窗口内页面的访问、资源、请求、错误和用户行为数据。

本文档结合当前 SDK 的初始化参数说明 Electron 应用的接入方式。

## 接入原则

- 只在 renderer process 初始化 RUM SDK，不要在 main process 中初始化。
- 每个需要监控的 `BrowserWindow`、`BrowserView` 或 `webview` 对应的 renderer 页面都需要接入一次。
- 如果页面通过 `file://` 加载，必须使用 `sessionPersistence: 'local-storage'`，避免依赖不可用或不稳定的 cookie。
- 如果页面通过 `https://` 加载，可以继续使用默认 cookie 会话策略；也可以统一使用 `local-storage`，但需要确保 RUM 与 Logs SDK 的会话策略保持一致。
- 如果同一个 Electron 应用同时使用本地 `file://` 页面和远程 `http(s)://` 页面，它们会被浏览器同源策略隔离，通常会生成不同 session。

## 推荐接入方式

### NPM 接入

适用于使用 Webpack、Vite、Rollup 等构建 renderer 代码的 Electron 应用。

```bash
npm install @cloudcare/browser-rum
```

在 renderer 入口文件中初始化：

```js
import { datafluxRum } from '@cloudcare/browser-rum'

datafluxRum.init({
  applicationId: '<应用 ID>',

  // Public DataWay 接入
  clientToken: '<clientToken>',
  site: '<Public DataWay 地址>',

  // 如果使用 DataKit 接入，改为配置 datakitOrigin
  // datakitOrigin: '<DataKit 域名或 IP>',

  service: 'electron-renderer',
  env: 'production',
  version: '<应用版本>',
  sessionSampleRate: 100,
  trackUserInteractions: true,

  // file:// 页面必须配置
  sessionPersistence: 'local-storage'
})
```

如果需要 Session Replay：

```js
datafluxRum.startSessionReplayRecording()
```

### CDN 接入

适用于直接维护 renderer HTML 的应用。建议将 SDK 文件作为应用静态资源一起打包，避免桌面应用离线或弱网场景下依赖远程 CDN。

```html
<script src="./vendor/dataflux-rum.js" type="text/javascript"></script>
<script>
  window.DATAFLUX_RUM &&
    window.DATAFLUX_RUM.init({
      applicationId: '<应用 ID>',
      clientToken: '<clientToken>',
      site: '<Public DataWay 地址>',
      service: 'electron-renderer',
      env: 'production',
      version: window.__APP_VERSION__,
      sessionSampleRate: 100,
      trackUserInteractions: true,
      sessionPersistence: 'local-storage'
    })
</script>
```

如果 renderer 页面始终通过 `https://` 加载，并且 cookie 可用，可以不配置 `sessionPersistence`。

## main process 示例

main process 负责创建窗口，不需要引入或初始化 RUM SDK。推荐只把必要的版本、渠道等信息传递给 renderer。

```js
const { app, BrowserWindow } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.loadFile('index.html')
}

app.whenReady().then(createWindow)
```

`preload.js` 可以只暴露安全、只读的应用信息：

```js
const { contextBridge } = require('electron')
const { version } = require('./package.json')

contextBridge.exposeInMainWorld('electronAppInfo', {
  version
})
```

renderer 中再读取并写入 RUM 配置：

```js
datafluxRum.init({
  applicationId: '<应用 ID>',
  clientToken: '<clientToken>',
  site: '<Public DataWay 地址>',
  service: 'desktop-app',
  env: 'production',
  version: window.electronAppInfo.version,
  sessionSampleRate: 100,
  trackUserInteractions: true,
  sessionPersistence: 'local-storage'
})
```

## 多窗口接入

如果应用会同时打开多个窗口：

- 每个窗口内的 renderer 页面都要初始化 RUM SDK。
- 使用 `sessionPersistence: 'local-storage'` 时，多个窗口之间的 localStorage 同步可能存在极短延迟。
- 如果初始化后立即同时创建大量窗口，可能出现很短的临时 session。建议窗口创建和初始化之间保留至少几十毫秒间隔，或者按业务顺序逐个创建窗口。

## 本地页面和远程页面

Electron 应用常见两种页面来源：

| 页面来源 | 推荐配置 | 说明 |
| --- | --- | --- |
| `file://` 本地页面 | `sessionPersistence: 'local-storage'` | cookie 不可靠，必须使用 localStorage 存储 session。 |
| `https://` 远程页面 | 默认 cookie 或 `local-storage` | 如果使用默认 cookie，需要确保页面域名和安全策略允许写入 cookie。 |
| 混合 `file://` 与 `https://` | 分别接入，分别分析 | 受同源策略影响，本地页面和远程页面通常不会共享同一个 session。 |

如果应用从本地落地页跳转到远程站点，应预期它们在 RUM 中表现为两个不同会话。建议通过统一的 `user.id`、`service`、`env` 和 `version` 字段进行关联分析。

```js
datafluxRum.setUser({
  id: currentUserId,
  name: currentUserName
})
```

## API 请求与链路追踪

renderer 中的 `fetch` 和 `XMLHttpRequest` 会按浏览器 SDK 逻辑自动采集。若需要向后端 API 注入 Trace Header，需要配置 `allowedTracingUrls`：

```js
datafluxRum.init({
  applicationId: '<应用 ID>',
  clientToken: '<clientToken>',
  site: '<Public DataWay 地址>',
  service: 'desktop-app',
  env: 'production',
  version: window.electronAppInfo.version,
  sessionPersistence: 'local-storage',
  allowedTracingUrls: [
    'https://api.example.com',
    /https:\/\/.*\.internal-api\.example\.com/
  ],
  traceType: 'ddtrace'
})
```

不要把 `file://` 页面地址放入 `allowedTracingUrls`。该配置用于匹配后端 API 请求，而不是 renderer 页面本身。

## 错误与 SourceMap

Electron 本地页面的错误堆栈经常以 `file://` 开头，服务端可能无法像公网 URL 那样直接匹配 SourceMap。建议：

- 保持 `service`、`env`、`version` 和构建产物版本一致。
- 对 renderer 产物生成 SourceMap，并按发布版本保存。
- 如需改写本地文件路径，可在 `beforeSend` 中补充业务上下文，方便后续检索。

```js
datafluxRum.init({
  // ...
  beforeSend: (event) => {
    if (event.type === 'error') {
      event.context = {
        ...event.context,
        electron: true,
        rendererUrl: window.location.href
      }
    }
    return true
  }
})
```

## CSP 与 Worker

如果启用了 Session Replay、`compressIntakeRequests` 或 canvas 录制，SDK 可能会使用 Worker。Electron 应用如果配置了较严格的 CSP，需要允许对应 Worker 来源。

默认内联 Worker 通常需要：

```text
worker-src blob:;
```

如果不允许 `blob:`，请把 worker 文件打包为应用静态资源，并配置同源地址：

```js
datafluxRum.init({
  // ...
  workerUrl: './worker.js',
  replayCanvasWorkerUrl: './canvas-worker.js'
})
```

如果使用 `@cloudcare/browser-rum-slim`，该包不包含 Session Replay 和 `compressIntakeRequests` 压缩能力，一般不需要为这两项配置 worker。

## 安全建议

- 不要在 main process 暴露 RUM token 或其他敏感配置写接口。
- `preload` 只暴露必要的只读信息，例如应用版本、渠道、构建号。
- 保持 `contextIsolation: true` 和 `nodeIntegration: false`。
- 不要在 `beforeSend` 中上报本地文件绝对路径、用户名目录或其他敏感信息。
- 对用户输入、文件名、路径等字段进行脱敏后再写入自定义上下文。

## 验证方式

接入后，可以按以下顺序验证：

1. 打开 Electron 应用的目标窗口。
2. 在 DevTools Network 中确认存在 RUM 上报请求。
3. 触发一次页面访问、按钮点击、API 请求和前端错误。
4. 确认 `view`、`action`、`resource`、`error` 数据进入观测云。
5. 检查同一用户在多窗口或本地/远程页面切换时的 session 是否符合预期。

本地调试时，也可以临时开启 `beforeSend` 打印事件类型：

```js
datafluxRum.init({
  // ...
  beforeSend: (event) => {
    console.log('[RUM]', event.type, event)
    return true
  }
})
```

## 常见问题

### 为什么 main process 没有数据？

RUM SDK 是浏览器端 SDK，只采集 renderer process 中的页面行为。main process 中的崩溃、IPC、文件系统或原生模块错误需要通过应用自己的日志或崩溃采集方案处理。

### 为什么 `file://` 页面没有 session？

通常是没有配置 `sessionPersistence: 'local-storage'`，或者 renderer 页面所在环境禁用了 localStorage。请先确认该配置和 localStorage 可用性。

### 为什么本地页跳到远程页后 session 变了？

`file://` 和 `https://` 属于不同 origin，浏览器不会共享相同的 cookie 或 localStorage。建议用 `setUser()` 设置稳定用户 ID，在分析时按用户关联。

### 为什么多窗口里出现很短的 session？

多窗口同时初始化时，localStorage 在窗口之间同步可能有极短延迟。建议不要在同一瞬间创建并初始化大量窗口，窗口创建之间保留短暂间隔。

## 参考资料

- [Electron: Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
