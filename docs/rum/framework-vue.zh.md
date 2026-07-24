# Vue RUM 插件接入说明

`@cloudcare/browser-rum-vue` 用于把 Vue 组件错误和 Vue Router 路由变化转换为
RUM Error 与 View。

## 支持范围

| Vue | Vue Router | 插件子路径 |
| --- | --- | --- |
| Vue 2.7 | Vue Router 3 | `@cloudcare/browser-rum-vue/vue-router-v3` |
| Vue 3 | Vue Router 4 | `@cloudcare/browser-rum-vue/vue-router-v4` |

RUM 可以使用 `@cloudcare/browser-rum` 或
`@cloudcare/browser-rum-slim`，版本不得低于 Vue 插件版本。精简包不包含
Session Replay 和压缩上传能力，但不影响 Vue View 与 Error 采集。

## 安装

Vue 3：

```bash
npm install @cloudcare/browser-rum @cloudcare/browser-rum-vue vue@3 vue-router@4
```

Vue 2.7：

```bash
npm install @cloudcare/browser-rum @cloudcare/browser-rum-vue vue@2.7 vue-router@3
```

以下示例默认使用 Public DataWay 的 `site + clientToken`。DataKit 直连时，用
`datakitOrigin: '<DATAKIT_ORIGIN>'` 替换这两个字段，不要同时配置两种上报地址。

## Vue 3 与 Vue Router 4

### 完整接入

```js
import { createApp } from 'vue'
import { createWebHistory } from 'vue-router'
import {
  createRouter
} from '@cloudcare/browser-rum-vue/vue-router-v4'
import { datafluxRum } from '@cloudcare/browser-rum'
import { vuePlugin } from '@cloudcare/browser-rum-vue'
import App from './App.vue'

const app = createApp(App)
const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: () => import('./pages/Home.vue')
    },
    {
      path: '/users/:id',
      component: () => import('./pages/UserDetail.vue')
    }
  ]
})

app.use(router)

datafluxRum.init({
  applicationId: '<APPLICATION_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  service: 'web-vue',
  env: 'production',
  version: '1.0.0',
  sessionSampleRate: 100,
  plugins: [
    vuePlugin({
      app,
      router: true
    })
  ]
})

app.mount('#app')
```

`createWebHistory`、`createWebHashHistory`、`RouterLink` 和 `RouterView`
等其他 Vue Router API 仍从 `vue-router` 导入。只有 `createRouter` 从插件的
`vue-router-v4` 子路径导入。

### 只采集 Vue 错误

不需要 Vue Router 集成时，不设置 `router`：

```js
datafluxRum.init({
  applicationId: '<APPLICATION_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  plugins: [vuePlugin({ app })]
})
```

传入 `app` 后，插件会安装 `app.config.errorHandler`，并保留应用原有的错误处理器。

## Vue 2.7 与 Vue Router 3

Vue Router 3 使用构造函数，因此需要从 v3 子路径导入默认导出：

```js
import Vue from 'vue'
import VueRouter from '@cloudcare/browser-rum-vue/vue-router-v3'
import { datafluxRum } from '@cloudcare/browser-rum'
import { vuePlugin } from '@cloudcare/browser-rum-vue'
import App from './App.vue'

Vue.use(VueRouter)

const router = new VueRouter({
  mode: 'history',
  routes: [
    {
      path: '/',
      component: () => import('./pages/Home.vue')
    },
    {
      path: '/users/:id',
      component: () => import('./pages/UserDetail.vue')
    }
  ]
})

datafluxRum.init({
  applicationId: '<APPLICATION_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  service: 'web-vue2',
  env: 'production',
  version: '1.0.0',
  sessionSampleRate: 100,
  plugins: [
    vuePlugin({
      app: Vue,
      router: true
    })
  ]
})

new Vue({
  router,
  render: (h) => h(App)
}).$mount('#app')
```

v3 wrapper 保留了原构造函数上的 `install` 等静态属性，因此可以正常执行
`Vue.use(VueRouter)`。

## Router 接入原则

启用 Router 集成时必须同时完成两件事：

1. 设置 `vuePlugin({ router: true })`。
2. 使用与 Vue Router 主版本匹配的插件子路径创建 Router。

插件主入口只导出 `vuePlugin`、`addVueError` 和
`installVueErrorHandler`，不再导出 Router wrapper。

启用 `router: true` 后，SDK 会切换到手动 View 模式。如果 Router 仍由原始
`vue-router` 入口创建，插件无法订阅路由，可能导致 View 不完整。

## View 命名与去重

| 场景 | 行为 |
| --- | --- |
| Router 已有已匹配的初始路由 | 创建初始 View |
| pathname 变化且导航成功 | 创建新 View |
| 导航失败 | 不创建 View |
| 只修改 query | 不创建新 View |
| 只修改 hash | 不创建新 View |
| 动态路由 | 使用 `/users/:id` 等 matched route 模板 |
| catch-all 路由 | 使用实际匹配的路径后缀 |

