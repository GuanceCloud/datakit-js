# Canvas Recording Acceptance Checklist

This document is for acceptance and validation of the current canvas recording implementation. It is not a design document.

Its purpose is simple:

- define whether the current canvas recording implementation is ready for validation or release at this stage

## Scope

This checklist covers:

- `replayCanvasSampling: number`
- `replayCanvasSampling: 'all'`
- `manual` mode
- `auto` mode
- canvas snapshot worker
  - inline blob worker
  - external `replayCanvasWorkerUrl`

Out of scope for this stage:

- WebGL command-level replay
- `OffscreenCanvas`
- perfect reconstruction for every complex 2D scene

## Preconditions

Before running acceptance, confirm:

- Session Replay is sampled in
- `startSessionReplayRecording()` has been called
- `replayCanvasEnabled: true`
- the target is a `2d canvas`, or a `webgl` / `webgl2` canvas in `auto` mode
- the demo or business page is already running in the target mode

## Core Acceptance Items

### 1. First-frame capture

Must confirm:

- the initial canvas state is recorded after first page entry
- dashboard initial panels are also recorded
- the first frame does not require a second manual interaction to appear

### 2. `manual` mode

Must confirm:

- `snapshotCanvas(canvas)` produces a recorded result
- repeated calls do not break live canvas rendering
- without `snapshotCanvas(canvas)`, no automatic frame capture occurs

### 3. `auto + replayCanvasSampling: number`

Must confirm:

- automatic snapshot capture triggers reliably
- no corrupted encoded payloads are produced
- no `createImageBitmap` decode errors occur
- recording pauses when the page is hidden and resumes after visibility returns

### 4. `auto + replayCanvasSampling: 'all'`

Must confirm:

- ordinary 2D drawing goes through command capture
- live canvas rendering is not broken
- fallback behavior is stable and explainable
- when complex objects such as `Path2D`, `CanvasGradient`, or `CanvasPattern` trigger fallback, other canvases are not polluted

### 5. Fallback behavior

Must confirm:

- fallback still produces acceptable replay results
- debug output contains a clear `reason`
- fallback does not leak stale command queues into the next round
- `takeSubsequentFullSnapshot()` and `pause()/resume()` reset state cleanly

### 6. Worker behavior

Must confirm:

- inline worker works
- external `replayCanvasWorkerUrl` works
- the external canvas worker does not affect the existing `workerUrl`
- a single runtime worker failure does not permanently disable the canvas worker path for the entire page

## Current Formal Boundaries

The following are formal fallback boundaries in the current product stage, not bugs by default:

- `Path2D`
- `CanvasGradient`
- `CanvasPattern`
- some `drawImage(...)` sources
- `drawImage(canvas, ...)`

If these scenarios produce:

- `scheduler: 'command_capture'`
- `status: 'fallback'`

that should be treated as the current product boundary rather than an unexplained failure.

## Must-Not-Fail Items

The following should block acceptance:

- missing first frame
- live canvas broken by the recorder
- corrupted encoded payloads
- `createImageBitmap` decode errors
- external `canvas-worker.js` not taking effect
- missing or degraded fallback reasons
- stale fallback state leaking across `takeSubsequentFullSnapshot()`

## Recommended Acceptance Record

For each acceptance run, record at least:

- page or demo scenario
- configuration
  - `replayCanvasMode`
  - `replayCanvasSampling`
  - worker mode
- whether the first frame was captured
- whether fallback was triggered
- fallback reason
- whether console errors occurred
- whether obvious replay defects were observed

## Current Acceptance Record

### Demo workbench (`http://127.0.0.1:8082/`)

Confirmed pass:

- first-frame capture
  - main canvas: pass
  - dashboard 10 canvases: pass
- `manual`
  - main canvas manual snapshot: pass
  - dashboard manual snapshot: pass
- concurrent `manual` snapshot
  - main canvas: `3/3` succeeded
  - dashboard: `10/10` succeeded
- `auto + replayCanvasSampling: number`
  - `continuous_snapshot:completed`
  - `eligibleCanvasCount=11`
  - `selectedCanvasCount=11`
  - dashboard `auto continuous`
    - `drawCount=37`
    - `completedSnapshots=200`
    - `avgSelectedCanvasCount=11`
- `auto + replayCanvasSampling: 'all'`
  - ordinary scenes: `command_capture:completed`
  - complex scenes: stable fallback, with confirmed reasons including `draw_image_canvas`
- `visibility command`
  - `hiddenSnapshotCount=0`
  - `fallbackCount=0`
  - `resumeFirstGapMs=15`
- dashboard `auto command` benchmark
  - `drawCount=39`
  - `completedSnapshots=41`
  - `avgSelectedCanvasCount=4.9`
  - `fallbackCount=0`
- dashboard `visibility command`
  - `drawCount=42`
  - `completedSnapshots=36`
  - `hiddenSnapshotCount=0`
  - `fallbackCount=0`
  - `resumeFirstGapMs=71`
- canvas worker
  - inline: pass
  - external: pass
  - confirmed `GET /canvas-worker.js [200]`

Issues not reproduced in this round:

- corrupted encoded payloads
- `createImageBitmap` decode errors
- external canvas worker not taking effect

### Known note

- The dashboard `auto command` benchmark is now aggregated by batch and no longer shows the earlier `completedSnapshots=200` / `avgSelectedCanvasCount=1` behavior.
- The current observed result is closer to the real draw cadence:
  - `drawCount=39`
  - `completedSnapshots=41`
  - `avgSelectedCanvasCount=4.9`
- This is still a demo benchmark metric, not a guarantee that each dashboard render maps to exactly one automatic recording result.
- The dashboard `auto continuous` benchmark still counts selected canvas snapshots, so it currently shows:
  - `drawCount=37`
  - `completedSnapshots=200`
  - `avgSelectedCanvasCount=11`
- That matches the current continuous snapshot metric model and is not treated as a recording failure.

## Stage-Pass Criteria

At this stage, the minimum pass criteria should be:

- first-frame capture is stable
- snapshot, command, and fallback paths all work
- both inline and external worker modes work
- no corrupted payloads or decode errors remain
- current fallback boundaries behave consistently and are explainable
