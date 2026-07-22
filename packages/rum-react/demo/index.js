import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Outlet,
  RouterProvider,
  createBrowserRouter,
  useLocation,
  useNavigate
} from 'react-router-dom'
import {
  ErrorBoundary,
  reactPlugin,
  wrapCreateReactRouter
} from '../src'
import {
  createFrameworkDemo,
  createRumConfiguration
} from '../../../demo/framework-demo-runtime'

var element = React.createElement
var demo = createFrameworkDemo('react')

function CrashProbe(props) {
  if (props.active) {
    throw new Error('React demo render error')
  }
  return null
}

function Layout() {
  var navigate = useNavigate()
  var location = useLocation()

  return element(
    React.Fragment,
    null,
    element('h2', null, 'Router workspace'),
    element('div', { className: 'demo-route', id: 'current-route' }, location.pathname + location.search),
    element(
      'div',
      { className: 'demo-actions' },
      element('button', { className: 'demo-button', id: 'go-home', onClick: function () { navigate('/') } }, 'Home'),
      element('button', { className: 'demo-button', id: 'go-user', onClick: function () { navigate('/users/42') } }, 'User 42'),
      element('button', { className: 'demo-button', id: 'change-query', onClick: function () { navigate('/users/42?tab=activity') } }, 'Query only')
    ),
    element(Outlet)
  )
}

function DemoApplication() {
  var crashState = useState(false)
  var shouldCrash = crashState[0]
  var setShouldCrash = crashState[1]

  return element(
    React.Fragment,
    null,
    element(
      'div',
      { className: 'demo-actions' },
      element('button', { className: 'demo-button demo-button--error', id: 'trigger-error', onClick: function () { setShouldCrash(true) } }, 'Trigger render error')
    ),
    element(CrashProbe, { active: shouldCrash }),
    element(RouterProvider, { router: router })
  )
}

function RouteContent(props) {
  return element('p', null, props.label)
}

function ErrorFallback(props) {
  return element(
    'div',
    { className: 'demo-fallback' },
    element('p', null, 'The React error was captured.'),
    element('button', { className: 'demo-button', id: 'reset-error', onClick: props.resetError }, 'Reset error')
  )
}

var createRouter = wrapCreateReactRouter(createBrowserRouter)
var router = createRouter(
  [
    {
      path: '/',
      element: element(Layout),
      children: [
        { index: true, element: element(RouteContent, { label: 'Home route' }) },
        { path: 'users/:id', element: element(RouteContent, { label: 'Dynamic user route' }) }
      ]
    }
  ],
  { basename: '/framework-react' }
)

try {
  window.DATAFLUX_RUM.init(
    createRumConfiguration('react', reactPlugin({ router: true }), demo)
  )
  createRoot(document.getElementById('app')).render(
    element(
      ErrorBoundary,
      { fallback: ErrorFallback },
      element(DemoApplication)
    )
  )
  demo.markReady()
} catch (error) {
  demo.recordSetupError(error)
}
