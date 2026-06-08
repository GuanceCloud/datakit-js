# @cloudcare/browser-rum-slim

Slim Guance Browser SDK RUM package.

This package shares the core RUM implementation with `@cloudcare/browser-rum`, but excludes Session Replay controls and the `compressIntakeRequests` deflate worker path to reduce browser bundle size.

```js
import { datafluxRum } from '@cloudcare/browser-rum-slim'

datafluxRum.init({
  applicationId: '<APPLICATION_ID>',
  datakitUrl: 'https://datakit.example.com'
})
```

