# 自定义全局 TAG

初始化 RUM 后，可以使用全局上下文 API 给所有事件附加额外字段。

## 添加字段

### CDN 同步

```js
window.DATAFLUX_RUM &&
  window.DATAFLUX_RUM.setGlobalContextProperty('isvip', 'xxxx')
```

### NPM

```js
import { datafluxRum } from '@cloudcare/browser-rum'

datafluxRum.setGlobalContextProperty('activity', {
  hasPaid: true,
  amount: 23.42
})
```

## 整体覆盖

```js
datafluxRum.setGlobalContext({
  codeVersion: 34
})
```

## 读取、删除与清空

```js
const context = datafluxRum.getGlobalContext()
datafluxRum.removeGlobalContextProperty('activity')
datafluxRum.clearGlobalContext()
```

## 建议

- 全局上下文字段会进入大部分事件，尽量保持字段稳定。
- 不建议放大对象或频繁变化的数据。
