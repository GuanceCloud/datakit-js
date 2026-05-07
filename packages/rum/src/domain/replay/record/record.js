import {
  timeStampNow,
  getScrollX,
  getScrollY,
  assign
} from '@cloudcare/browser-core'
import { getViewportDimension } from '../../initViewportObservable'

import { RecordType, IncrementalSource } from '../../../types'
import { serializeDocument, SerializationContextStatus } from './serialize'
import { initObservers } from './observers'

import { getVisualViewport } from './viewports'
import { assembleIncrementalSnapshot } from './utils'
import { createElementsScrollPositions } from './elementsScrollPositions'
import { initShadowRootsController } from './shadowRootsController'
import { createCanvasObserver } from './canvasObserver'
import { startCanvasCommandCapture } from './canvasCommandObserver'
import {
  getSerializedCanvasNodes,
  getSerializedNodeId
} from './serializationUtils'
import { startContinuousCanvasSnapshotLoop } from './canvasContinuousScheduler'

var MUTATION_EMIT_DELAY_MS = 16
var MAX_MUTATION_EMIT_APPROX_BYTES = 200000
var CANVAS_DEBUG_HISTORY_LIMIT = 200

function shouldUseCommandCapture(configuration) {
  return (
    configuration.replayCanvasEnabled &&
    configuration.replayCanvasMode === 'auto' &&
    configuration.replayCanvasSampling === 'all'
  )
}

function shouldUseContinuousCanvasSnapshot(configuration) {
  return (
    configuration.replayCanvasEnabled &&
    configuration.replayCanvasMode === 'auto' &&
    configuration.replayCanvasSampling !== 'all'
  )
}

