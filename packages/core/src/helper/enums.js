export var DOM_EVENT = {
  BEFORE_UNLOAD: 'beforeunload',
  CLICK: 'click',
  DBL_CLICK: 'dblclick',
  KEY_DOWN: 'keydown',
  LOAD: 'load',
  POP_STATE: 'popstate',
  SCROLL: 'scroll',
  TOUCH_START: 'touchstart',
  TOUCH_END: 'touchend',
  TOUCH_MOVE: 'touchmove',
  VISIBILITY_CHANGE: 'visibilitychange',
  PRERENDERING_CHANGE: 'prerenderingchange',
  PAGE_SHOW: 'pageshow',
  FREEZE: 'freeze',
  RESUME: 'resume',
  DOM_CONTENT_LOADED: 'DOMContentLoaded',
  POINTER_DOWN: 'pointerdown',
  POINTER_UP: 'pointerup',
  POINTER_CANCEL: 'pointercancel',
  HASH_CHANGE: 'hashchange',
  PAGE_HIDE: 'pagehide',
  MOUSE_DOWN: 'mousedown',
  MOUSE_UP: 'mouseup',
  MOUSE_MOVE: 'mousemove',
  FOCUS: 'focus',
  BLUR: 'blur',
  CONTEXT_MENU: 'contextmenu',
  RESIZE: 'resize',
  CHANGE: 'change',
  INPUT: 'input',
  PLAY: 'play',
  PAUSE: 'pause',
  SECURITY_POLICY_VIOLATION: 'securitypolicyviolation',
  SELECTION_CHANGE: 'selectionchange',
  STORAGE: 'storage'
}
export var ResourceType = {
  DOCUMENT: 'document',
  XHR: 'xhr',
  BEACON: 'beacon',
  FETCH: 'fetch',
  CSS: 'css',
  JS: 'js',
  IMAGE: 'image',
  FONT: 'font',
  MEDIA: 'media',
  OTHER: 'other',
  CUSTOM: 'custom'
}

export var ActionType = {
  CLICK: 'click',
  CUSTOM: 'custom'
}
export var FrustrationType = {
  RAGE_CLICK: 'rage_click',
  ERROR_CLICK: 'error_click',
  DEAD_CLICK: 'dead_click'
}
export var RumEventType = {
  ACTION: 'action',
  ERROR: 'error',
  LONG_TASK: 'long_task',
  VIEW: 'view',
  RESOURCE: 'resource',
  LOGGER: 'logger'
}
export var RumLongTaskEntryType = {
  LONG_TASK: 'long-task',
  LONG_ANIMATION_FRAME: 'long-animation-frame'
}
export var ViewLoadingType = {
  INITIAL_LOAD: 'initial_load',
  ROUTE_CHANGE: 'route_change'
}
export var RequestType = {
  FETCH: ResourceType.FETCH,
  XHR: ResourceType.XHR
}

export var TraceType = {
  DDTRACE: 'ddtrace',
  ZIPKIN_MULTI_HEADER: 'zipkin',
  ZIPKIN_SINGLE_HEADER: 'zipkin_single_header',
  W3C_TRACEPARENT: 'w3c_traceparent',
  W3C_TRACEPARENT_64: 'w3c_traceparent_64bit',
  SKYWALKING_V3: 'skywalking_v3',
  JAEGER: 'jaeger'
}
export var ErrorHandling = {
  HANDLED: 'handled',
  UNHANDLED: 'unhandled'
}
export var NonErrorPrefix = {
  UNCAUGHT: 'Uncaught',
  PROVIDED: 'Provided'
}
