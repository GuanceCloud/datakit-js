# Browser SDK Architecture

## Overview

This repository is a browser observability SDK monorepo built with `npm` workspaces and `lerna`.

It provides four main packages:

- `@cloudcare/browser-core`
- `@cloudcare/browser-rum`
- `@cloudcare/browser-logs`
- `@cloudcare/browser-worker`

The system is designed to collect browser-side telemetry, normalize it into SDK event models, and send it through either HTTP batch transport or a WebView event bridge.

## Main Responsibilities

### `packages/core`

Shared foundation used by every other package.

Key responsibilities:

- browser utilities and compatibility wrappers
- session lifecycle and persistence
- observables and lifecycle primitives
- transport, batching, retry, flush control
- telemetry and monitor helpers
- error/raw stack processing
- serialization, sanitization, context management
- event bridge integration

This package is the dependency base of the whole repo.

### `packages/rum`

Real User Monitoring SDK.

Key responsibilities:

- public RUM API
- initialization and pre-start buffering
- view/action/resource/error collection
- performance timing collection
- long task and web-vitals-style metrics
- tracing header generation
- session replay integration
- final RUM event assembly and delivery

Typical event domains include:

- view
- action
- resource
- error
- long task
- performance
- replay

### `packages/logs`

Browser logs SDK.

Key responsibilities:

- public logs API and logger creation
- global/user/common context handling
- console log collection
- reporting API collection
- runtime error collection
- network error collection
- final log assembly and delivery

This package is lighter than RUM, but shares the same architectural pattern:

1. init
2. build configuration/session/context
3. subscribe to browser sources
4. transform raw input into normalized events
5. send via batch or bridge

### `packages/worker`

Compression worker used by the browser SDK stack.

Key responsibilities:

- receive worker messages
- maintain per-stream deflate state
- compress incremental chunks
- return compressed buffers and stream trailer metadata

This package exists to move compression work off the main thread.

## Architectural Layers

Across RUM and Logs, the codebase follows a consistent layering model.

### 1. Boot Layer

Usually under `packages/*/src/boot`.

Responsibilities:

- public API creation
- init/pre-init buffering
- build-time env injection
- startup orchestration
- deciding transport mode

Examples:

- [packages/rum/src/boot](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/boot)
- [packages/logs/src/boot](/Users/dengchangliang/www/rum/browser-sdk/packages/logs/src/boot)

### 2. Collection Layer

Usually under `packages/*/src/domain/*Collection`.

Responsibilities:

- subscribe to raw browser inputs
- convert browser callbacks into SDK raw events
- isolate browser-specific collection logic

Examples:

- console
- report observer
- runtime error
- network/XHR/fetch
- RUM action/view/resource/error collectors

### 3. Context Layer

Usually under `packages/*/src/domain/contexts`.

Responsibilities:

- maintain user/global/view/display/internal context
- attach stable contextual metadata to outgoing events
- provide lookup APIs by time or lifecycle state

### 4. Assembly Layer

Usually `domain/assembly.js`.

Responsibilities:

- merge raw event payload with:
  - SDK metadata
  - session info
  - common context
  - RUM internal context
  - user/view/action context
- apply `beforeSend`
- apply event rate limiting
- emit final server event shape

This is the normalization boundary between raw browser input and transport-ready event payload.

### 5. Transport Layer

Usually under `packages/*/src/transport`.

Responsibilities:

- batch creation
- flush policies
- page-exit flush
- retry behavior
- event bridge delivery

Two main delivery paths exist:

- HTTP batch transport
- WebView bridge transport

## Runtime Flow

### Logs Flow

1. Public API is created in `boot/logsPublicApi.js`
2. Pre-start strategy buffers calls until init succeeds
3. `startLogs()` wires session, telemetry, collectors, assembly, and transport
4. Collection modules emit `RAW_LOG_COLLECTED`
5. `domain/assembly.js` expands raw logs into final log events
6. Transport sends the event via batch or bridge

### RUM Flow

1. Public API is created in the RUM boot layer
2. Pre-start calls are buffered
3. `startRum()` and related startup modules create collectors and contexts
4. Domain collectors emit raw RUM events
5. `domain/assembly.js` merges raw events with session/view/action/url/display/common context
6. Transport sends final RUM payloads

### Worker Flow

1. Worker starts from `packages/worker/src/index.js`
2. `startWorker()` installs a `message` listener
3. Messages such as `init`, `write`, and `reset` are handled per stream
4. Deflate output and trailer are posted back to the main thread

## Key Cross-Cutting Concepts

### Session Management

Session logic lives in `core` and is reused by RUM and Logs.

It handles:

- tracked vs not-tracked session state
- cookie/localStorage persistence
- renew/expire lifecycle
- sampling decisions

### Observables And Lifecycle

The repo uses custom observable and lifecycle abstractions heavily.

They are the internal event bus that connects:

- browser signal collection
- raw event creation
- assembly
- transport

### Event Bridge

The SDK supports a bridge transport for embedded/webview environments.

When the bridge is available:

- some startup behavior changes
- transport may bypass regular HTTP batching
- replay/log/RUM events can be sent directly through the bridge

### Worker Compression

Replay and other payload-heavy flows rely on the worker package for deflate compression.

This keeps compression incremental and off the main thread.

## Build Architecture

The repository treats `packages/*/src` as the source of truth.

Generated outputs are:

- `cjs`
- `esm`
- `bundle`

Build notes:

- top-level build runs through `lerna`
- `rum` and `logs` emit browser bundles
- `worker` emits only its worker bundle
- build-time constants such as SDK version are injected by scripts
- worker output is inlined into consumers through build-time replacement

## Testing Architecture

Unit tests run through Karma + Jasmine in `ChromeHeadlessNoSandbox`.

Current test strategy in practice is a mix of:

- pure logic unit tests
- light browser integration tests
- fake browser primitives
- bridge and worker smoke tests

Areas that tend to be more expensive in test runtime:

- Karma webpack bundling
- browser-observer-based collection
- large source files such as worker deflate logic

## Practical Reading Order

If you need to understand the repo quickly, start here:

1. [AGENTS.md](/Users/dengchangliang/www/rum/browser-sdk/AGENTS.md)
2. [packages/core/src/index.js](/Users/dengchangliang/www/rum/browser-sdk/packages/core/src/index.js)
3. [packages/rum/src/boot](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/boot)
4. [packages/logs/src/boot](/Users/dengchangliang/www/rum/browser-sdk/packages/logs/src/boot)
5. [packages/rum/src/domain/assembly.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/assembly.js)
6. [packages/logs/src/domain/assembly.js](/Users/dengchangliang/www/rum/browser-sdk/packages/logs/src/domain/assembly.js)
7. [packages/worker/src/boot/startWorker.js](/Users/dengchangliang/www/rum/browser-sdk/packages/worker/src/boot/startWorker.js)

## Summary

This project is not an application. It is an SDK platform for browser observability.

Its architecture centers on:

- shared core primitives
- package-specific bootstrapping
- browser signal collection
- context enrichment
- event assembly
- transport and worker-assisted delivery
