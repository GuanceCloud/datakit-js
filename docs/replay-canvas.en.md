# Canvas Recording Guide

## Overview

Guance Browser RUM can record `canvas` content as part of Session Replay.

Canvas 2D recording configuration is available from SDK `3.3.0`. The optional
WebGL/WebGL2 Replay addon is available from SDK `3.3.7` and requires
`@cloudcare/browser-rum >= 3.3.7`. Use the RUM package and
`@cloudcare/browser-rum-webgl` from the same SDK release when possible.

The first thing to keep clear is this:

**Setting `replayCanvasEnabled` alone is not enough.**

Canvas recording only works when all of the following are true:

- Session Replay sampling is enabled
  - for example `sessionReplaySampleRate > 0`, or the session is captured by `sessionReplayOnErrorSampleRate`
- Session Replay recording has actually started
  - call `startSessionReplayRecording()`
- canvas recording is enabled
  - `replayCanvasEnabled: true`
- the target is a `2d canvas`; `webgl` / `webgl2` also requires the optional
  `@cloudcare/browser-rum-webgl` plugin registered in `auto` mode
- in `manual` mode, your app must also call `snapshotCanvas(canvas)`

Current capability boundaries:

- supports manual recording
- supports automatic recording
- automatic recording has two formal paths:
  - snapshot sampling
  - higher-fidelity auto recording
- supports `2d canvas`; complex Path2D, Gradient, Pattern, video, or
  cross-origin `drawImage` scenes may fall back or may not replay with full
  fidelity
- the optional `@cloudcare/browser-rum-webgl` plugin provides draw-driven
  automatic pixel snapshots for `webgl` / `webgl2`
- recording output is sent through the Session Replay event stream

Current scope limitations:

- WebGL command-level replay
- `OffscreenCanvas`
- full-fidelity reconstruction for every complex 2D scene

## WebGL Plugin Setup

The WebGL implementation is not part of the `@cloudcare/browser-rum` main
bundle. DOM and ordinary Canvas 2D replay do not need the addon. Install it only
for applications that need WebGL replay. WebGL Replay is available from SDK
`3.3.7`, requires `@cloudcare/browser-rum >= 3.3.7`, and should use the addon
from the same SDK release when possible:

```js
import { datafluxRum } from '@cloudcare/browser-rum'
import { webglReplayPlugin } from '@cloudcare/browser-rum-webgl'

datafluxRum.init({
  // ...
  sessionReplaySampleRate: 100,
  replayCanvasEnabled: true,
  replayCanvasMode: 'auto',
  replayCanvasSampling: 2,
  plugins: [webglReplayPlugin()]
})

datafluxRum.startSessionReplayRecording()
```

For CDN usage, load both scripts before `init()`:

```html
<script src="https://static.guance.com/browser-sdk/v3/dataflux-rum.js"></script>
<script src="https://static.guance.com/browser-sdk/v3/dataflux-rum-webgl.js"></script>
<script>
  DATAFLUX_RUM.init({
    // ...
    replayCanvasEnabled: true,
    replayCanvasMode: 'auto',
    plugins: [DATAFLUX_RUM_WEBGL.webglReplayPlugin()]
  })
  DATAFLUX_RUM.startSessionReplayRecording()
</script>
```

The plugin must be registered during RUM `init()`. A missing, duplicate,
incompatible, or failed plugin disables only WebGL capture; DOM, Canvas 2D, and
the rest of RUM continue normally.
When `replayCanvasEnabled` is not `true` or `replayCanvasMode` is `manual`, the
plugin does not install its early WebGL/rAF bootstrap hooks.

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
  - a number: snapshot sampling; tune frequency with the auto interval and
    cooldown/backoff options
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

A positive numeric `replayCanvasSampling` value selects the snapshot path; the
number does not replace the cadence setting. Use
`replayCanvasAutoInterval` to tune snapshot frequency: a smaller interval is
more frequent and costs more encoding and upload work. Use `'all'` when the
higher-fidelity 2D command path is worth the extra complexity.

### Quality presets and baseline defaults

The named `replayCanvasQuality` presets change both image quality and the auto
capture budget; they are not image-quality-only aliases:

| Setting | No named preset | `low` | `medium` | `high` |
| --- | --- | --- | --- | --- |
| Snapshot encode quality | `0.4` | `0.25` | `0.4` | `0.5` |
| `replayCanvasSampling` | `2` | `1` | `2` | `4` |
| `replayCanvasAutoInterval` | `250 ms` | `500 ms` | `250 ms` | `125 ms` |
| `replayCanvasAutoCooldown` | `250 ms` | `500 ms` | `250 ms` | `125 ms` |
| `replayCanvasAutoUnchangedBackoff` | `3000 ms` | `5000 ms` | `3000 ms` | `2000 ms` |
| `replayCanvasAutoFailureBackoff` | `5000 ms` | `7000 ms` | `5000 ms` | `4000 ms` |
| `replayCanvasAutoMaxPerRun` | `2` | `1` | `2` | `4` |

Without `low`, `medium`, or `high`, the “No named preset” column contains the
runtime baseline defaults. An explicitly configured individual option
overrides only its matching preset value. For example,
`replayCanvasQuality: 'medium'` together with
`replayCanvasAutoCooldown: 800` uses `800 ms` for cooldown and keeps the other
`medium` values.

For Canvas 2D, `replayCanvasAutoUnchangedBackoff` is the interval between full
encode validations of an unchanged signature. Lightweight `24x24` signature
probes continue with a bounded adaptive backoff (up to about `1000 ms`) so a
new animation can resume its target cadence without waiting for the full
validation window. WebGL keeps its separate conservative GPU-readback cadence.

