# @cloudcare/browser-rum-angular

Angular integration for `@cloudcare/browser-rum` and `@cloudcare/browser-rum-slim`.

Detailed Chinese guide:
[Angular RUM integration](https://github.com/GuanceCloud/datakit-js/blob/master/docs/rum/framework-angular.zh.md).

```bash
npm install @cloudcare/browser-rum @cloudcare/browser-rum-angular
```

```ts
import { bootstrapApplication } from '@angular/platform-browser'
import { provideRouter } from '@angular/router'
import { datafluxRum } from '@cloudcare/browser-rum'
import { angularPlugin } from '@cloudcare/browser-rum-angular'
import {
  provideRumErrorHandler,
  provideRumRouter
} from '@cloudcare/browser-rum-angular/providers'

datafluxRum.init({
  applicationId: '<APP_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  plugins: [angularPlugin({ router: true })]
})

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideRumRouter(),
    provideRumErrorHandler()
  ]
})
```

For a DataKit direct connection, replace `site` and `clientToken` with
`datakitOrigin`. Do not configure both reporting modes.

The router provider starts views only after `NavigationEnd` and uses route templates
such as `/users/:id`. Canceled or failed navigations, query-only changes, and hash-only
changes do not create views. The error provider keeps Angular's default console
reporting behavior.

Applications with an existing `ErrorHandler` can call `addAngularError(error, context)`
instead.

## Demo

From the repository root, run `npm run dev` and open
`http://localhost:8082/framework-angular/`. The demo uses a real Angular Router and
ErrorHandler, then verifies route-template views, query-only navigation, and a RUM
upload.
