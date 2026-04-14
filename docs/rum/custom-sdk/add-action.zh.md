# 自定义 Action

在初始化 RUM 后，可以使用 `addAction(name, context)` 上报自定义 action。

## `addAction`

### CDN 同步

```js
window.DATAFLUX_RUM && window.DATAFLUX_RUM.addAction('cart', {
  amount: 42,
  nb_items: 2,
  items: ['socks', 't-shirt']
})
```

### CDN 异步

```js
DATAFLUX_RUM.onReady(function () {
  DATAFLUX_RUM.addAction('cart', {
    amount: 42,
    nb_items: 2,
    items: ['socks', 't-shirt']
  })
})
```

### NPM

```js
import { datafluxRum } from '@cloudcare/browser-rum'

datafluxRum.addAction('cart', {
  amount: 42,
  nb_items: 2,
  items: ['socks', 't-shirt']
})
```

## `addTypeAction`

如果需要自定义 `action_type`，可以使用 `addTypeAction(name, actionType, context)`。

```js
datafluxRum.addTypeAction('cart', 'custom_action_type', {
  amount: 42,
  nb_items: 2
})
```
