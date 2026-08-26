import {
  instrumentSetter,
  instrumentMethod,
  assign,
  throttle,
  DOM_EVENT,
  addEventListeners,
  addEventListener,
  noop,
  LifeCycleEventType,
  RumEventType,
  ActionType,
  isNodeShadowHost,
  getScrollX,
  getScrollY
} from '@cloudcare/browser-core'
import { initViewportObservable } from '../../initViewportObservable'
import { FORM_PRIVATE_TAG_NAMES, NodePrivacyLevel } from '../../../constants'

import {
  RecordType,
  IncrementalSource,
  MediaInteractionType,
  MouseInteractionType
} from '../../../types'
import { getNodePrivacyLevel, shouldMaskNode } from './privacy'
import {
  getElementInputValue,
  getSerializedNodeId,
  hasSerializedNode
} from './serializationUtils'
import {
  assembleIncrementalSnapshot,
  getPathToNestedCSSRule,
  isTouchEvent
} from './utils'
import { startMutationObserver } from './mutationObserver'
import {
  getVisualViewport,
  convertMouseEventToLayoutCoordinates
} from './viewports'

var MOUSE_MOVE_OBSERVER_THRESHOLD = 50
var SCROLL_OBSERVER_THRESHOLD = 100
var VISUAL_VIEWPORT_OBSERVER_THRESHOLD = 200
var MAX_TRACKED_RADIO_GROUPS = 256

var recordIds = new WeakMap()
let nextId = 1

export function getRecordIdForEvent(event) {
  if (!recordIds.has(event)) {
    recordIds.set(event, nextId++)
  }
  return recordIds.get(event)
}
export function initObservers(o) {
  var cleanupTasks = []
  var mutationHandler
  var isNodeIgnoredForStateObserver = createNodeIgnorePredicate(
    o.shadowRootsController,
    o.isNodeIgnored
  )
  var isNodeIgnoredForStatelessObserver = createNodeIgnorePredicate(
    o.shadowRootsController,
    o.isNodeIgnoredForStatelessObserver || o.isNodeIgnored
  )
  try {
    mutationHandler = initMutationObserver(
      o.mutationCb,
      o.configuration,
      o.shadowRootsController,
      o.mutationPerfCb,
      o.mutationOverflowCb,
      o.mutationActivityCb,
      o.mutationNodeSerializationCb,
      // DOM mutation assembly and stateful observers use the queued-aware
      // predicate. Stateless interactions use the strict published-only
      // predicate below and never advance a pending serializer.
      o.isNodeIgnored &&
        function (node) {
          return o.isNodeIgnored(node, true)
        },
      o.isNodePublished,
      o.mutationResourceBudget
    )
    cleanupTasks.push(mutationHandler.stop)
    cleanupTasks.push(
      initMoveObserver(
        o.mousemoveCb,
        o.configuration,
        isNodeIgnoredForStatelessObserver
      )
    )
    cleanupTasks.push(
      initMouseInteractionObserver(
        o.mouseInteractionCb,
        o.configuration,
        isNodeIgnoredForStatelessObserver
      )
    )
    cleanupTasks.push(
      initScrollObserver(
        o.scrollCb,
        o.configuration,
        o.elementsScrollPositions,
        isNodeIgnoredForStateObserver
      )
    )
    cleanupTasks.push(
      initViewportResizeObserver(o.viewportResizeCb, o.configuration)
    )
    cleanupTasks.push(
      initInputObserver(
        o.inputCb,
        o.configuration,
        undefined,
        isNodeIgnoredForStateObserver
      )
    )
    cleanupTasks.push(
      initMediaInteractionObserver(
        o.mediaInteractionCb,
        o.configuration,
        isNodeIgnoredForStateObserver
      )
    )
    cleanupTasks.push(
      initStyleSheetObserver(
        o.styleSheetCb,
        o.configuration,
        isNodeIgnoredForStateObserver
      )
    )
    cleanupTasks.push(initFocusObserver(o.focusCb, o.configuration))
    cleanupTasks.push(
      initVisualViewportResizeObserver(
        o.visualViewportResizeCb,
        o.configuration
      )
    )
    cleanupTasks.push(
      initFrustrationObserver(
        o.lifeCycle,
        o.frustrationCb,
        o.configuration,
        isNodeIgnoredForStatelessObserver
      )
    )
  } catch (error) {
    try {
      runObserverCleanupTasks(cleanupTasks.slice().reverse())
    } catch (_) {}
    throw error
  }

  return {
    flush: function () {
      return mutationHandler.flush()
    },
    refreshAndFlushPendingRootForNode: function (node) {
      if (mutationHandler.refreshAndFlushPendingRootForNode) {
        return mutationHandler.refreshAndFlushPendingRootForNode(node)
      }
    },
    reset: function () {
      if (mutationHandler.reset) {
        mutationHandler.reset()
      }
    },
    stop: function () {
      runObserverCleanupTasks(cleanupTasks)
    }
  }
}

