# @cloudcare/browser-rum-react

React integration for `@cloudcare/browser-rum` and `@cloudcare/browser-rum-slim`.

```bash
npm install @cloudcare/browser-rum @cloudcare/browser-rum-react
```

```js
import { datafluxRum } from '@cloudcare/browser-rum'
import { reactPlugin } from '@cloudcare/browser-rum-react'

datafluxRum.init({
  applicationId: '<APP_ID>',
  datakitOrigin: '<DATAKIT_ORIGIN>',
  plugins: [reactPlugin()]
})
```

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

Enable manual view tracking and wrap a data-router factory. Route templates such as
`/users/:id` are used as view names, and query-only changes are ignored.

```js
import { createBrowserRouter as createRouter } from 'react-router-dom'
import {
  reactPlugin,
  wrapCreateReactRouter
} from '@cloudcare/browser-rum-react'

const createBrowserRouter = wrapCreateReactRouter(createRouter)
const router = createBrowserRouter(routes)

datafluxRum.init({
  // ...
  plugins: [reactPlugin({ router: true })]
})
```

An existing data router can instead be passed as `reactPlugin({ router })`.

## Demo

From the repository root, run `npm run dev` and open
`http://localhost:8082/framework-react/`. The demo verifies route-template views,
query-only navigation, `ErrorBoundary`, and an actual RUM upload.
