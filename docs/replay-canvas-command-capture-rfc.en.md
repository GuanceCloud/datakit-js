# Replay Canvas Command Capture RFC

## Goal

This RFC defines how the canvas replay implementation moves toward rrweb-compatible 2D command capture as a formal supported mode.

Assumptions already fixed:

- the public sampling model is aligned with rrweb / Sentry style semantics
- `sampling: number` is the default mode
- `sampling: number` uses snapshot capture
- `sampling: 'all'` uses command capture

The target is:

- fidelity that is not weaker than Sentry in practical 2D canvas scenarios
- better control over bytes, flush pressure, and main-thread cost

## Product Model

### Mode Mapping

- `sampling: number`
  - default mode
  - snapshot sampling
- `sampling: 'all'`
  - higher-fidelity mode
  - 2D command capture

### Snapshot Fallback

Snapshot remains valid in two roles:

- the main path for `sampling:number`
- a fallback path for harder cases under `sampling:'all'`

Typical fallback cases include:

- `Path2D`
- `CanvasGradient`
- `CanvasPattern`
- difficult `drawImage(...)` sources
- recorder-side failures

## Current Implementation Snapshot

The current codebase already has a working command path with:

- 2D method capture
- property setter capture
- per-context pending queues
- rAF flushing
- rrweb-compatible `CanvasMutation` shape
- integration into the recorder path
- demo wiring
- debug and benchmark support

## Constraints

- never break live canvas rendering
- only track the contexts that should actually be recorded
- do not let canvas failures spill into the main replay recorder
- keep snapshot fallback explicit and observable

## Current Boundaries

The main command path is working, but some fidelity-heavy cases intentionally fall back today.

`Path2D` is already treated as a formal fallback boundary rather than a temporary bug. The same applies to a number of other opaque or hard-to-reconstruct objects.

## Near-Term Direction

The near-term direction is not “force every canvas API into command capture”. It is:

- keep `number` stable as the default user path
- keep `'all'` available as the high-fidelity path
- tighten command-path correctness
- make fallback boundaries explicit
- improve deployment quality through the dedicated canvas worker
