# Session Replay Canvas Continuous Snapshot Prototype

## Purpose

This document captures the original prototype plan for a first version of `continuous_snapshot`.

Its purpose was narrow:

- improve continuity for changing canvas content
- keep the existing rrweb-compatible `CanvasMutation` protocol
- avoid moving to full command capture immediately

## Prototype Shape

The prototype assumed:

- a new internal scheduler
- a render-driven or rAF-driven capture loop
- no protocol rewrite
- reuse of the existing encoder and recorder path

## Historical Role

This is not the final design document and not the final public model.

It remains useful as implementation history because it explains:

- why continuous scheduling was split from encoding
- why the first version focused on scheduler changes
- why command capture was treated as a later step

## Current Relevance

The repository now exposes a clearer public model based on:

- `replayCanvasSampling: number`
- `replayCanvasSampling: 'all'`

So this prototype document should be treated as background material rather than the current product guide.
