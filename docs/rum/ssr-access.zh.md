# SSR 场景接入

在 SSR 应用中，RUM SDK 必须只在浏览器端初始化，不能在服务端执行。

## 原则

- 初始化逻辑只放在 client 侧
- 不要在服务端直接访问 `window`、`document` 或浏览器 API

## React / Next.js

可以在客户端组件或 `useEffect` 中初始化：

```js
useEffect(() => {
  datafluxRum.init({
    // ...
  })

  datafluxRum.startSessionReplayRecording()
}, [])
```

## Nuxt

建议把初始化写在 `.client.js` 插件里：

```js
export default () => {
  window.DATAFLUX_RUM &&
    window.DATAFLUX_RUM.init({
      // ...
    })

  window.DATAFLUX_RUM && window.DATAFLUX_RUM.startSessionReplayRecording()
}
```

然后在 `nuxt.config.js` 中只注册浏览器端插件。

## 最佳实践

- 初始化只在浏览器端执行
- 录制启动也放在浏览器端
- SSR 页面如果依赖路由切换或用户状态，再根据业务场景决定何时开始录制