export function record(options) {
  var emit = options.emit
  // runtime checks for user options
  if (!emit) {
    throw new Error('emit function is required')
  }

  var elementsScrollPositions = createElementsScrollPositions()
  var replayPerformanceStats = createReplayPerformanceStats()
  var pendingMutationPayload
  var pendingMutationTimeout

  var updateReplayPerformanceStats = function (delta) {
    accumulateReplayPerformanceStats(replayPerformanceStats, delta)
  }

  var mutationCb = function (mutation) {
    if (
      pendingMutationPayload &&
      shouldFlushPendingMutationPayloadBeforeMerge(
        pendingMutationPayload,
        mutation
      )
    ) {
      flushPendingMutations()
    }
    pendingMutationPayload = mergeMutationPayloads(
      pendingMutationPayload,
      mutation
    )
    scheduleMutationEmit()
  }
  function scheduleMutationEmit() {
    if (pendingMutationTimeout) {
      return
    }
    pendingMutationTimeout = setTimeout(function () {
      pendingMutationTimeout = undefined
      flushPendingMutations()
    }, MUTATION_EMIT_DELAY_MS)
  }
function flushPendingMutations() {
    if (pendingMutationTimeout) {
      clearTimeout(pendingMutationTimeout)
      pendingMutationTimeout = undefined
    }
    if (!pendingMutationPayload) {
      return
    }
    var mutationPayloads = splitPendingMutationPayloadForEmit(
      pendingMutationPayload
    )
    pendingMutationPayload = undefined
    updateReplayPerformanceStats(
      mutationPayloads.reduce(
        function (stats, mutationPayload) {
          stats.mutationCallbackCount += 1
          stats.mutationRecordCount += countMutationPayloadRecords(
            mutationPayload
          )
          stats.mutationAddCount += mutationPayload.adds.length
          stats.mutationRemoveCount += mutationPayload.removes.length
          stats.mutationTextCount += mutationPayload.texts.length
          stats.mutationAttributeCount += mutationPayload.attributes.length
          return stats
        },
        {
          mutationCallbackCount: 0,
          mutationRecordCount: 0,
          mutationAddCount: 0,
          mutationRemoveCount: 0,
          mutationTextCount: 0,
          mutationAttributeCount: 0
        }
      )
    )
    mutationPayloads.forEach(function (mutationPayload) {
      lastDomMutationForDebug = cloneDomMutationDebugResult(mutationPayload)
      pushCanvasDebugHistoryEntry(
        domMutationHistoryForDebug,
        lastDomMutationForDebug
      )
      emit(
        assembleIncrementalSnapshot(IncrementalSource.Mutation, mutationPayload)
      )
    })
  }
  var inputCb = function (s) {
    emit(assembleIncrementalSnapshot(IncrementalSource.Input, s))
  }

  var shadowRootsController = initShadowRootsController(options.configuration, {
    mutationCb,
    inputCb
  })
  var lastAutoCanvasSnapshotResult
  var autoCanvasSnapshotDebugHistoryForDebug = []
  var lastCanvasMutationForDebug
  var canvasMutationHistoryForDebug = []
  var lastDomMutationForDebug
  var domMutationHistoryForDebug = []
  var shouldUseCanvasCommandCapture = shouldUseCommandCapture(
    options.configuration
  )
  var canvasObserver = (
    options.createCanvasObserver || createCanvasObserver
  )({
    configuration: options.configuration,
    emit: emit,
    onMutationDebug: function (result) {
      lastCanvasMutationForDebug = cloneCanvasMutationDebugResult(result)
      pushCanvasDebugHistoryEntry(
        canvasMutationHistoryForDebug,
        lastCanvasMutationForDebug
      )
    }
  })
  var startCanvasSnapshotLoop =
    options.startContinuousCanvasSnapshotLoop || startContinuousCanvasSnapshotLoop
  var canvasSnapshotLoop = shouldUseCanvasCommandCapture
    ? {
        stop: function () {},
        reset: function () {}
      }
    : startCanvasSnapshotLoop({
    configuration: options.configuration,
    getCanvases: function () {
      return getSerializedCanvasNodes()
    },
    getSerializedNodeId: function (canvas) {
      return getSerializedNodeId(canvas)
    },
    onDebug: function (result) {
      var keepSessionAliveTriggered = false
      if (
        shouldKeepSessionAliveAfterAutoCanvasSnapshot(result) &&
        options.sessionManager &&
        options.sessionManager.keepSessionAlive
      ) {
        options.sessionManager.keepSessionAlive()
        keepSessionAliveTriggered = true
      }
      lastAutoCanvasSnapshotResult = cloneAutoCanvasSnapshotDebugResult(
        result,
        keepSessionAliveTriggered
      )
      pushCanvasDebugHistoryEntry(
        autoCanvasSnapshotDebugHistoryForDebug,
        lastAutoCanvasSnapshotResult
      )
    },
    snapshotCanvas: function (canvas) {
      return canvasObserver.snapshot(canvas, {
        trigger: 'auto',
        scheduler: 'continuous_snapshot'
      })
    }
  })
  var canvasCommandCapture = (
    options.startCanvasCommandCapture || startCanvasCommandCapture
  )({
    configuration: options.configuration,
    emit: emit,
    snapshotCanvas: function (canvas, snapshotOptions) {
      return canvasObserver.snapshot(canvas, snapshotOptions)
    },
    getCanvases: function () {
      return getSerializedCanvasNodes()
    },
    getSerializedNodeId: function (canvas) {
      return getSerializedNodeId(canvas)
    },
    onDebug: function (result) {
      var keepSessionAliveTriggered = false
      if (
        shouldKeepSessionAliveAfterAutoCanvasSnapshot(result) &&
        options.sessionManager &&
        options.sessionManager.keepSessionAlive
      ) {
        options.sessionManager.keepSessionAlive()
        keepSessionAliveTriggered = true
      }
      lastAutoCanvasSnapshotResult = cloneAutoCanvasSnapshotDebugResult(
        result,
        keepSessionAliveTriggered
      )
      pushCanvasDebugHistoryEntry(
        autoCanvasSnapshotDebugHistoryForDebug,
        lastAutoCanvasSnapshotResult
      )
    },
    onMutationDebug: function (result) {
      lastCanvasMutationForDebug = cloneCanvasMutationDebugResult(result)
      pushCanvasDebugHistoryEntry(
        canvasMutationHistoryForDebug,
        lastCanvasMutationForDebug
      )
    }
  })

  var takeFullSnapshot = function (timestamp, serializationContext) {
    if (typeof timestamp === 'undefined') {
      timestamp = timeStampNow()
    }
    if (typeof serializationContext === 'undefined') {
      serializationContext = {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: elementsScrollPositions,
        shadowRootsController: shadowRootsController
      }
    }
    var _viewportDimension = getViewportDimension()
    var width = _viewportDimension.width
    var height = _viewportDimension.height
    emit({
      data: {
        height: height,
        href: window.location.href,
        width: width
      },
      type: RecordType.Meta,
      timestamp: timestamp
    })

    emit({
      data: {
        has_focus: document.hasFocus()
      },
      type: RecordType.Focus,
      timestamp: timestamp
    })

    emit({
      data: {
        node: serializeDocument(
          document,
          options.configuration,
          serializationContext
        ),
        initialOffset: {
          left: getScrollX(),
          top: getScrollY()
        }
      },
      type: RecordType.FullSnapshot,
      timestamp: timestamp
    })

    if (window.visualViewport) {
      emit({
        data: getVisualViewport(),
        type: RecordType.VisualViewport,
        timestamp: timestamp
      })
    }
  }

  takeFullSnapshot()
  if (canvasCommandCapture.scanExistingCanvases) {
    canvasCommandCapture.scanExistingCanvases()
  }
  var _initObservers = initObservers({
    lifeCycle: options.lifeCycle,
    configuration: options.configuration,
    elementsScrollPositions: elementsScrollPositions,
    inputCb: inputCb,
    mediaInteractionCb: function (p) {
      emit(assembleIncrementalSnapshot(IncrementalSource.MediaInteraction, p))
    },
    mouseInteractionCb: function (mouseInteractionRecord) {
      emit(mouseInteractionRecord)
    },
    mousemoveCb: function (positions, source) {
      emit(assembleIncrementalSnapshot(source, { positions: positions }))
    },
    mutationCb: mutationCb,
    mutationPerfCb: updateReplayPerformanceStats,
    scrollCb: function (p) {
      emit(assembleIncrementalSnapshot(IncrementalSource.Scroll, p))
    },
    styleSheetCb: function (r) {
      emit(assembleIncrementalSnapshot(IncrementalSource.StyleSheetRule, r))
    },
    viewportResizeCb: function (d) {
      emit(assembleIncrementalSnapshot(IncrementalSource.ViewportResize, d))
    },
    frustrationCb: function (frustrationRecord) {
      emit(frustrationRecord)
    },
    focusCb: function (data) {
      emit({
        data: data,
        type: RecordType.Focus,
        timestamp: timeStampNow()
      })
    },
    visualViewportResizeCb: function (data) {
      emit({
        data: data,
        type: RecordType.VisualViewport,
        timestamp: timeStampNow()
      })
    },
    shadowRootsController: shadowRootsController
  })
  var stopObservers = _initObservers.stop
  var flushMutationsFromObservers = _initObservers.flush
  var resetMutationsFromObservers = _initObservers.reset || function () {}
  function flushMutations() {
    shadowRootsController.flush()
    flushMutationsFromObservers()
    flushPendingMutations()
  }

  return {
    stop: function () {
      flushPendingMutations()
      shadowRootsController.stop()
      canvasCommandCapture.stop()
      canvasObserver.stop()
      stopCanvasSnapshots(canvasSnapshotLoop)
      stopObservers()
    },
    snapshotCanvas: function (canvas, snapshotOptions) {
      return canvasObserver.snapshot(
        canvas,
        assign({ trigger: 'manual' }, snapshotOptions)
      )
    },
    getSerializedNodeIdForDebug: function (node) {
      return getSerializedNodeId(node)
    },
    getLastAutoCanvasSnapshotResultForDebug: function () {
      return cloneAutoCanvasSnapshotDebugResult(lastAutoCanvasSnapshotResult)
    },
    getAutoCanvasSnapshotDebugHistoryForDebug: function () {
      return autoCanvasSnapshotDebugHistoryForDebug.map(
        cloneAutoCanvasSnapshotDebugResult
      )
    },
    getLastCanvasMutationForDebug: function () {
      return cloneCanvasMutationDebugResult(lastCanvasMutationForDebug)
    },
    getCanvasMutationHistoryForDebug: function () {
      return canvasMutationHistoryForDebug.map(cloneCanvasMutationDebugResult)
    },
    getLastDomMutationForDebug: function () {
      return cloneDomMutationDebugResult(lastDomMutationForDebug)
    },
    getDomMutationHistoryForDebug: function () {
      return domMutationHistoryForDebug.map(cloneDomMutationDebugResult)
    },
    getReplayPerformanceForDebug: function () {
      return cloneReplayPerformanceStats(replayPerformanceStats)
    },
    takeSubsequentFullSnapshot: function (timestamp) {
      flushMutations()
      resetMutationsFromObservers()
      if (canvasObserver.reset) {
        canvasObserver.reset()
      }
      if (canvasCommandCapture.reset) {
        canvasCommandCapture.reset()
      }
      resetCanvasSnapshots(canvasSnapshotLoop)
      takeFullSnapshot(timestamp, {
        shadowRootsController: shadowRootsController,
        status: SerializationContextStatus.SUBSEQUENT_FULL_SNAPSHOT,
        elementsScrollPositions: elementsScrollPositions
      })
      if (canvasCommandCapture.scanExistingCanvases) {
        canvasCommandCapture.scanExistingCanvases()
      }
    },
    flushMutations: flushMutations,
    shadowRootsController: shadowRootsController
  }
}

