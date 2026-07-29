# Session Replay Performance Review

## Scope

This review describes the current recorder implementation in this worktree:

- DOM full snapshots and mutation collection
- replay segment encoding, recovery, and delivery
- 2D canvas command and snapshot capture
- WebGL/WebGL2 snapshot capture

It documents the limits enforced by the implementation. Test counts, bundle
sizes, and browser trace measurements are intentionally not frozen here; they
must come from the final verification run for the exact revision being
released.

## Current performance safeguards

### DOM snapshots are bounded and fail closed

The initial full snapshot is allowed one synchronous serialization attempt with
a 32 ms deadline. If it cannot complete within that budget, recording stops
instead of emitting a partial baseline and accepting dependent incrementals.

Subsequent full snapshots are incremental serializer tasks:

- each task runs in 4 ms slices
- total active serialization time is limited to 1 second; time spent waiting
  between slices does not consume that budget
- serialization stops at 50,000 nodes or approximately 1 MiB; this separately
  bounds the final synchronous JSON serialization before worker encoding
- tree depth is capped at 1,000 levels
- one serialized source node is capped at 1,000 attributes and 200,000 source
  characters; text nodes and form values use the same source-character bound
- stylesheet extraction is capped at 5,000 rules, 256 Ki characters, and a
  4 ms active budget; an over-budget linked sheet falls back to its original
  URL, while an inline style keeps its bounded source text when possible
- a DOM mutation generation change invalidates the in-progress snapshot and
  restarts it, with a maximum of three restarts
- records observed while a replacement baseline is being built are bounded and
  are released only after the full snapshot succeeds

This avoids a single unbounded document walk and prevents a mixed-time DOM
baseline from being emitted.

### Mutation serialization and emission have separate watermarks

Native observer batches are admitted only while they remain at or below 256
records, 1,000 referenced nodes, and approximately 256 KiB. Their synchronous
normalization and document-order sort share a 4 ms deadline, checked every 32
normalization operations or sort comparisons and again at each phase boundary.
Crossing it cancels the complete unpublished serializer generation, including
its publication tokens, before reporting overflow and requesting a mandatory
replacement baseline. No normalized prefix from the failed batch is emitted.
Ancestor validation and privacy inheritance are iterative and fail closed
after 1,000 levels instead of recursing or walking indefinitely.

`MutationRecord.oldValue` accounting cannot see the current DOM value. Current
text and attribute sources therefore have a separate O(1) admission check:
one value is limited to 200,000 characters and all current values normalized
in one batch are limited to 512 Ki characters. The check runs before masking,
attribute serialization, or payload measurement. Safe entries completed
before the watermark are emitted, then the staged generation is discarded and
a replacement baseline is requested.

Added subtrees are serialized as resumable tasks. Mutation records also have
two approximately 200 KB boundaries:

- an individual add, remove, text, or attribute entry cannot exceed the limit
- a materialized mutation event cannot exceed the limit

Safe entries are split into bounded events. An indivisible oversized entry is
dropped before it can enter debug history or segment serialization, and the
recorder requests a replacement full snapshot. This applies to large text and
attribute changes as well as added DOM subtrees.

Pending subtree serializers have a separate global backlog limit of 256 roots
and approximately 4 MiB. A root may be refreshed at most 16 times while it is
changing. Removed-subtree cleanup visits no more than 5,000 nodes in a 4 ms
slice, including open shadow trees. Crossing any of these limits atomically
discards the staged generation and requests a fresh baseline instead of
emitting across a sequence gap.

The Large DOM demo keeps its 2,500-row stress case incremental-only and appends
four rows per observer callback. Its separate 50-row case is the Full Snapshot
baseline check. Combining the 142,500-element stress tree with the snapshot
button would intentionally cross the 50,000-node/1 MiB fail-closed boundary and
is therefore blocked by the demo instead of reporting a false success.

