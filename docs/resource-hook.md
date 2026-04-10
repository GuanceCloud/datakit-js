# Resource Hook Guide

## Overview

Resource Hook provides a request-scoped way to attach business context to auto-collected `resource` events.

Use it when:

- You need to write context before the request starts
- You need to append context after the response arrives
- You want the final `resource` event to contain both parts

It works for both `fetch` and `XMLHttpRequest`.

## How It Works

1. Create a tracker id with `createResourceTrackerId()`
2. Add the tracker id to the request header `x-rum-resource-id`
3. Write request context with `setResourceContext()`
4. Append response context with `appendResourceContext()`
5. Call `finishResource()` to flush the tracked resource event

If the request does not carry `x-rum-resource-id`, the SDK keeps the normal resource collection path unchanged.

## Public API

```javascript
const resourceId = DATAFLUX_RUM.createResourceTrackerId()

DATAFLUX_RUM.setResourceContext(resourceId, { order_id: '123' })
DATAFLUX_RUM.appendResourceContext(resourceId, { result: 'success' })
DATAFLUX_RUM.finishResource(resourceId)
DATAFLUX_RUM.getResource(resourceId)
```

API behavior:

- `createResourceTrackerId()`
  Creates a new tracker id.
- `setResourceContext(resourceId, context)`
  Replaces the current tracker context.
- `appendResourceContext(resourceId, context)`
  Merges more fields into the tracker context.
- `finishResource(resourceId)`
  Flushes the tracked resource event if the request has already completed.
- `getResource(resourceId)`
  Returns the current tracker snapshot for debugging.

## Fetch Example

```javascript
const resourceId = window.DATAFLUX_RUM.createResourceTrackerId()

window.DATAFLUX_RUM.setResourceContext(resourceId, {
  order_id: '123',
  scene: 'checkout'
})

fetch('/api/order/detail', {
  headers: {
    'x-rum-resource-id': resourceId
  }
})
  .then((response) => {
    window.DATAFLUX_RUM.appendResourceContext(resourceId, {
      result: 'success',
      response_status: response.status
    })
    window.DATAFLUX_RUM.finishResource(resourceId)
    return response
  })
  .catch((error) => {
    window.DATAFLUX_RUM.appendResourceContext(resourceId, {
      result: 'error',
      error_message: error.message
    })
    window.DATAFLUX_RUM.finishResource(resourceId)
    throw error
  })
```

## XHR Example

```javascript
const resourceId = window.DATAFLUX_RUM.createResourceTrackerId()

window.DATAFLUX_RUM.setResourceContext(resourceId, {
  order_id: '123',
  scene: 'checkout'
})

const xhr = new XMLHttpRequest()
xhr.open('GET', '/api/order/detail', true)
xhr.setRequestHeader('x-rum-resource-id', resourceId)

xhr.addEventListener('load', () => {
  window.DATAFLUX_RUM.appendResourceContext(resourceId, {
    result: 'success',
    response_status: xhr.status
  })
  window.DATAFLUX_RUM.finishResource(resourceId)
})

xhr.addEventListener('error', () => {
  window.DATAFLUX_RUM.appendResourceContext(resourceId, {
    result: 'error',
    error_message: 'xhr_error'
  })
  window.DATAFLUX_RUM.finishResource(resourceId)
})

xhr.send()
```

## Trace Example

If you also want trace ids on the same request, keep the resource tracker header and make sure the request origin is included in tracing configuration.

```javascript
window.DATAFLUX_RUM.init({
  // ...
  traceType: 'ddtrace',
  allowedDDTracingOrigins: [window.location.origin]
})
```

Then send the tracked request as usual:

```javascript
const resourceId = window.DATAFLUX_RUM.createResourceTrackerId()

window.DATAFLUX_RUM.setResourceContext(resourceId, {
  scene: 'checkout'
})

fetch('/api/order/detail', {
  headers: {
    'x-rum-resource-id': resourceId
  }
})
  .then((response) => {
    window.DATAFLUX_RUM.appendResourceContext(resourceId, {
      trace_expected: 'true',
      response_status: response.status
    })
    window.DATAFLUX_RUM.finishResource(resourceId)
    return response
  })
```

The final tracked snapshot can contain trace fields in `rawRumEvent._gc`.

## Debugging

You can inspect the current tracker state at any time:

```javascript
const snapshot = window.DATAFLUX_RUM.getResource(resourceId)
console.log(snapshot)
```

Typical snapshot shape:

```javascript
{
  trackerId: 'uuid',
  status: 'request_collected',
  context: {
    order_id: '123',
    result: 'success'
  },
  resource: {
    type: 'fetch',
    url: '/api/order/detail',
    method: 'GET',
    status: 200
  },
  rawRumEvent: {
    type: 'resource',
    _gc: {
      traceId: '...',
      spanId: '...'
    }
  }
}
```

Tracker statuses:

- `created`
- `request_collected`
- `finished`
- `flushed`
- `timeout_flushed`
- `cleared`

## Timeout Behavior

If `finishResource()` is never called, the SDK automatically flushes the tracked resource after `30s`.

This prevents tracked requests from staying pending forever.

## Notes

- This feature requires the business request to allow the custom header `x-rum-resource-id`.
- If the header is missing, the request follows the normal auto-collected resource path.
- If the tracker id does not exist, the request also falls back to the normal resource path.
- `getResource()` is intended for debugging and inspection.
