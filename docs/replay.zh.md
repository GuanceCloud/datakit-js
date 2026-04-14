# Session Replay 接入指南

## 开启 Session Replay

升级到 `> 3.0.0` 版本后，调用 `init()` 并不会自动开始录制 Session Replay。你需要显式调用 `startSessionReplayRecording()`。

这个能力适合只在特定场景开启录制，例如登录后、命中特定错误后，或者用户进入关键流程后。

```js
if (user.isLogin()) {
  DATAFLUX_RUM.startSessionReplayRecording()
}
```

如果需要停止录制，可以调用 `stopSessionReplayRecording()`。

## NPM

```js
import { datafluxRum } from '@cloudcare/browser-rum'

datafluxRum.init({
  applicationId: '<DATAFLUX_APPLICATION_ID>',
  datakitOrigin: '<DATAKIT_ORIGIN>',
  service: 'browser',
  env: 'production',
  version: '1.0.0',
  sessionSampleRate: 100,
  sessionReplaySampleRate: 70,
  trackInteractions: true
})

datafluxRum.startSessionReplayRecording()
```

## CDN

```html
<script
  src="https://static.guance.com/browser-sdk/v3/dataflux-rum.js"
  type="text/javascript"
></script>
<script>
  window.DATAFLUX_RUM &&
    window.DATAFLUX_RUM.init({
      applicationId: '<DATAFLUX_APPLICATION_ID>',
      datakitOrigin: '<DATAKIT_ORIGIN>',
      service: 'browser',
      env: 'production',
      version: '1.0.0',
      sessionSampleRate: 100,
      sessionReplaySampleRate: 100,
      trackInteractions: true
    })

  window.DATAFLUX_RUM && window.DATAFLUX_RUM.startSessionReplayRecording()
</script>
```

## 注意事项

### 某些元素在回放中不可见

当前 Session Replay 对以下元素仍然不支持完整回放：

- `iframe`
- `video`
- `audio`
- Web Components
- Shadow DOM

对于 `canvas`，当前 SDK 已支持 2D canvas 录制。具体配置见 [Canvas 录制使用手册](./replay-canvas.md)。

### 字体或图片显示异常

Session Replay 不是视频文件，而是在回放时基于快照重建 DOM。因此字体、图片和样式文件在回放时仍然需要能够被浏览器访问。

常见原因：

- 静态资源已经不存在
- 资源需要鉴权
- 资源只在内网可访问
- 字体或图片因 CORS 被浏览器拦截

建议为回放依赖的静态资源显式配置：

```http
Access-Control-Allow-Origin: *
```

### CSS 样式不完整或鼠标悬停效果缺失

回放会优先尝试读取样式规则本身；如果无法读取，会退回到记录样式文件链接。跨域样式表需要配合 `crossorigin="anonymous"` 和正确的 CORS Header。

```html
<link
  rel="stylesheet"
  crossorigin="anonymous"
  href="https://assets.example.com/style.css"
/>
```

并在静态资源服务端允许页面域名访问对应样式资源。
