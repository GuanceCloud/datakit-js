# 自定义用户标识

默认情况下，SDK 会自动为用户生成一个匿名唯一标识。你也可以显式设置业务侧用户身份信息。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 用户 ID |
| `name` | string | 用户名或昵称 |
| `email` | string | 用户邮箱 |

建议至少提供其中一个字段。

## 设置用户

### CDN 同步

```js
window.DATAFLUX_RUM &&
  window.DATAFLUX_RUM.setUser({
    id: '1234',
    name: 'John Doe',
    email: 'john@doe.com'
  })
```

### CDN 异步

```js
DATAFLUX_RUM.onReady(function () {
  DATAFLUX_RUM.setUser({
    id: '1234',
    name: 'John Doe',
    email: 'john@doe.com'
  })
})
```

### NPM

```js
import { datafluxRum } from '@cloudcare/browser-rum'

datafluxRum.setUser({
  id: '1234',
  name: 'John Doe',
  email: 'john@doe.com'
})
```

## 清除用户

```js
datafluxRum.clearUser()
```
