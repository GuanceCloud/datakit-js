export function createFrameworkDemo(framework) {
  var maxRecordedRequests = 5
  var state = {
    framework: framework,
    ready: false,
    completed: false,
    passed: false,
    viewNames: [],
    errors: [],
    frameworkErrors: [],
    requests: []
  }
  window.__frameworkDemo = state

  installRequestObserver(recordRequest)

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

  function beforeSend(event) {
    if (event.type === 'view') {
      var viewName = event.view && event.view.name
      if (viewName && state.viewNames.indexOf(viewName) === -1) {
        state.viewNames.push(viewName)
      }
    }
    if (event.type === 'error') {
      var errorMessage =
        (event.error && event.error.message) || 'Unknown framework error'
      state.errors.push(errorMessage)
      if (
        event.error &&
        event.error.source === 'custom' &&
        event.context &&
        event.context.framework === framework
      ) {
        state.frameworkErrors.push(errorMessage)
      }
    }
    refresh()
    return true
  }

  function markReady() {
    state.ready = true
    refresh()
  }

  function recordSetupError(error) {
    state.errors.push(error && error.message ? error.message : String(error))
    refresh()
  }

  function refresh() {
    state.passed =
      state.ready &&
      state.viewNames.length >= 2 &&
      state.frameworkErrors.length >= 1 &&
      state.requests.length >= 1
    state.completed = state.passed
    renderState(state)
    window.dispatchEvent(new CustomEvent('framework-demo:update'))
  }

  refresh()
  return { state: state, beforeSend: beforeSend, markReady: markReady, recordSetupError: recordSetupError }
}

export function createRumConfiguration(framework, plugin, demo) {
  return {
    applicationId: 'framework-demo-' + framework,
    datakitOrigin: window.location.origin,
    service: 'framework-demo-' + framework,
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

function renderState(state) {
  var badge = document.getElementById('demo-result')
  var viewCount = document.getElementById('demo-view-count')
  var errorCount = document.getElementById('demo-error-count')
  var requestCount = document.getElementById('demo-request-count')
  var log = document.getElementById('demo-log')
  if (!badge || !viewCount || !errorCount || !requestCount || !log) {
    return
  }

  badge.textContent = state.passed ? 'Passed' : state.ready ? 'Running' : 'Starting'
  badge.setAttribute('data-state', state.passed ? 'passed' : 'running')
  viewCount.textContent = String(state.viewNames.length)
  errorCount.textContent = String(state.errors.length)
  requestCount.textContent = String(state.requests.length)
  log.textContent = JSON.stringify(state, null, 2)
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
