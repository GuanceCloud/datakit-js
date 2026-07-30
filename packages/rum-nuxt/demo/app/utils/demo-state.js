export function createDemoState() {
  if (window.__frameworkDemoController) {
    return window.__frameworkDemoController
  }

  var state = (window.__frameworkDemo = {
    framework: 'nuxt',
    ready: false,
    completed: false,
    passed: false,
    viewNames: [],
    errors: [],
    frameworkErrors: [],
    requests: []
  })
  var maxRecordedRequests = 5

  function refresh() {
    state.passed =
      state.ready &&
      state.viewNames.length >= 2 &&
      state.frameworkErrors.length >= 1 &&
      state.requests.length >= 1
    state.completed = state.passed
    window.dispatchEvent(new CustomEvent('framework-demo:update'))
  }

  function recordRequest(url, transport, body) {
    if (
      String(url || '').indexOf('/v1/write/rum') === -1 ||
      state.requests.length >= maxRecordedRequests
    ) {
      return
    }
    state.requests.push({
      transport: transport,
      url: String(url),
      bodyType: body && body.constructor ? body.constructor.name : typeof body
    })
    refresh()
  }

  installRequestObserver(recordRequest)

  var controller = {
    state: state,
    beforeSend: function (event) {
      if (event.type === 'view') {
        var name = event.view && event.view.name
        if (name && state.viewNames.indexOf(name) === -1) {
          state.viewNames.push(name)
        }
      }
      if (event.type === 'error') {
        var errorMessage =
          (event.error && event.error.message) || 'Unknown Nuxt error'
        state.errors.push(errorMessage)
        if (
          event.error &&
          event.error.source === 'custom' &&
          event.context &&
          event.context.framework === 'nuxt'
        ) {
          state.frameworkErrors.push(errorMessage)
        }
      }
      refresh()
      return true
    },
    markReady: function () {
      state.ready = true
      refresh()
    },
    recordSetupError: function (error) {
      state.errors.push(error && error.message ? error.message : String(error))
      refresh()
    }
  }
  window.__frameworkDemoController = controller
  refresh()
  return controller
}

export function createRumConfiguration(plugin, demo) {
  return {
    applicationId: 'framework-demo-nuxt',
    datakitOrigin: window.location.origin,
    service: 'framework-demo-nuxt',
    env: 'demo',
    version: '1.0.0',
    sessionSampleRate: 100,
    sessionReplaySampleRate: 0,
    sessionReplayOnErrorSampleRate: 0,
    compressIntakeRequests: false,
    sendContentTypeByJson: true,
    allowFallbackToLocalStorage: true,
    trackUserInteractions: true,
    plugins: [plugin],
    beforeSend: demo.beforeSend
  }
}

function installRequestObserver(recordRequest) {
  if (window.fetch) {
    var originalFetch = window.fetch
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : input && input.url
      recordRequest(url, 'fetch', init && init.body)
      return originalFetch.apply(this, arguments)
    }
  }

  var originalOpen = window.XMLHttpRequest.prototype.open
  var originalSend = window.XMLHttpRequest.prototype.send
  window.XMLHttpRequest.prototype.open = function (method, url) {
    this.__frameworkDemoUrl = url
    return originalOpen.apply(this, arguments)
  }
  window.XMLHttpRequest.prototype.send = function (body) {
    recordRequest(this.__frameworkDemoUrl, 'xhr', body)
    return originalSend.apply(this, arguments)
  }

  if (navigator.sendBeacon) {
    var originalSendBeacon = navigator.sendBeacon.bind(navigator)
    navigator.sendBeacon = function (url, body) {
      recordRequest(url, 'sendBeacon', body)
      return originalSendBeacon(url, body)
    }
  }
}
