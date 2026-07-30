import { datafluxRum } from '@cloudcare/browser-rum'
import {
  nextjsPlugin,
  onRouterTransitionStart
} from '@cloudcare/browser-rum-nextjs'
import { createDemoState, createRumConfiguration } from './lib/demo-state'

export { onRouterTransitionStart }

var demo = createDemoState()
if (!window.__nextjsRumDemoInitialized) {
  window.__nextjsRumDemoInitialized = true
  try {
    datafluxRum.init(createRumConfiguration(nextjsPlugin(), demo))
    demo.markReady()
  } catch (error) {
    demo.recordSetupError(error)
  }
}
