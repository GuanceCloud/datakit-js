# React RUM 插件接入说明

`@cloudcare/browser-rum-react` 用于把 React 组件错误，以及 React Router 或
TanStack Router 的客户端路由变化转换为 RUM Error 和 View。

## 支持范围

| 依赖 | 支持版本 |
| --- | --- |
| React | 18、19 |
| React Router | 6、7、8 |
| TanStack Router | 1.x |
| RUM | `@cloudcare/browser-rum` 或 `@cloudcare/browser-rum-slim`，版本不得低于插件版本 |

完整包和精简包使用同一套 React 插件。使用精简包时，只需要把示例中的
`@cloudcare/browser-rum` 替换为 `@cloudcare/browser-rum-slim`。精简包不包含
Session Replay 和压缩上传能力，这不影响 React View 与 Error 采集。

## 安装

```bash
npm install @cloudcare/browser-rum @cloudcare/browser-rum-react
```

Router 依赖需要由应用自行安装。例如：

```bash
# React Router 6
npm install react-router-dom@6

# React Router 7
npm install react-router@7

# React Router 8
npm install react-router@8

# TanStack Router 1.x
npm install @tanstack/react-router@1
```

以下示例默认使用 Public DataWay 的 `site + clientToken`。DataKit 直连时，用
`datakitOrigin: '<DATAKIT_ORIGIN>'` 替换这两个字段，不要同时配置两种上报地址。

## 只采集 React 错误

不需要框架路由集成时，直接注册基础插件：

```js
import { datafluxRum } from '@cloudcare/browser-rum'
import { reactPlugin } from '@cloudcare/browser-rum-react'

datafluxRum.init({
  applicationId: '<APPLICATION_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  service: 'web-react',
  env: 'production',
  version: '1.0.0',
  sessionSampleRate: 100,
  plugins: [reactPlugin()]
})
```

此配置不会启用手动 View。SDK 仍按原有浏览器路由逻辑采集 View，React 插件只提供
React 错误上报入口。仍需使用下面的 `ErrorBoundary` 或 `addReactError()`，插件
不会仅凭注册动作自动发现 React 组件错误。

## 使用 ErrorBoundary

建议在应用根节点或关键业务区域外层放置 `ErrorBoundary`：

```jsx
import { ErrorBoundary } from '@cloudcare/browser-rum-react'

function ErrorFallback({ error, resetError }) {
  return (
    <section>
      <p>{error.message}</p>
      <button type="button" onClick={resetError}>
        重试
      </button>
    </section>
  )
}

root.render(
  <ErrorBoundary
    fallback={ErrorFallback}
    context={{ module: 'checkout' }}
    onError={(error, errorInfo) => {
      console.error(error, errorInfo)
    }}
    onReset={() => {
      window.location.reload()
    }}
  >
    <App />
  </ErrorBoundary>
)
```

`ErrorBoundary` 支持以下属性：

| 属性 | 说明 |
| --- | --- |
| `fallback` | React 节点，或接收 `{ error, resetError }` 的组件 |
| `context` | 附加到 RUM Error 的业务上下文 |
| `onError` | RUM 记录错误后调用，参数与 React `componentDidCatch` 一致 |
| `onReset` | 调用 `resetError()` 清除 Boundary 状态后执行 |
| `children` | 被保护的 React 子树 |

错误事件会带上 `context.framework = react`；React 提供组件栈时，还会带上
`context.component_stack`。

已有 ErrorBoundary 或 React 19 根节点错误回调时，可以直接调用
`addReactError`：

```jsx
import { createRoot } from 'react-dom/client'
import { addReactError } from '@cloudcare/browser-rum-react'

const root = createRoot(document.getElementById('root'), {
  onUncaughtError: (error, errorInfo) => {
    addReactError(error, errorInfo, { module: 'root' })
  }
})
```

业务代码主动捕获的错误也可以上报：

```js
try {
  await submitOrder()
} catch (error) {
  addReactError(error, undefined, {
    operation: 'submit_order'
  })
}
```

## React Router 接入原则

启用 Router 集成时必须同时完成两件事：

1. 在 `reactPlugin` 中设置 `router: true`。
2. 从与 Router 主版本匹配的插件子路径导入 Router 创建 API 或 `Routes`。

插件主入口不再导出 Router wrapper。不要从
`@cloudcare/browser-rum-react` 导入 `createBrowserRouter`、`Routes` 或
`useRoutes`。

启用 `router: true` 后，SDK 会切换到手动 View 模式。如果仍直接使用原始 Router
创建 API，插件收不到路由状态，可能导致 View 不完整。

### React Router v6 Data Router

```jsx
import { RouterProvider } from 'react-router-dom'
import {
  createBrowserRouter
} from '@cloudcare/browser-rum-react/react-router-v6'
import { datafluxRum } from '@cloudcare/browser-rum'
import { reactPlugin } from '@cloudcare/browser-rum-react'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Home />
  },
  {
    path: '/users/:id',
    element: <UserDetail />
  }
])

datafluxRum.init({
  applicationId: '<APPLICATION_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  plugins: [reactPlugin({ router: true })]
})

root.render(<RouterProvider router={router} />)
```

v6 子路径还导出：

- `createHashRouter`
- `createMemoryRouter`
- `useRoutes`
- `Routes`

其他 API，例如 `RouterProvider`、`Route`、`Link` 和 `Outlet`，继续从
`react-router-dom` 导入。

