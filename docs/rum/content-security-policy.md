# Content Security Policy

The HTTP response header Content-Security-Policy allows site administrators to control which resources the user agent can load for a given page. Apart from a few exceptions, the policy primarily involves specifying the sources and script endpoints of the server. This will help prevent cross-site scripting attacks (Cross-Site Script).

> For more details, refer to [Content-Security-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy)

## Multiple Content Security Policies

CSP allows multiple policies to be specified within a single resource, including through the [Content-Security-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy) header, the [Content-Security-Policy-Report-Only](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy-Report-Only) header, and [meta](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta) elements.

## Examples

```js
// header
Content-Security-Policy: connect-src http://example.com/;
                         script-src http://example.com/

// meta tag
<meta http-equiv="Content-Security-Policy" content="connect-src http://example.com/;
                         script-src http://example.com/">
```

## How to Integrate RUM SDK in Your Website Application Using CSP

If your website application is using CSP, integrating the Guance RUM SDK may result in security violation warnings in the browser. You need to add the following URLs to the corresponding directives:

### Datakit Reporting URLs

Dependent on the `datakitOrigin` option in the [RUM SDK Initialization Configuration](./custom-sdk/index.md):

```js
 DATAFLUX_RUM.init({
      ...
      datakitOrigin: 'https://test.dk.com',
      ...
    })
```

In the CSP security directive, please add the following entries:

```js
    connect-src https://*.dk.com
```

### Web Worker {#webwork}

If you have enabled the RUM SDK [Session Replay](../replay.md) feature or added the [compressIntakeRequests](./app-access.md#config) configuration in the RUM initialization configuration, ensure that you add the following `worker-src` entry:

```json
 worker-src blob:;
```

Starting with SDK version `>=3.2.0`, self-hosting web worker files is supported. Add `workerUrl` in the SDK configuration to specify the hosting address. The worker file can be obtained in two ways:

1. Download from the official Guance URL: https://static.guance.com/browser-sdk/v3/worker.js
2. Install the @cloudcare/browser-worker NPM package and include it in your build assets using a build tool (refer to the documentation for [Webpack 4](https://v4.webpack.js.org/loaders/file-loader/), [Webpack 5](https://webpack.js.org/guides/asset-modules/#url-assets), [Vite](https://vitejs.dev/guide/assets.html#new-url-url-import-meta-url), and [Rollup](https://github.com/rollup/plugins/tree/master/packages/url/#readme)).

Prerequisites:

1. Host the file on the same origin as your web application. Due to browser restrictions, it cannot be hosted on a separate domain (e.g., third-party CDN hosts) or other schemes.
2. Ensure SDK version `>=3.2.0`.

### CDN Address

If you are introducing the RUM SDK using [CDN asynchronous or CDN synchronous](./app-access.md#access), add the following `script-src` entry:

```json
script-src https://static.guance.com
```
