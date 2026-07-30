# Angular RUM 插件接入说明

`@cloudcare/browser-rum-angular` 用于把 Angular Router 导航和 Angular
`ErrorHandler` 捕获到的错误转换为 RUM View 与 Error。

## 支持范围

| 依赖 | 支持版本 |
| --- | --- |
| Angular Core | 15 至 22 |
| Angular Router | 15 至 22 |
| RxJS | 7 及以上 |
| RUM | `@cloudcare/browser-rum` 或 `@cloudcare/browser-rum-slim`，版本不得低于插件版本 |

精简包不包含 Session Replay 和压缩上传能力，但不影响 Angular View 与 Error
采集。

## 安装

```bash
npm install @cloudcare/browser-rum @cloudcare/browser-rum-angular
```

Angular、Angular Router 与 RxJS 由应用提供。

以下示例默认使用 Public DataWay 的 `site + clientToken`。DataKit 直连时，用
`datakitOrigin: '<DATAKIT_ORIGIN>'` 替换这两个字段，不要同时配置两种上报地址。

## Standalone 应用接入

推荐使用插件提供的两个 environment provider：

- `provideRumRouter()`：订阅 Angular Router，启动手动 RUM View。
- `provideRumErrorHandler()`：把 Angular 全局错误上报到 RUM，并保留 Angular
  默认控制台错误输出。

```ts
import { bootstrapApplication } from '@angular/platform-browser'
import { provideRouter } from '@angular/router'
import { datafluxRum } from '@cloudcare/browser-rum'
import { angularPlugin } from '@cloudcare/browser-rum-angular'
import {
  provideRumErrorHandler,
  provideRumRouter
} from '@cloudcare/browser-rum-angular/providers'
import { AppComponent } from './app/app.component'
import { routes } from './app/app.routes'

datafluxRum.init({
  applicationId: '<APPLICATION_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  service: 'web-angular',
  env: 'production',
  version: '1.0.0',
  sessionSampleRate: 100,
  plugins: [
    angularPlugin({
      router: true
    })
  ]
})

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideRumRouter(),
    provideRumErrorHandler()
  ]
})
```

必须同时设置 `angularPlugin({ router: true })` 和注册
`provideRumRouter()`。前者启用手动 View，后者提供实际 Angular Router
订阅。

## 只采集 Angular 错误

不需要 Router 集成时：

```ts
datafluxRum.init({
  applicationId: '<APPLICATION_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  plugins: [angularPlugin()]
})

bootstrapApplication(AppComponent, {
  providers: [provideRumErrorHandler()]
})
```

此时插件不启用手动 View，SDK 继续使用原有浏览器路由采集逻辑。

## View 采集语义

Angular provider 只在收到 `NavigationEnd` 后启动 View。Guard、resolver、lazy
load 或重定向流程尚未成功结束时，不会提前创建 View。

| 场景 | 行为 |
| --- | --- |
| Router 已完成初始导航 | 立即创建初始 View |
| 到达 `NavigationEnd` | 创建新 View |
| 守卫拒绝 | 不创建新 View |
| guard 通过后 resolver、lazy load 等后续阶段失败 | 不创建新 View |
| URL 重定向 | 使用 `urlAfterRedirects` |
| 只修改 query | 不创建新 View |
| 只修改 hash | 不创建新 View |
| 动态路由 | 使用 `/users/:id` 等 `routeConfig.path` 模板 |
| 辅助 outlet | 默认只沿 primary outlet 生成 View 名称 |
| `**` 通配路由 | 使用实际 URL segment |

每个 Router View 都会带上：

```text
context.framework = angular
context.router = angular-router
```

### 自定义 View 名称

`getViewName` 接收当前 primary route snapshot 根节点和导航 URL：

```ts
datafluxRum.init({
  applicationId: '<APPLICATION_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  plugins: [
    angularPlugin({
      router: true,
      getViewName(root, url) {
        if (url.startsWith('/internal/')) {
          return undefined
        }

        return computeBusinessViewName(root)
      }
    })
  ]
})
```

返回 `undefined` 会跳过当前导航的 View 创建。由于 `router: true` 已关闭 SDK
自动 View，不建议对所有路由都返回 `undefined`。

## 自定义 ErrorHandler

`provideRumErrorHandler()` 会替换 Angular `ErrorHandler` provider，并继承 Angular
默认 `ErrorHandler`，适合没有自定义全局处理器的 standalone 应用。

已有自定义 `ErrorHandler` 时，不要再注册 `provideRumErrorHandler()`。在现有处理器
中调用 `addAngularError`：

```ts
import { ErrorHandler, Injectable } from '@angular/core'
import { addAngularError } from '@cloudcare/browser-rum-angular'

@Injectable()
export class AppErrorHandler implements ErrorHandler {
  private readonly defaultHandler = new ErrorHandler()

  handleError(error: unknown): void {
    addAngularError(error, {
      module: 'checkout'
    })

    this.defaultHandler.handleError(error)
  }
}
```