function materializeMutationPayload(pendingMutationPayload) {
  return {
    adds: pendingMutationPayload.adds,
    removes: pendingMutationPayload.removes,
    texts: pendingMutationPayload.texts,
    attributes: pendingMutationPayload.attributes
  }
}

function createEmptyMutationPayload() {
  return {
    adds: [],
    removes: [],
    texts: [],
    attributes: [],
    approxBytes: 0,
    addsApproxBytes: 0,
    removesApproxBytes: 0,
    textsApproxBytes: 0,
    attributesApproxBytes: 0,
    addApproxBytes: [],
    removesByKey: new Map(),
    removeApproxBytesByKey: new Map(),
    textsById: new Map(),
    textApproxBytesById: new Map(),
    attributesById: new Map(),
    attributeApproxBytesById: new Map()
  }
}

function mergeMutationPayloads(target, source) {
  var merged = target || createEmptyMutationPayload()
  mergeAddMutations(merged, source.adds)
  mergeRemoveMutations(merged, source.removes)
  mergeTextMutations(merged, source.texts)
  mergeAttributeMutations(merged, source.attributes)
  updateMutationPayloadApproxBytes(merged)
  return merged
}

function mergeAddMutations(merged, sourceAdds) {
  if (!sourceAdds.length) {
    return
  }

  sourceAdds.forEach(function (add) {
    var addApproxBytes = estimateMutationEntryBytes(add)
    merged.adds.push(add)
    merged.addApproxBytes.push(addApproxBytes)
    merged.addsApproxBytes += addApproxBytes
  })
}

