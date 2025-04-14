# DataFlux RUM Web 端数据指标监控（V2 版本）

## 简介

DataFlux RUM 能够通过收集各个应用的指标数据，以可视化的方式分析各个应用端的性能

### 你可以从下面几种方式中选择一种接入到你的 Web 应用中

| 接入方式     | 简介                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NPM          | 通过把 SDK 代码一起打包到你的前端项目中，此方式可以确保对前端页面的性能不会有任何影响，不过可能会错过 SDK 初始化之前的的请求、错误的收集。                       |
| CDN 异步加载 | 通过 CDN 加速缓存，以异步脚本引入的方式，引入 SDK 脚本，此方式可以确保 SDK 脚本的下载不会影响页面的加载性能，不过可能会错过 SDK 初始化之前的的请求、错误的收集。 |
| CDN 同步加载 | 通过 CDN 加速缓存，以同步脚本引入的方式，引入 SDK 脚本，此方式可以确保能够收集到所有的错误，资源，请求，性能指标。不过可能会影响页面的加载性能。                 |

### NPM

```javascript
import { datafluxRum } from '@cloudcare/browser-rum'

datafluxRum.init({
  applicationId: '<DATAFLUX_APPLICATION_ID>',
  datakitOrigin: '<DATAKIT ORIGIN>'
  env: 'production',
  version: '1.0.0',
  trackInteractions: true,
})
```

### CDN 异步加载

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
    'https://static.dataflux.cn/browser-sdk/v2/dataflux-rum.js',
    'DATAFLUX_RUM'
  )
  DATAFLUX_RUM.onReady(function () {
    DATAFLUX_RUM.init({
      applicationId: '<DATAFLUX_APPLICATION_ID>',
      datakitOrigin: '<DATAKIT ORIGIN>'
      env: 'production',
      version: '1.0.0',
      trackInteractions: true
    })
  })
</script>
```

### CDN 同步加载

```html
<script
  src="https://static.dataflux.cn/browser-sdk/v2/dataflux-rum.js"
  type="text/javascript"
></script>
<script>
  window.DATAFLUX_RUM &&
    window.DATAFLUX_RUM.init({
      applicationId: '<DATAFLUX_APPLICATION_ID>',
      datakitOrigin: '<DATAKIT ORIGIN>'
      env: 'production',
      version: '1.0.0',
      trackInteractions: true,
    })
