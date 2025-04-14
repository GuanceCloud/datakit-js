# Browser Log Collection

---

Send log data of different levels (`corresponding source:browser_log` Metrics type log data) actively through a Web browser or Javascript client to [Guance](https://guance.com/).

- Custom log data collection, by integrating the SDK into the client application, collects different log data for different scenarios;
- Automatically collect error information from the application (including network errors, console errors, and js errors) and report it to Guance;
- Customize error levels (`debug`, `critical`, `error`, `info`, `warn`), customize Logger objects, and customize Log fields;
- Automatically collect [RUM](../../docs/rum/app-access.md) related data and associate it with RUM business scenarios.

## Getting Started

### Prerequisites

- **DataKit**: Send log data to the Guance platform via the DataKit Log Collection API;

- **Integrate SDK**: The SDK can be integrated into the application using methods such as `NPM`, `CDN synchronous`, or `CDN asynchronous`;

- **Supported Browsers**: Supports all PC and mobile browsers.

### Choose Integration Method

| Integration Method       | Introduction                                                                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NPM                      | By bundling the SDK code into your frontend project, this method ensures no impact on the performance of the frontend page. However, requests and errors before SDK initialization may be missed.                                                                         |
| CDN Asynchronous Loading | Through CDN accelerated caching, the SDK script is introduced asynchronously. This method ensures that the download of the SDK script does not affect the loading performance of the page, but it might miss requests and errors collected before the SDK initialization. |
| CDN Synchronous Loading  | Through CDN accelerated caching, the SDK script is introduced synchronously. This method ensures the collection of all errors, resources, requests, and performance metrics. However, it might affect the loading performance of the page.                                |

#### NPM

```javascript
import { datafluxLogs } from '@cloudcare/browser-logs'
datafluxLogs.init({
  datakitOrigin: '<DataKit domain or IP>', // DK integration requires configuration
  clientToken: 'clientToken', // Public OpenWay integration requires filling out
  site: 'Public OpenWay address' // Public OpenWay integration requires filling out
  //service: 'browser',
  //forwardErrorsToLogs:true
})
```

#### CDN Asynchronous Loading

```html
<script>
  ;(function (h, o, u, n, d) {
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
    'https://static.guance.com/browser-sdk/v3/dataflux-logs.js',
    'DATAFLUX_LOGS'
  )
  DATAFLUX_LOGS.onReady(function () {
    DATAFLUX_LOGS.init({
      datakitOrigin: '<DataKit domain or IP>', // DK integration requires configuration
      clientToken: 'clientToken', // Public OpenWay integration requires filling out
      site: 'Public OpenWay address' // Public OpenWay integration requires filling out
      //service: 'browser',
      //forwardErrorsToLogs:true
    })
  })
</script>
```

#### CDN Synchronous Loading

```html
<script
  src="https://static.guance.com/browser-sdk/v3/dataflux-logs.js"
  type="text/javascript"
></script>
<script>
  window.DATAFLUX_LOGS &&
    window.DATAFLUX_LOGS.init({
      datakitOrigin: '<DataKit domain or IP>', // DK integration requires configuration
      clientToken: 'clientToken', // Public OpenWay integration requires filling out
      site: 'Public OpenWay address' // Public OpenWay integration requires filling out
      //service: 'browser',
      //forwardErrorsToLogs:true
    })
</script>
```

## Configuration

### Initialization Parameters

| **Parameter**          | **Type**     | **Required** | **Default Value** | **Description**                                                                                                                                                                                                   |
| ---------------------- | ------------ | ------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `datakitOrigin`        | String       | Yes          |                   | DataKit data reporting Origin Note: `protocol (including: //), domain name (or IP address) [and port number]` Example: https://www.datakit.com, http://100.20.34.3:8088.                                          |
| `clientToken`          | String       | Yes          |                   | Data token for reporting in the openway method, obtained from the Guance console, required (public openway method access).                                                                                        |
| `site`                 | String       | Yes          |                   | Data reporting address for public openway method, obtained from the Guance console, required (public openway method access).                                                                                      |
| `service`              | String       | No           | `browser`         | Log Service Name                                                                                                                                                                                                  |
| `env`                  | String       | No           |                   | Current environment of the Web application, such as Prod: production environment; Gray: gray environment; Pre: pre-release environment Common: daily environment; Local: local environment;                       |
| `version`              | String       | No           |                   | Version number of the Web application                                                                                                                                                                             |
| `sessionSampleRate`    | Number       | No           | `100`             | Percentage of Metrics data collection: `100` means full collection, `0` means no collection                                                                                                                       |
| `forwardErrorsToLogs`  | Boolean      | No           | `true`            | Setting to `false` stops collecting console.error, js, and network errors reported to Guance log data                                                                                                             |
| `silentMultipleInit`   | Boolean      | No           | `false`           | Does not allow multiple log objects to be initialized                                                                                                                                                             |
| `forwardConsoleLogs`   | String/Array | No           |                   | Browser console log types to collect, optional values: `error`, `log`, `info`, `warn`, `error`                                                                                                                    |
| `storeContextsToLocal` | Boolean      | No           |                   | Version requirement:`>3.1.2`. Whether to cache user-defined data locally in localstorage, for example: `setUser`, `addGlobalContext` api added custom data.                                                       |
| `storeContextsKey`     | String       | No           |                   | Version requirement:`>3.1.18`. Defines the key stored in localstorage, default not filled, auto-generated, this parameter mainly solves the problem of shared store under the same domain for different sub-paths |

## Usage

After initializing the SDK in the application, you can customize log data configurations via exposed JS APIs.

```javascript
logger.debug | info | warn | error | critical (message: string, messageContext = Context)
```

### NPM

```javascript
import { datafluxLogs } from '@cloudcare/browser-logs'

datafluxLogs.logger.info('Button clicked', { name: 'buttonName', id: 123 })
```

### CDN Asynchronous

```javascript
DATAFLUX_LOGS.onReady(function () {
  DATAFLUX_LOGS.logger.info('Button clicked', { name: 'buttonName', id: 123 })
})
```

### CDN Synchronous

```javascript
window.DATAFLUX_LOGS &&
  DATAFLUX_LOGS.logger.info('Button clicked', { name: 'buttonName', id: 123 })
```

## Returned Data Structure

```json
{
  "service": "browser",
  "session": {
    "id": "c549c2b8-4955-4f74-b7f8-a5f42fc6e79b"
  },
  "type": "logger",
  "_dd": {
    "sdk_name": "Web LOG SDK",
    "sdk_version": "1.0.0",
    "env": "",
    "version": ""
  },
  "device": {
    "os": "Mac OS",
    "os_version": "10.14.6",
    "os_version_major": "10",
    "browser": "Chrome",
    "browser_version": "90.0.4430.85",
    "browser_version_major": "90",
    "screen_size": "2560*1440",
    "network_type": "3g",
    "divice": "PC"
  },
  "user": {},
  "date": 1621321916756,
  "view": {
    "referrer": "",
    "url": "http://localhost:8080/",
    "host": "localhost:8080",
    "path": "/",
    "path_group": "/",
    "url_query": "{}",
    "id": "5dce64f4-8d6d-411a-af84-c41653ccd94a"
  },
  "application": {
    "id": "app_idxxxxxx"
  },
  "message": "XHR error get http://testing-ft2x-api.cloudcare.cn/api/v1/workspace/xxx",
  "status": "error",
  "tags": {},
  "error": {
    "source": "network",
    "stack": "Failed to load"
  },
  "resource": {
    "method": "get",
    "status": 0,
    "status_group": 0,
    "url": "http://testing-ft2x-api.cloudcare.cn/api/v1/workspace/xxx",
    "url_host": "testing-ft2x-api.cloudcare.cn",
    "url_path": "/api/v1/workspace/xxx",
    "url_path_group": "/api/?/workspace/xxx"
  }
}
```

## Status Parameter

After initializing the SDK, you can use the provided `log` API to define different types of statuses.

```javascript
log (message: string, messageContext: Context, status? = 'debug' | 'info' | 'warn' | 'error' | 'critical')
```

### NPM

```javascript
import { datafluxLogs } from '@cloudcare/browser-logs'

datafluxLogs.logger.log(<MESSAGE>,<JSON_ATTRIBUTES>,<STATUS>);
```

### CDN Asynchronous

```javascript
DATAFLUX_LOGS.onReady(function () {
  DATAFLUX_LOGS.logger.log(<MESSAGE>,<JSON_ATTRIBUTES>,<STATUS>);
})
```

### CDN Synchronous

```javascript
window.DATAFLUX_LOGS && DATAFLUX_LOGS.logger.log(<MESSAGE>,<JSON_ATTRIBUTES>,<STATUS>);
```

## Parameter Description

| **Parameter**       | **Description**                                                     |
| ------------------- | ------------------------------------------------------------------- |
| `<MESSAGE>`         | Message field in Guance logs                                        |
| `<JSON_ATTRIBUTES>` | Additional data describing the Message, as a JSON object            |
| `<STATUS>`          | Log level, optional values `debug`,`info`,`warn`,`error`,`critical` |

## Adding Custom TAG Data

---

After initializing LOG, use the `setGlobalContextProperty(key:string, value:any)` API to add extra TAGs to all LOG events collected from the application.

### Add TAG

=== "CDN Synchronous"

    ```javascript
    window.DATAFLUX_LOGS && window.DATAFLUX_LOGS.setGlobalContextProperty('<CONTEXT_KEY>', '<CONTEXT_VALUE>');

    // Code example
    window.DATAFLUX_LOGS && window.DATAFLUX_LOGS.setGlobalContextProperty('isvip', 'xxxx');
    window.DATAFLUX_LOGS && window.DATAFLUX_LOGS.setGlobalContextProperty('activity', {
        hasPaid: true,
        amount: 23.42
    });
    ```

=== "CDN Asynchronous"

    ```javascript
    DATAFLUX_LOGS.onReady(function() {
        DATAFLUX_LOGS.setGlobalContextProperty('<CONTEXT_KEY>', '<CONTEXT_VALUE>');
    })

    // Code example
    DATAFLUX_LOGS.onReady(function() {
        DATAFLUX_LOGS.setGlobalContextProperty('isvip', 'xxxx');
    })
    DATAFLUX_LOGS.onReady(function() {
        DATAFLUX_LOGS.setGlobalContextProperty('activity', {
            hasPaid: true,
            amount: 23.42
        });
    })

    ```

=== "NPM"

    ```javascript
    import { datafluxLogs } from '@cloudcare/browser-logs'
    datafluxLogs.setGlobalContextProperty('<CONTEXT_KEY>', <CONTEXT_VALUE>);

    // Code example
    datafluxLogs && datafluxLogs.setGlobalContextProperty('isvip', 'xxxx');
    datafluxLogs.setGlobalContextProperty('activity', {
        hasPaid: true,
        amount: 23.42
    });
    ```

### Replace TAG (Override)

=== "CDN Synchronous"

    ```javascript
    window.DATAFLUX_LOGS &&
         window.DATAFLUX_LOGS.setGlobalContext({ '<CONTEXT_KEY>': '<CONTEXT_VALUE>' });

    // Code example
    window.DATAFLUX_LOGS &&
         window.DATAFLUX_LOGS.setGlobalContext({
            codeVersion: 34,
        });
    ```

=== "CDN Asynchronous"

    ```javascript
     window.DATAFLUX_LOGS.onReady(function() {
         window.DATAFLUX_LOGS.setGlobalContext({ '<CONTEXT_KEY>': '<CONTEXT_VALUE>' });
    })

    // Code example
     window.DATAFLUX_LOGS.onReady(function() {
         window.DATAFLUX_LOGS.setGlobalContext({
            codeVersion: 34,
        })
    })
    ```

=== "NPM"

    ```javascript
    import { datafluxLogs } from '@cloudcare/browser-logs'

    datafluxLogs.setGlobalContext({ '<CONTEXT_KEY>': '<CONTEXT_VALUE>' });

    // Code example
    datafluxLogs.setGlobalContext({
        codeVersion: 34,
    });
    ```

### Get All Set Custom TAGs

=== "CDN Synchronous"

    ```javascript
    var context = window.DATAFLUX_LOGS &&  window.DATAFLUX_LOGS.getGlobalContext();

    ```

=== "CDN Asynchronous"

    ```javascript
     window.DATAFLUX_LOGS.onReady(function() {
        var context =  window.DATAFLUX_LOGS.getGlobalContext();
    });
    ```

=== "NPM"

    ```javascript
    import { datafluxLogs } from '@cloudcare/browser-logs'

    const context = datafluxLogs.getGlobalContext();

    ```

### Remove Specific Key Corresponding Custom TAG

=== "CDN Synchronous"

    ```javascript
    var context = window.DATAFLUX_LOGS &&  window.DATAFLUX_LOGS.removeGlobalContextProperty('<CONTEXT_KEY>');

    ```

=== "CDN Asynchronous"

    ```javascript
     window.DATAFLUX_LOGS.onReady(function() {
        var context =  window.DATAFLUX_LOGS.removeGlobalContextProperty('<CONTEXT_KEY>');
    });
    ```

=== "NPM"

    ```javascript
    import { datafluxLogs } from '@cloudcare/browser-logs'

    const context = datafluxLogs.removeGlobalContextProperty('<CONTEXT_KEY>');
    ```

### Remove All Custom TAGs

=== "CDN Synchronous"

    ```javascript
    var context = window.DATAFLUX_LOGS &&  window.DATAFLUX_LOGS.clearGlobalContext();

    ```

=== "CDN Asynchronous"

    ```javascript
     window.DATAFLUX_LOGS.onReady(function() {
        var context =  window.DATAFLUX_LOGS.clearGlobalContext();
    });
    ```

=== "NPM"

    ```javascript
    import { datafluxLogs } from '@cloudcare/browser-logs'

    const context = datafluxLogs.clearGlobalContext();
    ```

## Custom User Identification

---

By default, the SDK automatically generates a unique ID for users. This ID has no identifying attributes and can only distinguish between different user properties. To address this, we provide additional APIs to add various identifying attributes to the current user.

| Attribute  | Type   | Description          |
| ---------- | ------ | -------------------- |
| user.id    | string | User ID              |
| user.name  | string | Username or Nickname |
| user.email | string | Email Address        |

**Note**: The following attributes are optional, but it is recommended to provide at least one.

### Add User Identification

=== "CDN Synchronous"

    ```javascript
    window.DATAFLUX_LOGS && window.DATAFLUX_LOGS.setUser({
        id: '1234',
        name: 'John Doe',
        email: 'john@doe.com',
    })
    ```

=== "CDN Asynchronous"

    ```javascript
    window.DATAFLUX_LOGS.onReady(function() {
        window.DATAFLUX_LOGS.setUser({
            id: '1234',
            name: 'John Doe',
            email: 'john@doe.com',
        })
    })
    ```

=== "NPM"

    ```javascript
    import { datafluxLogs } from '@cloudcare/browser-logs'
    datafluxLogs.setUser({
        id: '1234',
        name: 'John Doe',
        email: 'john@doe.com',
    })
    ```

### Remove User Identification

=== "CDN Synchronous"

    ```javascript
    window.DATAFLUX_LOGS && window.DATAFLUX_LOGS.clearUser()
    ```

=== "CDN Asynchronous"

    ```javascript
    window.DATAFLUX_LOGS.onReady(function() {
        window.DATAFLUX_LOGS.clearUser()
    })
    ```

=== "NPM"

    ```javascript
    import { datafluxLogs } from '@cloudcare/browser-logs'
    datafluxLogs.clearUser()
    ```
