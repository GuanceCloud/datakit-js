# beforeSend

`beforeSend` 用于在事件真正发送前做最后一次过滤或改写。

## 适合做什么

- 丢弃不需要上报的事件
- 为特定事件补充字段
- 脱敏或裁剪部分上下文数据

## 基本用法

```js
window.DATAFLUX_RUM.init({
  // ...
  beforeSend: (event) => {
    if (event.type === 'resource' && /health/.test(event.resource?.url || '')) {
      return false
    }

    if (event.type === 'error') {
      event.context = {
        ...event.context,
        releaseChannel: 'gray'
      }
    }

    return true
  }
})
```

## 使用建议

- 只做轻量逻辑，不要在 `beforeSend` 里做重计算。
- 不要依赖它做主流程控制，它更适合做过滤和字段修正。
- 如果返回 `false`，该事件不会被发送。