function createNodeIgnorePredicate(
  shadowRootsController,
  customIsNodeIgnored
) {
  if (typeof customIsNodeIgnored === 'function') {
    return function (node) {
      try {
        return customIsNodeIgnored(node)
      } catch (_) {
        return true
      }
    }
  }
  if (
    !shadowRootsController ||
    typeof shadowRootsController.isNodeInSkippedShadowRoot !== 'function'
  ) {
    return function () {
      return false
    }
  }
  return function (node) {
    try {
      return shadowRootsController.isNodeInSkippedShadowRoot(node)
    } catch (_) {
      return true
    }
  }
}

function neverIgnoreNode() {
  return false
}

function runObserverCleanupTasks(tasks) {
  var firstError
  tasks.forEach(function (task) {
    try {
      task()
    } catch (error) {
      if (!firstError) {
        firstError = error
      }
    }
  })
  if (firstError) {
    throw firstError
  }
}

export function initMutationObserver(
  cb,
  configuration,
  shadowRootsController,
  mutationPerfCb,
  mutationOverflowCb,
  mutationActivityCb,
  mutationNodeSerializationCb,
  isNodeIgnored,
  isNodePublished,
  mutationResourceBudget
) {
  return startMutationObserver(
    cb,
    configuration,
    shadowRootsController,
    document,
    mutationPerfCb,
    mutationOverflowCb,
    mutationActivityCb,
    mutationNodeSerializationCb,
    isNodeIgnored,
    isNodePublished,
    undefined,
    mutationResourceBudget
  )
}

export function initMoveObserver(cb, configuration, isNodeIgnored) {
  isNodeIgnored = isNodeIgnored || neverIgnoreNode
  var _updatePosition = throttle(
    function (event) {
      var target = getEventTarget(event)
      if (!isNodeIgnored(target) && hasSerializedNode(target)) {
        var coordinates = tryToComputeCoordinates(event)
        if (!coordinates) {
          return
        }
        var position = {
          id: getSerializedNodeId(target),
          timeOffset: 0,
          x: coordinates.x,
          y: coordinates.y
        }

        cb(
          [position],
          isTouchEvent(event)
            ? IncrementalSource.TouchMove
            : IncrementalSource.MouseMove
        )
      }
    },
    MOUSE_MOVE_OBSERVER_THRESHOLD,
    {
      trailing: false
    }
  )
  var cancelThrottle = _updatePosition.cancel
  var updatePosition = _updatePosition.throttled

  var _listener = addEventListeners(
    document,
    [DOM_EVENT.MOUSE_MOVE, DOM_EVENT.TOUCH_MOVE],
    updatePosition,
    {
      capture: true,
      passive: true
    }
  )
  var removeListener = _listener.stop
  return function () {
    removeListener()
    cancelThrottle()
  }
}

var eventTypeToMouseInteraction = {}
// Listen for pointerup DOM events instead of mouseup for MouseInteraction/MouseUp records. This
// allows to reference such records from Frustration records.
//
// In the context of supporting Mobile Session Replay, we introduced `PointerInteraction` records
// used by the Mobile SDKs in place of `MouseInteraction`. In the future, we should replace
// `MouseInteraction` by `PointerInteraction` in the Browser SDK so we have an uniform way to
// convey such interaction. This would cleanly solve the issue since we would have
// `PointerInteraction/Up` records that we could reference from `Frustration` records.
eventTypeToMouseInteraction[DOM_EVENT.POINTER_UP] = MouseInteractionType.MouseUp
eventTypeToMouseInteraction[DOM_EVENT.MOUSE_DOWN] = MouseInteractionType.MouseDown
eventTypeToMouseInteraction[DOM_EVENT.CLICK] = MouseInteractionType.Click
eventTypeToMouseInteraction[DOM_EVENT.CONTEXT_MENU] =
  MouseInteractionType.ContextMenu
