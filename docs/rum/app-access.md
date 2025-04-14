# Web Application Integration

---

Guance application monitoring can collect metrics data from various web applications and analyze the performance of each web application endpoint in a visual manner.

## Prerequisites

**Note**: If you have enabled the RUM Headless service, the prerequisites have been automatically configured for you, and you can directly integrate the application.

- Install DataKit
- Configure the RUM Collector
- Ensure DataKit is accessible over the public network and has the IP geolocation database installed

## Application Integration {#access}

Log in to the Guance console, go to the **Synthetic Tests** page, click on the top-left corner **Create Application** to start creating a new application.

- Guance provides **Public DataWay** to directly receive RUM data without installing the DataKit collector. Configuring `site` and `clientToken` parameters is sufficient. It supports uploading SourceMap directly from the console, allowing multiple files to be uploaded based on different versions and environments.

- Guance also supports receiving RUM data via **local environment deployment**, which requires meeting the prerequisites.

Web application integration can be done in three ways: NPM integration, asynchronous loading, and synchronous loading.

| Integration Method | Description                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NPM                | By bundling the SDK code into the frontend project, this method ensures no impact on the frontend page performance but may miss requests and errors before SDK initialization.                      |
| CDN Asynchronous   | Through CDN caching and asynchronous script introduction, it ensures that the SDK script download does not affect page load performance but may miss requests and errors before SDK initialization. |
| CDN Synchronous    | Through CDN caching and synchronous script introduction, it ensures capturing all errors, resources, requests, and performance metrics. However, it may impact page load performance.               |

=== "NPM"

    ```javascript
    import { datafluxRum } from '@cloudcare/browser-rum'

    datafluxRum.init({
      applicationId: 'guance',
      datakitOrigin: '<DataKit domain or IP>', // Required for DK integration
      clientToken: 'clientToken', // Required for public OpenWay integration
      site: 'public OpenWay address', // Required for public OpenWay integration
      env: 'production',
      version: '1.0.0',
      sessionSampleRate: 100,
      sessionReplaySampleRate: 70,
      trackInteractions: true,
      traceType: 'ddtrace', // Optional, default is ddtrace. Currently supports ddtrace, zipkin, skywalking_v3, jaeger, zipkin_single_header, w3c_traceparent
      allowedTracingOrigins: ['https://api.example.com', /https:\/\/.*\.my-api-domain\.com/],  // Optional, list of origins or regex patterns allowed to inject tracing headers
    })
    ```

=== "CDN Asynchronous Loading"

    ```javascript
    <script>
     (function (h, o, u, n, d) {
        h = h[d] = h[d] || {
          q: [],
          onReady: function (c) {
            h.q.push(c)
          }
        }
        d = o.createElement(u)
        d.async = 1
        d.src = n
        n = o.getElementsByTagName(u)[0]
        n.parentNode.insertBefore(d, n)
      })(
        window,
        document,
        'script',
        'https://static.guance.com/browser-sdk/v3/dataflux-rum.js',
        'DATAFLUX_RUM'
      )
      DATAFLUX_RUM.onReady(function () {
        DATAFLUX_RUM.init({
          applicationId: 'guance',
          datakitOrigin: '<DataKit domain or IP>', // Required for DK integration
          clientToken: 'clientToken', // Required for public OpenWay integration
          site: 'public OpenWay address', // Required for public OpenWay integration
          env: 'production',
          version: '1.0.0',
          sessionSampleRate: 100,
          sessionReplaySampleRate: 70,
          trackInteractions: true,
          traceType: 'ddtrace', // Optional, default is ddtrace. Currently supports ddtrace, zipkin, skywalking_v3, jaeger, zipkin_single_header, w3c_traceparent
          allowedTracingOrigins: ['https://api.example.com', /https:\/\/.*\.my-api-domain\.com/],  // Optional, list of origins or regex patterns allowed to inject tracing headers
        })
      })
    </script>
    ```

=== "CDN Synchronous Loading"

    ```javascript
    <script src="https://static.guance.com/browser-sdk/v3/dataflux-rum.js" type="text/javascript"></script>
    <script>
      window.DATAFLUX_RUM &&
        window.DATAFLUX_RUM.init({
          applicationId: 'guance',
          datakitOrigin: '<DataKit domain or IP>', // Required for DK integration
          clientToken: 'clientToken', // Required for public OpenWay integration
          site: 'public OpenWay address', // Required for public OpenWay integration
          env: 'production',
          version: '1.0.0',
          sessionSampleRate: 100,
          sessionReplaySampleRate: 70,
          trackInteractions: true,
          traceType: 'ddtrace', // Optional, default is ddtrace. Currently supports ddtrace, zipkin, skywalking_v3, jaeger, zipkin_single_header, w3c_traceparent
          allowedTracingOrigins: ['https://api.example.com', /https:\/\/.*\.my-api-domain\.com/],  // Optional, list of origins or regex patterns allowed to inject tracing headers
        })
    </script>
    ```

## Configuration {#config}

### Initialization Parameters

