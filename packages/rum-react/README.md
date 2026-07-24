# @cloudcare/browser-rum-react

React integration for `@cloudcare/browser-rum` and `@cloudcare/browser-rum-slim`.
Supports React 18 and 19.

Detailed Chinese guide:
[React RUM integration](https://github.com/GuanceCloud/datakit-js/blob/master/docs/rum/framework-react.zh.md).

```bash
npm install @cloudcare/browser-rum @cloudcare/browser-rum-react
```

```js
import { datafluxRum } from '@cloudcare/browser-rum'
import { reactPlugin } from '@cloudcare/browser-rum-react'

datafluxRum.init({
  applicationId: '<APP_ID>',
  clientToken: '<CLIENT_TOKEN>',
  site: '<PUBLIC_DATAWAY_URL>',
  plugins: [reactPlugin()]
})
```

For a DataKit direct connection, replace `site` and `clientToken` with
`datakitOrigin`. Do not configure both reporting modes.

## Error handling

Use the provided boundary or report an error from an existing boundary.

```jsx
import {
  ErrorBoundary,
  addReactError
} from '@cloudcare/browser-rum-react'

<ErrorBoundary fallback={({ resetError }) => (
  <button onClick={resetError}>Retry</button>
)}>
  <App />
</ErrorBoundary>

// React 19 createRoot option
createRoot(container, { onUncaughtError: addReactError })
```

## React Router

Enable manual view tracking and import Router APIs from the entry matching the
installed React Router major. Route templates such as `/users/:id` are used as
view names, and query-only changes are ignored.

Declarative router views start from a commit-phase layout effect. Suspended or
aborted renders do not create views for routes that were never displayed.

### React Router v6

```js
import { RouterProvider } from 'react-router-dom'
import { reactPlugin } from '@cloudcare/browser-rum-react'
import { createBrowserRouter } from '@cloudcare/browser-rum-react/react-router-v6'

const router = createBrowserRouter(routes)

datafluxRum.init({
  // ...
  plugins: [reactPlugin({ router: true })]
})
```

The v6 entry also exports instrumented `createHashRouter`,
`createMemoryRouter`, `useRoutes`, and `Routes`.

### React Router v7 and v8

Use the matching entry while importing the remaining Router APIs from
`react-router`:

```js
import { RouterProvider } from 'react-router'
import { createBrowserRouter } from '@cloudcare/browser-rum-react/react-router-v7'

// For React Router v8:
// import { createBrowserRouter } from '@cloudcare/browser-rum-react/react-router-v8'
```

### TanStack Router

```js
import { RouterProvider } from '@tanstack/react-router'
import { createRouter } from '@cloudcare/browser-rum-react/tanstack-router'

const router = createRouter({ routeTree })

datafluxRum.init({
  // ...
  plugins: [reactPlugin({ router: true })]
})
```

## Demo

From the repository root, run `npm run dev` and open
`http://localhost:8082/framework-react/`. The demo verifies route-template views,
query-only navigation, `ErrorBoundary`, and an actual RUM upload.
