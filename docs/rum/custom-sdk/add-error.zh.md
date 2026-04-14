# 自定义错误

初始化 RUM 后，可以通过 `addError(error, context)` 主动上报已捕获错误。

## 示例

### CDN 同步

```js
const error = new Error('Something wrong occurred.')

window.DATAFLUX_RUM &&
  window.DATAFLUX_RUM.addError(error, {
    pageStatus: 'beta'
  })
```

### CDN 异步

```js
fetch('/some-url').catch(function (error) {
  DATAFLUX_RUM.onReady(function () {
    DATAFLUX_RUM.addError(error)
  })
})
```

### NPM

```js
import { datafluxRum } from '@cloudcare/browser-rum'

try {
  // some code
} catch (error) {
  datafluxRum.addError(error, {
    pageStatus: 'beta'
  })
}
```

## 使用建议

- 优先传真实 `Error` 对象。
- 业务上下文放在第二个参数里，不要拼进错误消息。
