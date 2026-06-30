# Guance RUM SDK 接入指南

## 基础接入

最小初始化示例：

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

## 关键说明

- `sessionReplaySampleRate` 控制 Session Replay 采样率
- `startSessionReplayRecording()` 必须显式调用
- 如果不调用 `startSessionReplayRecording()`，Replay 不会开始

## Canvas 录制

如果要启用 canvas 录制，除了 Session Replay，本质上还要再配置：

- `replayCanvasEnabled: true`
- `replayCanvasMode`
- `auto` 模式下建议显式配置 `replayCanvasSampling`

当前 `replayCanvasMode` 默认值是 `auto`。

详细说明见：

- [应用接入说明](./app-access.zh.md)
- [Electron 应用接入说明](./electron-access.zh.md)
- [Canvas 录制使用手册](../replay-canvas.md)
