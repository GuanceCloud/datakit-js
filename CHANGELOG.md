# Changelog

## v3.3.1

- Fix replay mutation reparent handling and tracing ids
- fix: add test

## v3.3.0

- fix: add docs
- fix: update docs
- fix: update docs
- feat: add doc
- fix: add canvas record
- fix: add resource tracker
- fix: larget mutaion
- fix: add replay canvas
- fix: add canvas replay
- fix: add replay unit
- chore: update cls demo setup
- test: expand core and rum unit coverage
- fix: add md
- fix: add sourcemap demo

## v3.2.51

- feat: add monitorError
- fix: console error format

## v3.2.50

- fix: log handle sankbug

## v3.2.49

- fix: add mutaion try catch

## v3.2.48

- fix: update publishconfig
- fix: add author
- fix: style
- fix: style

## v3.2.47

- fix: add traceSmapled

## v3.2.46

- fix: style

## v3.2.45

- fix: getRemoteConfiguration pre bug

## v3.2.44

- fix: remove console
- fix: add bridge sendEvent error
- fix: add  prerenderingchange lis

## v3.2.43

- fix: remove getType

## v3.2.42

- fix: remove monitor
- fix: update getRemoteConfigration handler
- fix: add addResource method
- fix: display noop handler

## v3.2.41

- fix: add EventListener EventTarget bug

## v3.2.40

- fix: unsubscrbe
- fix: add takeSubsequentFullSnapshot method
- fix: update repository
- fix: add user agent
- feat: add session_is_forced
- feat: add requestHeaderContexts
- feat: add force session

## v3.2.39

- fix: encoder pendingdata bug
- fix: add demo
- fix: add timeZone

## v3.2.38

- fix: add demo
- fix: pendingData to string
- fix: add SessionPersistence import
- fix: remove monitor
- fix: update getId
- fix: add md

## v3.2.37

- fix: source action type
- fix: update duration
- fix: add addTypeAction method

## v3.2.36

- fix: update max queue bytes
- fix: add track history

## v3.2.35

- v3.2.34
- fix: deflate pendingData bug

## v3.2.34

- fix: deflate pendingData bug

## v3.2.33

- fix: add url hash path

## v3.2.32

- fix: add x-client-timestamp header

## v3.2.31

- fix: remove x-client-timestamp

## v3.2.30

- fix: add pendingData handler
- fix: add x-client-timestamp
- fix: updated changelog.md

## v3.2.29

- fix: removed console logs
- fix: added `sessionPersistence` config for store selection
- fix: added `view_update_time` to document version
- fix: corrected `xhr` to `fetch` transmission
- fix: added `allowedTracingOrigins` type
- fix: fixed session lock bug
- fix: added `.gitignore`
- fix: removed unicode translation logic

## v3.2.28

- fix: added translation logic
- fix: removed unicode translation logic

## v3.2.27

- fix: updated `trackFirstHidden` handler

## v3.2.26

- fix: ignored error source reports
- fix: fixed Zipkin trace bug

## v3.2.25

- fix: fixed `eventBridge` bug
- fix: initialized `pageStates` with `performanceEntry`

## v3.2.24

- fix: removed console logs
- fix: updated `eventBridge`
- fix: updated `listenerTarget`
- fix: fixed session store bug
- fix: added Safari Wasm stack trace parsing support
- fix: updated `getAllowedWebViewHosts`

## v3.2.23

- fix: `tracingSampleRate` default value bug (should be 100)

## v3.2.22

- fix: removed monitor console logs

## v3.2.21

- (no entries)

## v3.2.19

- fix: tracked `setErrorForSession`
- fix: handled `firstHidden` visibility change
- feat: added `shouldMaskNode` for custom session replay masking
- fix: added documentation
- fix: added `sessionOnErrorSampleRate` config
- fix: added `sampled_for_error_replay` field
- fix: added `replaysOnErrorSampleRate` for error session replay only

## v3.2.18

- fix: updated view name extraction method

## v3.2.17

- fix: fixed cookie access condition logic

## v3.2.16

- fix: removed `decodeURIComponent` logic

## v3.2.15

- fix: `matchRequestResourceEntry` length > 2
- feat: added view operation APIs

## v3.2.14

- fix: memory optimization in `getSelectorFromElement`

## v3.2.13

- fix: `hasRedirection` updated `redirectEnd`
- fix: timeout `flush` logic updated
- fix: added telemetry data reporting

## v3.2.12

- fix: fixed `entry` scope issue during resource collection

## v3.2.11

- fix: added `deliveryType`, `protocol` fields
- feat: updated `resource_url`, `resource_url_query` to field types

## v3.2.10

- fix: `statusGroup` bug

## v3.2.9

- feat: added `generateTraceId` config

## v3.2.8

- feat: added `retryMaxSize` config
- fix: removed console logs

## v3.2.7

- fix: `sessionSampleRate = 0` incorrectly defaulting to 100

## v3.2.6

- feat: added storage support
- feat: added `allowFallbackToLocalStorage` for cookie fallback

## v3.2.5

- fix: `deflate` bug

## v3.2.4

- feat: added delayed resource collection logic

## v3.2.3

- fix: updated Babel config
- fix: improved init config logic for logs and RUM
- fix: removed default `renderBlockingStatus` value

## v3.2.2

- fix: removed console logs
- fix: IE browser compatibility support
- fix: added Babel config for IE support

## v3.2.1

- fix: fixed cookie authorization issue

## v3.2.0

- feat: added `longAnimationFrameCollection`
- fix: CLS handler
- fix: error stack and message reporting
- feat: `compressData` handler
- fix: sendBeacon error handling
- fix: fetch handling improvements
- fix: resource ID, worker URL, and status management
- fix: internal config and import cleanup
- fix: updated documentation