function mergeRemoveMutations(merged, sourceRemoves) {
  if (!sourceRemoves.length) {
    return
  }
  sourceRemoves.forEach(function (remove) {
    var key = getRemoveMutationKey(remove)
    if (!merged.removesByKey.has(key)) {
      merged.removes.push(remove)
      var removeApproxBytes = estimateMutationEntryBytes(remove)
      merged.removeApproxBytesByKey.set(key, removeApproxBytes)
      merged.removesApproxBytes += removeApproxBytes
    }
    merged.removesByKey.set(key, remove)
  })
}

function mergeTextMutations(merged, sourceTexts) {
  if (!sourceTexts.length) {
    return
  }
  sourceTexts.forEach(function (textMutation) {
    var existingTextMutation = merged.textsById.get(textMutation.id)
    if (existingTextMutation) {
      merged.textsApproxBytes -=
        merged.textApproxBytesById.get(textMutation.id) || 0
      existingTextMutation.value = textMutation.value
      var nextTextApproxBytes = estimateMutationEntryBytes(existingTextMutation)
      merged.textApproxBytesById.set(textMutation.id, nextTextApproxBytes)
      merged.textsApproxBytes += nextTextApproxBytes
      return
    }
    merged.texts.push(textMutation)
    merged.textsById.set(textMutation.id, textMutation)
    var textApproxBytes = estimateMutationEntryBytes(textMutation)
    merged.textApproxBytesById.set(textMutation.id, textApproxBytes)
    merged.textsApproxBytes += textApproxBytes
  })
}

