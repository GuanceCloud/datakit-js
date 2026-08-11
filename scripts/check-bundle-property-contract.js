const fs = require('fs')
const path = require('path')

// These keys are exposed to customer beforeSend callbacks through the second
// domainContext argument.  Unlike SDK-private coordination objects, they must
// keep their source names in minified production bundles.
const PUBLIC_DOMAIN_CONTEXT_KEYS = {
  rum: [
    'error',
    'event',
    'events',
    'handlingStack',
    'isAborted',
    'isWebSocket',
    'location',
    'performanceEntry',
    'requestHeaderContexts',
    'requestInit',
    'requestInput',
    'resource',
    'resourceTrackerId',
    'response',
    'webSocket',
    'xhr'
  ],
  logs: ['handlingStack', 'isAborted']
}

// These method names belong to the native FTWebViewJavascriptBridge contract.
// They are looked up on a host object that is not produced by this bundle, so
// production property mangling must never rename them.
const EXTERNAL_WEBVIEW_BRIDGE_METHOD_KEYS = [
  'getAllowedWebViewHosts',
  'getCapabilities',
  'getPrivacyLevel',
  'sendEvent'
]

// These callbacks are read directly from customer init configuration.
const PUBLIC_INIT_CALLBACK_KEYS = ['generateTraceId', 'injectTraceHeader']

// A plugin passes this object into context.addError().  Its keys are read from
// an independently built customer/plugin bundle, so they must remain stable in
// the minified RUM host just like init callbacks and beforeSend contexts.
const PUBLIC_PLUGIN_ERROR_KEYS = [
  'handlingStack',
  'startClocks',
  'relative',
  'timeStamp'
]

const PUBLIC_RESOURCE_TRACKER_KEYS = [
  'trackerId',
  'status',
  'context',
  'resource',
  'rawRumEvent'
]

const LOGS_PUBLIC_API_KEYS = [
  'clearGlobalContext',
  'clearUser',
  'createLogger',
  'getGlobalContext',
  'getInitConfiguration',
  'getInternalContext',
  'getLogger',
  'getUser',
  'init',
  'logger',
  'onReady',
  'removeGlobalContextProperty',
  'removeUserProperty',
  'setGlobalContext',
  'setGlobalContextProperty',
  'setUser',
  'setUserProperty'
]

const bundlePath = process.argv[2] && path.resolve(process.argv[2])
const profileName = process.argv[3]
const expectedKeys = PUBLIC_DOMAIN_CONTEXT_KEYS[profileName]

if (!bundlePath || !profileName) {
  fail(
    'Usage: node scripts/check-bundle-property-contract.js <bundle> <rum|logs>'
  )
}
if (!expectedKeys) {
  fail(`Unknown bundle property-contract profile: ${profileName}`)
}
if (!fs.existsSync(bundlePath)) {
  fail(`Bundle not found: ${bundlePath}`)
}

const bundleSource = fs.readFileSync(bundlePath, 'utf8')
const missingKeys = expectedKeys.filter(
  (key) => !hasObjectProperty(bundleSource, key)
)

if (missingKeys.length) {
  fail(
    `Production bundle mangled or removed public beforeSend domainContext properties: ${missingKeys.join(
      ', '
    )}`
  )
}

const missingExternalMethodKeys =
  profileName === 'rum'
    ? EXTERNAL_WEBVIEW_BRIDGE_METHOD_KEYS.filter(
        (key) => !hasMemberProperty(bundleSource, key)
      )
    : []
const missingInitCallbackKeys =
  profileName === 'rum'
    ? PUBLIC_INIT_CALLBACK_KEYS.filter(
        (key) => !hasMemberProperty(bundleSource, key)
      )
    : []
const missingPluginErrorKeys =
  profileName === 'rum'
    ? PUBLIC_PLUGIN_ERROR_KEYS.filter(
        (key) => !hasMemberProperty(bundleSource, key)
      )
    : []
