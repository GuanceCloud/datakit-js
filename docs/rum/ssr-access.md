# SSR 框架下接入观测云前端 RUM SDK 指南

本文档用于指导在 **SSR（Server-Side Rendering）框架** 中，如何正确接入 **观测云前端 RUM SDK**，适用于 Next.js、Nuxt 等在 AWS Amplify 或自建 Node SSR 环境中运行的项目。

---

## 一、核心原则

> **观测云 RUM SDK 只能在浏览器环境初始化，不能在服务器 SSR 阶段执行。**

| 阶段                | 运行环境 | 是否可以初始化 SDK |
| ------------------- | -------- | ------------------ |
| SSR 渲染阶段        | Node.js  | ❌ 不可以          |
| 浏览器 Hydration 后 | Browser  | ✅ 可以            |

因此，我们需要把 SDK 的初始化逻辑延迟到客户端执行。

---

## 二、安装观测云前端 SDK

根据你们实际使用的包名安装，例如：

```bash
npm install @cloudcare/browser-rum
```

---

## 三、创建“仅客户端执行”的初始化文件

新建文件：

```
/src/guanceRum.client.ts
```

```ts
import { datafluxRum } from '@cloudcare/browser-rum'

export function initGuanceRum() {
  // SSR 阶段直接跳过
  if (typeof window === 'undefined') return

  datafluxRum.init({
    applicationId: 'Your Application ID',
    datakitOrigin: '<DataKit Domain Name or IP>', // Required for DK method integration
    clientToken: 'clientToken', // Required for public OpenWay integration
    site: 'Public OpenWay URL', // Required for public OpenWay integration
    env: 'production',
    version: '1.0.0',
    sessionSampleRate: 100,
    sessionReplaySampleRate: 70,
    trackUserInteractions: true
    // Other optional configurations...
  })

  // Enable session replay recording
  datafluxRum.startSessionReplayRecording()
}
```

关键代码：

```ts
if (typeof window === 'undefined') return
```

用于确保在服务器渲染阶段不执行 SDK。

---

## 四、在 Next.js（Amplify SSR 常见）中接入

在 `_app.tsx` 中初始化：

```tsx
import { useEffect } from 'react'
import { initGuanceRum } from '../guanceRum.client'

export default function App({ Component, pageProps }) {
  useEffect(() => {
    initGuanceRum()
  }, [])

  return <Component {...pageProps} />
}
```

`useEffect` 只在浏览器执行，不会在 SSR 阶段运行。

---

## 五、Nuxt（Vue SSR）接入方式

创建客户端插件：

```
/plugins/guance-rum.client.js
```

```js
import { datafluxRum } from '@cloudcare/browser-rum'

export default () => {
  datafluxRum.init({
    applicationId: 'Your Application ID',
    datakitOrigin: '<DataKit Domain Name or IP>', // Required for DK method integration
    clientToken: 'clientToken', // Required for public OpenWay integration
    site: 'Public OpenWay URL', // Required for public OpenWay integration
    env: 'production',
    version: '1.0.0',
    sessionSampleRate: 100,
    sessionReplaySampleRate: 70,
    trackUserInteractions: true
    // Other optional configurations...
  })

  // Enable session replay recording
  datafluxRum.startSessionReplayRecording()
}
```

在 `nuxt.config.js` 中注册：

```js
plugins: [{ src: '~/plugins/guance-rum.client.js', mode: 'client' }]
```

---

## 六、最佳实践总结

- SDK 初始化必须在浏览器端执行
- 使用 `useEffect` 或 `.client.js` 插件

---

通过以上方式，即可在 SSR 架构下安全、稳定地接入观测云前端 RUM SDK。