`replayCanvasAutoInterval` is a per-canvas target cadence, not a fixed global
page scan. Multiple canvases are scheduled fairly and remain bounded by the
per-run, concurrency, and global capture budgets, so a busy dashboard can have
a lower effective per-canvas cadence than the target. The default global cap is
about `16.7` snapshot attempts per second, preventing capture cost from growing
linearly with the number of canvases.

The interval/cooldown matrix above is the Canvas 2D automatic-snapshot
baseline. The optional WebGL addon must synchronously read GPU pixels, so it
keeps the safer legacy cadence unless those fields are explicitly configured:
default `1000/1000 ms`, `low` `1500/3000 ms`, `medium` `1000/2000 ms`, and
`high` `700/1400 ms`. Explicit interval and cooldown values override the WebGL
policy independently. Improving 2D continuity therefore does not implicitly
multiply WebGL `readPixels` cost.

If you only want to change image encode quality without changing sampling or
scheduling, use a number from `0` to `1`, such as
`replayCanvasQuality: 0.4`. In `replayCanvasSampling: 'all'` mode, command
frames are not image-encoded, but fallback snapshots still use this quality.
`replayCanvasFlushImmediately` defaults to `true` in `manual` mode and `false`
in `auto` mode.

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

## WebGL Game Demo

Run `npm run dev`, then open `/webgl-replay-game.html`. That page additionally
loads `dataflux-rum-webgl.js`. The scene continuously
draws a shader background, star field, asteroids, projectiles, and collision
particles. Its inspector shows `webgl_snapshot` count, encoded bytes, and
capture latency. `Stress` increases the scene to roughly 800 dynamic objects,
while `Replay: on/off` makes it possible to compare the same game load with and
without recording.

For engines such as Cocos Creator that create a WebGL context, query extensions,
or cache `draw*` methods during boot, load the WebGL plugin and complete RUM
`init()` before loading the Cocos engine / `main.js`. The plugin installs a
lightweight bootstrap hook synchronously during `init()`, so `draw*`, extension
draw, and rAF methods cached before the asynchronous recorder is ready are
routed to the active observer once recording starts.

An unclaimed bootstrap hook restores the prototypes after 30 seconds so a
sampled-out or never-started replay session does not pay a page-lifetime hook
cost. Start the engine immediately after `init()`. Wrappers cached during that
window remain routeable after the lease, while a recorder-claimed hook remains
active until its observer stops.

A draw delayed by cooldown, an in-flight encode, concurrency pressure, or a
full boundary queue remains dirty, but the addon stages it only after that
canvas draws again. A timer or asynchronous encode completion never reads the
source WebGL framebuffer. This avoids stale or blank frames when
`preserveDrawingBuffer` is `false`. Boundary candidates stay bounded and use
priority plus last-selection order for fairness. `shouldRecordCanvas()` is
reevaluated on each real draw; numeric results rank higher values first and are
also exposed as the canvas replay debug priority.

Deferred state is discarded on hidden/page-exit, and the addon does not start
new asynchronous WebGL encodes there.

The asynchronous full-snapshot canvas baseline skips canvases identified as
WebGL. Their first safe replay bitmap comes from the next real draw after the
observer starts; ordinary static 2D and unknown canvases keep their existing
baseline behavior.

```js
datafluxRum.init({
  // ...
  plugins: [webglReplayPlugin()]
})
datafluxRum.startSessionReplayRecording()

// init() is enough; do not poll isRecording() before booting the game.
bootCocosCreator()
```

Do not block game startup by polling `isRecording()`: a session outside
`sessionReplaySampleRate` never enters recording. If Cocos cached original
WebGL methods before the plugin/RUM `init()`, the SDK cannot retroactively
replace those saved function references; that incorrect initialization order
is outside the supported integration contract.
This validates the early method-caching contract commonly used by such
engines; it does not imply that every Cocos Creator version has been tested.
Run recording and playback acceptance against the target version's real H5
build before rollout.

For a smoother WebGL animation profile, start with:

```js
replayCanvasSampling: 2,
replayCanvasQuality: 0.4,
replayCanvasMaxCanvasSize: 960,
replayCanvasAutoInterval: 250,
replayCanvasAutoCooldown: 50,
replayCanvasAutoUnchangedBackoff: 1000,
replayCanvasAutoFailureBackoff: 3000
```

This targets about 4 captured frames per second. Lowering quality or maximum
size reduces encode latency and payload size, but cadence—not image quality—is
the primary control for temporal smoothness. Snapshot replay does not
interpolate between captured frames.

If a WebGL frame exceeds `replayCanvasMaxEncodedBytes`, the SDK reuses the same
staging frame for one bounded fallback: width and height are scaled to 40%, and
encoding quality is halved with a floor of 0.12. A successful fallback profile
is cached for 10 seconds and then probed at the original profile, so a game
scene change does not leave the canvas permanently downsampled. If the fallback
is still oversized, that frame is dropped, but subsequent samples avoid doing
both encodes until the next probe. This policy applies only to WebGL/WebGL2;
ordinary 2D canvas keeps its existing single-encode path and the byte cap is
not relaxed.

WebGL staging canvases share an internal `16 MiB` pixel-memory budget. A high-
DPR, 4K, or concurrent frame that exceeds this budget during staging is skipped
before the encoded-size fallback above can run. Lower
`replayCanvasMaxCanvasSize` for those WebGL scenes. This internal budget applies
only to WebGL staging/readback and does not silently clamp an explicit ordinary
2D canvas size configuration.

`replayCanvasMaxCanvasSize` defaults to `1280`. Increasing it also increases
pixel-processing and memory cost substantially.

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