Serialized subtree membership is published with one O(1) token rather than a
second walk over every source node. Tokens distinguish queued, published, and
canceled subtrees. Interaction, input, media, stylesheet, scroll, and canvas
events are admitted only for the currently published tree; remove
normalization may additionally refer to a queued add so an add/remove pair in
one native batch remains valid. Canceling or refreshing an add invalidates its
token and falls back to the last published ancestor. Abandoning an incomplete
replacement baseline restores the previous publication maps, so stale ids
from the failed attempt cannot escape and the still-playable tree remains
observable.

Shadow-root observers use generation invalidation and an O(1) active-map swap
on reset or stop. Retired observers are released asynchronously in batches of
at most 32 or 4 ms. At most 64 ShadowRoots per generation are serialized with
their content and observed. Additional roots are represented by empty
ShadowRoot document-fragment placeholders without adopted styles or child
content, so a component-heavy page degrades locally instead of stopping the
whole replay. Synchronous flush therefore visits at most the same 64 observed
roots and has a 4 ms budget. Its callbacks are buffered until every root
succeeds, so a partial flush is never published. A new full snapshot retires
the old generation before serialization, and the observed roots discovered by
that snapshot remain active after the baseline is emitted.

Open ShadowRoots attached after recording starts are instrumented at
`attachShadow()` and publish their empty root boundary before control returns
to application code. Synchronously appended children therefore cannot overtake
the root in the replay stream. A root created inside an unpublished host is
instead serialized with that host's outer add. Closed roots are not inspected,
and dynamic roots share the same 64-controller capacity and empty-placeholder
degradation as roots discovered during a full snapshot.

At most 512 retired ShadowRoot controllers may wait in the sliced cleanup
queue. Once that queue is full, the newly retired generation is disconnected
synchronously instead of extending the backlog. Deactivation immediately
releases queued native mutation records and serializer tasks even when the
physical listener cleanup remains scheduled.

Recorder startup is transactional. Each serialized-canvas tracker,
ShadowRoot controller, canvas observer/scheduler, and DOM observer registers
its cleanup immediately after construction. If a later initializer fails,
registered resources are stopped in reverse order, recording reports the
startup failure, and callers receive an inactive recorder rather than a
partially running pipeline. DOM observer construction applies the same rollback
rule internally.

Mutation payload sizing uses bounded estimation rather than eagerly calling
`JSON.stringify` on the whole payload. Debug history keeps bounded summaries
and small samples rather than retaining complete mutation payload references.

Radio input tracking keeps only the last observed checked element per
root/form/name group. It does not run a document-wide selector for every
change, and each group map is capped at 256 entries with weak references where
available.

### Canvas discovery and capture work is budgeted

Serialized canvas nodes are tracked in a registry of at most 2,048 entries
while canvas recording is active. Entries hold `WeakRef` values where the
browser supports them; the compatibility fallback is still hard-capped.
Continuous snapshot mode inspects at most 64 registry entries per run and
advances a rolling cursor, so disconnected-node cleanup and eligibility checks
do not become a full-registry scan on every animation frame. Stopping the last
tracker clears the registry and its cursor state.

After each successful full snapshot, automatic mode takes a strictly serial
bitmap baseline for at most 64 serialized canvases. This bounded pass is
independent from the continuous/command round-robin cursor and does not probe
or create application canvas contexts. It covers static canvases that were
drawn before Replay started without adding a periodic document-wide sweep.

The continuous scheduler additionally limits snapshots and concurrent encodes,
honors the configured interval, and applies success, unchanged, and failure
backoff. WebGL canvases are excluded from this generic 2D scan.

Auto mode also applies explicit bounded defaults when callers provide a numeric
quality but no named quality preset: a 1 second interval and cooldown, 3 and 5
second unchanged/failure backoffs, and at most two snapshots per run. These
defaults are resolved before the scheduler starts, so an omitted preset cannot
silently collapse cooldown or backoff to zero.