eventTypeToMouseInteraction[DOM_EVENT.DBL_CLICK] = MouseInteractionType.DblClick
eventTypeToMouseInteraction[DOM_EVENT.FOCUS] = MouseInteractionType.Focus
eventTypeToMouseInteraction[DOM_EVENT.BLUR] = MouseInteractionType.Blur
eventTypeToMouseInteraction[DOM_EVENT.TOUCH_START] =
  MouseInteractionType.TouchStart
eventTypeToMouseInteraction[DOM_EVENT.TOUCH_END] = MouseInteractionType.TouchEnd
export function initMouseInteractionObserver(
  cb,
  configuration,
  isNodeIgnored
) {
  isNodeIgnored = isNodeIgnored || neverIgnoreNode
  var handler = function (event) {
    var target = getEventTarget(event)
    if (
      isNodeIgnored(target) ||
      getNodePrivacyLevel(target, configuration.defaultPrivacyLevel) ===
        NodePrivacyLevel.HIDDEN ||
      !hasSerializedNode(target)
    ) {
      return
    }
    var id = getSerializedNodeId(target)
    var type = eventTypeToMouseInteraction[event.type]

    var interaction
    if (
      type !== MouseInteractionType.Blur &&
      type !== MouseInteractionType.Focus
    ) {
      var coordinates = tryToComputeCoordinates(event)
      if (!coordinates) {
        return
      }
      interaction = { id: id, type: type, x: coordinates.x, y: coordinates.y }
    } else {
      interaction = { id: id, type: type }
    }

    var record = assign(
      { id: getRecordIdForEvent(event) },
      assembleIncrementalSnapshot(
        IncrementalSource.MouseInteraction,
        interaction
      )
    )
    cb(record)
  }
  return addEventListeners(
    document,
    Object.keys(eventTypeToMouseInteraction),
    handler,
    {
      capture: true,
      passive: true
    }
  ).stop
}

function tryToComputeCoordinates(event) {
  var _event = isTouchEvent(event) ? event.changedTouches[0] : event
  var x = _event.clientX
  var y = _event.clientY
  if (window.visualViewport) {
    var _convertMouseEventToLayoutCoordinates =
      convertMouseEventToLayoutCoordinates(x, y)
    x = _convertMouseEventToLayoutCoordinates.visualViewportX
    y = _convertMouseEventToLayoutCoordinates.visualViewportY
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined
  }
  return { x: x, y: y }
}

function initScrollObserver(
  cb,
  configuration,
  elementsScrollPositions,
  isNodeIgnored
) {
  isNodeIgnored = isNodeIgnored || neverIgnoreNode
  var _updatePosition = throttle(function (event) {
    var target = getEventTarget(event)
    if (!target) {
      return
    }
    var ignored = isNodeIgnored(target)
    if (
      getNodePrivacyLevel(target, configuration.defaultPrivacyLevel) ===
        NodePrivacyLevel.HIDDEN ||
      !hasSerializedNode(target)
    ) {
      return
    }
    var id = getSerializedNodeId(target)
    var scrollPositions =
      target === document
        ? {
            scrollTop: getScrollY(),
            scrollLeft: getScrollX()
          }
        : {
            scrollTop: Math.round(target.scrollTop),
            scrollLeft: Math.round(target.scrollLeft)
          }
    elementsScrollPositions.set(target, scrollPositions)
    if (ignored) {
      // Keep the live scroll baseline current while a time-sliced full
      // snapshot temporarily gates incremental records.
      return
    }
    cb({
      id: id,
      x: scrollPositions.scrollLeft,
      y: scrollPositions.scrollTop
    })
  }, SCROLL_OBSERVER_THRESHOLD)
  var cancelThrottle = _updatePosition.cancel
  var updatePosition = _updatePosition.throttled

  var _listener = addEventListener(document, DOM_EVENT.SCROLL, updatePosition, {
    capture: true,
    passive: true
  })
  var removeListener = _listener.stop
  return function () {
    removeListener()
    cancelThrottle()
  }
}