function mergeAttributeMutations(merged, sourceAttributes) {
  if (!sourceAttributes.length) {
    return
  }

  sourceAttributes.forEach(function (attributeMutation) {
    var existingAttributeMutation = merged.attributesById.get(attributeMutation.id)
    if (!existingAttributeMutation) {
      var nextAttributeMutation = {
        id: attributeMutation.id,
        attributes: assign({}, attributeMutation.attributes)
      }
      merged.attributes.push(nextAttributeMutation)
      merged.attributesById.set(attributeMutation.id, nextAttributeMutation)
      var attributeApproxBytes = estimateMutationEntryBytes(nextAttributeMutation)
      merged.attributeApproxBytesById.set(
        attributeMutation.id,
        attributeApproxBytes
      )
      merged.attributesApproxBytes += attributeApproxBytes
      return
    }
    merged.attributesApproxBytes -=
      merged.attributeApproxBytesById.get(attributeMutation.id) || 0
    existingAttributeMutation.attributes = assign(
      existingAttributeMutation.attributes,
      attributeMutation.attributes
    )
    var nextAttributeApproxBytes = estimateMutationEntryBytes(
      existingAttributeMutation
    )
    merged.attributeApproxBytesById.set(
      attributeMutation.id,
      nextAttributeApproxBytes
    )
    merged.attributesApproxBytes += nextAttributeApproxBytes
  })
}

function getRemoveMutationKey(remove) {
  return remove.parentId + ':' + remove.id
}

function shouldFlushPendingMutationPayloadBeforeMerge(target, source) {
  return (
    target.approxBytes + estimateMutationPayloadBytes(source) >
    MAX_MUTATION_EMIT_APPROX_BYTES
  )
}