const missingResourceTrackerKeys =
  profileName === 'rum'
    ? PUBLIC_RESOURCE_TRACKER_KEYS.filter(
        (key) => !hasObjectProperty(bundleSource, key)
      )
    : []
if (
  missingExternalMethodKeys.length ||
  missingInitCallbackKeys.length ||
  missingPluginErrorKeys.length ||
  missingResourceTrackerKeys.length
) {
  fail(
    [
      missingExternalMethodKeys.length
        ? `external FTWebViewJavascriptBridge methods: ${missingExternalMethodKeys.join(', ')}`
        : '',
      missingInitCallbackKeys.length
        ? `public init callbacks: ${missingInitCallbackKeys.join(', ')}`
        : '',
      missingPluginErrorKeys.length
        ? `public plugin error input: ${missingPluginErrorKeys.join(', ')}`
        : '',
      missingResourceTrackerKeys.length
        ? `public resource tracker snapshot: ${missingResourceTrackerKeys.join(', ')}`
        : ''
    ]
      .filter(Boolean)
      .join('; ')
  )
}

if (profileName === 'logs') {
  inspectLogsPublicApi(bundlePath)
}

console.log(
  `${profileName} beforeSend domainContext contract: ${expectedKeys.length} properties preserved`
)

function hasObjectProperty(source, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `(?:^|[,{])(?:["']?)${escapedKey}(?:["']?)\\s*:`,
    'm'
  ).test(source)
}

function hasMemberProperty(source, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `(?:\\.${escapedKey}\\b|\\[["']${escapedKey}["']\\])`,
    'm'
  ).test(source)
}

function inspectLogsPublicApi(bundlePath) {
  const previousLogs = globalThis.DATAFLUX_LOGS
  const hadLogs = Object.prototype.hasOwnProperty.call(
    globalThis,
    'DATAFLUX_LOGS'
  )

  try {
    delete globalThis.DATAFLUX_LOGS
    delete require.cache[require.resolve(bundlePath)]
    require(bundlePath)

    const publicApi = globalThis.DATAFLUX_LOGS
    if (!publicApi || typeof publicApi !== 'object') {
      fail('Logs public API contract: DATAFLUX_LOGS global was not created')
    }
    const actualKeys = Object.keys(publicApi).sort()
    const expectedKeys = LOGS_PUBLIC_API_KEYS.slice().sort()
    const missingApiKeys = expectedKeys.filter(
      (key) => !actualKeys.includes(key)
    )
    const unexpectedApiKeys = actualKeys.filter(
      (key) => !expectedKeys.includes(key)
    )
    const nonFunctionKeys = expectedKeys.filter(
      (key) => key !== 'logger' && typeof publicApi[key] !== 'function'
    )
    if (
      missingApiKeys.length ||
      unexpectedApiKeys.length ||
      nonFunctionKeys.length ||
      !publicApi.logger ||
      typeof publicApi.logger !== 'object' ||
      typeof publicApi._setDebug !== 'function'
    ) {
      fail(
        [
          missingApiKeys.length
            ? `missing methods: ${missingApiKeys.join(', ')}`
            : '',
          unexpectedApiKeys.length
            ? `unexpected methods: ${unexpectedApiKeys.join(', ')}`
            : '',
          nonFunctionKeys.length
            ? `non-function methods: ${nonFunctionKeys.join(', ')}`
            : '',
          !publicApi.logger || typeof publicApi.logger !== 'object'
            ? 'logger object is missing'
            : '',
          typeof publicApi._setDebug !== 'function'
            ? 'hidden _setDebug method is missing'
            : ''
        ]
          .filter(Boolean)
          .join('; ')
      )
    }
    console.log(
      `logs public API contract: ${actualKeys.length} members preserved`
    )
  } finally {
    if (hadLogs) {
      globalThis.DATAFLUX_LOGS = previousLogs
    } else {
      delete globalThis.DATAFLUX_LOGS
    }
  }
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
