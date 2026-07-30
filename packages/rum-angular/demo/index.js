import '@angular/compiler'
import { Component, provideZonelessChangeDetection } from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'
import { RouterLink, RouterOutlet, provideRouter } from '@angular/router'
import { angularPlugin } from '../src'
import {
  provideRumErrorHandler,
  provideRumRouter
} from '../src/providers'
import {
  createFrameworkDemo,
  createRumConfiguration
} from '../../../demo/framework-demo-runtime'

var demo = createFrameworkDemo('angular')

class HomeComponent {}
Component({
  selector: 'framework-home',
  standalone: true,
  template: '<p>Home route</p>'
})(HomeComponent)

class UserComponent {}
Component({
  selector: 'framework-user',
  standalone: true,
  template: '<p>Dynamic user route</p>'
})(UserComponent)

class AppComponent {
  get currentPath() {
    return window.location.pathname + window.location.search
  }

  triggerError() {
    throw new Error('Angular demo event error')
  }
}

Component({
  selector: 'framework-demo-root',
  standalone: true,
  imports: [RouterLink, RouterOutlet],
  template: [
    '<h2>Router workspace</h2>',
    '<div class="demo-route" id="current-route">{{ currentPath }}</div>',
    '<div class="demo-actions">',
    '  <a class="demo-button" id="go-home" routerLink="/">Home</a>',
    '  <a class="demo-button" id="go-user" routerLink="/users/42">User 42</a>',
    '  <a class="demo-button" id="change-query" routerLink="/users/42" [queryParams]="{ tab: \'activity\' }">Query only</a>',
    '  <button class="demo-button demo-button--error" id="trigger-error" type="button" (click)="triggerError()">Trigger event error</button>',
    '</div>',
    '<router-outlet></router-outlet>'
  ].join('')
})(AppComponent)

var routes = [
  { path: '', component: HomeComponent },
  { path: 'users/:id', component: UserComponent }
]

try {
  window.DATAFLUX_RUM.init(
    createRumConfiguration(
      'angular',
      angularPlugin({ router: true }),
      demo
    )
  )
  bootstrapApplication(AppComponent, {
    providers: [
      provideZonelessChangeDetection(),
      provideRouter(routes),
      provideRumRouter(),
      provideRumErrorHandler()
    ]
  })
    .then(function () {
      demo.markReady()
    })
    .catch(function (error) {
      demo.recordSetupError(error)
    })
} catch (error) {
  demo.recordSetupError(error)
}
