# @cloudcare/browser-rum 中文说明

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

## Session Replay

启用 Session Replay 至少需要：

1. 在 `init()` 时配置 `sessionReplaySampleRate`
2. 初始化完成后调用 `startSessionReplayRecording()`

如果不调用 `startSessionReplayRecording()`，Replay 不会开始。

## Canvas 录制相关配置

如果你只关心 canvas 录制，这几个参数最重要：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `replayCanvasEnabled` | `false` | canvas 录制总开关。不设为 `true` 就不会录制 canvas。 |
| `replayCanvasMode` | `auto` | `manual` 或 `auto`。`manual` 需要主动调用 `snapshotCanvas(canvas)`。 |
| `replayCanvasSampling` |  | `auto` 模式下的录制策略。数值表示 snapshot sampling，`'all'` 表示更高还原度的自动录制。建议显式配置，不要依赖默认行为。 |
| `replayCanvasWorkerUrl` |  | canvas snapshot 编码专用 worker 地址，只影响 canvas 编码，不替代原 `workerUrl`。 |

## 实际上应视为必填的项

- `sessionReplaySampleRate`
- `replayCanvasEnabled: true`
- `replayCanvasMode`

如果是 `auto` 模式，还应显式配置：

- `replayCanvasSampling`

## 推荐最小配置

### 手动录制

```js
datafluxRum.init({
  // ...
  sessionReplaySampleRate: 100,
  replayCanvasEnabled: true,
  replayCanvasMode: 'manual',
  replayCanvasQuality: 'medium'
})

datafluxRum.startSessionReplayRecording()
```

### 自动 snapshot

```js
datafluxRum.init({
  // ...
  sessionReplaySampleRate: 100,
  replayCanvasEnabled: true,
  replayCanvasMode: 'auto',
  replayCanvasSampling: 2,
  replayCanvasQuality: 'medium'
})

datafluxRum.startSessionReplayRecording()
```

### 自动高还原度录制

```js
datafluxRum.init({
  // ...
  sessionReplaySampleRate: 100,
  replayCanvasEnabled: true,
  replayCanvasMode: 'auto',
  replayCanvasSampling: 'all',
  replayCanvasQuality: 'medium'
})

datafluxRum.startSessionReplayRecording()
```

## 更多说明

- [应用接入说明](../../docs/rum/app-access.zh.md)
- [Canvas 录制使用手册](../../docs/replay-canvas.zh.md)
