# `@cloudcare/browser-rum-webgl`

Optional WebGL/WebGL2 Session Replay capture for
`@cloudcare/browser-rum`. The plugin observes WebGL draw calls, copies the
rendered frame synchronously, and delegates image encoding to the RUM SDK's
existing canvas worker/main-thread encoder.

The package does not contain a second replay recorder, segment pipeline, or
canvas worker. Ordinary DOM and Canvas 2D replay remain owned by
`@cloudcare/browser-rum`.

WebGL Replay is available from SDK `3.3.7` and requires
`@cloudcare/browser-rum >= 3.3.7`. Install the addon from the same SDK release
as `@cloudcare/browser-rum` when possible. The package keeps its minimum capable
host version as a peer dependency, and the build checks the private `onInit`
runtime registration and positional runtime shape in both bundles. If
registration is absent or runtime creation fails, the host keeps DOM, Canvas
2D, and other RUM collection active while WebGL capture stays off.

## NPM

Register the plugin when RUM is initialized. Registration must happen before
`startSessionReplayRecording()` and before the WebGL engine is loaded. The
plugin installs its bootstrap hooks synchronously during `init()`, so an engine
may cache hooked draw methods before the recorder becomes ready; there is no
need to poll `isRecording()` before starting the game.

An unclaimed bootstrap hook expires after 30 seconds. This prevents sampled-out
or never-started replay sessions from leaving WebGL and rAF prototypes wrapped
for the page lifetime. Start the engine immediately after `init()`: wrappers
cached by the engine during that window remain routeable after the lease, and a
lease claimed by the recorder stays active until the observer stops.

```js
import { datafluxRum } from '@cloudcare/browser-rum'
import { webglReplayPlugin } from '@cloudcare/browser-rum-webgl'

datafluxRum.init({
  applicationId: 'my-app',
  clientToken: 'my-client-token',
  site: 'https://example.com',
  sessionSampleRate: 100,
  sessionReplaySampleRate: 100,
  replayCanvasEnabled: true,
  replayCanvasMode: 'auto',
  replayCanvasSampling: 2,
  replayCanvasAutoInterval: 1000,
  replayCanvasQuality: 'medium',
  plugins: [webglReplayPlugin()]
})

datafluxRum.startSessionReplayRecording()
```

## CDN

Load both bundles before calling `DATAFLUX_RUM.init()`. The addon does not
modify `DATAFLUX_RUM` and does not register itself automatically.

```html
<script src="https://static.guance.com/browser-sdk/v3/dataflux-rum.js"></script>
<script src="https://static.guance.com/browser-sdk/v3/dataflux-rum-webgl.js"></script>
<script>
  DATAFLUX_RUM.init({
    applicationId: 'my-app',
    clientToken: 'my-client-token',
    site: 'https://example.com',
    sessionSampleRate: 100,
    sessionReplaySampleRate: 100,
    replayCanvasEnabled: true,
    replayCanvasMode: 'auto',
    replayCanvasSampling: 2,
    replayCanvasAutoInterval: 1000,
    plugins: [DATAFLUX_RUM_WEBGL.webglReplayPlugin()]
  })

  DATAFLUX_RUM.startSessionReplayRecording()
</script>
```

## Runtime behavior

- WebGL/WebGL2 frames are sampled only in Canvas `auto` mode.
- If canvas replay is disabled or configured as `manual`, registering the
  plugin does not install the early WebGL/rAF bootstrap hooks.
- The rendered backing store is staged at the draw/rAF boundary so contexts
  created with `preserveDrawingBuffer: false` can be recorded.
- A failed `drawImage()` copy falls back to a bounded `readPixels()` path that
  restores framebuffer, pixel-pack buffer, and pixel-store state.
- Oversized encoded frames retry at 40% dimensions and reduced quality. The
  fallback profile is cached briefly to avoid repeatedly attempting an
  unsuitable full-size encoding.
- Staging surfaces, readback buffers, queued frames, and concurrent encodes are
  bounded. The RUM host reports logical `result` and `physicalSettled`
  separately, so `reset()`, `stop()`, and encode timeouts never reuse a surface
  still owned by an asynchronous native encode.
- A draw deferred by cooldown, an in-flight encode, concurrency pressure, or a
  full boundary queue remains dirty, but it is staged only after the canvas
  draws again. Timers and encode completions never read source WebGL pixels.
  This is required for contexts using `preserveDrawingBuffer: false`, whose
  static tail cannot be read safely after its render boundary.
- Boundary candidates and concurrent encodes are bounded and selected fairly
  by priority and last-selection order. Deferred state is discarded when the
  document becomes hidden.
- Full-snapshot canvas baselines skip canvases identified as WebGL. Their next
  real draw supplies the first safe replay frame instead of reading a static
  default framebuffer from an asynchronous baseline task.
- `shouldRecordCanvas(canvas)` is evaluated at scheduling time. Return `false`
  to skip a canvas or a number to prioritize important canvases; larger numbers
  are selected first and are reported in replay canvas debug results.
- WebGL failures never fall back to the ordinary Canvas 2D snapshot path.
- WebGL methods cached before plugin/RUM `init()` cannot be retroactively
  intercepted. Load and initialize the plugin before Cocos Creator or another
  engine caches its WebGL methods.
- Synthetic cached-draw contract tests do not replace acceptance with a target
  engine version. Validate recording and playback with the actual H5 build
  before rollout.

This addon requires the full `@cloudcare/browser-rum` recorder capability. It
cannot be used with `@cloudcare/browser-rum-slim`, which intentionally excludes
Session Replay.