Contexts rejected by the configured canvas-recording predicate are remembered
in a `WeakSet` for the lifetime of the recorder. Draw calls and property writes
on an excluded context therefore do not re-run application policy code on
every operation. Snapshot-fallback cooldowns retain canvases weakly where
supported, are capped at 64 live timers, and cannot remain scheduled for more
than 60 seconds. Browsers without usable weak references fall back to bounded
strong references. Timer, concurrency, and per-drain limits keep a dirty tail
frame queued until capacity is released instead of requiring another draw.

### 2D command capture cannot build an unbounded frame

A 2D command batch is capped at:

- 1,000 commands
- approximately 128 KiB of serialized command data

Argument estimation is performed before retaining the serialized command.
When either boundary would be exceeded, the context switches to the bounded
snapshot fallback instead of emitting an oversized command mutation.

Across all canvases, pending command capture is additionally capped at 64
contexts and approximately 512 KiB. Object references use per-recorder weak
registries with O(1) lookup. Canvas arguments, which previously required a
synchronous `toDataURL`, are rejected before serialization and use the
snapshot fallback. Initial static snapshots are discovered in batches of 64
until the registry has been scanned, rather than retaining or processing every
canvas at once.

### WebGL uses draw-driven snapshots with a bounded fallback

WebGL/WebGL2 capture is scheduled from actual draw calls and drained at the
render-task or `requestAnimationFrame` boundary. This is important for the
default `preserveDrawingBuffer: false` behavior: a later timer may see a cleared
default framebuffer.

Draws that occur during cooldown or while an encode slot is busy only mark the
canvas dirty. A timer or an asynchronous encode completion never starts a
WebGL capture; the next eligible real draw must enqueue it. This keeps
subsequent cadence samples on a valid rendering boundary instead of reading a
stale default framebuffer.

At the draw boundary, the normal path copies the WebGL canvas into an
SDK-internal 2D staging canvas with `drawImage`. It does not synchronously read
pixels from the GPU. `readPixels` is used only if that copy fails, and that
fallback:

- rejects source buffers larger than 3840 x 2160 pixels
- rejects a readback before allocation when its combined source pixels,
  downsampled target pixels, and x-offset table exceed the 16 MiB per-capture
  hard peak
- restores framebuffer, pixel-pack buffer, and pixel-store state after reading
- vertically flips and downsamples into reusable arrays
- separately keeps no more than 16 MiB of readback arrays in the staging-canvas
  cache; allocations within the per-capture hard peak that would exceed the
  remaining cache budget are used for that capture but are not retained

Encoding is delegated to the canvas worker when available. The main-thread
fallback uses asynchronous `toBlob` plus `FileReader`; synchronous `toDataURL`
is retained only for environments without those APIs.

The encoded-byte limit is checked from `Blob.size` before the worker creates an
`ArrayBuffer` or base64 string and before the main thread creates a
`FileReader`. Resetting a replay generation rejects queued work, terminates
pending worker work, and ignores late main-thread completions. Native
`createImageBitmap` and `toBlob` work cannot be cancelled: canceled callers are
rejected immediately, but those jobs keep their physical concurrency slot and
WebGL staging admission until the native promise actually settles. Repeated
resets therefore cannot bypass the configured concurrency or staging limits.
Native encodes also pass through a module-level admission queue shared by
successive recorder instances. At most four native operations run at once and
at most 64 wait, so stop/start cycles cannot accumulate otherwise
uncancellable browser work outside a retired recorder's local counters.

The object URL for the inline canvas worker is revoked immediately after worker
initialization, and is also revoked if construction fails. External worker URLs
remain owned by their callers.

Snapshot mutations keep the source canvas backing dimensions as the replay
destination. A downsampled encoded image is therefore scaled across the whole
replay canvas rather than covering only its upper-left area.

### Deflate backlog and stalled workers are bounded

The deflate encoder uses a head-indexed pending-action queue. Normal dequeue is
O(1), consumed payload references are cleared immediately, and occasional
compaction is amortized rather than using `Array.shift` for every worker
response.

