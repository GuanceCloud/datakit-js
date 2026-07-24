# Web RUM 框架插件接入说明

框架插件负责把框架路由和错误生命周期转换为 RUM View 与 Error。每个插件都是独立 npm 包，可与完整包 `@cloudcare/browser-rum` 或精简包 `@cloudcare/browser-rum-slim` 配合使用。

## 版本要求

- RUM 包版本不得低于框架插件版本，以确保包含插件所需的生命周期能力。
- 一个应用只初始化完整包或精简包中的一个，不要同时初始化两个 RUM 实例。
- Next.js 和 Nuxt 必须在客户端入口初始化，服务端渲染阶段不执行浏览器 SDK。
- React 插件支持 React 18/19、React Router 6/7/8，以及 TanStack Router 1.x。
- Vue 插件支持 Vue 2.7 + Vue Router 3，以及 Vue 3 + Vue Router 4。

支持范围由各包的 `peerDependencies` 约束。当前仓库 lockfile 的主回归组合为：

| 插件 | 主回归依赖 |
| --- | --- |
| React | React 19.2、React Router 6.30/7.18/8.1、TanStack Router 1.170 |
| Vue | Vue 3.5、Vue Router 4.5 |
| Angular | Angular 21.2、RxJS 7.8 |
| Next.js | Next.js 16.2、React 19.2 |
| Nuxt | Nuxt 4.5、Vue 3.5、Vue Router 4.5 |

支持范围下限和其他主版本仍需在发布流水线中使用对应依赖执行兼容回归，不能只用
当前 lockfile 的最新版本结果代替。

## 可用插件

| 框架 | npm 包 | 路由能力 | 错误能力 | 详细文档 |
| --- | --- | --- | --- | --- |
| React | `@cloudcare/browser-rum-react` | React Router 路由模板、query-only 去重 | `ErrorBoundary`、`addReactError` | [React 接入](./framework-react.zh.md) |
| Vue | `@cloudcare/browser-rum-vue` | Vue Router 路由模板、query-only 去重 | Vue `app.config.errorHandler`、`addVueError` | [Vue 接入](./framework-vue.zh.md) |
| Angular | `@cloudcare/browser-rum-angular` | Angular Router、成功导航后启动 View | Angular `ErrorHandler`、`addAngularError` | [Angular 接入](./framework-angular.zh.md) |
| Next.js | `@cloudcare/browser-rum-nextjs` | App Router、Pages Router、动态路由模板 | `ErrorBoundary`、`addNextjsError` | [Next.js 接入](./framework-nextjs.zh.md) |
| Nuxt | `@cloudcare/browser-rum-nuxt` | Nuxt 3/4 路由、动态与 catch-all 模板 | Vue 与 Nuxt `app:error` 去重、`addNuxtError` | [Nuxt 接入](./framework-nuxt.zh.md) |

## 通用初始化规则

插件必须通过 RUM 初始化参数的 `plugins` 数组注册：

```js
import { datafluxRum } from '@cloudcare/browser-rum'
import { reactPlugin } from '@cloudcare/browser-rum-react'

datafluxRum.init({
  applicationId: '<APPLICATION_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  plugins: [reactPlugin()]
})
```

以上示例使用 Public DataWay。DataKit 直连时，用
`datakitOrigin: '<DATAKIT_ORIGIN>'` 替换 `site` 和 `clientToken`。两种上报地址
配置不要同时使用。

React 和 Vue 注册路由集成时，将 `router` 设置为 `true`，并从匹配当前 Router
主版本的插件子路径导入 Router 创建 API：

```js
import { reactPlugin } from '@cloudcare/browser-rum-react'
import { createBrowserRouter } from '@cloudcare/browser-rum-react/react-router-v6'

const router = createBrowserRouter(routes)

datafluxRum.init({
  // ...
  plugins: [reactPlugin({ router: true })]
})
```

React Router 其他入口为 `react-router-v7`、`react-router-v8` 和
`tanstack-router`；Vue Router 入口为 `vue-router-v3` 和
`vue-router-v4`。不要直接从框架插件主入口导入 Router wrapper。

Angular 使用 `provideRumRouter()` 或 `trackAngularRouter()`；Next.js 使用
对应 App Router/Pages Router tracker；Nuxt 在 `.client` 插件中传入
`useRouter()`。具体初始化顺序见上表中的独立文档。

注册路由集成后，插件会在配置校验前启用手动 View。首个框架路由会作为初始 View，后续 pathname 变化启动新 View；仅 query 变化不会重复创建 View。动态路由使用模板名称，例如 `/users/:id` 或 `/users/[id]`，避免每个实体 ID 形成独立 View。

插件错误入口会保留错误发生时的时间和调用栈。即使框架在 RUM 完成启动前报告错误，错误也会在启动后按原始时间进入采集管道。

## 本地 Demo

先安装依赖并构建全部 Demo：

```bash
npm install
npm run demo:frameworks:build
```

启动五个 Demo：

```bash
npm run demo:frameworks:dev
```

访问地址：

| Demo | 地址 |
| --- | --- |
| React | `http://localhost:8082/framework-react/` |
| Vue | `http://localhost:8082/framework-vue/` |
| Angular | `http://localhost:8082/framework-angular/` |
| Next.js | `http://localhost:8083/` |
| Nuxt | `http://localhost:8084/` |

每个 Demo 的验收步骤一致：

1. 进入动态用户路由，确认 View 名称使用路由模板。
2. 只修改 query，确认 View 数量不增加。
3. 触发框架错误，确认 Error 数量增加且事件包含对应的 `context.framework`。
4. 确认页面显示 `Passed`，并存在 `/v1/write/rum` 请求。

## 测试与发布

运行框架插件单元测试、类型测试和 Demo 构建：

```bash
npm run test:unit
npm run test:types:frameworks
npm run test:exports:frameworks
npm run demo:frameworks:build
```

五个插件均可独立发布。发布前应先发布包含插件生命周期能力的 RUM 完整包和精简包，再发布框架包。可使用以下命令检查单个包内容：

```bash
npm pack --dry-run --workspace @cloudcare/browser-rum-react
```

如果后续修改 RUM 的 `plugins` 生命周期、`startView` 参数或内部错误入队结构，需要同步更新完整包、精简包、五个框架包的类型声明与版本约束，并重新执行单元测试、类型测试、五个 Demo 构建和浏览器验收。普通 RUM 采集逻辑变更若不改变这些契约，框架包通常无需改代码，但仍应运行上述回归流程。
