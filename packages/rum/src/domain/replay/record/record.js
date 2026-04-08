import { timeStampNow, getScrollX, getScrollY } from '@cloudcare/browser-core'
import { getViewportDimension } from '../../initViewportObservable'

import { RecordType, IncrementalSource } from '../../../types'
import { serializeDocument, SerializationContextStatus } from './serialize'
import { initObservers } from './observers'

import { getVisualViewport } from './viewports'
import { assembleIncrementalSnapshot } from './utils'
import { createElementsScrollPositions } from './elementsScrollPositions'
import { initShadowRootsController } from './shadowRootsController'
import { createCanvasObserver } from './canvasObserver'
import {
  getSerializedCanvasNodes,
  getSerializedNodeId
} from './serializationUtils'
import { startAutoCanvasSnapshotLoop } from './canvasAutoSnapshot'

export function record(options) {
  var emit = options.emit
  // runtime checks for user options
  if (!emit) {
    throw new Error('emit function is required')
  }

  var elementsScrollPositions = createElementsScrollPositions()

  var mutationCb = function (mutation) {
    emit(assembleIncrementalSnapshot(IncrementalSource.Mutation, mutation))
  }
  var inputCb = function (s) {
    emit(assembleIncrementalSnapshot(IncrementalSource.Input, s))
  }

  var shadowRootsController = initShadowRootsController(options.configuration, {
    mutationCb,
    inputCb
  })
  var lastAutoCanvasSnapshotResult
  var canvasObserver = createCanvasObserver({
    configuration: options.configuration,
    emit: emit
  })
  var stopAutoCanvasSnapshots = (
    options.startAutoCanvasSnapshotLoop || startAutoCanvasSnapshotLoop
  )({
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
        result &&
        result.status === 'completed' &&
        result.selectedCanvasCount > 0 &&
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
    },
    snapshotCanvas: function (canvas) {
      return canvasObserver.snapshot(canvas)
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
  function flushMutations() {
    shadowRootsController.flush()
    flushMutationsFromObservers()
  }

  return {
    stop: function () {
      shadowRootsController.stop()
      canvasObserver.stop()
      stopAutoCanvasSnapshots()
      stopObservers()
    },
    snapshotCanvas: function (canvas, snapshotOptions) {
      return canvasObserver.snapshot(canvas, snapshotOptions)
    },
    getSerializedNodeIdForDebug: function (node) {
      return getSerializedNodeId(node)
    },
    getLastAutoCanvasSnapshotResultForDebug: function () {
      return cloneAutoCanvasSnapshotDebugResult(lastAutoCanvasSnapshotResult)
    },
    takeSubsequentFullSnapshot: function (timestamp) {
      flushMutations()
      takeFullSnapshot(timestamp, {
        shadowRootsController: shadowRootsController,
        status: SerializationContextStatus.SUBSEQUENT_FULL_SNAPSHOT,
        elementsScrollPositions: elementsScrollPositions
      })
    },
    flushMutations: flushMutations,
    shadowRootsController: shadowRootsController
  }
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
    status: result.status,
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