每个 Router View 都会带上：

```text
context.framework = vue
context.router = vue-router
```

### 使用路由 meta 设置 View 名称

Vue Router 3 和 4 都可以通过 `meta.rumViewName` 指定名称：

```js
const routes = [
  {
    path: '/checkout/:step',
    component: Checkout,
    meta: {
      rumViewName: '/checkout/step'
    }
  }
]
```

### 使用 `getViewName`

`getViewName` 的优先级高于 `meta.rumViewName`：

```js
datafluxRum.init({
  applicationId: '<APPLICATION_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  plugins: [
    vuePlugin({
      app,
      router: true,
      getViewName(route) {
        if (route.meta?.skipRumView) {
          return undefined
        }

        return route.meta?.rumViewName || route.matched.at(-1)?.path
      }
    })
  ]
})
```

返回 `undefined` 会跳过当前路由的 View 创建。由于 `router: true` 已关闭 SDK
自动 View，不建议对所有路由都返回 `undefined`。

## Vue 错误采集

传入 `app` 后，插件会：

1. 保存当前 `app.config.errorHandler`。
2. 先把错误上报为 RUM Error。
3. 再调用原有错误处理器，并保持原有 `this` 与参数。

错误事件会带上 `context.framework = vue`。能够识别组件实例时，还会生成
`context.component_stack`。

已有自定义错误链路时，可以主动调用：

```js
import { addVueError } from '@cloudcare/browser-rum-vue'

app.config.errorHandler = (error, instance, info) => {
  addVueError(error, instance, info, {
    module: 'checkout'
  })

  reportToConsole(error)
}
```

如果不通过 `vuePlugin({ app })` 自动安装，也可以单独安装错误处理器：

```js
import {
  installVueErrorHandler,
  vuePlugin
} from '@cloudcare/browser-rum-vue'

datafluxRum.init({
  applicationId: '<APPLICATION_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  plugins: [vuePlugin()]
})

const stop = installVueErrorHandler(app, datafluxRum)

// 应用销毁时可恢复安装前的 errorHandler
stop?.()
```

单独安装时，应传入已经初始化的 `datafluxRum`。如果省略第二个参数，则仍必须注册
`vuePlugin()`，错误才能通过插件生命周期进入 RUM。

不要同时使用 `vuePlugin({ app })` 自动安装和
`installVueErrorHandler(app)` 手动安装，否则同一个错误可能重复上报。

## 公共 API

| API | 用途 |
| --- | --- |
| `vuePlugin(configuration?)` | 注册 Vue 错误集成，并按需开启手动 Router View |
| `addVueError(error, instance?, info?, context?)` | 上报业务或自定义 handler 捕获的错误 |
| `installVueErrorHandler(app, rum?)` | 安装 Vue error handler，并返回恢复函数 |
| `vue-router-v3` 默认导出 | 包装后的 Vue Router 3 构造函数 |
| `vue-router-v4` 的 `createRouter` | 包装后的 Vue Router 4 创建函数 |

## 初始化顺序

推荐顺序：

1. 创建 Vue app。
2. 使用插件 Router 子路径创建 Router。
3. `app.use(router)`。
4. 初始化 RUM 并注册 `vuePlugin`。
5. `app.mount()`。

Router 在 RUM 初始化前创建也可以，插件会在 RUM 完成初始化后处理已注册的路由
回调。但应确保首个业务页面渲染前完成 RUM 初始化，以减少早期错误和资源漏采。

## 验证接入

1. 打开浏览器 Network，过滤 `/v1/write/rum`。
2. 首次进入页面，确认出现 `type=view`。
3. 从 `/users/1` 跳转到 `/users/2`，确认 View 名称仍为 `/users/:id`。
4. 只修改 query，确认 View 数量不增加。
5. 在 Vue 组件事件或渲染中抛出错误，确认出现 `type=error`，并包含
   `framework=vue`。

仓库内 Demo：

```bash
npm run dev
```

打开 `http://localhost:8082/framework-vue/`。

## 常见问题

### Vue 2 项目无法 `Vue.use`

确认默认导入来自：

```js
import VueRouter from '@cloudcare/browser-rum-vue/vue-router-v3'
```

不要在 Vue Router 3 项目中使用 `vue-router-v4`。

### 启用 `router: true` 后没有 View

确认 Router 是通过匹配版本的插件子路径创建的。只注册
`vuePlugin({ router: true })` 不会自动接管由原始入口创建的 Router。

### 错误出现两次

检查是否既传入了 `app`，又手动调用 `addVueError` 或
`installVueErrorHandler`。同一个错误只保留一种接入方式。

### catch-all 路由产生大量 View 名称

catch-all 会保留实际匹配后缀。路径中包含用户 ID、订单号等高基数字段时，使用
`meta.rumViewName` 或 `getViewName` 统一归类。
