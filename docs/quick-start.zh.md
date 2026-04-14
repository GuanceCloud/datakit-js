# RUM SDK 快速开始

## 概述

Guance RUM SDK 用于采集 Web 应用的真实用户行为、性能和错误数据。

本文档只保留最常用的接入步骤。更完整的配置说明请继续查看：

- [应用接入说明](./rum/app-access.zh.md)
- [Canvas 录制使用手册](./replay-canvas.zh.md)

## NPM 接入

```bash
npm install @cloudcare/browser-rum
```

```js
import { datafluxRum } from '@cloudcare/browser-rum'

datafluxRum.init({
  applicationId: 'Your Application ID',
  datakitOrigin: '<DataKit Domain Name or IP>',
  env: 'production',
  version: '1.0.0',
  sessionSampleRate: 100,
  sessionReplaySampleRate: 70,
  trackUserInteractions: true
})

datafluxRum.startSessionReplayRecording()
```

## CDN 接入

```html
<script src="https://static.guance.com/browser-sdk/v3/dataflux-rum.js" type="text/javascript"></script>
<script>
  window.DATAFLUX_RUM &&
    window.DATAFLUX_RUM.init({
      applicationId: 'Your Application ID',
      datakitOrigin: '<DataKit Domain Name or IP>',
      env: 'production',
      version: '1.0.0',
      sessionSampleRate: 100,
      sessionReplaySampleRate: 70,
      trackUserInteractions: true
    })

  window.DATAFLUX_RUM && window.DATAFLUX_RUM.startSessionReplayRecording()
</script>
```

## Session Replay

启用 Session Replay 至少需要两步：

1. `init()` 时配置 `sessionReplaySampleRate`
2. 初始化完成后调用 `startSessionReplayRecording()`

## Canvas 录制

如果你还需要录制 `canvas`，除了开启 Session Replay，还必须显式配置：

- `replayCanvasEnabled: true`
- `replayCanvasMode`
- `auto` 模式下再显式配置 `replayCanvasSampling`

当前 `replayCanvasMode` 默认值是 `auto`。  
更完整的接入方式见 [Canvas 录制使用手册](./replay-canvas.zh.md)。
