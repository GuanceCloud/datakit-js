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
  //  env: 'production',
  //  version: '1.0.0',
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
      //  env: 'production',
      //  version: '1.0.0',
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
      //  env: 'production',
      //  version: '1.0.0',
    })
</script>
```

## 配置

### 初始化参数

| 参数                                              | 类型     | 是否必须 | 默认值                             | 描述                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | -------- | -------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applicationId`                                   | String   | 是       |                                    | 从 dataflux 创建的应用 ID                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `datakitOrigin`                                   | String   | 是       |                                    | datakit 数据上报 Origin 注释: `协议（包括：//），域名（或IP地址）[和端口号]` 例如：https://www.datakit.com, http://100.20.34.3:8088                                                                                                                                                                                                                                                                                                                                          |
| `env`                                             | String   | 是       |                                    | web 应用当前环境， 如 prod：线上环境；gray：灰度环境；pre：预发布环境 common：日常环境；local：本地环                                                                                                                                                                                                                                                                                                                                                                        |
| `service`                                         | String   | 否       |                                    | web 应用对应的服务名称，可以用于关联 APM 服务相关 tag                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `version`                                         | String   | 是       |                                    | web 应用的版本号                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `sessionSampleRate`                               | Number   | 否       | `100`                              | 指标数据收集百分比: `100`表示全收集，`0`表示不收集                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `sessionOnErrorSampleRate`                        | Number   | 否       | `0`                                | 错误会话补偿采样率：当会话未被 `sessionSampleRate` 采样时，若会话期间发生错误，则按此比例采集。此类会话将在错误发生时开始记录事件，并持续记录直到会话结束。                                                                                                                                                                                                                                                                                                                  |
| `sessionReplaySampleRate`                         | Number   | 否       | `100`                              | 会话重放数据收集百分比: `100`表示全收集，`0`表示不收。                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `sessionReplayOnErrorSampleRate`                  | Number   | 否       | `0`                                | 错误会话重放补偿采样率：当会话未被 `sessionReplaySampleRate` 采样时，若会话期间发生错误，则按此比例采集。此类回放将记录错误发生前最多一分钟的事件，并持续记录直到会话结束。                                                                                                                                                                                                                                                                                                  |
| 100 表示全收集；0 表示不收集。                    |
| `trackSessionAcrossSubdomains`                    | Boolean  | 否       | `false`                            | 同一个域名下面的子域名共享缓存                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `traceType` $\color{#FF0000}{新增}$               | Enum     | 否       | `ddtrace`                          | 与 APM 采集工具连接的请求 header 类型，目前兼容的类型包括：`ddtrace`、`zipkin`、`skywalking_v3`、`jaeger`、`zipkin_single_header`、`w3c_traceparent`。_注： opentelemetry 支持 `zipkin_single_header`,`w3c_traceparent`,`zipkin`三种类型_                                                                                                                                                                                                                                    |
| `traceId128Bit` $\color{#FF0000}{新增}$           | Boolean  | 否       | `false`                            | 是否以 128 位的方式生成 `traceID`，与`traceType` 对应，目前支持类型 `zipkin`、`jaeger`                                                                                                                                                                                                                                                                                                                                                                                       |
| `allowedDDTracingOrigins` $\color{#FF0000}{废弃}$ | Array    | 否       | `[]`                               | 允许注入`ddtrace` 采集器所需 header 头部的所有请求列表。可以是请求的 origin，也可以是是正则，origin: `协议（包括：//），域名（或IP地址）[和端口号]` 例如：`["https://api.example.com", /https:\/\/.*\.my-api-domain\.com/]` _该参数 旧的配置在新版本中做了兼容， 推荐使用`allowedTracingOrigins`_                                                                                                                                                                            |
| `allowedTracingOrigins` $\color{#FF0000}{新增}$   | Array    | 否       | `[]`                               | 允许注入 `trace` 采集器所需 header 头部的所有请求列表。可以是请求的 origin，也可以是是正则，origin: `协议（包括：//），域名（或IP地址）[和端口号]` 例如：`["https://api.example.com", /https:\/\/.*\.my-api-domain\.com/]`                                                                                                                                                                                                                                                   |
| `tracingSampleRate`                               | Number   | 否       | `100`                              | 链路数据收集百分比: `100`表示全收集，`0`表示不收集                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `trackInteractions`                               | Boolean  | 否       | `false`                            | 是否开启用户行为采集                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `isServerError`                                   | Function | 否       | `function(request) {return false}` | 默认情况下，请求如果 `status code`>= 500 则定义为错误请求，会相应的采集为 `error` 指标数据。为满足部分场景可能并非是通过 `status code` 来判断业务请求的错误情况，提供可通过用户自定义的方式来判断请求是否为 error 请求，callback 参数为请求对应的相关返回参数： `{ isAborted: false, method:"get",response: "{...}",status: 200,url: "xxxx" }`, 如果方法返回为 true，则该请求相关数据会被采集为 `error` 指标， _该参数 方法返回结果必须为 Boolean 类型， 否则认为是无效参数_ |
| `isIntakeUrl`                                     | Function | 否       | `function(url) {return false}`     | 自定义方法根据请求资源 url 判断是否需要采集对应资源数据，默认都采集。 返回：`false` 表示要采集，`true` 表示不需要采集 _该参数 方法返回结果必须为 Boolean 类型， 否则认为是无效参数_                                                                                                                                                                                                                                                                                          |
| `compressIntakeRequests`                          | Boolean  | 否       |                                    | 压缩 RUM 数据请求内容，以减少发送大量数据时的带宽使用量。压缩在 Worker 线程中完成。版本要求`>= 3.2.0`                                                                                                                                                                                                                                                                                                                                                                        |
| `workerUrl`                                       | Sring    | 否       |                                    | sessionReplay 和 compressIntakeRequests 数据压缩都是在 webwork 线程中完成，所以默认情况下，在开启 csp 安全访问的情况下，需要允许 worker-src blob:; 该配置允许添加自行托管 worker 地址。版本要求`>= 3.2.0`                                                                                                                                                                                                                                                                    |

## 问题

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
