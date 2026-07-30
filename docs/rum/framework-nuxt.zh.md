# Nuxt RUM 插件接入说明

`@cloudcare/browser-rum-nuxt` 用于把 Nuxt 客户端页面路由、Vue 组件错误和
Nuxt `app:error` 转换为 RUM View 与 Error。

## 支持范围

| 依赖 | 支持版本 |
| --- | --- |
| Nuxt | 3、4 |
| Vue | 3 |
| Vue Router | 4 |
| RUM | `@cloudcare/browser-rum` 或 `@cloudcare/browser-rum-slim`，版本不得低于插件版本 |

Nuxt 同时运行服务端与客户端代码。RUM 只能在客户端插件中初始化，采集浏览器内的
View、资源、行为和错误。纯 Nitro、SSR 或其他未传到客户端的服务端错误，需要使用
服务端监控方案。

精简包不包含 Session Replay 和压缩上传能力，但不影响 Nuxt View 与 Error
采集。

## 安装

```bash
npm install @cloudcare/browser-rum @cloudcare/browser-rum-nuxt
```

以下示例默认使用 Public DataWay 的 `site + clientToken`。DataKit 直连时，用
`datakitOrigin: '<DATAKIT_ORIGIN>'` 替换这两个字段，不要同时配置两种上报地址。

## 推荐接入

在 `app/plugins` 或项目对应的 Nuxt plugins 目录中创建
`rum.client.ts`。`.client` 后缀确保代码只在浏览器运行。

```ts
import { datafluxRum } from '@cloudcare/browser-rum'
import { nuxtRumPlugin } from '@cloudcare/browser-rum-nuxt'

export default defineNuxtPlugin({
  name: 'dataflux-rum',
  enforce: 'pre',
  setup(nuxtApp) {
    datafluxRum.init({
      applicationId: '<APPLICATION_ID>',
      clientToken: '<CLIENT_TOKEN>',
      site: '<PUBLIC_DATAWAY_URL>',
      service: 'web-nuxt',
      env: 'production',
      version: '1.0.0',
      sessionSampleRate: 100,
      plugins: [
        nuxtRumPlugin({
          nuxtApp,
          router: useRouter()
        })
      ]
    })
  }
})
```

Nuxt 会自动注册 plugins 目录顶层的插件，不需要再把该文件写入
`nuxt.config.ts`。`enforce: 'pre'` 可以让 RUM 尽早安装路由和错误监听。

如果使用精简包：

```ts
import { datafluxRum } from '@cloudcare/browser-rum-slim'
```

其余插件配置不变。

## 使用 runtimeConfig

可以把不同环境的公开 RUM 配置放入 `runtimeConfig.public`：

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      rumApplicationId: '',
      rumClientToken: '',
      rumSite: '',
      appEnv: 'production',
      appVersion: '1.0.0'
    }
  }
})
```

客户端插件读取：

```ts
export default defineNuxtPlugin({
  name: 'dataflux-rum',
  enforce: 'pre',
  setup(nuxtApp) {
    const config = useRuntimeConfig()

    datafluxRum.init({
      applicationId: config.public.rumApplicationId,
      clientToken: config.public.rumClientToken,
      site: config.public.rumSite,
      env: config.public.appEnv,
      version: config.public.appVersion,
      plugins: [
        nuxtRumPlugin({
          nuxtApp,
          router: useRouter()
        })
      ]
    })
  }
})
```

客户端可读取 `runtimeConfig.public`。RUM `clientToken` 本来就是浏览器端上报
token，可以放在这里；其他服务端密钥不能放入 `public`。

## View 采集语义

插件会读取 Nuxt 使用的 Vue Router：

| 场景 | 行为 |
| --- | --- |
| 初始路由已匹配 | 创建初始 View |
| pathname 变化且导航成功 | 创建新 View |
| 导航失败 | 不创建 View |
| 只修改 query | 不创建新 View |
| hash 变化 | 创建新 View |
| 动态路由 | 转换为 Nuxt 文件路由名称 |

Nuxt 路由模板转换示例：

| Vue Router record path | RUM View 名称 |
| --- | --- |
| `/users/:id` | `/users/[id]` |
| `/users/:id?` | `/users/[[id]]` |
| `/docs/:slug(.*)*` | `/docs/[...slug]` |
| `/docs/:slug([^/]*)*` | `/docs/[...slug]` |

每个 Nuxt View 都会带上：

```text
context.framework = nuxt
context.router = vue-router
```

### 自定义 View 名称

```ts
datafluxRum.init({
  applicationId: '<APPLICATION_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  plugins: [
    nuxtRumPlugin({
      nuxtApp,
      router: useRouter(),
      getViewName(route) {
        if (route.path?.startsWith('/admin/')) {
          return '/admin'
        }

        const leaf = route.matched?.[route.matched.length - 1]
        return leaf?.path
      }
    })
  ]
})
```

返回 `undefined` 会跳过当前路由的 View 创建。Nuxt 插件始终启用手动 View，不建议
对所有路由都返回 `undefined`。

自定义函数返回的是最终 View 名称，插件不会再执行 Nuxt 路由模板转换。

## 错误采集

传入 `nuxtApp` 后，插件会同时处理：

- `nuxtApp.vueApp.config.errorHandler` 收到的 Vue 组件错误；
- Nuxt `app:error` 收到的应用启动和致命错误。

同一个 Error 对象同时经过 Vue 与 Nuxt 错误链路时，插件只上报一次。应用已有自定义
Vue error handler 时，插件会在 RUM 上报后继续调用原处理器。

错误事件会带上 `context.framework = nuxt`。能够识别 Vue 组件实例时，还会生成
`context.component_stack`。

### 上报业务已捕获错误

```ts
import { addNuxtError } from '@cloudcare/browser-rum-nuxt'