function initViewportResizeObserver(cb, configuration) {
  return initViewportObservable().subscribe(cb).unsubscribe
}

export function initInputObserver(
  cb,
  configuration,
  target,
  isNodeIgnored
) {
  if (target === undefined) {
    target = document
  }
  isNodeIgnored = isNodeIgnored || neverIgnoreNode
  var lastInputStateMap = new WeakMap()
  var radioGroupStateByRoot = new WeakMap()
  var isShadowRoot = target !== document

  var _addEventListeners = addEventListeners(
    target,
    // The 'input' event bubbles across shadow roots, so we don't have to listen for it on shadow
    // roots since it will be handled by the event listener that we did add to the document. Only
    // the 'change' event is blocked and needs to be handled on shadow roots.
    isShadowRoot ? [DOM_EVENT.CHANGE] : [DOM_EVENT.INPUT, DOM_EVENT.CHANGE],
    function (event) {
      var target = getEventTarget(event)
      if (FORM_PRIVATE_TAG_NAMES[target.tagName]) {
        onElementChange(target)
      }
    },
    {
      capture: true,
      passive: true
    }
  )
  var stopEventListeners = _addEventListeners.stop
  var stopPropertySetterInstrumentation
  if (!isShadowRoot) {
    const instrumentationStoppers = [
      instrumentSetter(HTMLInputElement.prototype, 'value', onElementChange),
      instrumentSetter(HTMLInputElement.prototype, 'checked', onElementChange),
      instrumentSetter(HTMLSelectElement.prototype, 'value', onElementChange),
      instrumentSetter(HTMLTextAreaElement.prototype, 'value', onElementChange),
      instrumentSetter(
        HTMLSelectElement.prototype,
        'selectedIndex',
        onElementChange
      )
    ]
    stopPropertySetterInstrumentation = function () {
      instrumentationStoppers.forEach(function (stopper) {
        return stopper.stop()
      })
    }
  } else {
    stopPropertySetterInstrumentation = noop
  }

  return function () {
    stopPropertySetterInstrumentation()
    stopEventListeners()
  }

  function onElementChange(target) {
    if (isNodeIgnored(target)) {
      return
    }
    var nodePrivacyLevel = getNodePrivacyLevel(
      target,
      configuration.defaultPrivacyLevel
    )
    if (nodePrivacyLevel === NodePrivacyLevel.HIDDEN) {
      return
    }

    var type = target.type

    let inputState
    if (type === 'radio' || type === 'checkbox') {
      if (shouldMaskNode(configuration, target, nodePrivacyLevel)) {
        return
      }
      inputState = { isChecked: target.checked }
    } else {
      var value = getElementInputValue(configuration, target, nodePrivacyLevel)
      if (value === undefined) {
        return
      }
      inputState = { text: value }
    }

    // Can be multiple changes on the same node within the same batched mutation observation.
    var shouldTrackRadioGroup = cbWithDedup(target, inputState)

    // If a radio was checked, other radios with the same name attribute will be unchecked.
    // Keep only the last observed checked radio per native group. This avoids
    // scanning an arbitrarily large document and does not manufacture false
    // records for every unchecked peer when a group is first observed.
    if (type === 'radio' && target.name && shouldTrackRadioGroup) {
      synchronizeRadioGroup(target)
    }
  }

  function synchronizeRadioGroup(target) {
    var root = getRadioRoot(target)
    var groupMap = getRadioGroupMap(root, target.form)
    var name = target.name
    var previouslyCheckedRadio = getTrackedRadio(
      groupMap,
      name,
      target,
      root
    )

    if (!target.checked) {
      if (previouslyCheckedRadio === target) {
        groupMap.delete(name)
      }
      return
    }

    trackRadio(groupMap, name, target)
    if (
      previouslyCheckedRadio &&
      previouslyCheckedRadio !== target &&
      isInSameRadioGroup(previouslyCheckedRadio, target, root) &&
      !previouslyCheckedRadio.checked
    ) {
      cbWithDedup(previouslyCheckedRadio, { isChecked: false })
    }
  }

  function getTrackedRadio(groupMap, name, target, root) {
    var reference = groupMap.get(name)
    if (!reference) {
      return undefined
    }
    var radio = reference.weakRef
      ? reference.weakRef.deref()
      : reference.radio
    if (
      !radio ||
      !radio.isConnected ||
      !isInSameRadioGroup(radio, target, root)
    ) {
      groupMap.delete(name)
      return undefined
    }
    return radio
  }

  function trackRadio(groupMap, name, radio) {
    if (groupMap.has(name)) {
      groupMap.delete(name)
    }
    groupMap.set(
      name,
      typeof WeakRef === 'function'
        ? { weakRef: new WeakRef(radio) }
        : { radio: radio }
    )
    if (groupMap.size > MAX_TRACKED_RADIO_GROUPS) {
      groupMap.delete(groupMap.keys().next().value)
    }
  }

  function getRadioGroupMap(root, form) {
    var rootState = radioGroupStateByRoot.get(root)
    if (!rootState) {
      rootState = {
        groupsWithoutForm: new Map(),
        groupsByForm: new WeakMap()
      }
      radioGroupStateByRoot.set(root, rootState)
    }
    if (!form) {
      return rootState.groupsWithoutForm
    }
    var formGroups = rootState.groupsByForm.get(form)
    if (!formGroups) {
      formGroups = new Map()
      rootState.groupsByForm.set(form, formGroups)
    }
    return formGroups
  }

  function getRadioRoot(input) {
    if (typeof input.getRootNode === 'function') {
      var root = input.getRootNode()
      if (root) {
        return root
      }
    }
    return input.ownerDocument || document
  }

  function isInSameRadioGroup(candidate, target, root) {
    return (
      candidate.type === 'radio' &&
      candidate.name === target.name &&
      candidate.form === target.form &&
      getRadioRoot(candidate) === root
    )
  }

  /**
   * There can be multiple changes on the same node within the same batched mutation observation.
   */
  function cbWithDedup(target, inputState) {
    if (isNodeIgnored(target) || !hasSerializedNode(target)) {
      return false
    }
    var lastInputState = lastInputStateMap.get(target)
    if (
      !lastInputState ||
      lastInputState.text !== inputState.text ||
      lastInputState.isChecked !== inputState.isChecked
    ) {
      lastInputStateMap.set(target, inputState)
      cb(
        assign(
          {
            id: getSerializedNodeId(target)
          },
          inputState
        )
      )
    }
    return true
  }
}

