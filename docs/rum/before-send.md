# beforeSend (数据拦截以及数据修改)

RUM SDK 在每条数据发送之前都会执行 `beforeSend` 方法，通过自定义该方法的实现可以实现一下操作：
- 修改部分数据
- 拦截发送数据

`beforeSend` 提供两个参数：
```js
function beforeSend(event, context)
```
`event` 由 SDK 产生采集各种指标数据对象
`context` 具体相关信息参考如下:

| EVENT TYPE  |  context |
|---|---|
|  View | [Location](https://developer.mozilla.org/en-US/docs/Web/API/Location)  |
|  Action | [Event](https://developer.mozilla.org/en-US/docs/Web/API/Event)  |
|  Resource (XHR) | [XMLHttpRequest](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest) , [ PerformanceResourceTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming)  |
|  Resource (Fetch) | [Reqeust](https://developer.mozilla.org/en-US/docs/Web/API/Request) , [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response), [ PerformanceResourceTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming)  |
|  Resource (Other) | [ PerformanceResourceTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming)  |
|  Error | [Error](https://developer.mozilla.org/en-US/docs/Web//Reference/Global_Objects/Error)  |
|  Long Task | [PerformanceLongTaskTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming)  |

## 修改部分数据

```js
window.DATAFLUX_RUM &&
    window.DATAFLUX_RUM.init({
        ...,
        beforeSend: (event, context) => {
            if (event.type === 'resource' && event.resource.type === 'fetch') {
                // 在原数据的基础上添加请求的返回headers信息
                event.context = {...event.context, responseHeaders: context.response.headers}
            }
        },
        ...
    });
```
注意：`beforeSend` 只能修改 SDK 允许修改的数据字段。如果不在这些字段范围内的修改会被忽略。

SDK 允许修改的字段如下表：

|  属性 | 类型  | 描述 |
|---|---| --- |
|  `view.url` |  string |  页面地址   |
|  `view.referrer` |  string |  页面来源   |
|  `resource.url` |  string |  资源地址   |
|  `error.message` |  string |  错误信息   |
|  `error.resource.url` |  string |  错误资源地址   |
|  `context` |  string |  全局自定义内容，例如 通过`addAction`, `addError`添加的内容    |

## 拦截发送数据
可以通过 `beforeSend` 方法返回 `true` `false` 拦截一些不需要的数据。

- `true` 表示这条数据需要上报
- `false` 表示这条数据忽略上报

```js
window.DATAFLUX_RUM &&
    window.DATAFLUX_RUM.init({
        ...,
        beforeSend: (event) => {
            if (shouldDiscard(event)) {
                return false
            } else {
                return true
            }
            ...
        },
        ...
    });
```

