# Next.js RUM 插件接入说明

`@cloudcare/browser-rum-nextjs` 用于采集 Next.js 客户端 View 和 Error，支持
App Router 与 Pages Router。

## 支持范围

| 依赖 | 支持版本 |
| --- | --- |
| Next.js | 13 及以上 |
| React | 18 及以上 |
| RUM | `@cloudcare/browser-rum` 或 `@cloudcare/browser-rum-slim`，版本不得低于插件版本 |

Next.js 服务端渲染阶段没有浏览器环境，因此 RUM 只能在客户端初始化。插件采集的是
浏览器 View、客户端组件错误，以及 Next.js 传递到客户端错误边界的错误。纯服务端
请求、Server Action 执行和未传到客户端的服务端错误，需要使用服务端监控方案。

精简包不包含 Session Replay 和压缩上传能力，但不影响 Next.js View 与 Error
采集。

## 安装

```bash
npm install @cloudcare/browser-rum @cloudcare/browser-rum-nextjs
```

以下示例默认使用 Public DataWay 的 `site + clientToken`。DataKit 直连时，用
`datakitOrigin: '<DATAKIT_ORIGIN>'` 替换这两个字段，不要同时配置两种上报地址。

## App Router 推荐接入

Next.js 15.3 及以上支持根目录或 `src` 目录中的
`instrumentation-client.js|ts`。该文件会在 hydration 前运行，适合尽早初始化
浏览器监控。

### 1. 初始化 RUM

创建 `instrumentation-client.ts`：

```ts
import { datafluxRum } from '@cloudcare/browser-rum'
import {
  nextjsPlugin,
  onRouterTransitionStart
} from '@cloudcare/browser-rum-nextjs'

export { onRouterTransitionStart }

datafluxRum.init({
  applicationId: '<APPLICATION_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  service: 'web-nextjs',
  env: 'production',
  version: '1.0.0',
  sessionSampleRate: 100,
  plugins: [nextjsPlugin()]
})
```

`onRouterTransitionStart` 只记录本次导航的目标 URL。`RumNextjsAppRouter` 在新
pathname 实际提交后才创建 View，并同时写入动态路由模板名称。导航被取消、重定向
失败或渲染未提交时，不会提前创建一个无法回滚的 View。发生成功重定向时，View
使用最终提交的 pathname，不会保留重定向前的目标 URL。

如果项目使用 `src` 目录，文件位置为 `src/instrumentation-client.ts`。

### 2. 在根 layout 放置 Router tracker

创建客户端包装组件：

```tsx
// app/rum-router-tracker.tsx
'use client'

import { RumNextjsAppRouter } from '@cloudcare/browser-rum-nextjs'

export function RumRouterTracker() {
  return <RumNextjsAppRouter />
}
```

在根 layout 中渲染一次：

```tsx
// app/layout.tsx
import { RumRouterTracker } from './rum-router-tracker'

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <RumRouterTracker />
        {children}
      </body>
    </html>
  )
}
```

`RumNextjsAppRouter` 只渲染逻辑，不产生可见 DOM。整个应用只放置一个实例。

## Next.js 13 至 15.2 App Router

这些版本没有 `instrumentation-client`。可以在根 layout 中放置一个客户端初始化
组件：

```tsx
// app/rum-provider.tsx
'use client'

import { useEffect } from 'react'
import { datafluxRum } from '@cloudcare/browser-rum'
import {
  nextjsPlugin,
  RumNextjsAppRouter
} from '@cloudcare/browser-rum-nextjs'

let initialized = false

export function RumProvider() {
  useEffect(() => {
    if (initialized) {
      return
    }
    initialized = true

    datafluxRum.init({
      applicationId: '<APPLICATION_ID>',
      clientToken: '<CLIENT_TOKEN>',
      site: '<PUBLIC_DATAWAY_URL>',
      service: 'web-nextjs',
      env: 'production',
      version: '1.0.0',
      sessionSampleRate: 100,
      plugins: [nextjsPlugin()]
    })
  }, [])

  return <RumNextjsAppRouter />
}
```

然后在 `app/layout.tsx` 中渲染 `<RumProvider />`。

这种方式可以正确采集已完成的 App Router 路由变化，但没有
`onRouterTransitionStart` 提供的完整目标 URL，初始化时机也晚于
`instrumentation-client` 方案。

## App Router View 命名

