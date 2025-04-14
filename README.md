# Guance RUM SDK Quick Start Guide

## Overview

Guance RUM SDK (Real User Monitoring) provides a powerful set of tools for monitoring and analyzing the behavior and performance of real users in web applications. This quick start guide will help you integrate the RUM SDK into your web application quickly, distinguishing between DK method integration and public DataWay integration, and detailing how to add custom data TAGs.

## Prerequisites

- **Install DataKit**: Ensure that DataKit is installed and configured to be publicly accessible (for DK method integration) .
- **Configure RUM Collector**: Follow the Guance documentation to configure the RUM collector .

## Integration Methods

### 1. DK Method Integration

- Ensure that DataKit is installed and configured to be publicly accessible.
- Obtain parameters such as `applicationId`, `env`, `version` from the Guance console Create Application.
- When integrating the SDK, configure `datakitOrigin` with the domain name or IP of DataKit.

### 2. Public OpenWay Integration

- Log in to the Guance console, go to the **Synthetic Tests** page, click on **Create Application** in the top-left corner, and obtain parameters like `applicationId`, `clientToken`, and `site`. Create Application
- Configure `site` and `clientToken` parameters, supporting SourceMap uploads via the console.
- When integrating the SDK, there's no need to configure `datakitOrigin`; the SDK will send data to the public DataWay by default.

## SDK Integration

### NPM Integration

Install and import the SDK in your front-end project:

```bash
npm install @cloudcare/browser-rum
```

Initialize the SDK in your project:

```javascript
import { datafluxRum } from '@cloudcare/browser-rum'

datafluxRum.init({
  applicationId: 'Your Application ID',
  datakitOrigin: '<DataKit Domain Name or IP>', // Required for DK method integration
  clientToken: 'clientToken', // Required for public OpenWay integration
  site: 'Public OpenWay URL', // Required for public OpenWay integration
  env: 'production',
  version: '1.0.0',
  sessionSampleRate: 100,
  sessionReplaySampleRate: 70,
  trackUserInteractions: true
  // Other optional configurations...
})

// Enable session replay recording
datafluxRum.startSessionReplayRecording()
```

### Asynchronous CDN Loading

Add the script to your HTML file:

```html
<script>
  ;(function (h, o, u, n, d) {
    h = h[d] = h[d] || {
      q: [],
      onReady: function (c) {
        h.q.push(c)
      }
    }
    ;(d = o.createElement(u)), (d.async = 1), (d.src = n)
    n = o.getElementsByTagName(u)[0]
    n.parentNode.insertBefore(d, n)
  })(
    window,
    document,
    'script',
    'https://static.guance.com/browser-sdk/v3/dataflux-rum.js',
    'DATAFLUX_RUM'
  )

  window.DATAFLUX_RUM.onReady(function () {
    window.DATAFLUX_RUM.init({
      applicationId: 'Your Application ID',
      datakitOrigin: '<DataKit Domain Name or IP>', // Required for DK method integration
      clientToken: 'clientToken', // Required for public OpenWay integration
      site: 'Public OpenWay URL', // Required for public OpenWay integration
      env: 'production',
      version: '1.0.0',
      sessionSampleRate: 100,
      sessionReplaySampleRate: 70,
      trackUserInteractions: true
      // Other configurations...
    })
    // Enable session replay recording
    window.DATAFLUX_RUM.startSessionReplayRecording()
  })
</script>
```

### Synchronous CDN Loading

Add the script to your HTML file:

```html
<script
  src="https://static.guance.com/browser-sdk/v3/dataflux-rum.js"
  type="text/javascript"
></script>
<script>
  window.DATAFLUX_RUM &&
    window.DATAFLUX_RUM.init({
      applicationId: 'Your Application ID',
      datakitOrigin: '<DataKit Domain Name or IP>', // Required for DK method integration
      clientToken: 'clientToken', // Required for public OpenWay integration
      site: 'Public OpenWay URL', // Required for public OpenWay integration
      env: 'production',
      version: '1.0.0',
      sessionSampleRate: 100,
      sessionReplaySampleRate: 70,
      trackUserInteractions: true
      // Other configurations...
    })
  // Enable session replay recording
  window.DATAFLUX_RUM && window.DATAFLUX_RUM.startSessionReplayRecording()
</script>
```

## Custom Data TAG Addition

