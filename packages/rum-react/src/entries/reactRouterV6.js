import {
  createBrowserRouter as originalCreateBrowserRouter,
  createHashRouter as originalCreateHashRouter,
  createMemoryRouter as originalCreateMemoryRouter,
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useRoutes as originalUseRoutes
} from 'react-router-dom'
import {
  createRoutesComponent,
  wrapCreateRouter,
  wrapUseRoutes
} from '../domain/reactRouter'

export var createBrowserRouter = wrapCreateRouter(originalCreateBrowserRouter)
export var createHashRouter = wrapCreateRouter(originalCreateHashRouter)
export var createMemoryRouter = wrapCreateRouter(originalCreateMemoryRouter)
export var useRoutes = wrapUseRoutes({
  useRoutes: originalUseRoutes,
  useLocation: useLocation,
  matchRoutes: matchRoutes
})
export var Routes = createRoutesComponent(
  useRoutes,
  createRoutesFromChildren
)