function splitPendingMutationPayloadForEmit(pendingMutationPayload) {
  var mutation = materializeMutationPayload(pendingMutationPayload)
  if (
    !mutation.adds.length ||
    pendingMutationPayload.approxBytes <= MAX_MUTATION_EMIT_APPROX_BYTES
  ) {
    return [mutation]
  }

  var addOnlyPayloads = []
  var currentAdds = []
  var currentAddsBytes = BASE_MUTATION_PAYLOAD_APPROX_BYTES

  mutation.adds.forEach(function (add, index) {
    var addBytes = pendingMutationPayload.addApproxBytes[index]
    if (
      currentAdds.length &&
      currentAddsBytes + addBytes > MAX_MUTATION_EMIT_APPROX_BYTES
    ) {
      addOnlyPayloads.push({
        adds: currentAdds,
        removes: [],
        texts: [],
        attributes: []
      })
      currentAdds = []
      currentAddsBytes = BASE_MUTATION_PAYLOAD_APPROX_BYTES
    }
    currentAdds.push(add)
    currentAddsBytes += addBytes
  })

  if (currentAdds.length) {
    addOnlyPayloads.push({
      adds: currentAdds,
      removes: [],
      texts: [],
      attributes: []
    })
  }

  if (
    mutation.removes.length ||
    mutation.texts.length ||
    mutation.attributes.length
  ) {
    addOnlyPayloads.push({
      adds: [],
      removes: mutation.removes,
      texts: mutation.texts,
      attributes: mutation.attributes
    })
  }

  return addOnlyPayloads
}

function createEmptyMutation() {
  return {
    adds: [],
    removes: [],
    texts: [],
    attributes: []
  }
}

var BASE_MUTATION_PAYLOAD_APPROX_BYTES = 64
function estimateMutationPayloadBytes(mutation) {
  return (
    BASE_MUTATION_PAYLOAD_APPROX_BYTES +
    estimateMutationEntriesBytes(mutation.adds) +
    estimateMutationEntriesBytes(mutation.removes) +
    estimateMutationEntriesBytes(mutation.texts) +
    estimateMutationEntriesBytes(mutation.attributes)
  )
}

function estimateMutationEntryBytes(entry) {
  return JSON.stringify(entry).length
}

function estimateMutationEntriesBytes(entries) {
  var total = 0
  for (var i = 0; i < entries.length; i += 1) {
    total += estimateMutationEntryBytes(entries[i])
  }
  return total
}

function updateMutationPayloadApproxBytes(mutationPayload) {
  mutationPayload.approxBytes =
    BASE_MUTATION_PAYLOAD_APPROX_BYTES +
    mutationPayload.addsApproxBytes +
    mutationPayload.removesApproxBytes +
    mutationPayload.textsApproxBytes +
    mutationPayload.attributesApproxBytes
}

function createReplayPerformanceStats() {
  return {
    processMutationsCount: 0,
    processMutationsDuration: 0,
    mutationCallbackCount: 0,
    mutationRecordCount: 0,
    mutationAddCount: 0,
    mutationRemoveCount: 0,
    mutationTextCount: 0,
    mutationAttributeCount: 0
  }
}

function accumulateReplayPerformanceStats(stats, delta) {
  if (!delta) {
    return
  }

  stats.processMutationsCount += delta.processMutationsCount || 0
  stats.processMutationsDuration += delta.processMutationsDuration || 0
  stats.mutationCallbackCount += delta.mutationCallbackCount || 0
  stats.mutationRecordCount += delta.mutationRecordCount || 0
  stats.mutationAddCount += delta.mutationAddCount || 0
  stats.mutationRemoveCount += delta.mutationRemoveCount || 0
  stats.mutationTextCount += delta.mutationTextCount || 0
  stats.mutationAttributeCount += delta.mutationAttributeCount || 0
}

function countMutationPayloadRecords(mutation) {
  return (
    mutation.adds.length +
    mutation.removes.length +
    mutation.texts.length +
    mutation.attributes.length
  )
}

function cloneReplayPerformanceStats(stats) {
  if (!stats) {
    return stats
  }

  return {
    processMutationsCount: stats.processMutationsCount,
    processMutationsDuration:
      Math.round(stats.processMutationsDuration * 10) / 10,
    mutationCallbackCount: stats.mutationCallbackCount,
    mutationRecordCount: stats.mutationRecordCount,
    mutationAddCount: stats.mutationAddCount,
    mutationRemoveCount: stats.mutationRemoveCount,
    mutationTextCount: stats.mutationTextCount,
    mutationAttributeCount: stats.mutationAttributeCount
  }
}

