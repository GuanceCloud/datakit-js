# @cloudcare/browser-rum-vue

Vue integration for `@cloudcare/browser-rum` and `@cloudcare/browser-rum-slim`.

Detailed Chinese guide:
[Vue RUM integration](https://github.com/GuanceCloud/datakit-js/blob/master/docs/rum/framework-vue.zh.md).

```bash
npm install @cloudcare/browser-rum @cloudcare/browser-rum-vue
```

```js
import { datafluxRum } from '@cloudcare/browser-rum'
import { vuePlugin } from '@cloudcare/browser-rum-vue'

datafluxRum.init({
  applicationId: '<APP_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  plugins: [vuePlugin({ app, router: true })]
})
```

For a DataKit direct connection, replace `site` and `clientToken` with
`datakitOrigin`. Do not configure both reporting modes.

Passing `app` installs a Vue error handler while preserving the application's existing
handler. Setting `router: true` enables manual view tracking. Import the Router creation
API from the entry matching the installed Vue Router major.

## Vue 3 and Vue Router 4

```js
import { createWebHistory } from 'vue-router'
import { createRouter } from '@cloudcare/browser-rum-vue/vue-router-v4'

const router = createRouter({
  history: createWebHistory(),
  routes
})

datafluxRum.init({
  // ...
  plugins: [vuePlugin({ app, router: true })]
})
```

## Vue 2.7 and Vue Router 3

```js
import Vue from 'vue'
import VueRouter from '@cloudcare/browser-rum-vue/vue-router-v3'
import { vuePlugin } from '@cloudcare/browser-rum-vue'

Vue.use(VueRouter)
const router = new VueRouter({ routes })

datafluxRum.init({
  // ...
  plugins: [vuePlugin({ app: Vue, router: true })]
})
```

Both entries ignore query-only navigation and use matched route templates such
as `/users/:id` as view names.

`addVueError(error, instance, info, context)` is available for custom handlers.

## Demo

From the repository root, run `npm run dev` and open
`http://localhost:8082/framework-vue/`. The demo verifies route-template views,
query-only navigation, the application error handler, and an actual RUM upload.