try {
  await submitOrder()
} catch (error) {
  addNuxtError(error, {
    operation: 'submit_order',
    module: 'checkout'
  })
}
```

### 手动安装错误处理

特殊场景下可以只安装 Nuxt 错误处理器：

```ts
import {
  installNuxtErrorHandler
} from '@cloudcare/browser-rum-nuxt'

const stop = installNuxtErrorHandler(nuxtApp, datafluxRum)

// 应用销毁时恢复原处理器并移除 Nuxt hook
stop?.()
```

不要同时传入 `nuxtRumPlugin({ nuxtApp, ... })` 并调用
`installNuxtErrorHandler()`，否则会安装两层处理器。

## 公共 API

| API | 用途 |
| --- | --- |
| `nuxtRumPlugin(configuration)` | 注册 Nuxt Router 与错误集成 |
| `nuxtPlugin(configuration)` | `nuxtRumPlugin` 的同名能力入口 |
| `addNuxtError(error, context?)` | 上报已捕获的 Nuxt 业务错误 |
| `installNuxtErrorHandler(nuxtApp, rum)` | 单独安装错误集成并返回清理函数 |
| `setupNuxtErrorHandling(nuxtApp, reportError)` | 使用自定义错误回调安装底层 Nuxt 错误集成 |
| `startTrackingNuxtViews(rum, router, options?)` | 低层 Router 跟踪入口 |
| `trackNuxtRouter(router, rum, options?)` | 低层 Router 跟踪入口 |
| `computeNuxtViewName(matched)` | 从 matched route records 计算 View 名称 |
| `normalizeNuxtRoutePath(path)` | 把 Vue Router 参数路径转换为 Nuxt 文件路由名称 |

业务项目通常只需要 `nuxtRumPlugin` 和 `addNuxtError`。

## 初始化与插件顺序

- 文件必须使用 `.client.ts` 或 `.client.js` 后缀。
- 推荐使用 object syntax 和 `enforce: 'pre'`。
- 同一个浏览器页面只能初始化一次 RUM。
- 如果其他插件会替换 `vueApp.config.errorHandler`，应明确插件顺序，并让后安装的
  handler 保留前一个 handler。
- 不要同时注册 Nuxt 插件与 Vue RUM 插件来跟踪同一个 Router。

## 验证接入

1. 打开浏览器 Network，过滤 `/v1/write/rum`。
2. 首次进入页面，确认出现 `type=view`。
3. 进入 `/users/42`，确认 View 名称为 `/users/[id]`。
4. 只修改 query，确认 View 数量不增加。
5. 修改 hash，确认创建新 View。
6. 在 Vue 组件事件中抛出错误，确认出现 `type=error`，并包含
   `framework=nuxt`。

仓库内 Nuxt Demo：

```bash
npm run demo:nuxt:dev
```

打开 `http://localhost:8084/`。

## 常见问题

### 服务端构建时报 `window is not defined`

插件文件没有使用 `.client` 后缀，或 RUM 初始化被导入到服务端模块。把完整初始化
逻辑放入 `rum.client.ts`。

### 配置后没有 View

`nuxtRumPlugin` 必须传入 `router: useRouter()`。不要只传 `nuxtApp`。

### 同一个错误上报两次

插件会对同一次错误传播中的 Vue handler 和 `app:error` 链路去重；下一事件循环再次
出现同一个 `Error` 对象仍会正常上报。插件无法自动识别业务代码再次调用
`addNuxtError` 的重复上报，确认同一个错误只走一种业务入口。

### 动态路由仍然形成高基数 View

默认 Nuxt 路由参数会转换为 `[id]` 等模板。自定义 `getViewName` 时，如果直接返回
`route.path` 的实际值，需要由业务自行移除 ID、订单号等高基数字段。

## 参考

- [Nuxt plugins 目录](https://nuxt.com/docs/3.x/directory-structure/plugins)
- [Nuxt Error Handling](https://nuxt.com/docs/3.x/getting-started/error-handling)
