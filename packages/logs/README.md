# DataFlux Browser Logs SDK 

## 简介
通过web浏览器或者javascript客户端主动发送不同等级的[日志数据](https://www.yuque.com/dataflux/datakit/logging)(`对应的source:browser_log
`指标类型日志数据)到[DataFlux](https://dataflux.cn)。

## 功能简介
- 自定义日志数据采集，通过sdk接入客户端应用中，针对不同场景采集不同日志数据。
- 可以自动收集应用端的错误信息（包括网络错误，console错误，以及js错误）上报到DataFlux。
- 自定义错误等级（`debug`,`critical`,`error`,`info`,`warn`）,自定义Logger对象，以及自定义log字段
- 可以自动收集[RUM](https://www.yuque.com/dataflux/doc/eqs7v2)相关数据，关联RUM业务场景

## 开始使用
 ### 前置条件
 **datakit** 通过[datakit](https://www.yuque.com/dataflux/doc/oolclw)日志采集API发送日志数据到DataFlux平台
 
 **引入SDK** 可通过`NPM`,`CDN同步`或`CDN异步`的方式引入SDK到应用中
 
 **支持的浏览器** 支持所有pc端，移动端的浏览器

### 你可以从下面几种方式中选择一种接入到你的 Web 应用中

| 接入方式     | 简介                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NPM          | 通过把 SDK 代码一起打包到你的前端项目中，此方式可以确保对前端页面的性能不会有任何影响，不过可能会错过 SDK 初始化之前的的请求、错误的收集。                       |
| CDN 异步加载 | 通过 CDN 加速缓存，以异步脚本引入的方式，引入 SDK 脚本，此方式可以确保 SDK 脚本的下载不会影响页面的加载性能，不过可能会错过 SDK 初始化之前的的请求、错误的收集。 |
| CDN 同步加载 | 通过 CDN 加速缓存，以同步脚本引入的方式，引入 SDK 脚本，此方式可以确保能够收集到所有的错误，资源，请求，性能指标。不过可能会影响页面的加载性能。                 |

### NPM

```javascript
import { datafluxLogs } from '@cloudcare/browser-logs'
datafluxLogs.init({
  datakitOrigin: '<DATAKIT ORIGIN>'
  //service: 'browser',
  //forwardErrorsToLogs:true
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
    'https://static.dataflux.cn/browser-sdk/v1/dataflux-logs.js',
    'DATAFLUX_LOGS'
  )
  DATAFLUX_LOGS.onReady(function () {
    DATAFLUX_LOGS.init({
      datakitOrigin: '<DATAKIT ORIGIN>'
      //service: 'browser',
      //forwardErrorsToLogs:true
    })
  })
</script>
```

### CDN 同步加载

```html
<script
  src="https://static.dataflux.cn/browser-sdk/v1/dataflux-logs.js" 
  type="text/javascript"
></script>
<script>
  window.DATAFLUX_LOGS &&
    window.DATAFLUX_LOGS.init({
      datakitOrigin: '<DATAKIT ORIGIN>'
      //service: 'browser',
      //forwardErrorsToLogs:true
    })
</script>
```

## 配置

### 初始化参数

| 参数                  | 类型    | 是否必须 | 默认值    | 描述                                                                                                                                |
| --------------------- | ------- | -------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `datakitOrigin`       | String  | 是       |           | datakit 数据上报 Origin 注释: `协议（包括：//），域名（或IP地址）[和端口号]` 例如：https://www.datakit.com, http://100.20.34.3:8088 |
| `service`             | String  | 否       | `browser` | 日志service名称                                                                                                                     |
| `env`                 | String  | 否       |           | web 应用当前环境， 如 prod：线上环境；gray：灰度环境；pre：预发布环境 common：日常环境；local：本地环境；                           |
| `version`             | String  | 否       |           | web 应用的版本号                                                                                                                    |
| `sessionSampleRate`          | Number  | 否       | `100`     | 指标数据收集百分比: `100`表示全收集，`0`表示不收集                                                                                  |
| `forwardErrorsToLogs` | Boolean | 否       | `true`    | 设置为`false` 表示停止采集console.error、 js、以及网络错误上报到DataFlux日志数据中                                                  |
| `silentMultipleInit`  | Boolean | 否       | `false`   | 不允许有多个日志对象被初始化                                                                                                        |

## 使用
SDK在应用中初始化后，通过暴露的JS API 可以自定义配置日志数据
```js
logger.debug | info | warn | error | critical (message: string, messageContext = Context)
```
### NPM
```js
import { datafluxLogs } from '@cloudcare/browser-logs'

datafluxLogs.logger.info('Button clicked', { name: 'buttonName', id: 123 })
```

### CDN 异步
```js
DATAFLUX_LOGS.onReady(function () {
  DATAFLUX_LOGS.logger.info('Button clicked', { name: 'buttonName', id: 123 })
})
```

### CDN 同步
```js
window.DATAFLUX_LOGS && DATAFLUX_LOGS.logger.info('Button clicked', { name: 'buttonName', id: 123 })
```

## 返回数据结构
```JSON
{
    "service": "browser",
    "session": {
        "id": "c549c2b8-4955-4f74-b7f8-a5f42fc6e79b"
    },
    "type": "logger",
    "_dd": {
        "sdk_name": "Web LOG SDK",
        "sdk_version": "1.0.0",
        
    },
    "env": "",
    "version": "",
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
    "error": {
        "source": "network",
        "stack": "Failed to load"
    },
    "http": {
        "method": "get",
        "status_code": 0,
        "status_group": 0,
        "url": "http://testing-ft2x-api.cloudcare.cn/api/v1/workspace/xxx",
        "url_host": "testing-ft2x-api.cloudcare.cn",
        "url_path": "/api/v1/workspace/xxx",
        "url_path_group": "/api/?/workspace/xxx"
    }
}
```
##  Status 参数
初始化SDk后，可以使用提供`log` API,定义不同类型的状态
```js
log (message: string, messageContext: Context, status? = 'debug' | 'info' | 'warn' | 'error' | 'critical')
```

### NPM
```js
import { datafluxLogs } from '@cloudcare/browser-logs'

datafluxLogs.logger.log(<MESSAGE>,<JSON_ATTRIBUTES>,<STATUS>);

```

### CDN 异步
```js
DATAFLUX_LOGS.onReady(function () {
  DATAFLUX_LOGS.logger.log(<MESSAGE>,<JSON_ATTRIBUTES>,<STATUS>);
})
```

### CDN 同步
```js
window.DATAFLUX_LOGS && DATAFLUX_LOGS.logger.log(<MESSAGE>,<JSON_ATTRIBUTES>,<STATUS>);
```

## 参数说明

| 参数                 | 描述                                                             |
| -------------------- | ---------------------------------------------------------------- |
| `<MESSAGE>`          | Dataflux 日志中的 message 字段                                   |
| `<JSON_ATTRIBUTES>	` | 描述message的额外数据，是一个json对象                            |
| `<STATUS>	`          | 日志的等级，可选值：`debug`, `info`, `warn`, `error`, `critical` |


