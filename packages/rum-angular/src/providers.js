import {
  ENVIRONMENT_INITIALIZER,
  ErrorHandler,
  inject,
  makeEnvironmentProviders
} from '@angular/core'
import { GuardsCheckEnd, NavigationEnd, Router } from '@angular/router'
import { addAngularError, trackAngularRouter } from './index'

class AngularRumErrorHandler extends ErrorHandler {
  handleError(error) {
    addAngularError(error)
    return super.handleError(error)
  }
}

export function provideRumErrorHandler() {
  return makeEnvironmentProviders([
    {
      provide: ErrorHandler,
      useClass: AngularRumErrorHandler
    }
  ])
}

export function provideRumRouter() {
  return makeEnvironmentProviders([
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useFactory: function () {
        var router = inject(Router)
        return function () {
          trackAngularRouter(router, undefined, {
            navigationEventMatcher: isSuccessfulNavigationEvent
          })
        }
      }
    }
  ])
}

function isSuccessfulNavigationEvent(event) {
  if (event instanceof GuardsCheckEnd) {
    return event.shouldActivate
  }
  return event instanceof NavigationEnd
}