插件结合 `usePathname()` 与 `useParams()` 生成文件路由模板：

| 实际 URL | View 名称示例 |
| --- | --- |
| `/` | `/` |
| `/users/42`，路由为 `users/[id]` | `/users/[id]` |
| `/docs/a/b`，路由为 `docs/[...slug]` | `/docs/[...slug]` |

只修改 query 或 hash 不会创建新 View。pathname 变化会创建新 View。

当静态 segment 与动态参数值重复时，仅凭 `usePathname()` 和 `useParams()` 无法
唯一还原文件路由，例如 `/users/users`。可以显式提供名称函数：

```tsx
<RumNextjsAppRouter
  getViewName={(pathname, params) => {
    if (params.id) {
      return '/users/[id]'
    }
    return pathname
  }}
/>
```

返回 `undefined` 会跳过当前已提交路由的 View 创建。

每个 Next.js View 会带上：

```text
context.framework = nextjs
context.router = next-router
```

## Pages Router 接入

### 使用 `RumNextjsPagesRouter`

在 `pages/_app.tsx` 中完成客户端初始化并渲染 tracker：

```tsx
import { useEffect } from 'react'
import type { AppProps } from 'next/app'
import { datafluxRum } from '@cloudcare/browser-rum'
import {
  nextjsPlugin,
  RumNextjsPagesRouter
} from '@cloudcare/browser-rum-nextjs'

let initialized = false

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    if (initialized) {
      return
    }
    initialized = true

    datafluxRum.init({
      applicationId: '<APPLICATION_ID>',
      clientToken: '<CLIENT_TOKEN>',
      site: '<PUBLIC_DATAWAY_URL>',
      service: 'web-nextjs',
      env: 'production',
      version: '1.0.0',
      sessionSampleRate: 100,
      plugins: [nextjsPlugin()]
    })
  }, [])

  return (
    <>
      <RumNextjsPagesRouter />
      <Component {...pageProps} />
    </>
  )
}
```

Pages Router 使用 `router.pathname` 作为模板名称，例如实际 URL
`/users/42` 会归入 `/users/[id]`。插件只在路由状态成功提交后创建 View；
`routeChangeError` 和未提交的导航不会创建 View。只修改 query 或 hash 不会创建
新 View。

### 直接传入 Pages Router

需要自定义 View 名称时，可以把 `next/router` 单例直接交给插件，此时不再渲染
`RumNextjsPagesRouter`。以下初始化仍必须在浏览器端执行，例如放入 `_app` 的
`useEffect` 或其他客户端初始化模块：

```ts
import { useEffect } from 'react'
import type { AppProps } from 'next/app'
import Router from 'next/router'
import { datafluxRum } from '@cloudcare/browser-rum'
import { nextjsPlugin } from '@cloudcare/browser-rum-nextjs'

let initialized = false

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    if (initialized) {
      return
    }
    initialized = true

    datafluxRum.init({
      applicationId: '<APPLICATION_ID>',
      clientToken: '<CLIENT_TOKEN>',
      site: '<PUBLIC_DATAWAY_URL>',
      plugins: [
        nextjsPlugin({
          router: Router,
          getViewName(url, router) {
            if (router.pathname.startsWith('/admin/')) {
              return '/admin'
            }
            return router.pathname
          }
        })
      ]
    })
  }, [])

  return <Component {...pageProps} />
}
```

`nextjsPlugin({ getViewName })` 只用于这种直接传入 Pages Router 的方式。标准
`RumNextjsPagesRouter` 使用内置模板命名；App Router 如需自定义名称，应把
`getViewName` 属性直接传给 `RumNextjsAppRouter`。

返回 `undefined` 会跳过当前路由的 View 创建。由于插件已启用手动 View，不建议对
所有路由都返回 `undefined`。

## Next.js 错误采集

### 使用插件 ErrorBoundary

`ErrorBoundary` 与 React 插件的 Boundary 参数一致：

```tsx
'use client'

import { ErrorBoundary } from '@cloudcare/browser-rum-nextjs'

function Fallback({
  error,
  resetError
}: {
  error: Error
  resetError: () => void
}) {
  return (
    <section>
      <p>{error.message}</p>
      <button type="button" onClick={resetError}>
        重试
      </button>
    </section>
  )
}

export function CheckoutBoundary({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <ErrorBoundary
      fallback={Fallback}
      context={{ module: 'checkout' }}
    >
      {children}
    </ErrorBoundary>
  )
}
```