A 30-second activity watchdog is active while writes are pending. Each valid
worker response refreshes it. A timeout, worker error, or `postMessage` failure
releases queued data and callbacks, clears accounting, and transitions the
stream to an explicit error state instead of leaving the replay pipeline
permanently blocked.

During `UNLOADING`, pending segment boundaries are completed synchronously
before the lifecycle handler returns. Already-compressed zlib prefixes retain
their worker-provided Adler32 state; the bounded pending tail is appended as
valid final DEFLATE stored blocks. Length is checked without allocation before
encoding. Across all pending segment groups, UTF-8 scanning, output allocation,
and exit payloads share the 60,000-byte segment budget, so this reliability path
cannot synchronously process the normal 4 MiB worker-backlog allowance. Work
that cannot fit the exit budget fails closed instead of blocking unload or
emitting an incomplete compressed stream.

The object URL for the inline deflate worker is revoked as soon as worker
initialization succeeds, and is also revoked on construction or initialization
failure.

Replay segment collection separately caps pending raw data at 4 MiB. Full
snapshots are subject to the same admission control as incrementals. Baseline
generations are confirmed only after encoding succeeds. Dependent segments do
not overtake an unconfirmed baseline; results remain associated with that
generation and are released or discarded
as a unit. Repeated full-snapshot failures stop recording instead of producing
an indefinitely unplayable stream. A known large full snapshot is admitted
against the current segment and encoder backlog before JSON serialization.
When any record fills a segment after serialization, its serialized form is
reused in the fresh segment rather than stringified a second time.

Mutation-record admission is bounded to 256 payloads and 8 MiB. When encoder
backpressure reaches that limit, complete unpublished additions and paired
replacements can be dropped locally without exposing a remove-only state.
Mutation-observer overflow metadata is not treated as a mandatory-recovery
boolean. A discardable recovery snapshot that cannot stabilize on a changing
page restores the previous published replay tree and resumes recording instead
of stopping the recorder.

### Hidden-page recovery and cleanup reconcile asynchronous state

Canvas schedulers pause or reset pending work when the page becomes hidden and
resume from a clean generation when it becomes visible. Late promises from an
old generation cannot publish stale snapshots. Command-capture fallback queues
are also resumed on visibility recovery rather than relying on throttled hidden
timers.

On stop or baseline reset, timers, animation frames, pending queues, cached
buffers, canvas registries, worker listeners, and patched browser methods are
released. Recorder cleanup continues through all cleanup tasks even if one
throws, and WebGL method patches are restored in reverse installation order.
Mutation batches atomically release their queued DOM references before
processing, so a throwing DOM getter or user privacy predicate cannot leave a
batch permanently retained and unscheduled.
An overflow found by the final stop-time mutation drain cannot start a
replacement full snapshot that teardown would immediately discard. If the
recorder stops itself after a baseline or encoder failure, the public recorder
state is notified immediately and does not retain the stopped recorder object
graph until a later API call.

Segment delivery also reconciles lifecycle state:

- page-exit intent upgrades eligible in-flight transports to `sendOnExit`
- `UNLOADING` latches exit transport for encoded dependent segments that are
  still waiting for their baseline generation
- current, in-flight, and retained segment results share one 60,000-byte exit
  delivery budget; the baseline and ordered dependent prefix are kept, and
  once one segment cannot fit, that segment and every later segment are
  dropped rather than creating a replay sequence gap or overflowing the
  browser's beacon queue
- a hidden-page beacon decision is cleared if a locked segment is later sent
  through the regular transport
- stopped or superseded generations cannot publish stale segment results
- footer and encoder failures are propagated instead of sending an empty or
  corrupt segment

### Release artifacts have explicit size gates

The production RUM bundle is checked against raw and deterministic
`gzip -9 -n` ceilings as part of the package build. Production bundle maps omit
embedded `sourcesContent`. CJS and ESM maps are stripped after compilation
while the published source tree remains available, avoiding two additional
copies of every source file without removing source-level debugging.

