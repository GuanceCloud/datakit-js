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
| `replayCanvasSampling` | `2` | 仅在 `auto` 模式下生效。填 `2`：推荐起始值，自动 snapshot 更稳。数值表示使用 snapshot sampling；采集节奏由 `replayCanvasAutoInterval` 和 cooldown/backoff 配置控制。填 `'all'`：更高还原度的自动录制，复杂场景下仍可能回退为 snapshot。建议显式配置。 |
| `replayCanvasQuality` | `0.4` | Canvas snapshot 编码质量。`low`、`medium`、`high` 字符串预设还会一起调整 sampling 和自动调度预算；只改图片质量时请传 `0` 到 `1` 的数字。 |
| `replayCanvasWorkerUrl` |  | canvas snapshot 编码专用 worker 地址，只影响 canvas 编码，不替代原 `workerUrl`。 |

未使用字符串预设时，自动调度基线为：interval `1000 ms`、cooldown
`1000 ms`、unchanged backoff `3000 ms`、failure backoff `5000 ms`、每轮最多
`2` 个 canvas。显式单项配置会覆盖字符串预设里的对应值；完整 preset 矩阵见
[Canvas 录制使用手册](../../docs/replay-canvas.md)。`replayCanvasFlushImmediately`
在 `manual` 模式默认 `true`，在 `auto` 模式默认 `false`。

## 实际上应视为必填的项

- `sessionReplaySampleRate`
- `replayCanvasEnabled: true`
- `replayCanvasMode`

如果是 `auto` 模式，还应显式配置：

- `replayCanvasSampling`
  - `2`：推荐默认值
  - 数值：使用 snapshot sampling；频率由 auto interval 和
    cooldown/backoff 配置控制
  - `'all'`：更高还原度的自动录制
- WebGL/WebGL2 不包含在本主包中。需要时额外安装
  `@cloudcare/browser-rum-webgl`，并在 `plugins` 中注册
  `webglReplayPlugin()`；它在 `auto` 模式下使用绘制驱动且受预算控制的像素快照。

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
- [Canvas 录制使用手册](../../docs/replay-canvas.md)
