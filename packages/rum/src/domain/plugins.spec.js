import { display } from '@cloudcare/browser-core'
import {
  callPluginsMethod,
  getPluginsTelemetry,
  validatePlugins
} from './plugins'

describe('rum plugins', () => {
  it('should accept optional lifecycle methods', () => {
    expect(validatePlugins(undefined)).toBeTrue()
    expect(validatePlugins([])).toBeTrue()
    expect(
      validatePlugins([
        { name: 'metadata-only' },
        { name: 'init', onInit: function () {} },
        { name: 'start', onRumStart: function () {} }
      ])
    ).toBeTrue()
  })

  it('should call a lifecycle method with the plugin as this', () => {
    const context = { value: 42 }
    const plugin = {
      name: 'test',
      onInit: jasmine.createSpy('onInit').and.callFake(function () {
        expect(this).toBe(plugin)
      })
    }

    callPluginsMethod([plugin], 'onInit', context)

    expect(plugin.onInit).toHaveBeenCalledOnceWith(context)
  })

  it('should isolate lifecycle and telemetry errors', () => {
    const lifecycleError = new Error('lifecycle failed')
    const telemetryError = new Error('telemetry failed')
    const displayErrorSpy = spyOn(display, 'error')
    const nextPlugin = {
      name: 'next',
      onInit: jasmine.createSpy('nextOnInit')
    }

    callPluginsMethod(
      [
        {
          name: 'broken',
          onInit: function () {
            throw lifecycleError
          }
        },
        nextPlugin
      ],
      'onInit',
      {}
    )

    expect(nextPlugin.onInit).toHaveBeenCalled()
    expect(
      getPluginsTelemetry([
        {
          name: 'router',
          getConfigurationTelemetry: function () {
            return { router: true }
          }
        },
        {
          name: 'broken-telemetry',
          getConfigurationTelemetry: function () {
            throw telemetryError
          }
        }
      ])
    ).toEqual([
      { name: 'router', router: true },
      { name: 'broken-telemetry' }
    ])
    expect(displayErrorSpy.calls.allArgs()).toEqual([
      ['broken plugin onInit threw an error:', lifecycleError],
      [
        'broken-telemetry plugin getConfigurationTelemetry threw an error:',
        telemetryError
      ]
    ])
  })
})
