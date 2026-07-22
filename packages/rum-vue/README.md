# @cloudcare/browser-rum-vue

Vue integration for `@cloudcare/browser-rum` and `@cloudcare/browser-rum-slim`.

```bash
npm install @cloudcare/browser-rum @cloudcare/browser-rum-vue
```

```js
import { datafluxRum } from '@cloudcare/browser-rum'
import { vuePlugin } from '@cloudcare/browser-rum-vue'

datafluxRum.init({
  applicationId: '<APP_ID>',
  datakitOrigin: '<DATAKIT_ORIGIN>',
  plugins: [vuePlugin({ app, router })]
})
```

Passing `app` installs a Vue error handler while preserving the application's existing
handler. Passing `router` enables manual view tracking, ignores query-only changes, and
uses matched route templates such as `/users/:id` as view names.

For routers created before RUM initialization, either pass the router instance to the
plugin or wrap the router factory:

```js
import { createRouter as createVueRouter } from 'vue-router'
import { wrapCreateVueRouter } from '@cloudcare/browser-rum-vue'

const createRouter = wrapCreateVueRouter(createVueRouter)
const router = createRouter(routerOptions)

datafluxRum.init({
  // ...
  plugins: [vuePlugin({ app, router: true })]
})
```

`addVueError(error, instance, info, context)` is available for custom handlers.

## Demo

From the repository root, run `npm run dev` and open
`http://localhost:8082/framework-vue/`. The demo verifies route-template views,
query-only navigation, the application error handler, and an actual RUM upload.
