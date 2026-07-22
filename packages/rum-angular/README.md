# @cloudcare/browser-rum-angular

Angular integration for `@cloudcare/browser-rum` and `@cloudcare/browser-rum-slim`.

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
  datakitOrigin: '<DATAKIT_ORIGIN>',
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

The router provider starts views after guards pass and uses route templates such as
`/users/:id`. Query and hash-only changes do not create views. The error provider keeps
Angular's default console reporting behavior.

Applications with an existing `ErrorHandler` can call `addAngularError(error, context)`
instead.

## Demo

From the repository root, run `npm run dev` and open
`http://localhost:8082/framework-angular/`. The demo uses a real Angular Router and
ErrorHandler, then verifies route-template views, query-only navigation, and a RUM
upload.
