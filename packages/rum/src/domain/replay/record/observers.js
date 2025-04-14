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
  cssEscape,
  getScrollX,
  getScrollY
} from '@cloudcare/browser-core'
import { initViewportObservable } from '../../initViewportObservable'
import { NodePrivacyLevel } from '../../../constants'

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
  forEach,
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

var recordIds = new WeakMap()
let nextId = 1

export function getRecordIdForEvent(event) {
  if (!recordIds.has(event)) {
    recordIds.set(event, nextId++)
  }
  return recordIds.get(event)
}
export function initObservers(o) {
  var mutationHandler = initMutationObserver(
    o.mutationCb,
    o.configuration,
    o.shadowRootsController
  )
  var mousemoveHandler = initMoveObserver(o.mousemoveCb, o.configuration)
  var mouseInteractionHandler = initMouseInteractionObserver(
    o.mouseInteractionCb,
    o.configuration
  )
  var scrollHandler = initScrollObserver(
    o.scrollCb,
    o.configuration,
    o.elementsScrollPositions
  )
  var viewportResizeHandler = initViewportResizeObserver(
    o.viewportResizeCb,
    o.configuration
  )
  var inputHandler = initInputObserver(o.inputCb, o.configuration)
  var mediaInteractionHandler = initMediaInteractionObserver(
    o.mediaInteractionCb,
    o.configuration
  )
  var styleSheetObserver = initStyleSheetObserver(
    o.styleSheetCb,
    o.configuration
  )
  var focusHandler = initFocusObserver(o.focusCb, o.configuration)
  var visualViewportResizeHandler = initVisualViewportResizeObserver(
    o.visualViewportResizeCb,
    o.configuration
  )
  var frustrationHandler = initFrustrationObserver(
    o.lifeCycle,
    o.frustrationCb,
    o.configuration
  )

  return {
    flush: function () {
      mutationHandler.flush()
    },
    stop: function () {
      mutationHandler.stop()
      mousemoveHandler()
      mouseInteractionHandler()
      scrollHandler()
      viewportResizeHandler()
      inputHandler()
      mediaInteractionHandler()
      styleSheetObserver()
      focusHandler()
      visualViewportResizeHandler()
      frustrationHandler()
    }
  }
}

export function initMutationObserver(cb, configuration, shadowRootsController) {
  return startMutationObserver(
    cb,
    configuration,
    shadowRootsController,
    document
  )
}

export function initMoveObserver(cb, configuration) {
  var _updatePosition = throttle(
    function (event) {
      var target = getEventTarget(event)
      if (hasSerializedNode(target)) {
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

var eventTypeToMouseInteraction = {
  // Listen for pointerup DOM events instead of mouseup for MouseInteraction/MouseUp records. This
  // allows to reference such records from Frustration records.
  //
  // In the context of supporting Mobile Session Replay, we introduced `PointerInteraction` records
  // used by the Mobile SDKs in place of `MouseInteraction`. In the future, we should replace
  // `MouseInteraction` by `PointerInteraction` in the Browser SDK so we have an uniform way to
  // convey such interaction. This would cleanly solve the issue since we would have
  // `PointerInteraction/Up` records that we could reference from `Frustration` records.
  [DOM_EVENT.POINTER_UP]: MouseInteractionType.MouseUp,

  [DOM_EVENT.MOUSE_DOWN]: MouseInteractionType.MouseDown,
  [DOM_EVENT.CLICK]: MouseInteractionType.Click,
  [DOM_EVENT.CONTEXT_MENU]: MouseInteractionType.ContextMenu,
  [DOM_EVENT.DBL_CLICK]: MouseInteractionType.DblClick,
  [DOM_EVENT.FOCUS]: MouseInteractionType.Focus,
  [DOM_EVENT.BLUR]: MouseInteractionType.Blur,
  [DOM_EVENT.TOUCH_START]: MouseInteractionType.TouchStart,
  [DOM_EVENT.TOUCH_END]: MouseInteractionType.TouchEnd
}
export function initMouseInteractionObserver(cb, configuration) {
  var handler = function (event) {
    var target = getEventTarget(event)
    if (
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

function initScrollObserver(cb, configuration, elementsScrollPositions) {
  var _updatePosition = throttle(function (event) {
    var target = getEventTarget(event)
    if (
      !target ||
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

export function initInputObserver(cb, configuration, target) {
  if (target === undefined) {
    target = document
  }
  var lastInputStateMap = new WeakMap()
  var isShadowRoot = target !== document

  var _addEventListeners = addEventListeners(
    target,
    // The 'input' event bubbles across shadow roots, so we don't have to listen for it on shadow
    // roots since it will be handled by the event listener that we did add to the document. Only
    // the 'change' event is blocked and needs to be handled on shadow roots.
    isShadowRoot ? [DOM_EVENT.CHANGE] : [DOM_EVENT.INPUT, DOM_EVENT.CHANGE],
    function (event) {
      var target = getEventTarget(event)
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
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
    cbWithDedup(target, inputState)

    // If a radio was checked, other radios with the same name attribute will be unchecked.
    var name = target.name
    if (type === 'radio' && name && target.checked) {
      forEach(
        document.querySelectorAll(
          'input[type="radio"][name="' + cssEscape(name) + '"]'
        ),
        function (el) {
          if (el !== target) {
            cbWithDedup(el, { isChecked: false })
          }
        }
      )
    }
  }

  /**
   * There can be multiple changes on the same node within the same batched mutation observation.
   */
  function cbWithDedup(target, inputState) {
    if (!hasSerializedNode(target)) {
      return
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
  }
}

export function initStyleSheetObserver(cb, configuration) {
  function checkStyleSheetAndCallback(styleSheet, callback) {
    if (styleSheet && hasSerializedNode(styleSheet.ownerNode)) {
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

function initMediaInteractionObserver(mediaInteractionCb, configuration) {
  var handler = function (event) {
    var target = getEventTarget(event)
    if (
      !target ||
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
  configuration
) {
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
        frustrationCb({
          timestamp: data.rawRumEvent.date,
          type: RecordType.FrustrationRecord,
          data: {
            frustrationTypes: data.rawRumEvent.action.frustration.type,
            recordIds: data.domainContext.events.map(function (e) {
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
