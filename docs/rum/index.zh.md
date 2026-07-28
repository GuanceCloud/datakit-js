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

## 运行时会话控制

调用 `startSession()` 会立即结束当前会话并创建新会话，不需要等待下一次用户交互。可以同时覆盖运行时会话采样率；该采样率也会用于后续自动续会：

```js
datafluxRum.startSession({
  sessionSampleRate: 100
})
```

当当前会话未命中采样，但需要立即采集并录制 Replay 时，可以使用：

```js
datafluxRum.startSessionReplayRecording({ force: true })
```

强制会话会生成 `session_id`，并通过 `session.is_forced_session: true` 标记。

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