export function initStyleSheetObserver(
  cb,
  configuration,
  isNodeIgnored
) {
  isNodeIgnored = isNodeIgnored || neverIgnoreNode
  function checkStyleSheetAndCallback(styleSheet, callback) {
    if (
      styleSheet &&
      !isNodeIgnored(styleSheet.ownerNode) &&
      hasSerializedNode(styleSheet.ownerNode)
    ) {
      callback(getSerializedNodeId(styleSheet.ownerNode))
    }
  }

  var instrumentationStoppers = [
    instrumentMethod(CSSStyleSheet.prototype, 'insertRule', function (params) {
      var styleSheet = params.target
      var parameters = params.parameters
      var rule = parameters[0]
      var index = parameters[1]
      checkStyleSheetAndCallback(styleSheet, function (id) {
        return cb({ id: id, adds: [{ rule: rule, index: index }] })
      })
    }),
    instrumentMethod(CSSStyleSheet.prototype, 'deleteRule', function (params) {
      var styleSheet = params.target
      var parameters = params.parameters
      var index = parameters[0]
      checkStyleSheetAndCallback(styleSheet, function (id) {
        return cb({ id: id, removes: [{ index: index }] })
      })
    })
  ]

  if (typeof CSSGroupingRule !== 'undefined') {
    instrumentGroupingCSSRuleClass(CSSGroupingRule)
  } else {
    instrumentGroupingCSSRuleClass(CSSMediaRule)
    instrumentGroupingCSSRuleClass(CSSSupportsRule)
  }

  function instrumentGroupingCSSRuleClass(cls) {
    instrumentationStoppers.push(
      instrumentMethod(cls.prototype, 'insertRule', function (params) {
        var styleSheet = params.target
        var parameters = params.parameters
        var rule = parameters[0]
        var index = parameters[1]
        checkStyleSheetAndCallback(styleSheet.parentStyleSheet, function (id) {
          var path = getPathToNestedCSSRule(styleSheet)
          if (path) {
            path.push(index || 0)
            cb({ id: id, adds: [{ rule: rule, index: path }] })
          }
        })
      }),
      instrumentMethod(cls.prototype, 'deleteRule', function (params) {
        var styleSheet = params.target
        var parameters = params.parameters
        var index = parameters[0]
        checkStyleSheetAndCallback(styleSheet.parentStyleSheet, function (id) {
          var path = getPathToNestedCSSRule(styleSheet)
          if (path) {
            path.push(index)
            cb({ id: id, removes: [{ index: path }] })
          }
        })
      })
    )
  }

  return function () {
    instrumentationStoppers.forEach(function (stopper) {
      stopper.stop()
    })
  }
}

