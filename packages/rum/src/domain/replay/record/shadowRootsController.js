import {
  getParentNode,
  instrumentMethod,
  isNodeShadowRoot,
  noop,
  setTimeout
} from '@cloudcare/browser-core'
import {
  getMutationPayloadApproxBytes,
  startMutationObserver
} from './mutationObserver'
import { initInputObserver } from './observers'
import { MUTATION_RESOURCE_FLUSH } from './mutationResourceBudget'

export var SHADOW_ROOT_CLEANUP_BATCH_SIZE = 32
export var SHADOW_ROOT_CLEANUP_BUDGET_MS = 4
export var SHADOW_ROOT_FLUSH_MAX_COUNT = 64
export var SHADOW_ROOT_FLUSH_BUDGET_MS = 4
// Kept as an internal compatibility export for existing diagnostics/tests.
// It is now the per-turn activation/flush slice, not a total observer cap.
export var SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT =
  SHADOW_ROOT_FLUSH_MAX_COUNT
// Kept as an internal compatibility export for diagnostics. Retired
// generations are now invalidated in O(1) and disconnected in bounded slices;
// this value no longer triggers synchronous cleanup.
export var SHADOW_ROOT_RETIRED_CONTROLLER_LIMIT = 512
export var SHADOW_ROOT_SKIPPED_ANCESTOR_MAX_DEPTH = 1000

var attachShadowSubscribers = []
var attachShadowInstrumentation