### React Router v6 JSX Routes

```jsx
import { BrowserRouter, Route } from 'react-router-dom'
import { Routes } from '@cloudcare/browser-rum-react/react-router-v6'

root.render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/users/:id" element={<UserDetail />} />
    </Routes>
  </BrowserRouter>
)
```

使用 `useRoutes()` 时也应从 v6 子路径导入：

```jsx
import {
  useRoutes
} from '@cloudcare/browser-rum-react/react-router-v6'

function AppRoutes() {
  return useRoutes(routes)
}
```

### React Router v7

React Router v7 的 wrapper 从 `react-router-v7` 子路径导入，其余 API 从
`react-router` 导入：

```jsx
import { RouterProvider } from 'react-router'
import {
  createBrowserRouter
} from '@cloudcare/browser-rum-react/react-router-v7'

const router = createBrowserRouter(routes)
root.render(<RouterProvider router={router} />)
```

### React Router v8

React Router v8 使用独立子路径：

```jsx
import { RouterProvider } from 'react-router'
import {
  createBrowserRouter
} from '@cloudcare/browser-rum-react/react-router-v8'

const router = createBrowserRouter(routes)
root.render(<RouterProvider router={router} />)
```

v7 和 v8 子路径均导出 `createBrowserRouter`、`createHashRouter`、
`createMemoryRouter`、`useRoutes` 和 `Routes`。

### TanStack Router

```jsx
import { RouterProvider } from '@tanstack/react-router'
import {
  createRouter
} from '@cloudcare/browser-rum-react/tanstack-router'
import { datafluxRum } from '@cloudcare/browser-rum'
import { reactPlugin } from '@cloudcare/browser-rum-react'

const router = createRouter({ routeTree })

datafluxRum.init({
  applicationId: '<APPLICATION_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  plugins: [reactPlugin({ router: true })]
})

root.render(<RouterProvider router={router} />)
```

其他 TanStack Router API 继续从 `@tanstack/react-router` 导入。

## View 命名与去重

| 场景 | 行为 |
| --- | --- |
| 首次进入路由 | 创建初始 View |
| pathname 变化且 React 已提交新路由 | 创建新 View |
| Suspense、并发渲染或错误导致新路由未提交 | 不创建新 View |
| 只修改 query | 不创建新 View |
| 只修改 hash | 不创建新 View |
| 动态路由 | 使用 `/users/:id` 等路由模板作为 View 名称 |
| React Router splat | 最末级 `*` 会替换为实际匹配路径 |
| TanStack Router | 使用最后一个 match 的 `fullPath`；`/$` splat 会替换为实际路径 |

每个 Router View 会带上：

```text
context.framework = react
context.router = react-router
```

TanStack Router 的 `context.router` 为 `tanstack-router`。

### 自定义 React Router View 名称

`getViewName` 适用于 React Router v6/v7/v8：

```js
const plugin = reactPlugin({
  router: true,
  getViewName(location, matches) {
    const leaf = matches && matches[matches.length - 1]

    if (leaf && leaf.route && leaf.route.handle?.rumViewName) {
      return leaf.route.handle.rumViewName
    }

    return location?.pathname
  }
})
```

返回 `undefined` 会跳过当前路由的 View 创建。由于 `router: true` 已关闭 SDK
自动 View，不建议对所有路由都返回 `undefined`。

TanStack Router 当前固定使用 Router match 生成名称，不读取 `getViewName`。

## 公共 API

| API | 用途 |
| --- | --- |
| `reactPlugin(configuration?)` | 注册 React 插件，并按需开启手动 Router View |
| `ErrorBoundary` | 默认 RUM React ErrorBoundary |
| `createErrorBoundary(reportError?, displayName?)` | 创建使用自定义上报函数或名称的 Boundary |
| `addReactError(error, errorInfo?, context?)` | 上报已有 Boundary 或业务捕获的错误 |

React Router 和 TanStack Router 的版本化子路径导出项见前面的 Router 章节。

## 验证接入

1. 打开浏览器 Network，过滤 `/v1/write/rum`。
2. 首次进入页面，确认出现 `type=view` 数据。
3. 从 `/users/1` 跳转到 `/users/2`，确认 View 名称仍为 `/users/:id`。
4. 只把 URL 改为 `/users/2?tab=profile`，确认没有新增 View。
5. 触发组件渲染错误，确认出现 `type=error`，且上下文包含
   `framework=react`。

仓库内 Demo：

```bash
npm run dev
```

打开 `http://localhost:8082/framework-react/`。

## 常见问题

### 启用 `router: true` 后没有 View

确认 Router 创建 API、`Routes` 或 `useRoutes` 来自与当前主版本匹配的插件子路径。
只注册 `reactPlugin({ router: true })` 不足以获取 Router 状态。

### 一个跳转产生多个 View

不要同时使用插件 Router wrapper 和业务代码中的
`datafluxRum.startView()`。同一个应用也不要注册多个 React Router wrapper。

### ErrorBoundary 没有捕获事件处理函数中的错误

这是 React ErrorBoundary 的边界：它主要捕获渲染、生命周期和子组件构造阶段错误。
事件处理、定时器和业务 Promise 中已捕获的错误，请调用 `addReactError()`。

### 动态路由形成高基数 View

优先使用 `:id` 路由模板。对于 splat 路由，插件会保留实际匹配后缀；如果后缀包含
用户或实体标识，可通过 React Router 的 `getViewName` 统一归类。
