# Canvas Recording Guide

## Overview

Guance Browser RUM can record `canvas` content as part of Session Replay.

The first thing to keep clear is this:

**Setting `replayCanvasEnabled` alone is not enough.**

Canvas recording only works when all of the following are true:

- Session Replay sampling is enabled
  - for example `sessionReplaySampleRate > 0`, or the session is captured by `sessionReplayOnErrorSampleRate`
- Session Replay recording has actually started
  - call `startSessionReplayRecording()`
- canvas recording is enabled
  - `replayCanvasEnabled: true`
- the target element is a `2d canvas`
- in `manual` mode, your app must also call `snapshotCanvas(canvas)`

Current capability boundaries:

- supports manual recording
- supports automatic recording
- automatic recording has two formal paths:
  - snapshot sampling
  - higher-fidelity auto recording
- only `2d canvas` is supported
- recording output is sent through the Session Replay event stream

Current scope limitations:

- `webgl` / `webgl2`
- full-fidelity reconstruction for every complex 2D scene

## Minimum Working Configurations

These are the current minimum viable setups.

### 1. Manual recording

Best when:

- you know exactly when the canvas is stable
- you only need key frames
- you want the most predictable cost

```js
datafluxRum.init({
  applicationId: '<YOUR_APPLICATION_ID>',
  datakitOrigin: '<YOUR_DATAKIT_ORIGIN>',
  sessionReplaySampleRate: 100,

  replayCanvasEnabled: true,
  replayCanvasMode: 'manual',
  replayCanvasQuality: 'medium'
})

datafluxRum.startSessionReplayRecording()
```

Then capture frames explicitly:

```js
await datafluxRum.snapshotCanvas(canvasElement)
```

### 2. Automatic snapshot sampling

Best when:

- manual frame timing is inconvenient
- stability and cost matter more than fidelity
- frame-by-frame reproduction is not required

```js
datafluxRum.init({
  applicationId: '<YOUR_APPLICATION_ID>',
  datakitOrigin: '<YOUR_DATAKIT_ORIGIN>',
  sessionReplaySampleRate: 100,

  replayCanvasEnabled: true,
  replayCanvasMode: 'auto',
  replayCanvasSampling: 2,
  replayCanvasQuality: 'medium'
})

datafluxRum.startSessionReplayRecording()
```

### 3. Higher-fidelity automatic recording

Best when:

- you want auto mode to follow real drawing more closely
- your page mainly uses 2D canvas
- you accept automatic fallback to snapshot for harder cases

```js
datafluxRum.init({
  applicationId: '<YOUR_APPLICATION_ID>',
  datakitOrigin: '<YOUR_DATAKIT_ORIGIN>',
  sessionReplaySampleRate: 100,

  replayCanvasEnabled: true,
  replayCanvasMode: 'auto',
  replayCanvasSampling: 'all',
  replayCanvasQuality: 'medium'
})

datafluxRum.startSessionReplayRecording()
```

## What Must Be Configured

### Required prerequisites

- `sessionReplaySampleRate`
- `startSessionReplayRecording()`
- `replayCanvasEnabled: true`

### Manual mode

- `replayCanvasEnabled: true`
- strongly recommended to set `replayCanvasMode: 'manual'`
- your business code must call `snapshotCanvas(canvas)`

### Auto mode

- `replayCanvasEnabled: true`
- `replayCanvasMode: 'auto'`
- strongly recommended to set `replayCanvasSampling` explicitly
  - `2`: recommended starting value, safer automatic snapshot sampling
  - `1`: more frequent automatic snapshots, with higher cost
  - `'all'`: higher-fidelity auto recording

### When to configure `replayCanvasWorkerUrl`

This is not a feature toggle. It is a deployment setting.

Configure it only when:

- your CSP does not allow `worker-src blob:`
- you want to self-host the canvas snapshot encoding worker
- you explicitly want canvas encoding to avoid the inline blob worker

```js
datafluxRum.init({
  replayCanvasEnabled: true,
  replayCanvasMode: 'auto',
  replayCanvasSampling: 2,
  replayCanvasWorkerUrl: '/canvas-worker.js'
})
```

Notes:

- `replayCanvasWorkerUrl` only affects canvas snapshot encoding
- it does not replace `workerUrl`
- if the current frame does not use snapshot encoding, the canvas worker is not involved

## Mode Differences

### `manual`

- business code decides when to capture
- good for key checkpoints
- best cost control

### `auto`

- the SDK captures frames automatically
- the concrete strategy depends on `replayCanvasSampling`
- recording pauses while the page is hidden and resumes when it becomes visible again

## Current Fallback Boundaries

In auto high-fidelity mode, some cases may still fall back to snapshot-based recording. Typical examples include:

- `Path2D`
- `CanvasGradient`
- `CanvasPattern`
- some `drawImage(...)` sources such as video or cross-origin image sources

This is a current product boundary, not a separate user configuration.

## Practical Recommendations

- Use `manual` if you only need stable checkpoints.
- Use `auto + replayCanvasSampling: number` if you want the safer default.
- Use `auto + replayCanvasSampling: 'all'` only when higher fidelity is worth the extra complexity.

## FAQ

### 1. Why are some charts recorded on a dashboard page while others are missing?

This usually happens on pages that render many canvas charts at the same time. When some charts are missing, the most common reason is not that a single chart failed, but that:

- auto mode does not guarantee every chart is captured in every round
- there are too many visible charts for the current capture budget
- some charts render very early and never redraw again
- some complex charts fall back to snapshot in higher-fidelity auto mode, which costs more

The recommended approach is:

1. If the page priority is “do not miss important charts”, prefer:

```js
replayCanvasEnabled: true,
replayCanvasMode: 'auto',
replayCanvasSampling: 'all'
```

2. For critical above-the-fold charts, capture an explicit frame after rendering completes:

```js
await datafluxRum.snapshotCanvas(canvas)
```

3. Let non-critical charts remain on auto mode

4. Use `shouldRecordCanvas()` to prioritize important charts or skip low-value mini charts:

```js
shouldRecordCanvas(canvas) {
  if (canvas.dataset.miniChart === 'true') {
    return false
  }

  if (canvas.id === 'main-trend' || canvas.id === 'conversion-funnel') {
    return 10
  }

  return 1
}
```

If you care more about stability and cost than full dashboard coverage:

- keep `replayCanvasSampling: 2`
- use manual `snapshotCanvas(canvas)` for key charts only

If you care more about coverage:

- try `replayCanvasSampling: 'all'`
- combine it with manual snapshots for the most important charts

In practice:

- auto mode is responsible for “capture as much as possible”
- manual `snapshotCanvas(canvas)` is responsible for “make sure this chart is definitely recorded”