| Parameter                              | Type                             | Required | Default Value | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | -------------------------------- | -------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applicationId`                        | String                           | Yes      |               | The application ID created in Guance.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `datakitOrigin`                        | String                           | Yes      |               | DataKit data reporting Origin. Format: `protocol (including: //), domain name (or IP address) [and port number]`. Example: [https://www.datakit.com](https://www.datakit.com); [http://100.20.34.3:8088](http://100.20.34.3:8088).                                                                                                                                                                                                                                                            |
| `clientToken`                          | String                           | Yes      |               | The data reporting token for openway access, obtained from the Guance console (required for public openway integration).                                                                                                                                                                                                                                                                                                                                                                      |
| `site`                                 | String                           | Yes      |               | The data reporting address for public openway access, obtained from the Guance console (required for public openway integration).                                                                                                                                                                                                                                                                                                                                                             |
| `env`                                  | String                           | No       |               | The current environment of the web application, such as prod: production; gray: gray release; pre: pre-release; common: daily; local: local.                                                                                                                                                                                                                                                                                                                                                  |
| `version`                              | String                           | No       |               | The version number of the web application.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `service`                              | String                           | No       | `browser`     | The service name of the current application, defaults to `browser`, supports custom configuration.                                                                                                                                                                                                                                                                                                                                                                                            |
| `sessionSampleRate`                    | Number                           | No       | `100`         | Percentage of metric data collection:<br>`100` means full collection; `0` means no collection.                                                                                                                                                                                                                                                                                                                                                                                                |
| `sessionReplaySampleRate`              | Number                           | No       | `100`         | Percentage of [Session Replay](../replay.md) data collection: <br>`100` means full collection; `0` means no collection.                                                                                                                                                                                                                                                                                                                                                                       |
| `trackSessionAcrossSubdomains`         | Boolean                          | No       | `false`       | Subdomains under the same domain share cache.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `usePartitionedCrossSiteSessionCookie` | Boolean                          | No       | `false`       | Whether to enable partitioned secure cross-site session cookie [more details](https://developers.google.com/privacy-sandbox/3pcd/chips?hl=en)                                                                                                                                                                                                                                                                                                                                                 |
| `useSecureSessionCookie`               | Boolean                          | No       | `false`       | Use secure session cookies. This will disable RUM events sent over insecure (non-HTTPS) connections.                                                                                                                                                                                                                                                                                                                                                                                          |
| `traceType`                            | Enum                             | No       | `ddtrace`     | Configure the tracing tool type. Defaults to `ddtrace` if not set. Currently supports `ddtrace`, `zipkin`, `skywalking_v3`, `jaeger`, `zipkin_single_header`, `w3c_traceparent`.<br><br>:warning: <br>1. `opentelemetry` supports `zipkin_single_header`, `w3c_traceparent`, `zipkin`, `jaeger`.<br>2. This setting depends on `allowedTracingOrigins`.<br>3. Setting the corresponding `traceType` requires configuring the appropriate `Access-Control-Allow-Headers` for the API services. |
| `traceId128Bit`                        | Boolean                          | No       | `false`       | Whether to generate `traceID` using 128-bit format, corresponding to `traceType`, currently supports `zipkin`, `jaeger`.                                                                                                                                                                                                                                                                                                                                                                      |
| `allowedTracingOrigins`                | Array                            | No       | `[]`          | List of origins or regex patterns allowed to inject tracing headers. Can be request origin or regex, origin format: `protocol (including: //), domain name (or IP address) [and port number]`. Example: <br>`["https://api.example.com", /https:\\/\\/._\\.my-api-domain\\.com/]`.                                                                                                                                                                                                            |
| `allowedTracingUrls`                   | Array                            | No       | `[]`          | URL matching list for requests associated with APM. Can be request URLs, regex, or match function, example: `["https://api.example.com/xxx", /https:\/\/.*\.my-api-domain\.com\/xxx/, function(url) {if (url === 'xxx') { return false} else { return true }}]`. This parameter extends `allowedTracingOrigins`, configuring either one is sufficient.                                                                                                                                        |
| `trackUserInteractions`                | Boolean                          | No       | `false`       | Whether to enable user interaction tracking.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `actionNameAttribute`                  | String                           | No       |               | Version requirement:`>3.1.2`. Add custom attributes to elements to specify action names. For more details, refer to [Tracking User Actions](./tracking-user-actions.md)                                                                                                                                                                                                                                                                                                                       |
| `beforeSend`                           | Function(event, context):Boolean | No       |               | Version requirement:`>3.1.2`. Intercept and modify data, refer to [Data Interception](./before-send.md)                                                                                                                                                                                                                                                                                                                                                                                       |
| `storeContextsToLocal`                 | Boolean                          | No       |               | Version requirement:`>3.1.2`. Whether to cache custom user data locally in localStorage, e.g., data added via `setUser`, `addGlobalContext` APIs.                                                                                                                                                                                                                                                                                                                                             |
| `storeContextsKey`                     | String                           | No       |               | Version requirement:`>3.1.18`. Define the key used to store data in localStorage, defaults to auto-generated if not specified. This parameter helps differentiate storage across different subpaths within the same domain.                                                                                                                                                                                                                                                                   |
| `compressIntakeRequests`               | Boolean                          | No       |               | Compress RUM data request content to reduce bandwidth usage when sending large amounts of data, reducing the number of data requests. Compression occurs in the WebWorker thread. For CSP security policy, refer to [CSP Security](./content-security-policy.md#webwork). SDK version requirement `>= 3.2.0`. DataKit version requirement `>=1.60`. Deployment Plan version requirement `>= 1.96.178`.                                                                                        |
| `workerUrl`                            | String                           | No       |               | Both sessionReplay and compressIntakeRequests data compression occur in the WebWorker thread, so by default, in CSP secure access scenarios, you need to allow worker-src blob:. This configuration allows adding a self-hosted worker URL. For CSP security policy, refer to [CSP Security](./content-security-policy.md#webwork). SDK version requirement `>= 3.2.0`.                                                                                                                       |