注册业务处理器：

```ts
bootstrapApplication(AppComponent, {
  providers: [
    {
      provide: ErrorHandler,
      useClass: AppErrorHandler
    }
  ]
})
```

插件会向下解析 Angular 包装错误中的 `ngOriginalError` 或 `originalError`，尽可能
上报原始异常。RUM Error 会带上 `context.framework = angular`。

也可以复用包装类：

```ts
import { ErrorHandler } from '@angular/core'
import {
  createAngularErrorHandler
} from '@cloudcare/browser-rum-angular'

const handler = createAngularErrorHandler(new ErrorHandler())
handler.handleError(error)
```

## 手动订阅 Router

无法使用 environment provider 时，可以注入 Router 后调用
`trackAngularRouter`。这种直接调用默认在 `NavigationEnd` 启动 View：

```ts
import { DestroyRef, inject } from '@angular/core'
import { Router } from '@angular/router'
import { datafluxRum } from '@cloudcare/browser-rum'
import {
  trackAngularRouter
} from '@cloudcare/browser-rum-angular'

const router = inject(Router)
const destroyRef = inject(DestroyRef)
const subscription = trackAngularRouter(
  router,
  datafluxRum
) as { unsubscribe(): void } | undefined

destroyRef.onDestroy(() => {
  subscription?.unsubscribe()
})
```

RUM 初始化中仍需设置：

```ts
plugins: [angularPlugin({ router: true })]
```

只传 Router 的 `trackAngularRouter(router)` 可以在 RUM 初始化前调用，插件会等待
RUM 完成初始化后再建立采集，但这种便捷写法不返回后续创建的 subscription。需要在
组件销毁时取消订阅时，应在 RUM 初始化后把 `datafluxRum` 作为第二个参数传入。

另一种方式是把 Router 实例直接传给插件：

```ts
plugins: [
  angularPlugin({
    router,
    getViewName(root) {
      return computeBusinessViewName(root)
    }
  })
]
```

这种方式适合初始化 RUM 时已经能够取得 Router 实例的场景，不应再同时注册
`provideRumRouter()`。

## 公共 API

| API | 用途 |
| --- | --- |
| `angularPlugin(configuration?)` | 注册 Angular 插件，并按需开启手动 View |
| `provideRumRouter()` | Standalone 应用 Router environment provider |
| `provideRumErrorHandler()` | Standalone 应用 ErrorHandler provider |
| `addAngularError(error, context?)` | 上报业务或自定义 ErrorHandler 捕获的错误 |
| `RumAngularErrorHandler` | 包装可选 delegate 的 RUM ErrorHandler 类 |
| `createAngularErrorHandler(delegate?)` | 创建 `RumAngularErrorHandler` 实例 |
| `trackAngularRouter(router, rum?, options?)` | 底层 Router 订阅入口 |
| `computeAngularViewName(root?)` | 沿 primary outlet 计算路由模板名称 |

## 初始化顺序

Standalone 应用推荐：

1. 在 `bootstrapApplication()` 前初始化 RUM。
2. 注册 `angularPlugin({ router: true })`。
3. 在应用 providers 中依次提供 Angular Router、RUM Router provider 和 RUM
   Error provider。

如果受应用结构限制，Router provider 先运行也可以；`trackAngularRouter` 会等待
RUM 初始化。但为了减少启动阶段错误、资源和初始 View 漏采，仍建议尽早初始化。

## 验证接入

1. 打开浏览器 Network，过滤 `/v1/write/rum`。
2. 首次进入页面，确认出现 `type=view`。
3. 从 `/users/1` 跳转到 `/users/2`，确认 View 名称仍为 `/users/:id`。
4. 只修改 query，确认 View 数量不增加。
5. 让 Router guard 返回 `false`，确认没有为取消的导航创建 View。
6. 让 guard 通过但 resolver 失败，确认同样没有创建 View。
7. 在组件事件中抛出错误，确认出现 `type=error`，并包含
   `framework=angular`。

仓库内 Demo：

```bash
npm run dev
```

打开 `http://localhost:8082/framework-angular/`。

## 常见问题

### 启用 `router: true` 后没有 View

确认注册了 `provideRumRouter()`，或主动调用了 `trackAngularRouter()`。
`angularPlugin({ router: true })` 只负责切换手动 View 模式。

### 一个导航产生多个 View

不要同时使用 `provideRumRouter()`、`trackAngularRouter()` 和直接传入 Router
实例。三种方式只选择一种。

### 自定义 ErrorHandler 不再执行

如果应用已有 `ErrorHandler`，使用 `addAngularError()` 接入现有处理器，不要让
`provideRumErrorHandler()` 覆盖它。

### 通配路由产生高基数 View

`**` 路由会保留实际 URL segment。路径中包含用户 ID、订单号等高基数字段时，使用
`getViewName` 统一归类。