function initMediaInteractionObserver(
  mediaInteractionCb,
  configuration,
  isNodeIgnored
) {
  isNodeIgnored = isNodeIgnored || neverIgnoreNode
  var handler = function (event) {
    var target = getEventTarget(event)
    if (
      !target ||
      isNodeIgnored(target) ||
      getNodePrivacyLevel(target, configuration.defaultPrivacyLevel) ===
        NodePrivacyLevel.HIDDEN ||
      !hasSerializedNode(target)
    ) {
      return
    }
    mediaInteractionCb({
      id: getSerializedNodeId(target),
      type:
        event.type === DOM_EVENT.PLAY
          ? MediaInteractionType.Play
          : MediaInteractionType.Pause
    })
  }
  return addEventListeners(
    document,
    [DOM_EVENT.PLAY, DOM_EVENT.PAUSE],
    handler,
    { capture: true, passive: true }
  ).stop
}

function initFocusObserver(focusCb, configuration) {
  return addEventListeners(
    window,
    [DOM_EVENT.FOCUS, DOM_EVENT.BLUR],
    function () {
      focusCb({ has_focus: document.hasFocus() })
    }
  ).stop
}

function initVisualViewportResizeObserver(cb, configuration) {
  if (!window.visualViewport) {
    return noop
  }
  var _updateDimension = throttle(
    function () {
      cb(getVisualViewport())
    },
    VISUAL_VIEWPORT_OBSERVER_THRESHOLD,
    {
      trailing: false
    }
  )
  var removeListener = addEventListeners(
    window.visualViewport,
    [DOM_EVENT.RESIZE, DOM_EVENT.SCROLL],
    _updateDimension.throttled,
    {
      capture: true,
      passive: true
    }
  ).stop
  var cancelThrottle = _updateDimension.cancel
  return function stop() {
    removeListener()
    cancelThrottle()
  }
}

export function initFrustrationObserver(
  lifeCycle,
  frustrationCb,
  configuration,
  isNodeIgnored
) {
  isNodeIgnored = isNodeIgnored || neverIgnoreNode
  return lifeCycle.subscribe(
    LifeCycleEventType.RAW_RUM_EVENT_COLLECTED,
    function (data) {
      if (
        data.rawRumEvent.type === RumEventType.ACTION &&
        data.rawRumEvent.action.type === ActionType.CLICK &&
        data.rawRumEvent.action.frustration &&
        data.rawRumEvent.action.frustration.type &&
        data.rawRumEvent.action.frustration.type.length &&
        'events' in data.domainContext &&
        data.domainContext.events &&
        data.domainContext.events.length
      ) {
        var replayEvents = data.domainContext.events.filter(function (event) {
          try {
            return !isNodeIgnored(getEventTarget(event))
          } catch (_) {
            return false
          }
        })
        if (!replayEvents.length) {
          return
        }
        frustrationCb({
          timestamp: data.rawRumEvent.date,
          type: RecordType.FrustrationRecord,
          data: {
            frustrationTypes: data.rawRumEvent.action.frustration.type,
            recordIds: replayEvents.map(function (e) {
              return getRecordIdForEvent(e)
            })
          }
        })
      }
    }
  ).unsubscribe
}

function getEventTarget(event) {
  if (event.composed === true && isNodeShadowHost(event.target)) {
    return event.composedPath()[0]
  }
  return event.target
}