### 在 `error.tsx` 中上报

Next.js App Router 的 `error.tsx` 必须是客户端组件。Next.js 13 至 15 通常把
恢复回调命名为 `reset`；较新版本可能提供 `unstable_retry`。错误上报方式相同，
下面以 `reset` 为例：

```tsx
'use client'

import { useEffect } from 'react'
import { addNextjsError } from '@cloudcare/browser-rum-nextjs'

export default function ErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    addNextjsError(error, undefined, {
      route_boundary: 'dashboard'
    })
  }, [error])

  return (
    <section>
      <p>页面加载失败</p>
      <button type="button" onClick={reset}>
        重试
      </button>
    </section>
  )
}
```

错误对象包含 `digest` 时，插件会附加
`context.digest`，便于关联 Next.js 服务端日志。

### 在 `global-error.tsx` 中上报

根 layout 错误需要使用 `app/global-error.tsx`。该组件替代根 layout，因此必须
自行输出 `<html>` 和 `<body>`：

```tsx
'use client'

import { useEffect } from 'react'
import { addNextjsError } from '@cloudcare/browser-rum-nextjs'

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    addNextjsError(error, undefined, {
      route_boundary: 'global'
    })
  }, [error])

  return (
    <html>
      <body>
        <p>应用发生错误</p>
        <button type="button" onClick={reset}>
          重试
        </button>
      </body>
    </html>
  )
}
```

业务代码已捕获的错误可以直接调用：

```ts
addNextjsError(error, undefined, {
  operation: 'submit_order'
})
```

错误事件会带上 `context.framework = nextjs`。React 提供组件栈时，还会带上
`context.component_stack`。

## 公共 API

| API | 用途 |
| --- | --- |
| `nextjsPlugin(configuration?)` | 注册 Next.js 插件 |
| `onRouterTransitionStart(url)` | 记录 App Router 导航目标，等待 tracker 提交 |
| `RumNextjsAppRouter` | App Router pathname 与动态参数 tracker |
| `RumNextjsPagesRouter` | Pages Router tracker |
| `ErrorBoundary` | 上报 React 子树错误 |
| `addNextjsError(error, errorInfo?, context?)` | 上报已捕获错误 |
| `startNextjsView(name?, url?)` | 自定义 Router 场景手动启动 Next.js View |
| `trackNextjsRouter(router, rum, options?)` | 底层 Pages Router 订阅入口 |
| `computeViewNameFromParams(pathname, params)` | 把 App Router 参数转换为文件路由名称 |

通常只需要使用对应 Router tracker、`nextjsPlugin` 和错误 API。

## 验证接入

1. 打开浏览器 Network，过滤 `/v1/write/rum`。
2. 首次进入页面，确认出现 `type=view`。
3. 进入 `/users/42`，确认 View 名称为 `/users/[id]`。
4. 只修改 `?tab=profile`，确认 View 数量不增加。
5. 触发一次取消或失败导航，确认 View 数量不增加。
6. 在客户端组件中触发错误，确认出现 `type=error`，并包含
   `framework=nextjs`。
7. 对带 `digest` 的 App Router 错误，确认上下文包含 `digest`。

仓库内 App Router Demo：

```bash
npm run demo:nextjs:dev
```

打开 `http://localhost:8083/`。

## 常见问题

### 构建时报 `window is not defined`

RUM 初始化进入了服务端模块。App Router 15.3+ 使用
`instrumentation-client.ts`；较早版本使用带 `'use client'` 的组件，并在
`useEffect` 中初始化。

### 有 Error 但没有框架 View

确认渲染了与当前 Router 匹配的 tracker。App Router 使用
`RumNextjsAppRouter`，Pages Router 使用 `RumNextjsPagesRouter` 或直接传入
Router，两种方式不要混用。

### 一个跳转产生多个 View

整个应用只渲染一个 tracker，也不要同时在业务代码调用
`datafluxRum.startView()`。

### `error.tsx` 中同一错误在开发环境出现两次

检查 React Strict Mode 或热更新是否重复执行 effect。生产环境验证前，可在业务
错误上报封装中按错误对象做一次性去重。

## 参考

- [Next.js instrumentation-client](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client)
- [Next.js Error Handling](https://nextjs.org/docs/app/getting-started/error-handling)