Use the `setGlobalContextProperty` or `setGlobalContext` API to add extra TAGs to all RUM events [Add custom tag](./docs/rum/custom-sdk/add-additional-tag.md).

### Example

```javascript
// Add a single TAG using setGlobalContextProperty
window.DATAFLUX_RUM &&
  window.DATAFLUX_RUM.setGlobalContextProperty('userName', 'John Doe')

// Add multiple TAGs using setGlobalContext
window.DATAFLUX_RUM &&
  window.DATAFLUX_RUM.setGlobalContext({
    userAge: 28,
    userGender: 'Male'
  })
```

With the above code, you can add `userName`, `userAge`, and `userGender` TAGs to all RUM events.

## Tracking User Actions

### Control Whether to Enable Action Collection

Control whether to collect user click actions through the `trackUserInteractions` initialization parameter.

### Customize Action Names

- Customize Action names by adding the `data-guance-action-name` attribute or `data-custom-name` (depending on the `actionNameAttribute` configuration) to clickable elements.

### Use `addAction` API to Customize Actions

```javascript
// Synchronous CDN loading
window.DATAFLUX_RUM &&
  window.DATAFLUX_RUM.addAction('cart', {
    amount: 42,
    nb_items: 2,
    items: ['socks', 't-shirt']
  })

// Asynchronous CDN loading
window.DATAFLUX_RUM.onReady(function () {
  window.DATAFLUX_RUM.addAction('cart', {
    amount: 42,
    nb_items: 2,
    items: ['socks', 't-shirt']
  })
})

// NPM
import { datafluxRum } from '@cloudcare/browser-rum'
datafluxRum &&
  datafluxRum.addAction('cart', {
    amount: 42,
    nb_items: 2,
    items: ['socks', 't-shirt']
  })
```

## Custom Error Addition

Use the `addError` API to add custom Error Metrics data [Add custom Error](./docs/rum/custom-sdk/add-error.md).

```javascript
// Synchronous CDN loading
const error = new Error('Something wrong occurred.')
window.DATAFLUX_RUM && DATAFLUX_RUM.addError(error, { pageStatus: 'beta' })

// Asynchronous CDN loading
window.DATAFLUX_RUM.onReady(function () {
  const error = new Error('Something wrong occurred.')
  window.DATAFLUX_RUM.addError(error, { pageStatus: 'beta' })
})

// NPM
import { datafluxRum } from '@cloudcare/browser-rum'
const error = new Error('Something wrong occurred.')
datafluxRum.addError(error, { pageStatus: 'beta' })
```

## Custom User Identification

Use the `setUser` API to add identification attributes (such as ID, name, email) for the current user [Add custom user information](./docs/rum/custom-sdk/user-id.md).

```javascript
// Synchronous CDN loading
window.DATAFLUX_RUM &&
  window.DATAFLUX_RUM.setUser({
    id: '1234',
    name: 'John Doe',
    email: 'john@doe.com'
  })

// Asynchronous CDN loading
window.DATAFLUX_RUM.onReady(function () {
  window.DATAFLUX_RUM.setUser({
    id: '1234',
    name: 'John Doe',
    email: 'john@doe.com'
  })
})

// NPM
import { datafluxRum } from '@cloudcare/browser-rum'
datafluxRum.setUser({ id: '1234', name: 'John Doe', email: 'john@doe.com' })
```

## Session Replay Configuration

### Ensure SDK Version Support

Ensure that the SDK version you are using supports session replay functionality (usually versions `> 3.0.0`).

### Enable Session Replay Recording

After initializing the SDK, call the `startSessionReplayRecording()` method to enable session replay recording. You can choose to enable it under specific conditions, such as after user login [Enable session recording](./docs/replay.md).

## Important Notes

- Session replay does not support playing elements like iframes, videos, audio, and canvases.
- Ensure static resources (such as fonts, images) remain accessible during replay, which may require setting up CORS policies.
- For CSS styles and mouse hover events, ensure CSS rules can be accessed via the CSSStyleSheet interface.

## Debugging and Optimization

- Use the logging and monitoring tools provided by the SDK to debug and optimize your application performance.
- Adjust parameters like `sessionSampleRate` and `sessionReplaySampleRate` based on business needs to optimize data collection.

By following these steps, you can successfully integrate the Guance RUM SDK into your web application and start collecting data and using session replay features to optimize user experience and performance.
