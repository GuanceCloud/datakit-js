# Session Replay Canvas Design

## Summary

The protocol direction remains unchanged:

- continue to stay compatible with rrweb-style `CanvasMutation`
- keep using the existing replay pipeline
- do not introduce a separate `frameId -> fetch image -> drawImage` side protocol

The product model is now explicitly split into two formal modes:

- `replayCanvasSampling: number`
- `replayCanvasSampling: 'all'`

Runtime mapping:

- `number -> snapshot`
- `'all' -> command capture`

## Hard Constraints

- canvas replay must never break existing replay collection, segmentation, compression, upload, or playback behavior
- `replayCanvasEnabled` must stay `false` by default
- when canvas replay is disabled, replay behavior must remain unchanged
- any canvas-specific failure must stay isolated to canvas capture
- no canvas exception may break the recorder main path
- users who do not enable canvas replay must not pay meaningful extra CPU, memory, or network cost

## Current Implementation State

The current implementation already supports:

- `manual` mode
- `auto` mode
- `replayCanvasSampling: number | 'all'`
- `number -> continuous snapshot`
- `'all' -> 2D command capture`
- rrweb-compatible `CanvasMutation`
- failure isolation
- payload limits
- full snapshot reset
- keepalive
- debug APIs

This means the repository is no longer operating on a single auto-snapshot path. It already has:

- a default snapshot path
- a higher-fidelity command path

## Canvas Worker Status

Canvas encoding is now backed by an actual worker subsystem rather than an inline string-only helper.

The canvas worker:

- lives under `packages/worker`
- has its own bundle output: `canvas-worker`
- supports self-hosted deployment through `replayCanvasWorkerUrl`
- does not replace or affect the existing deflate worker
- keeps `workerUrl` semantics unchanged for the old worker

This matters because some deployments cannot rely on inline blob workers due to CSP, browser extensions, enterprise security products, or network middleboxes.

## Relationship To Sentry

The design target is aligned with the same two formal semantics seen around rrweb and Sentry:

- default snapshot-based recording
- higher-fidelity command capture

But the implementation does not try to copy Sentry mechanically. The goal is:

- remain protocol-compatible where it matters
- preserve existing Guance replay architecture
- keep performance costs controlled

## Current Product Boundary

The current system already records 2D canvas, but complex cases still fall back to snapshot-based recording. Important examples include:

- `Path2D`
- `CanvasGradient`
- `CanvasPattern`
- some `drawImage(...)` sources

This fallback behavior is an explicit boundary, not an accidental gap.

## Practical Direction

The design direction is now clear:

- `number` stays as the default supported path
- `'all'` stays as the supported higher-fidelity path
- difficult fidelity cases may still use snapshot fallback
- internal worker infrastructure continues to move toward the same engineering standard as the existing deflate worker
