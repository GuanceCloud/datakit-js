# Changelog

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
