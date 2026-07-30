# @cloudcare/browser-rum-nuxt

Nuxt 3/4 integration for `@cloudcare/browser-rum` and
`@cloudcare/browser-rum-slim`.

Detailed Chinese guide:
[Nuxt RUM integration](https://github.com/GuanceCloud/datakit-js/blob/master/docs/rum/framework-nuxt.zh.md).

```bash
npm install @cloudcare/browser-rum @cloudcare/browser-rum-nuxt
```

Create a client plugin that runs before other application plugins:

```js
import { datafluxRum } from '@cloudcare/browser-rum'
import { nuxtRumPlugin } from '@cloudcare/browser-rum-nuxt'

export default defineNuxtPlugin({
  name: 'dataflux-rum',
  enforce: 'pre',
  setup() {
    datafluxRum.init({
      applicationId: '<APP_ID>',
      clientToken: '<CLIENT_TOKEN>',
      site: '<PUBLIC_DATAWAY_URL>',
      plugins: [
        nuxtRumPlugin({
          nuxtApp: useNuxtApp(),
          router: useRouter()
        })
      ]
    })
  }
})
```

For a DataKit direct connection, replace `site` and `clientToken` with
`datakitOrigin`. Do not configure both reporting modes.

The integration tracks initial and client-side routes, converts Vue Router parameter
paths to Nuxt names such as `/users/[id]`, ignores query-only changes, and tracks hash
changes. Vue and `app:error` reports from the same propagation cycle are deduplicated
while preserving custom Nuxt error handlers. Reusing the same `Error` object later is
reported again.

`addNuxtError(error, context)` is available for handled errors.

## Demo

From the repository root, run `npm run demo:nuxt:dev` and open
`http://localhost:8084/`. The command builds the plugin before starting a real Nuxt
application. The demo verifies Nuxt route names, query-only navigation, application
error handling, and a RUM upload.