## Why WebGL replay is snapshot-based

Full command replay would patch WebGL prototypes and serialize shader sources,
typed arrays, buffers, textures, state changes, and object references. That
would add a JavaScript interception point to every GL call, duplicate resource
uploads into replay payloads, and still fail to reconstruct contexts that were
initialized before recording began.

The draw-driven snapshot path supports pre-existing contexts, does not change
`preserveDrawingBuffer`, and has bounded capture and payload costs. Command-level
WebGL replay should remain a separate opt-in design with its own compatibility
and resource budgets.

## Remaining risks

- Replay is still bundled eagerly into the main RUM browser bundle. The
  WebGL capture and backpressure safeguards therefore add download, parse, and
  compile cost even for sessions that are not sampled for replay. Applications
  that do not use Session Replay can use `@cloudcare/browser-rum-slim` to avoid
  that cost. For the full package, the production build enforces raw and gzip
  bundle-size limits. Moving the recorder and its canvas encoders behind a
  separately cached lazy chunk is the architectural follow-up; the automated
  size gate should remain in place until that split exists.
- Serialization can yield only between nodes. Source sizes, attribute counts,
  and CSS rules are bounded, but a browser-provided DOM/CSSOM getter or layout
  operation that itself blocks cannot be preempted.
- The initial baseline deliberately has a single 32 ms synchronous window. On
  documents that cannot finish inside it, replay is unavailable for that
  session rather than degrading page responsiveness or emitting a partial
  baseline.
- WebGL `drawImage` may still force browser-internal GPU synchronization even
  though it avoids an explicit JavaScript `readPixels`. If the copy fails, the
  bounded `readPixels` fallback is explicitly synchronous and can still cause a
  long task at the allowed maximum size.
- If `toBlob` or `FileReader` is unavailable, the final legacy main-thread
  fallback is synchronous `toDataURL`.
- Known WebGL extension draw entry points are intercepted when the extension
  is queried after Replay starts. An extension object cached before Replay
  starts cannot be discovered safely through standard browser APIs, so later
  extension-only draws on that object remain best-effort. Start Replay before
  creating the WebGL context or querying extensions for complete draw-driven
  capture.
- Rendering outside `requestAnimationFrame` has a weaker task-boundary signal.
  With `preserveDrawingBuffer: false`, applications with unusual scheduling may
  need an explicit capture point.
- A final draw that occurs during cooldown or while an encode is in flight is
  intentionally not captured unless the canvas draws again. Capturing that
  static tail later would read an undefined default framebuffer.
- Multiple independent `requestAnimationFrame` callbacks can draw the same
  canvas during one browser frame. A capture at the first completed callback
  may precede later callbacks in that frame.
- `OffscreenCanvas` has no replay DOM node id and is not captured by the current
  recorder.
- A hard process termination can still happen without any lifecycle event.
  During a normal `UNLOADING` event, the bounded synchronous deflate completion
  preserves only work that fits the shared 60,000-byte exit budget. A larger
  unencoded tail is deliberately dropped rather than causing an unload long
  task or exceeding the browser beacon queue.

## Verification requirements

For the release revision, verification should include:

- targeted unit coverage for DOM snapshot budgets, oversized text/attribute
  mutations, command-batch overflow, WebGL copy/readback paths, visibility
  recovery, deflate timeout, and baseline-generation reconciliation
- the complete unit suite and production package/bundle builds
- a browser trace comparing canvas recording disabled and enabled in a
  representative WebGL application, including main-thread long tasks, capture
  cadence, segment bytes, request count, and memory retention
- playback validation for both normal and stress scenes, including a
  high-device-pixel-ratio canvas to confirm that each frame fills the complete
  replay backing surface

Record the resulting test counts and trace measurements in the release or pull
request evidence for the exact commit. Do not reuse earlier local smoke-test
numbers as final performance evidence.
