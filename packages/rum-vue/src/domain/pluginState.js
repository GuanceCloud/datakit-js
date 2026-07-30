var activeRum
var activeConfiguration
var activeAddError
var pendingInitCallbacks = []
var pendingStartCallbacks = []

export function initializeVuePlugin(configuration, context) {
  activeRum = getPublicApi(context)
  activeConfiguration = configuration
  activeAddError = context.addError || activeAddError

  drainCallbacks(pendingInitCallbacks, function (callback) {
    callback(activeConfiguration, activeRum)
  })
  drainPendingErrors()
}

export function startVuePlugin(context) {
  activeRum = getPublicApi(context) || activeRum
  activeAddError = context.addError || activeAddError
  drainPendingErrors()
}

export function onRumInit(callback) {
  if (activeRum && activeConfiguration) {
    callback(activeConfiguration, activeRum)
  } else {
    pendingInitCallbacks.push(callback)
  }
}

export function onRumStart(callback) {
  if (activeAddError) {
    callback(activeAddError)
  } else {
    pendingStartCallbacks.push(callback)
  }
}

export function resetVuePlugin() {
  activeRum = undefined
  activeConfiguration = undefined
  activeAddError = undefined
  pendingInitCallbacks.length = 0
  pendingStartCallbacks.length = 0
}

function drainPendingErrors() {
  if (activeAddError) {
    drainCallbacks(pendingStartCallbacks, function (callback) {
      callback(activeAddError)
    })
  }
}

function drainCallbacks(callbacks, invoke) {
  var pending = callbacks.splice(0, callbacks.length)
  for (var i = 0; i < pending.length; i += 1) {
    invoke(pending[i])
  }
}

function getPublicApi(context) {
  return context && (context.publicApi || context.rum)
}
