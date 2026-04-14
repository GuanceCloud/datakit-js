# Session Replay Canvas Continuous Capture RFC

## Status

Historical RFC for the continuous snapshot path.

## Summary

This RFC describes the transition from the original timer-driven auto capture model to a more continuous snapshot scheduler.

The core idea was:

- keep the existing snapshot-based protocol
- improve continuity by changing scheduling behavior
- avoid jumping directly to full command capture in the first stage

## What It Proposed

- move away from low-frequency timer-only sampling
- introduce a render-driven or change-driven scheduler
- keep rrweb-compatible `CanvasMutation`
- retain the existing encoding and event pipeline

## What Changed Later

The repository has since moved beyond the old “legacy auto vs continuous snapshot” framing and now exposes a clearer public model:

- `replayCanvasSampling: number`
- `replayCanvasSampling: 'all'`

So this RFC is still useful as background, but it is no longer the primary public-facing design reference.

## Historical Value

This document still matters because it records:

- why timer-only sampling was insufficient
- why scheduler changes were treated as separate from protocol changes
- why snapshot remained an intentional default path even after higher-fidelity capture work started
