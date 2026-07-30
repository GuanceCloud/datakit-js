# @cloudcare/browser-rum-nextjs

Next.js integration for `@cloudcare/browser-rum` and `@cloudcare/browser-rum-slim`.

Detailed Chinese guide:
[Next.js RUM integration](https://github.com/GuanceCloud/datakit-js/blob/master/docs/rum/framework-nextjs.zh.md).

```bash
npm install @cloudcare/browser-rum @cloudcare/browser-rum-nextjs
```

## App Router

Initialize RUM in `instrumentation-client.js` and re-export the transition hook.

```js
import { datafluxRum } from '@cloudcare/browser-rum'
import {
  nextjsPlugin,
  onRouterTransitionStart
} from '@cloudcare/browser-rum-nextjs'

export { onRouterTransitionStart }

datafluxRum.init({
  applicationId: '<APP_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  plugins: [nextjsPlugin()]
})
```

For a DataKit direct connection, replace `site` and `clientToken` with
`datakitOrigin`. Do not configure both reporting modes.

Render the router tracker once in the root layout:

```jsx
import { RumNextjsAppRouter } from '@cloudcare/browser-rum-nextjs'

export default function RootLayout({ children }) {
  return <html><body><RumNextjsAppRouter />{children}</body></html>
}
```

The transition hook records the target URL. A view is created only after the new
pathname commits, so canceled or failed navigations do not create phantom views.
Pass `getViewName(pathname, params)` to `RumNextjsAppRouter` when route parameters
alone cannot disambiguate the file-route template.

## Pages Router

Register `nextjsPlugin()` during client initialization, then render
`RumNextjsPagesRouter` from `pages/_app`. It uses `router.pathname` so dynamic routes
are grouped under names such as `/users/[id]`. Views are created after a successful
route commit; `routeChangeError` is ignored.

```js
datafluxRum.init({
  applicationId: '<APP_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  plugins: [nextjsPlugin()]
})
```

```jsx
import { RumNextjsPagesRouter } from '@cloudcare/browser-rum-nextjs'

export default function App({ Component, pageProps }) {
  return <><RumNextjsPagesRouter /><Component {...pageProps} /></>
}
```

Use `ErrorBoundary` or `addNextjsError(error)` in `error.tsx`. Server-component error
digests are attached to the reported error context.

## Demo

From the repository root, run `npm run demo:nextjs:dev` and open
`http://localhost:8083/`. The command builds the plugin before starting a real Next.js
App Router application. The demo verifies dynamic route names, query-only navigation,
`ErrorBoundary`, hydration, and a RUM upload.
