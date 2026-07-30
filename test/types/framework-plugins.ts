import { datafluxRum } from '@cloudcare/browser-rum'
import { datafluxRum as slimRum } from '@cloudcare/browser-rum-slim'
import {
  ExperimentalFeature,
  ResourceType
} from '@cloudcare/browser-core'
import type { Router as AngularRouter } from '@angular/router'
import type { NextRouter } from 'next/router'
import type { NuxtApp as ActualNuxtApp } from 'nuxt/app'
import type { App as ActualVueApp } from 'vue'
import {
  createMemoryHistory,
  type Router as VueRouterInstance
} from 'vue-router'
import {
  ErrorBoundary as ReactErrorBoundary,
  reactPlugin,
  type ErrorBoundaryProps
} from '@cloudcare/browser-rum-react'
import { createMemoryRouter as createReactRouterV6 } from '@cloudcare/browser-rum-react/react-router-v6'
import { createMemoryRouter as createReactRouterV7 } from '@cloudcare/browser-rum-react/react-router-v7'
import { createMemoryRouter as createReactRouterV8 } from '@cloudcare/browser-rum-react/react-router-v8'
import { createRouter as createTanStackRouter } from '@cloudcare/browser-rum-react/tanstack-router'
import {
  addVueError,
  vuePlugin
} from '@cloudcare/browser-rum-vue'
import { createRouter as createVueRouter } from '@cloudcare/browser-rum-vue/vue-router-v4'
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

const reactRouter = createReactRouterV6([
  { path: '/', element: null }
])
const reactRouterV7 = createReactRouterV7([
  { path: '/', element: null }
])
const reactRouterV8 = createReactRouterV8([
  { path: '/', element: null }
])
const webSocketResourceType: ResourceType = ResourceType.WEBSOCKET
const vueRouter = createVueRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: {} }]
})
const nuxtRouter: NuxtRouter = vueRouter
declare const angularRouter: AngularRouter
declare const nextRouter: NextRouter
declare const vueRouterInstance: VueRouterInstance
declare const actualVueApp: ActualVueApp
declare const actualNuxtApp: ActualNuxtApp

angularPlugin({ router: angularRouter })
reactPlugin({ router: true })
vuePlugin({ router: true })
vuePlugin({ app: actualVueApp, router: true })
nextjsPlugin({ router: nextRouter })
nuxtRumPlugin({ router: vueRouterInstance })
nuxtRumPlugin({
  nuxtApp: actualNuxtApp,
  router: vueRouterInstance
})

datafluxRum.init({
  applicationId: 'framework-types',
  datakitOrigin: 'https://example.invalid',
  enableExperimentalFeatures: [ExperimentalFeature.TRACK_WEBSOCKETS],
  plugins: [
    reactPlugin({ router: true }),
    vuePlugin({ router: true }),
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
void reactRouter
void reactRouterV7
void reactRouterV8
void createTanStackRouter
void provideRumErrorHandler()
void provideRumRouter()
void RumNextjsAppRouter()
void RumNextjsAppRouter({
  getViewName: (pathname, params) =>
    params.id ? '/users/[id]' : pathname
})
void RumNextjsPagesRouter()

addVueError(new Error('vue'), null, 'render', { source: 'types' })
addAngularError(new Error('angular'), { source: 'types' })
addNuxtError(new Error('nuxt'), { source: 'types' })
onRouterTransitionStart('/users/42')
startNextjsView(undefined, '/users/42')