export var initShadowRootsController = function (configuration, data) {
  var mutationCb = data.mutationCb
  var mutationOverflowCb = data.mutationOverflowCb
  var mutationActivityCb = data.mutationActivityCb
  var inputCb = data.inputCb
  var isNodeIgnored = data.isNodeIgnored
  var isInputNodeIgnored = data.isInputNodeIgnored || isNodeIgnored
  var isMutationNodeIgnored =
    isNodeIgnored &&
    function (node) {
      return isNodeIgnored(node, true)
    }
  var isNodePublished = data.isNodePublished
  var mutationNodeSerializationCb = data.mutationNodeSerializationCb
  var mutationResourceBudget = data.mutationResourceBudget
  var startMutationObserverImpl = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? data.startMutationObserver || startMutationObserver
    : startMutationObserver
  var initInputObserverImpl = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? data.initInputObserver || initInputObserver
    : initInputObserver
  var scheduleCleanupImpl = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? data.scheduleCleanup || defaultScheduleCleanup
    : defaultScheduleCleanup
  var getCurrentTimeImpl = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? data.getCurrentTime || getCurrentTime
    : getCurrentTime
  var cleanupErrorCb = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? data.cleanupErrorCb
    : undefined
  var stopAttachShadowObserver = data.shadowRootCreatedCb
    ? subscribeToOpenShadowRoots(function (shadowRoot, host) {
        if (stopped) {
          return
        }
        try {
          data.shadowRootCreatedCb(shadowRoot, host)
        } catch (error) {
          if (mutationOverflowCb) {
            mutationOverflowCb({
              reason: 'dynamic_shadow_root_capture_error',
              error: String(error)
            })
          }
        }
      })
    : noop

  var nextGenerationId = 0
  var activeGeneration = createGeneration()
  var controllerByShadowRoot = new Map()
  // Persist only the latest registration identity. This distinguishes a root
  // retired by a baseline reset from a never-registered nested root without
  // walking the retired generation during reset.
  var latestEntryByShadowRoot = new WeakMap()
  var cleanupQueueHead
  var cleanupQueueTail
  var cleanupScheduled = false
  var retiredControllerCount = 0
  var currentFlush
  var pendingFlushIterator
  var pendingFlushGeneration
  var pendingFlushEntry
  var disconnectedCleanupIterator
  var disconnectedCleanupGeneration
  var disconnectedCleanupScheduled = false
  var baselineResetIterator
  var baselineResetGeneration
  var stopped = false
  var recoveryShadowRoots
  var mutationDependencyState = {
    $rPublishedRoots: new WeakSet(),
    $rLocallyDroppedRoots: new WeakSet()
  }

  var shadowRootsController = {
    $rMutationDependencyState: mutationDependencyState,
    addShadowRoot: function (shadowRoot, provisionalOwner) {
      if (stopped) {
        return false
      }
      if (controllerByShadowRoot.has(shadowRoot)) {
        return true
      }
      var entry = {
        active: true,
        registered: false,
        shadowRoot: shadowRoot,
        generation: activeGeneration,
        mutationObserverDeactivated: false,
        pendingOverflowAfterReset: false,
        unpublishedMutationOverflowReported: false,
        provisionalOwner: provisionalOwner,
        deactivateMutationObserver: function () {},
        refreshAndFlushPendingRootForNode: function () {},
        resetMutationObserver: function () {},
        stopMutationObserver: function () {},
        stopInputObserver: function () {}
      }
      if (provisionalOwner) {
        if (!provisionalOwner.provisionalShadowRoots) {
          provisionalOwner.provisionalShadowRoots = []
        }
        provisionalOwner.provisionalShadowRoots.push(shadowRoot)
      }
      latestEntryByShadowRoot.set(shadowRoot, entry)
      var mutationObserverController
      try {
        mutationObserverController = startMutationObserverImpl(
          createGatedCallback(entry, 'mutation', mutationCb),
          configuration,
          createGatedShadowRootsController(entry),
          shadowRoot,
          data.mutationPerfCb,
          createGatedCallback(entry, 'overflow', mutationOverflowCb),
          createGatedCallback(entry, 'activity', mutationActivityCb),
          mutationNodeSerializationCb,
          isMutationNodeIgnored,
          isNodePublished,
          function () {
            return isEntryActive(entry)
          },
          mutationResourceBudget
        )
        entry.flush = mutationObserverController.flush || function () {}
        entry.deactivateMutationObserver =
          mutationObserverController.deactivate || function () {}
        entry.refreshAndFlushPendingRootForNode =
          mutationObserverController.refreshAndFlushPendingRootForNode ||
          function () {}
        entry.resetMutationObserver =
          mutationObserverController.reset || function () {}
        entry.stopMutationObserver =
          mutationObserverController.stop || function () {}

        // The change event does not bubble across a shadow root, so each active
        // generation needs its own listener.  The callback is generation-gated
        // before the controller becomes visible in the active map.
        var gatedInputCb = createGatedCallback(entry, 'input', inputCb)
        entry.stopInputObserver =
          (isInputNodeIgnored
            ? initInputObserverImpl(
                gatedInputCb,
                configuration,
                shadowRoot,
                isInputNodeIgnored
              )
            : initInputObserverImpl(
                gatedInputCb,
                configuration,
                shadowRoot
              )) || function () {}
        entry.registered = true
        controllerByShadowRoot.set(shadowRoot, entry)
        return true
      } catch (error) {
        entry.active = false
        stopControllerEntry(entry, false)
        throw error
      }
    },

    removeShadowRoot: function (shadowRoot) {
      var entry = controllerByShadowRoot.get(shadowRoot)
      if (!entry) {
        return
      }
      entry.active = false
      entry.registered = false
      controllerByShadowRoot.delete(shadowRoot)
      stopControllerEntry(entry, true)
    },

    cleanupDisconnectedShadowRoots: function () {
      if (stopped || controllerByShadowRoot.size === 0) {
        return
      }
      runDisconnectedShadowRootCleanupSlice()
    },

    refreshAndFlushPendingRootForNode: function (node) {
      if (stopped || !node) {
        return
      }
      var rootNode
      try {
        rootNode = node.getRootNode()
      } catch (_) {
        return
      }
      var entry = controllerByShadowRoot.get(rootNode)
      if (!entry || !entry.active || !entry.registered) {
        return
      }
      return entry.refreshAndFlushPendingRootForNode(node)
    },

    commitProvisionalShadowRoots: function (owner) {
      var shadowRoots = owner.provisionalShadowRoots || []
      for (
        var shadowRootIndex = 0;
        shadowRootIndex < shadowRoots.length;
        shadowRootIndex += 1
      ) {
        var shadowRoot = shadowRoots[shadowRootIndex]
        var entry = controllerByShadowRoot.get(shadowRoot)
        if (entry && entry.provisionalOwner === owner) {
          entry.provisionalOwner = undefined
          // Recovery can begin while a serialized host add is still pending.
          // If that add is admitted before the generation reset, its root now
          // belongs to the previous published tree and must participate in a
          // later rollback just like roots captured at $rBeginRecovery time.
          if (
            recoveryShadowRoots &&
            entry.active &&
            entry.registered &&
            recoveryShadowRoots.indexOf(shadowRoot) === -1
          ) {
            recoveryShadowRoots.push(shadowRoot)
          }
        }
      }
      owner.provisionalShadowRoots = undefined
    },

    rollbackProvisionalShadowRoots: function (owner) {
      var shadowRoots = owner.provisionalShadowRoots || []
      var retiredControllers = new Map()
      for (
        var shadowRootIndex = 0;
        shadowRootIndex < shadowRoots.length;
        shadowRootIndex += 1
      ) {
        var shadowRoot = shadowRoots[shadowRootIndex]
        var entry = controllerByShadowRoot.get(shadowRoot)
        if (!entry || entry.provisionalOwner !== owner) {
          continue
        }
        entry.provisionalOwner = undefined
        entry.active = false
        entry.registered = false
        controllerByShadowRoot.delete(shadowRoot)
        retiredControllers.set(shadowRoot, entry)
      }
      owner.provisionalShadowRoots = undefined
      retireControllerEntries(retiredControllers)
    },

    isNodeInSkippedShadowRoot: function (node) {
      if (stopped) {
        return true
      }
      var current = node
      var depth = 0
      while (current) {
        if (depth >= SHADOW_ROOT_SKIPPED_ANCESTOR_MAX_DEPTH) {
          return true
        }
        try {
          current = getParentNode(current)
        } catch (_) {
          return true
        }
        if (!current) {
          return false
        }
        if (isNodeShadowRoot(current)) {
          var entry = latestEntryByShadowRoot.get(current)
          if (entry && !isEntryActive(entry)) {
            return true
          }
        }
        depth += 1
      }
      return false
    },

    stop: function () {
      if (stopped) {
        return
      }
      try {
        stopAttachShadowObserver()
      } catch (error) {
        reportCleanupError(error)
      }
      stopped = true
      recoveryShadowRoots = undefined
      retireActiveGeneration()
    },

    flush: function () {
      if (stopped || controllerByShadowRoot.size === 0) {
        return true
      }

      var generation = activeGeneration
      var shadowRootCount = controllerByShadowRoot.size

      var flushState =
        currentFlush && currentFlush.generation === generation
          ? currentFlush
          : {
              events: [],
              eventApproxBytes: 0,
              eventCount: 0,
              eventBudgetReservation: undefined,
              generation: generation,
              overflow: undefined
            }
      currentFlush = flushState
      var deadline = getCurrentTimeImpl() + SHADOW_ROOT_FLUSH_BUDGET_MS
      if (
        !pendingFlushIterator ||
        pendingFlushGeneration !== generation
      ) {
        pendingFlushIterator = controllerByShadowRoot.values()
        pendingFlushGeneration = generation
      }
      var iterator = pendingFlushIterator
      var flushedShadowRootCount = 0
      var failure
      var iteratorCompleted = false

      while (
        flushedShadowRootCount < SHADOW_ROOT_FLUSH_MAX_COUNT
      ) {
        if (
          flushedShadowRootCount > 0 &&
          getCurrentTimeImpl() >= deadline
        ) {
          break
        }
        var entry = pendingFlushEntry
        if (!entry) {
          var nextEntry = iterator.next()
          if (nextEntry.done) {
            iteratorCompleted = true
            break
          }
          entry = nextEntry.value
        }
        if (!isEntryActive(entry)) {
          pendingFlushEntry = undefined
          continue
        }
        try {
          var flushSucceeded = entry.flush()
          flushedShadowRootCount += 1
          if (flushSucceeded === false || flushState.overflow) {
            failure = {
              reason: 'shadow_root_flush_overflow',
              cause:
                flushState.overflow && flushState.overflow.reason,
              shadowRootCount: shadowRootCount,
              flushedShadowRootCount: flushedShadowRootCount,
              $rSuppressMutationOverflow:
                flushState.overflow
                  ? flushState.overflow.$rSuppressMutationOverflow
                  : flushSucceeded === false &&
                    mutationResourceBudget &&
                    mutationResourceBudget.isFailed()
            }
            break
          }
          if (flushSucceeded === 'pending') {
            // A single root can itself own a paged raw-mutation transaction.
            // Keep the iterator pinned to that root until its final chunk is
            // committed; advancing here would let a boundary reset/stop drop
            // the unfinished transaction while reporting a successful flush.
            pendingFlushEntry = entry
            break
          }
          pendingFlushEntry = undefined
        } catch (error) {
          failure = {
            reason: 'shadow_root_flush_error',
            error: String(error),
            shadowRootCount: shadowRootCount,
            flushedShadowRootCount: flushedShadowRootCount
          }
          break
        }
      }

      if (failure) {
        clearPendingShadowRootFlush()
        return failFlush(generation, failure)
      }

      if (!iteratorCompleted) {
        // Keep every page buffered in one logical commit. The caller can
        // yield and invoke flush() again; native callbacks occurring between
        // pages join the same generation-gated transaction.
        return 'pending'
      }

      currentFlush = undefined

      var eventsToDispatch = coalesceMutationEvents(
        flushState.events.filter(function (event) {
          return isEntryActive(event.entry)
        })
      )
      try {
        for (
          var eventIndex = 0;
          eventIndex < eventsToDispatch.length;
          eventIndex += 1
        ) {
          var event = eventsToDispatch[eventIndex]
          var eventEntries = event.entries || [event.entry]
          if (
            !eventEntries.some(function (entry) {
              return isEntryActive(entry)
            })
          ) {
            continue
          }
          event.callback(event.value)
        }
      } finally {
        releaseShadowRootFlushBudget(flushState)
      }
      if (iteratorCompleted) {
        clearPendingShadowRootFlush()
      }
      return isGenerationActive(generation)
    },

    $rResetPendingMutationsForBaseline: function () {
      if (stopped || controllerByShadowRoot.size === 0) {
        clearPendingShadowRootBaselineReset()
        return true
      }
      var generation = activeGeneration
      if (
        !baselineResetIterator ||
        baselineResetGeneration !== generation
      ) {
        baselineResetIterator = controllerByShadowRoot.values()
        baselineResetGeneration = generation
      }
      var deadline =
        getCurrentTimeImpl() + SHADOW_ROOT_FLUSH_BUDGET_MS
      var resetCount = 0
      while (resetCount < SHADOW_ROOT_FLUSH_MAX_COUNT) {
        if (resetCount > 0 && getCurrentTimeImpl() >= deadline) {
          return 'pending'
        }
        var nextEntry = baselineResetIterator.next()
        if (nextEntry.done) {
          clearPendingShadowRootBaselineReset()
          return true
        }
        var entry = nextEntry.value
        if (!isEntryActive(entry)) {
          continue
        }
        try {
          // reset() performs takeRecords(), reports mutation activity, and
          // discards the obsolete raw/task generation without serializing it.
          // The caller restarts the mixed-time FullSnapshot when that activity
          // advances its DOM version.
          entry.resetMutationObserver()
        } catch (error) {
          clearPendingShadowRootBaselineReset()
          if (mutationOverflowCb) {
            mutationOverflowCb({
              reason: 'shadow_root_baseline_reset_error',
              error: String(error)
            })
          }
          return false
        }
        resetCount += 1
      }
      return 'pending'
    },

    reset: function () {
      if (stopped) {
        return
      }
      retireActiveGeneration()
    },

    $rBeginRecovery: function () {
      if (stopped || recoveryShadowRoots) {
        return
      }
      recoveryShadowRoots = []
      controllerByShadowRoot.forEach(function (entry, shadowRoot) {
        if (
          entry.active &&
          entry.registered &&
          !entry.provisionalOwner
        ) {
          recoveryShadowRoots.push(shadowRoot)
        }
      })
    },

    $rCommitRecovery: function () {
      recoveryShadowRoots = undefined
    },

    $rRollbackRecovery: function () {
      if (stopped || !recoveryShadowRoots) {
        return
      }
      var shadowRoots = recoveryShadowRoots
      recoveryShadowRoots = undefined
      // Retire observers registered by the incomplete snapshot before
      // rebuilding the bounded observer set from the previous published
      // baseline. Observer installation is complete for every registered
      // root; explicit flushing is independently time-sliced.
      retireActiveGeneration()
      // This synchronous reinstall is deliberately limited to the abandoned
      // replacement-baseline path. Paging it would leave a window where
      // mutations inside a previously published root are not observed, so
      // correctness takes precedence over latency on this rare failure path.
      shadowRoots.forEach(function (shadowRoot) {
        try {
          if (shadowRootBelongsToObservedDocument(shadowRoot)) {
            shadowRootsController.addShadowRoot(shadowRoot)
          }
        } catch (error) {
          reportCleanupError(error)
        }
      })
    }
  }
  return shadowRootsController

  function createGeneration() {
    return {
      active: true,
      id: ++nextGenerationId
    }
  }

  function isGenerationActive(generation) {
    return (
      !stopped &&
      generation.active &&
      generation === activeGeneration
    )
  }

  function shadowRootBelongsToObservedDocument(shadowRoot) {
    try {
      return Boolean(
        shadowRoot.host &&
          shadowRoot.host.isConnected &&
          shadowRoot.host.ownerDocument === document
      )
    } catch (_) {
      return false
    }
  }

  function isEntryActive(entry) {
    return (
      entry.active &&
      entry.registered &&
      controllerByShadowRoot.get(entry.shadowRoot) === entry &&
      isGenerationActive(entry.generation)
    )
  }

  function createGatedCallback(entry, type, callback) {
    if (!callback) {
      return undefined
    }
    return function (value) {
      if (
        type === 'mutation' &&
        isEntryShadowRootIgnored(entry)
      ) {
        if (!entry.unpublishedMutationOverflowReported) {
          entry.unpublishedMutationOverflowReported = true
          var unpublishedMutationOverflow = {
            reason: 'shadow_root_mutation_before_publication'
          }
          if (
            currentFlush &&
            currentFlush.generation === entry.generation
          ) {
            currentFlush.overflow = unpublishedMutationOverflow
          } else if (mutationOverflowCb) {
            mutationOverflowCb(unpublishedMutationOverflow)
          }
        }
        return
      }
      var pendingOverflowAfterReset =
        type === 'overflow' &&
        entry.pendingOverflowAfterReset &&
        !stopped
      if (!isEntryActive(entry) && !pendingOverflowAfterReset) {
        return
      }
      if (pendingOverflowAfterReset) {
        entry.pendingOverflowAfterReset = false
      }
      if (currentFlush && currentFlush.generation === entry.generation) {
        if (type === 'overflow') {
          currentFlush.overflow = value || {
            reason: 'shadow_root_observer_overflow'
          }
        } else {
          if (!reserveShadowRootFlushEvent(currentFlush, type, value)) {
            var shouldReportOverflow =
              !mutationResourceBudget ||
              mutationResourceBudget.failOnce()
            currentFlush.overflow = {
              reason: 'aggregate_shadow_flush_watermark',
              mutationApproxBytes:
                currentFlush.eventApproxBytes +
                estimateShadowRootFlushEventApproxBytes(type, value),
              $rSuppressMutationOverflow: !shouldReportOverflow
            }
            return
          }
          currentFlush.events.push({
            callback: callback,
            entry: entry,
            type: type,
            value: value
          })
        }
        return
      }
      callback(value)
    }
  }

  function coalesceMutationEvents(events) {
    var result = []
    var mergedMutationEvent
    events.forEach(function (event) {
      if (event.type !== 'mutation') {
        // Only adjacent mutation callbacks are one coalescing window. Input
        // and other state events can arrive between paged root flushes; moving
        // a later mutation ahead of that event would corrupt replay ordering.
        mergedMutationEvent = undefined
        result.push(event)
        return
      }
      if (!mergedMutationEvent) {
        mergedMutationEvent = {
          callback: event.callback,
          entries: [],
          entry: event.entry,
          type: event.type,
          value: {
            adds: [],
            removes: [],
            texts: [],
            attributes: []
          }
        }
        result.push(mergedMutationEvent)
      }
      mergedMutationEvent.entries.push(event.entry)
      Array.prototype.push.apply(
        mergedMutationEvent.value.adds,
        event.value.adds
      )
      Array.prototype.push.apply(
        mergedMutationEvent.value.removes,
        event.value.removes
      )
      Array.prototype.push.apply(
        mergedMutationEvent.value.texts,
        event.value.texts
      )
      Array.prototype.push.apply(
        mergedMutationEvent.value.attributes,
        event.value.attributes
      )
    })
    return result
  }

  function reserveShadowRootFlushEvent(flushState, type, value) {
    var eventApproxBytes =
      estimateShadowRootFlushEventApproxBytes(type, value)
    var nextEventCount = flushState.eventCount + 1
    var nextEventApproxBytes =
      flushState.eventApproxBytes + eventApproxBytes
    if (mutationResourceBudget) {
      if (!flushState.eventBudgetReservation) {
        flushState.eventBudgetReservation =
          mutationResourceBudget.reserve(MUTATION_RESOURCE_FLUSH, {
            eventCount: nextEventCount,
            approxBytes: nextEventApproxBytes
          })
        if (!flushState.eventBudgetReservation) {
          return false
        }
      } else if (
        !flushState.eventBudgetReservation.update({
          eventCount: nextEventCount,
          approxBytes: nextEventApproxBytes
        })
      ) {
        return false
      }
    }
    flushState.eventCount = nextEventCount
    flushState.eventApproxBytes = nextEventApproxBytes
    return true
  }

  function releaseShadowRootFlushBudget(flushState) {
    if (flushState && flushState.eventBudgetReservation) {
      flushState.eventBudgetReservation()
      flushState.eventBudgetReservation = undefined
    }
  }

  function estimateShadowRootFlushEventApproxBytes(type, value) {
    if (type === 'mutation') {
      return getMutationPayloadApproxBytes(value)
    }
    var approxBytes = 64
    if (!value || typeof value !== 'object') {
      return (
        approxBytes +
        (typeof value === 'string' ? value.length * 2 : 0)
      )
    }
    Object.keys(value).slice(0, 64).forEach(function (name) {
      var propertyValue = value[name]
      approxBytes += name.length * 2 + 16
      if (typeof propertyValue === 'string') {
        approxBytes += propertyValue.length * 2
      }
    })
    return approxBytes
  }

  function isEntryShadowRootIgnored(entry) {
    if (!isNodeIgnored) {
      return false
    }
    try {
      return isNodeIgnored(entry.shadowRoot)
    } catch (_) {
      return true
    }
  }

  function createGatedShadowRootsController(entry) {
    return {
      $rMutationDependencyState: mutationDependencyState,
      addShadowRoot: function (shadowRoot, provisionalOwner) {
        if (isEntryActive(entry)) {
          return shadowRootsController.addShadowRoot(
            shadowRoot,
            provisionalOwner
          )
        }
        return false
      },
      removeShadowRoot: function (shadowRoot) {
        if (isEntryActive(entry)) {
          shadowRootsController.removeShadowRoot(shadowRoot)
        }
      },
      cleanupDisconnectedShadowRoots: function () {
        if (isEntryActive(entry)) {
          shadowRootsController.cleanupDisconnectedShadowRoots()
        }
      },
      reset: function () {
        if (isEntryActive(entry)) {
          // A removed-subtree traversal overflow resets the shadow-root
          // registry immediately, then reports its reason through the
          // observer overflow callback. Keep that one callback armed across
          // the generation swap so recovery is not lost. Every other callback
          // from the retired generation remains gated.
          entry.pendingOverflowAfterReset = true
          shadowRootsController.reset()
        }
      },
      commitProvisionalShadowRoots: function (owner) {
        shadowRootsController.commitProvisionalShadowRoots(owner)
      },
      rollbackProvisionalShadowRoots: function (owner) {
        shadowRootsController.rollbackProvisionalShadowRoots(owner)
      }
    }
  }

  function failFlush(generation, overflow) {
    releaseShadowRootFlushBudget(currentFlush)
    currentFlush = undefined
    if (generation === activeGeneration) {
      retireActiveGeneration()
    }
    if (
      !stopped &&
      mutationOverflowCb &&
      !overflow.$rSuppressMutationOverflow
    ) {
      mutationOverflowCb(overflow)
    }
    return false
  }

  function retireActiveGeneration() {
    releaseShadowRootFlushBudget(currentFlush)
    currentFlush = undefined
    clearPendingShadowRootFlush()
    clearPendingShadowRootBaselineReset()
    clearDisconnectedShadowRootCleanup()
    var retiredGeneration = activeGeneration
    var retiredControllers = controllerByShadowRoot
    retiredGeneration.active = false
    // These sets describe dependencies inside one published replay baseline.
    // Reusing them after a reset would make a node dropped in an old
    // generation permanently poison later moves of the same live node.
    mutationDependencyState.$rPublishedRoots = new WeakSet()
    mutationDependencyState.$rLocallyDroppedRoots = new WeakSet()
    activeGeneration = createGeneration()
    controllerByShadowRoot = new Map()
    retireControllerEntries(retiredControllers)
  }

  function clearPendingShadowRootFlush() {
    pendingFlushIterator = undefined
    pendingFlushGeneration = undefined
    pendingFlushEntry = undefined
  }

  function clearPendingShadowRootBaselineReset() {
    baselineResetIterator = undefined
    baselineResetGeneration = undefined
  }

  function runDisconnectedShadowRootCleanupSlice() {
    if (
      !disconnectedCleanupIterator ||
      disconnectedCleanupGeneration !== activeGeneration
    ) {
      disconnectedCleanupIterator = controllerByShadowRoot.entries()
      disconnectedCleanupGeneration = activeGeneration
    }
    var deadline = getCurrentTimeImpl() + SHADOW_ROOT_CLEANUP_BUDGET_MS
    var scanned = 0
    while (scanned < SHADOW_ROOT_CLEANUP_BATCH_SIZE) {
      var nextEntry = disconnectedCleanupIterator.next()
      if (nextEntry.done) {
        clearDisconnectedShadowRootCleanup()
        return
      }
      scanned += 1
      var shadowRoot = nextEntry.value[0]
      if (!shadowRootBelongsToObservedDocument(shadowRoot)) {
        try {
          shadowRootsController.removeShadowRoot(shadowRoot)
        } catch (_) {}
      }
      if (getCurrentTimeImpl() >= deadline) {
        break
      }
    }
    scheduleDisconnectedShadowRootCleanup()
  }

  function scheduleDisconnectedShadowRootCleanup() {
    if (
      disconnectedCleanupScheduled ||
      !disconnectedCleanupIterator ||
      stopped
    ) {
      return
    }
    disconnectedCleanupScheduled = true
    setTimeout(function () {
      disconnectedCleanupScheduled = false
      if (!stopped && disconnectedCleanupIterator) {
        runDisconnectedShadowRootCleanupSlice()
      }
    }, 0)
  }

  function clearDisconnectedShadowRootCleanup() {
    disconnectedCleanupIterator = undefined
    disconnectedCleanupGeneration = undefined
  }

  function retireControllerEntries(retiredControllers) {
    if (retiredControllers.size > 0) {
      // The generation (or provisional map membership) has already been
      // invalidated, so native observer ingress is gated without walking every
      // entry here. Physical observer/listener teardown remains bounded below.
      var cleanupItem = {
        controllers: retiredControllers,
        iterator: retiredControllers.entries(),
        next: undefined
      }
      retiredControllerCount += retiredControllers.size
      if (cleanupQueueTail) {
        cleanupQueueTail.next = cleanupItem
      } else {
        cleanupQueueHead = cleanupItem
      }
      cleanupQueueTail = cleanupItem
      scheduleCleanup()
    }
  }

  function scheduleCleanup() {
    if (cleanupScheduled || !cleanupQueueHead) {
      return
    }
    cleanupScheduled = true
    try {
      scheduleCleanupImpl(runCleanupSlice)
    } catch (error) {
      cleanupScheduled = false
      reportCleanupError(error)
      if (scheduleCleanupImpl !== defaultScheduleCleanup) {
        cleanupScheduled = true
        try {
          defaultScheduleCleanup(runCleanupSlice)
        } catch (fallbackError) {
          cleanupScheduled = false
          reportCleanupError(fallbackError)
        }
      }
    }
  }

  function runCleanupSlice() {
    cleanupScheduled = false
    var deadline = getCurrentTimeImpl() + SHADOW_ROOT_CLEANUP_BUDGET_MS
    var cleanedControllerCount = 0

    while (cleanupQueueHead) {
      var cleanupItem = cleanupQueueHead
      var nextEntry = cleanupItem.iterator.next()
      if (nextEntry.done) {
        cleanupQueueHead = cleanupItem.next
        cleanupItem.next = undefined
        if (!cleanupQueueHead) {
          cleanupQueueTail = undefined
        }
        continue
      }

      var shadowRoot = nextEntry.value[0]
      var entry = nextEntry.value[1]
      cleanupItem.controllers.delete(shadowRoot)
      retiredControllerCount = Math.max(retiredControllerCount - 1, 0)
      entry.active = false
      entry.registered = false
      entry.pendingOverflowAfterReset = false
      stopControllerEntry(entry, false)
      cleanedControllerCount += 1

      if (
        cleanedControllerCount >= SHADOW_ROOT_CLEANUP_BATCH_SIZE ||
        getCurrentTimeImpl() >= deadline
      ) {
        break
      }
    }

    if (!cleanupQueueHead) {
      return
    }
    scheduleCleanup()
  }

  function deactivateControllerEntry(entry) {
    if (entry.mutationObserverDeactivated) {
      return
    }
    entry.mutationObserverDeactivated = true
    try {
      entry.deactivateMutationObserver()
    } catch (error) {
      return error
    }
  }

  function stopControllerEntry(entry, shouldThrow) {
    var firstError = deactivateControllerEntry(entry)
    try {
      entry.stopMutationObserver()
    } catch (error) {
      if (!firstError) {
        firstError = error
      }
    }
    try {
      entry.stopInputObserver()
    } catch (error) {
      if (!firstError) {
        firstError = error
      }
    }
    if (firstError) {
      reportCleanupError(firstError)
    }
    if (firstError && shouldThrow) {
      throw firstError
    }
  }

  function reportCleanupError(error) {
    if (!cleanupErrorCb) {
      return
    }
    try {
      cleanupErrorCb(error)
    } catch (_) {}
  }

  function defaultScheduleCleanup(callback) {
    setTimeout(callback, 0)
  }
}

