import {
  getParentNode,
  instrumentMethod,
  isNodeShadowRoot,
  noop,
  setTimeout
} from '@cloudcare/browser-core'
import { startMutationObserver } from './mutationObserver'
import { initInputObserver } from './observers'

export var SHADOW_ROOT_CLEANUP_BATCH_SIZE = 32
export var SHADOW_ROOT_CLEANUP_BUDGET_MS = 4
export var SHADOW_ROOT_FLUSH_MAX_COUNT = 64
export var SHADOW_ROOT_FLUSH_BUDGET_MS = 4
export var SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT =
  SHADOW_ROOT_FLUSH_MAX_COUNT
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
  var isMutationNodeIgnored =
    isNodeIgnored &&
    function (node) {
      return isNodeIgnored(node, true)
    }
  var isNodePublished = data.isNodePublished
  var mutationNodeSerializationCb = data.mutationNodeSerializationCb
  var startMutationObserverImpl =
    data.startMutationObserver || startMutationObserver
  var initInputObserverImpl = data.initInputObserver || initInputObserver
  var scheduleCleanupImpl =
    data.scheduleCleanup || defaultScheduleCleanup
  var getCurrentTimeImpl = data.getCurrentTime || getCurrentTime
  var cleanupErrorCb = data.cleanupErrorCb
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
  // Keep this WeakSet across baseline generations. On reset, the bounded
  // active set is marked skipped before the next serializer starts. Roots are
  // removed only when the new baseline registers them again, so events from a
  // discarded/restarted baseline cannot escape with stale serialized ids.
  var skippedShadowRoots = new WeakSet()
  var cleanupQueueHead
  var cleanupQueueTail
  var cleanupScheduled = false
  var retiredControllerCount = 0
  var currentFlush
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
        skippedShadowRoots.delete(shadowRoot)
        return true
      }
      if (
        controllerByShadowRoot.size >=
        SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT
      ) {
        // `null` is distinct from the inactive/stopped `false` result. It lets
        // the serializer preserve an empty ShadowRoot placeholder while
        // skipping unobserved content instead of rejecting the whole replay
        // baseline.
        skippedShadowRoots.add(shadowRoot)
        return null
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
        stopMutationObserver: function () {},
        stopInputObserver: function () {}
      }
      if (provisionalOwner) {
        if (!provisionalOwner.provisionalShadowRoots) {
          provisionalOwner.provisionalShadowRoots = []
        }
        provisionalOwner.provisionalShadowRoots.push(shadowRoot)
      }
      var mutationObserverController
      try {
        mutationObserverController = startMutationObserverImpl(
          createGatedCallback(entry, 'mutation', mutationCb),
          configuration,
          createGatedShadowRootsController(entry),
          shadowRoot,
          undefined,
          createGatedCallback(entry, 'overflow', mutationOverflowCb),
          createGatedCallback(entry, 'activity', mutationActivityCb),
          mutationNodeSerializationCb,
          isMutationNodeIgnored,
          isNodePublished
        )
        entry.flush = mutationObserverController.flush || function () {}
        entry.deactivateMutationObserver =
          mutationObserverController.deactivate || function () {}
        entry.refreshAndFlushPendingRootForNode =
          mutationObserverController.refreshAndFlushPendingRootForNode ||
          function () {}
        entry.stopMutationObserver =
          mutationObserverController.stop || function () {}

        // The change event does not bubble across a shadow root, so each active
        // generation needs its own listener.  The callback is generation-gated
        // before the controller becomes visible in the active map.
        var gatedInputCb = createGatedCallback(entry, 'input', inputCb)
        entry.stopInputObserver =
          (isNodeIgnored
            ? initInputObserverImpl(
                gatedInputCb,
                configuration,
                shadowRoot,
                isNodeIgnored
              )
            : initInputObserverImpl(
                gatedInputCb,
                configuration,
                shadowRoot
              )) || function () {}
        entry.registered = true
        controllerByShadowRoot.set(shadowRoot, entry)
        skippedShadowRoots.delete(shadowRoot)
        return true
      } catch (error) {
        entry.active = false
        skippedShadowRoots.add(shadowRoot)
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
      skippedShadowRoots.add(shadowRoot)
      stopControllerEntry(entry, true)
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
        if (
          isNodeShadowRoot(current) &&
          skippedShadowRoots.has(current)
        ) {
          return true
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
      if (shadowRootCount > SHADOW_ROOT_FLUSH_MAX_COUNT) {
        return failFlush(generation, {
          reason: 'shadow_root_flush_watermark',
          shadowRootCount: shadowRootCount,
          flushedShadowRootCount: 0
        })
      }

      var flushState = {
        events: [],
        generation: generation,
        overflow: undefined
      }
      currentFlush = flushState
      var deadline = getCurrentTimeImpl() + SHADOW_ROOT_FLUSH_BUDGET_MS
      var iterator = controllerByShadowRoot.values()
      var flushedShadowRootCount = 0
      var failure

      while (flushedShadowRootCount < shadowRootCount) {
        if (
          flushedShadowRootCount > 0 &&
          getCurrentTimeImpl() >= deadline
        ) {
          failure = {
            reason: 'shadow_root_flush_budget',
            shadowRootCount: shadowRootCount,
            flushedShadowRootCount: flushedShadowRootCount
          }
          break
        }
        var nextEntry = iterator.next()
        if (nextEntry.done) {
          break
        }
        var entry = nextEntry.value
        if (!isEntryActive(entry)) {
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
              flushedShadowRootCount: flushedShadowRootCount
            }
            break
          }
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

      currentFlush = undefined
      if (failure) {
        return failFlush(generation, failure)
      }

      var eventsToDispatch = coalesceMutationEvents(
        flushState.events.filter(function (event) {
          return isEntryActive(event.entry)
        })
      )
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
      return isGenerationActive(generation)
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
      // baseline. The active set is capped at 64 roots.
      retireActiveGeneration()
      shadowRoots.forEach(function (shadowRoot) {
        try {
          if (shadowRoot.host && shadowRoot.host.isConnected) {
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

  function isEntryActive(entry) {
    return (
      entry.active &&
      entry.registered &&
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
    currentFlush = undefined
    if (generation === activeGeneration) {
      retireActiveGeneration()
    }
    if (!stopped && mutationOverflowCb) {
      mutationOverflowCb(overflow)
    }
    return false
  }

  function retireActiveGeneration() {
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

  function retireControllerEntries(retiredControllers) {
    if (retiredControllers.size > 0) {
      // Native MutationObserver callbacks can be much more expensive than the
      // final generation-gated replay callback. Deactivate their entry guards
      // synchronously, but leave physical disconnect and listener cleanup in
      // the bounded asynchronous cleanup slices below.
      retiredControllers.forEach(function (entry, shadowRoot) {
        skippedShadowRoots.add(shadowRoot)
        entry.active = false
        entry.registered = false
        var deactivationError = deactivateControllerEntry(entry)
        if (deactivationError) {
          reportCleanupError(deactivationError)
        }
      })
      if (
        retiredControllerCount + retiredControllers.size >
        SHADOW_ROOT_RETIRED_CONTROLLER_LIMIT
      ) {
        // Repeated baseline resets can outrun the sliced cleanup queue. The
        // active generation is already deactivated and its heavy mutation
        // buffers were released synchronously, so disconnect this one map now
        // rather than retaining an unbounded chain of observers/listeners.
        stopRetiredControllersSynchronously(retiredControllers)
        return
      }
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

  function stopRetiredControllersSynchronously(retiredControllers) {
    retiredControllers.forEach(function (entry, shadowRoot) {
      retiredControllers.delete(shadowRoot)
      entry.active = false
      entry.registered = false
      entry.pendingOverflowAfterReset = false
      stopControllerEntry(entry, false)
    })
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