</script>
```

## 配置

### 初始化参数

| 参数                                              | 类型     | 是否必须                         | 默认值                                                                                                                                   | 描述                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | -------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applicationId`                                   | String   | 是                               |                                                                                                                                          | 从 dataflux 创建的应用 ID                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `datakitOrigin`                                   | String   | 是                               |                                                                                                                                          | datakit 数据上报 Origin 注释: `协议（包括：//），域名（或IP地址）[和端口号]` 例如：https://www.datakit.com, http://100.20.34.3:8088                                                                                                                                                                                                                                                                                                                                          |
| `site`                                            | String   | 是（`公网dataway`上报方式 必填） |                                                                                                                                          | （SDK 版本要求 `> 3.1.4` ）公网 DataWay 对应站点的域名 注释: `协议（包括：//），域名（或IP地址）[和端口号]` 例如：https://www.datakit.com, http://100.20.34.3:8088                                                                                                                                                                                                                                                                                                           |
| `clientToken`                                     | String   | 是 （`公网dataway` 必填）        |                                                                                                                                          | （SDK 版本要求 `> 3.1.4` ）公网 DataWay 上报所需的客户端 token，在观测云控制台创建应用时生成                                                                                                                                                                                                                                                                                                                                                                                 |
| `env`                                             | String   | 是                               |                                                                                                                                          | web 应用当前环境， 如 prod：线上环境；gray：灰度环境；pre：预发布环境 common：日常环境；local：本地环境；                                                                                                                                                                                                                                                                                                                                                                    |
| `version`                                         | String   | 是                               |                                                                                                                                          | web 应用的版本号                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `sessionSampleRate`                               | Number   | 否                               | `100`                                                                                                                                    | 指标数据收集百分比: `100`表示全收集，`0`表示不收集                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `trackSessionAcrossSubdomains`                    | Boolean  | 否                               | `false`                                                                                                                                  | 同一个域名下面的子域名共享缓存                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `traceType`                                       | Enum     | 否                               | `ddtrace`                                                                                                                                | 与 APM 采集工具连接的请求 header 类型，目前兼容的类型包括：`ddtrace`、`zipkin`、`skywalking_v3`、`jaeger`、`zipkin_single_header`、`w3c_traceparent`。_注： opentelemetry 支持 `zipkin_single_header`,`w3c_traceparent`,`zipkin`三种类型_                                                                                                                                                                                                                                    |
| `traceId128Bit`                                   | Boolean  | 否                               | `false`                                                                                                                                  | 是否以 128 位的方式生成 `traceID`，与`traceType` 对应，目前支持类型 `zipkin`、`jaeger`                                                                                                                                                                                                                                                                                                                                                                                       |
| `allowedDDTracingOrigins` $\color{#FF0000}{废弃}$ | Array    | 否                               | `[]`                                                                                                                                     | 允许注入`ddtrace` 采集器所需 header 头部的所有请求列表。可以是请求的 origin，也可以是是正则，origin: `协议（包括：//），域名（或IP地址）[和端口号]` 例如：`["https://api.example.com", /https:\/\/.*\.my-api-domain\.com/]` _该参数 旧的配置在新版本中做了兼容， 推荐使用`allowedTracingOrigins`_                                                                                                                                                                            |
| `allowedTracingOrigins`                           | Array    | 否                               | `[]`                                                                                                                                     | 允许注入 `trace` 采集器所需 header 头部的所有请求列表。可以是请求的 origin，也可以是是正则，origin: `协议（包括：//），域名（或IP地址）[和端口号]` 例如：`["https://api.example.com", /https:\/\/.*\.my-api-domain\.com/]`                                                                                                                                                                                                                                                   |
| `allowedTracingUrls` $\color{#FF0000}{新增}$      | Array    | 否                               | `[]`                                                                                                                                     | 与 Apm 关联请求的 Url 匹配列表。可以是请求的 url，也可以是正则，或者是 match function 例如：`["https://api.example.com/xxx", /https:\/\/.*\.my-api-domain\.com\/xxx/, function(url) {if (url === 'xxx') { return false} else { return true }}]` 该参数是 `allowedTracingOrigins` 配置的扩展，两者配置其一即可。                                                                                                                                                              |
| `trackInteractions`                               | Boolean  | 否                               | `false`                                                                                                                                  | 是否开启用户行为采集                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `isServerError`                                   | Function | 否                               | `function(request) {return false}`                                                                                                       | 默认情况下，请求如果 `status code`>= 500 则定义为错误请求，会相应的采集为 `error` 指标数据。为满足部分场景可能并非是通过 `status code` 来判断业务请求的错误情况，提供可通过用户自定义的方式来判断请求是否为 error 请求，callback 参数为请求对应的相关返回参数： `{ isAborted: false, method:"get",response: "{...}",status: 200,url: "xxxx" }`, 如果方法返回为 true，则该请求相关数据会被采集为 `error` 指标， _该参数 方法返回结果必须为 Boolean 类型， 否则认为是无效参数_ |
| `storeContextsToLocal`                            | Boolean  | 否                               | 版本要求:`>3.1.2`。是否把用户自定义数据缓存到本地 localstorage, 例如： `setUser`, `addGlobalContext` api 添加的自定义数据                |
| `storeContextsKey`                                | String   | 否                               | 版本要求:`>3.1.18`。定义存储到 localstorage 的 key ，默认不填，自动生成, 该参数主要是为了区分在同一个域名下，不同子路径共用 store 的问题 |
| `sendContentTypeByJson`                           | Boolean  | 否                               | 版本要求:`>3.1.2`。是否以 json 的方式发送数据，即 write/rum 请求发送 `content-type: application/json`                                    |

## 问题

### 配置 allowedTracingOrigins 之后，异步请求跨域

为了在使用 APM（应用性能监控）工具时实现前端到后端的完整跟踪（通常称为 RUM，即真实用户监控），你需要在前端和后端进行相应的配置。以下是主要步骤和注意事项：

#### 前端配置

1. **安装并配置 RUM SDK**：

   - 在你的 Web 前端应用中安装 APM 工具提供的 RUM SDK。
   - 配置 SDK，包括设置`allowedTracingOrigins`（允许发送跟踪信息的源域名）和`traceType`（跟踪类型或框架，如`ddtrace`用于 Datadog）。

2. **发送跟踪信息**：
   - RUM SDK 会自动在前端发起的请求头中添加必要的跟踪信息，如`x-datadog-parent-id`, `x-datadog-origin`, `x-datadog-sampling-priority`, `x-datadog-trace-id`等。

#### 后端配置

1. **设置 CORS 策略**：

   - 在后端服务器上配置 CORS（跨源资源共享）策略，允许来自前端域的请求，并特别指定`Access-Control-Allow-Headers`以包含所有必要的跟踪信息头部。
   - 例如，如果你的后端使用 Node.js 和 Express 框架，可以添加 CORS 中间件并设置`allowedHeaders`属性来包含这些跟踪信息头部。

   ```javascript
   const cors = require('cors')
   app.use(
     cors({
       origin: 'https://your-frontend-domain.com', // 替换为你的前端应用域名
       allowedHeaders: [
         'x-datadog-parent-id',
         'x-datadog-origin',
         'x-datadog-sampling-priority',
         'x-datadog-trace-id'
         // 可能还有其他必要的头部
       ]
     })
   )
   ```

2. **处理请求**：
   - 确保后端服务能够接收并正确处理这些跟踪信息头部。这些信息通常用于在后端服务中关联和追踪请求。

#### 验证与测试

- **测试配置**：

  - 发起从前端到后端的请求，并检查网络请求的 HTTP 头部以确保跟踪信息被正确发送。
  - 查看后端服务器日志，确认跟踪信息被正确处理。

- **调试与修正**：
  - 如果遇到任何问题（如 CORS 错误、头部未发送等），请检查前端和后端的配置，并根据需要调整。

#### 注意事项

- **安全性**：确保`allowedTracingOrigins`仅包含受信任的源，以防止潜在的跨站请求伪造（CSRF）攻击。
- **性能**：虽然跟踪信息对于性能监控至关重要，但请确保它们不会对你的应用性能造成负面影响。

通过以上步骤，你可以成功配置 APM 工具以支持前端到后端的完整跟踪，从而更有效地监控和优化你的 Web 应用的性能。

### 产生 Script error 消息的原因

在使用 DataFlux Web Rum Sdk 进行 Web 端错误收集的时候，经常会在`js_error`中看到 Script error. 这样的错误信息，同时并没有包含任何详细信息。

### 可能出现上面问题的原因

1. 用户使用的浏览器不支持错误的捕获 (概率极小)。
2. 出错的脚本文件是跨域加载到页面的。
   对于用户浏览器不支持的情况，这种我们是无法处理的；这里主要解决跨域脚本错误无法收集的原因和解决方案。

### 原因

一般情况下脚本文件是使用 `<script>` 标签加载，对于同源脚本出错，在使用浏览器的 `GlobalEventHandlers API` 时，收集到的错误信息会包含详细的错误信息；当不同源脚本出错时，收集到的错误信息只有 `Script error.` 文本，这是由浏览器的同源策略控制的，也是正常的情况。对于非同源脚本我们只需要进行非同源资源共享（也称 HTTP 访问控制 / CORS）的操作即可。

### 解决方法

#### 1.脚本文件直接存放在服务器

在服务器上静态文件输出时添加 Header

```
Access-Control-Allow-Origin: *
```

在非同源脚本所在的 Script 标签上添加属 crossorigin="anonymous"

```
<script type="text/javascript" src="path/to/your/script.js" crossorigin="anonymous"></script>
```

#### 2.脚本文件存放 CDN 上

在 CDN 设置中添加 Header

```
Access-Control-Allow-Origin: *
```

在非同源脚本所在的 Script 标签上添加属 crossorigin="anonymous"

```
<script type="text/javascript" src="path/to/your/script.js" crossorigin="anonymous"></script>
```

#### 3. 脚本文件从第三方加载

在非同源脚本所在的 Script 标签上添加属 crossorigin="anonymous"

```
<script type="text/javascript" src="path/to/your/script.js" crossorigin="anonymous"></script>
```

### 参考及扩展阅读

[GlobalEventHandlers.onerror](https://developer.mozilla.org/en-US/docs/Web/API/GlobalEventHandlers/onerror)

[Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)

[The Script element](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script)

[CORS settings attributes](https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_settings_attributes)

### 资源数据(ssl, tcp, dns, trans,ttfb)收集不完整问题

在数据上报过程中，部分资源 timing 数据有可能收集不完整。比如 tcp，dns 数据没有收集上报。

### 出现上面问题原因

1. 比如 dns 数据没有收集到，有可能是您应用的这个资源请求是以`keep-alive`保持链接的，这种情况只有在你第一次请求的时候，会有创建链接的过程，之后的请求都会保持同一连接，不会再重新创建 tcp 连接。所以会出现 dns 数据没有的情况，或者数据为`0`。
2. 应用的资源是以跨域的形式加载到页面的，和你的网站并非是同源（主要原因）。
3. 浏览器不支持`Performance API`(极少数情况)

### 针对跨域资源的问题

#### 1.资源文件直接存放在服务器

在服务器上资源文件输出时添加 Header

```
Timing-Allow-Origin: *
```

#### 2.资源文件存放 CDN 上

在 CDN 设置中添加 Header

```
Timing-Allow-Origin: *
```

### 参考以及拓展

[Coping_with_CORS](https://developer.mozilla.org/en-US/docs/Web/API/Resource_Timing_API/Using_the_Resource_Timing_API#Coping_with_CORS)

[Resource Timing Standard; W3C Editor's Draft](https://w3c.github.io/resource-timing/)

[Resource Timing practical tips; Steve Souders](http://www.stevesouders.com/blog/2014/08/21/resource-timing-practical-tips/)

[Measuring network performance with Resource Timing API](http://googledevelopers.blogspot.ca/2013/12/measuring-network-performance-with.html)