function pushCanvasDebugHistoryEntry(history, entry) {
  if (!entry) {
    return
  }

  history.push(entry)
  if (history.length > CANVAS_DEBUG_HISTORY_LIMIT) {
    history.shift()
  }
}

function stopCanvasSnapshots(canvasSnapshotLoop) {
  if (typeof canvasSnapshotLoop === 'function') {
    canvasSnapshotLoop()
    return
  }
  if (canvasSnapshotLoop && canvasSnapshotLoop.stop) {
    canvasSnapshotLoop.stop()
  }
}

function resetCanvasSnapshots(canvasSnapshotLoop) {
  if (canvasSnapshotLoop && canvasSnapshotLoop.reset) {
    canvasSnapshotLoop.reset()
  }
}

function shouldKeepSessionAliveAfterAutoCanvasSnapshot(result) {
  return !!(
    result &&
    result.status === 'completed' &&
    result.selectedCanvasCount > 0 &&
    (result.results || []).some(function (entry) {
      return isKeepAliveWorthyAutoCanvasResult(entry)
    })
  )
}

function isKeepAliveWorthyAutoCanvasResult(entry) {
  return !!(
    entry &&
    (entry.ok ||
      entry.reason === 'unchanged' ||
      entry.reason === 'below_threshold')
  )
}

function cloneAutoCanvasSnapshotDebugResult(
  result,
  keepSessionAliveTriggered
) {
  if (!result) {
    return result
  }

  if (typeof keepSessionAliveTriggered === 'undefined') {
    keepSessionAliveTriggered = result.keepSessionAliveTriggered
  }

  return {
    scheduler: result.scheduler,
    status: result.status,
    startedAt:
      typeof result.startedAt === 'number' ? result.startedAt : result.timestamp,
    completedAt:
      typeof result.completedAt === 'number'
        ? result.completedAt
        : result.timestamp,
    timestamp: result.timestamp,
    eligibleCanvasCount: result.eligibleCanvasCount,
    selectedCanvasCount: result.selectedCanvasCount,
    skippedBudgetCount: result.skippedBudgetCount,
    keepSessionAliveTriggered: !!keepSessionAliveTriggered,
    results: (result.results || []).map(function (entry) {
      return {
        canvasId: entry.canvasId,
        ok: entry.ok,
        reason: entry.reason,
        priority: entry.priority
      }
    })
  }
}

function cloneCanvasMutationDebugResult(result) {
  if (!result) {
    return result
  }

  var clonedResult = {
    timestamp: result.timestamp,
    canvasId: result.canvasId,
    trigger: result.trigger,
    encodedBytesCount: result.encodedBytesCount,
    approxBytesCount: result.approxBytesCount,
    commandCount: result.commandCount,
    width: result.width,
    height: result.height
  }

  if (typeof result.reason !== 'undefined') {
    clonedResult.reason = result.reason
  }
  if (typeof result.diagnostics !== 'undefined') {
    clonedResult.diagnostics = result.diagnostics
  }

  return clonedResult
}

function cloneDomMutationDebugResult(result) {
  if (!result) {
    return result
  }

  return {
    timestamp:
      typeof result.timestamp === 'number' ? result.timestamp : timeStampNow(),
    adds: (result.adds || []).map(cloneDebugValue),
    removes: (result.removes || []).map(cloneDebugValue),
    texts: (result.texts || []).map(cloneDebugValue),
    attributes: (result.attributes || []).map(cloneDebugValue),
    addsCount: (result.adds || []).length,
    removesCount: (result.removes || []).length,
    textsCount: (result.texts || []).length,
    attributesCount: (result.attributes || []).length
  }
}

function cloneDebugValue(value) {
  if (!value || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(cloneDebugValue)
  }

  return Object.keys(value).reduce(function (accumulator, key) {
    accumulator[key] = cloneDebugValue(value[key])
    return accumulator
  }, {})
}