function getCurrentTime() {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now()
  }
  return Date.now()
}

function subscribeToOpenShadowRoots(callback) {
  if (
    typeof Element === 'undefined' ||
    !Element.prototype ||
    typeof Element.prototype.attachShadow !== 'function'
  ) {
    return noop
  }

  var subscriber = {
    callback: callback
  }
  attachShadowSubscribers.push(subscriber)

  if (!attachShadowInstrumentation) {
    try {
      attachShadowInstrumentation = instrumentMethod(
        Element.prototype,
        'attachShadow',
        function (call) {
          var host = call.target
          call.onPostCall(function (shadowRoot) {
            // Closed roots are intentionally outside the replay contract.
            // Checking the public host property avoids reading the caller's
            // options twice and only admits roots exposed as mode: "open".
            if (!shadowRoot || host.shadowRoot !== shadowRoot) {
              return
            }
            attachShadowSubscribers
              .slice()
              .forEach(function (activeSubscriber) {
                try {
                  activeSubscriber.callback(shadowRoot, host)
                } catch (_) {}
              })
          })
        }
      )
    } catch (error) {
      removeAttachShadowSubscriber(subscriber)
      throw error
    }
  }

  var subscriptionStopped = false
  return function () {
    if (subscriptionStopped) {
      return
    }
    subscriptionStopped = true
    removeAttachShadowSubscriber(subscriber)
    if (
      attachShadowSubscribers.length === 0 &&
      attachShadowInstrumentation
    ) {
      var instrumentation = attachShadowInstrumentation
      attachShadowInstrumentation = undefined
      instrumentation.stop()
    }
  }
}

function removeAttachShadowSubscriber(subscriber) {
  var subscriberIndex = attachShadowSubscribers.indexOf(subscriber)
  if (subscriberIndex !== -1) {
    attachShadowSubscribers.splice(subscriberIndex, 1)
  }
}
