import { datafluxRum } from '@cloudcare/browser-rum'
import { datafluxRum as slimRum } from '@cloudcare/browser-rum-slim'
import {
  ExperimentalFeature,
  ResourceType
} from '@cloudcare/browser-core'
import type { Router as AngularRouter } from '@angular/router'
import type { Router as ReactRouterInstance } from '@remix-run/router'
import type { NextRouter } from 'next/router'
import type { Router as VueRouterInstance } from 'vue-router'
import {
  ErrorBoundary as ReactErrorBoundary,
  reactPlugin,
  wrapCreateReactRouter,
  type ErrorBoundaryProps,
  type ReactRouter
} from '@cloudcare/browser-rum-react'
import {
  addVueError,
  vuePlugin,
  type VueRouter
} from '@cloudcare/browser-rum-vue'
import {
  addAngularError,
  angularPlugin
} from '@cloudcare/browser-rum-angular'
import {
  provideRumErrorHandler,
  provideRumRouter
} from '@cloudcare/browser-rum-angular/providers'
import {
  RumNextjsAppRouter,
  RumNextjsPagesRouter,
  nextjsPlugin,
  onRouterTransitionStart,
  startNextjsView
} from '@cloudcare/browser-rum-nextjs'
import {
  addNuxtError,
  nuxtRumPlugin,
  type NuxtRouter
} from '@cloudcare/browser-rum-nuxt'

const reactRouter: ReactRouter = {
  state: { location: { pathname: '/' }, matches: [] },
  subscribe: () => () => undefined
}
const webSocketResourceType: ResourceType = ResourceType.WEBSOCKET
const wrappedReactRouterFactory = wrapCreateReactRouter(
  (): ReactRouter => reactRouter
)
wrappedReactRouterFactory()

const vueRouter: VueRouter = {
  currentRoute: { path: '/', matched: [{ path: '/' }] },
  afterEach: () => () => undefined
}
const nuxtRouter: NuxtRouter = vueRouter
declare const angularRouter: AngularRouter
declare const nextRouter: NextRouter
declare const reactRouterInstance: ReactRouterInstance
declare const vueRouterInstance: VueRouterInstance

angularPlugin({ router: angularRouter })
reactPlugin({ router: reactRouterInstance })
vuePlugin({ router: vueRouterInstance })
nextjsPlugin({ router: nextRouter })
nuxtRumPlugin({ router: vueRouterInstance })

datafluxRum.init({
  applicationId: 'framework-types',
  datakitOrigin: 'https://example.invalid',
  enableExperimentalFeatures: [ExperimentalFeature.TRACK_WEBSOCKETS],
  plugins: [
    reactPlugin({ router: reactRouter }),
    vuePlugin({ router: vueRouter }),
    angularPlugin({ router: true }),
    nextjsPlugin(),
    nuxtRumPlugin({ router: nuxtRouter })
  ]
})

slimRum.init({
  applicationId: 'framework-types-slim',
  datakitOrigin: 'https://example.invalid',
  enableExperimentalFeatures: ['track_websockets'],
  plugins: [reactPlugin()]
})

const boundary: typeof ReactErrorBoundary = ReactErrorBoundary
const boundaryProps: ErrorBoundaryProps = { fallback: null }
void boundary
void boundaryProps
void webSocketResourceType
void provideRumErrorHandler()
void provideRumRouter()
void RumNextjsAppRouter()
void RumNextjsPagesRouter()

addVueError(new Error('vue'), null, 'render', { source: 'types' })
addAngularError(new Error('angular'), { source: 'types' })
addNuxtError(new Error('nuxt'), { source: 'types' })
onRouterTransitionStart('/users/42')
startNextjsView(undefined, '/users/42')
