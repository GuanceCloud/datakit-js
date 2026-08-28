import {
  LifeCycle,
  LifeCycleEventType,
  RumEventType
} from '@cloudcare/browser-core'
import { startRumAssembly } from './assembly'

describe('assembly', () => {
  let originalSyntheticsFlag

  beforeEach(() => {
    originalSyntheticsFlag = window._DATAFLUX_SYNTHETICS_BROWSER
    delete window._DATAFLUX_SYNTHETICS_BROWSER
  })

  afterEach(() => {
    if (originalSyntheticsFlag === undefined) {
      delete window._DATAFLUX_SYNTHETICS_BROWSER
    } else {
      window._DATAFLUX_SYNTHETICS_BROWSER = originalSyntheticsFlag
    }
  })

  function startAssembly(
    lifeCycle,
    beforeSend,
    reportError,
    sessionManager,
    getDeviceInfoImp
  ) {
    startRumAssembly(
      {
        sdkName: 'rum-sdk',
        sdkVersion: '1.2.3',
        applicationId: 'app-1',
        env: 'prod',
        service: 'browser-sdk',
        version: '9.9.9',
        sessionSampleRate: 100,
        sessionReplaySampleRate: 50,
        sessionOnErrorSampleRate: 40,
        sessionReplayOnErrorSampleRate: 30,
        eventRateLimiterThreshold: 100,
        beforeSend
      },
      lifeCycle,
      sessionManager || {
        findTrackedSession: () => ({
          id: 'session-1',
          isSessionForced: false,
          isErrorSession: false,
          sessionHasError: true,
          errorSessionReplayAllowed: false
        })
      },
      {
        getId: () => 'user-1'
      },
      {
        findView: () => ({
          id: 'view-1',
          name: 'Checkout',
          service: 'checkout-ui',
          version: '2.0.0',
          context: { viewTag: 'detail' }
        })
      },
      {
        findUrl: () => ({
          url: 'https://example.com/products/42',
          referrer: 'https://example.com/',
          host: 'example.com',
          path: '/products/42',
          pathGroup: '/products/?',
          pathname: '/products/42',
          urlQuery: { from: 'spec' }
        })
      },
      {
        findActionId: () => 'action-1',
        findAllActionId: () => ['action-1', 'action-2']
      },
      {
        get: () => ({ viewport: 'desktop' })
      },
      () => ({
        context: { globalTag: 'root' },
        user: { email: 'test@example.com' },
        hasReplay: true
      }),
      reportError || jasmine.createSpy('reportError'),
      getDeviceInfoImp
    )
  }

  it('should assemble raw resource events into rum events with common contexts', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    startAssembly(lifeCycle)
    lifeCycle.subscribe(LifeCycleEventType.RUM_EVENT_COLLECTED, collected)

    lifeCycle.notify(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, {
      startTime: 10,
      rawRumEvent: {
        type: RumEventType.RESOURCE,
        resource: {
          url: 'https://cdn.example.com/app.js'
        }
      },
      customerContext: { productId: 42 },
      domainContext: { requestId: 'req-1' }
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.type).toBe('resource')
    expect(event.service).toBe('checkout-ui')
    expect(event.version).toBe('2.0.0')
    expect(event.application.id).toBe('app-1')
    expect(event.session.id).toBe('session-1')
    expect(event.session.type).toBe('user')
    expect(event.view.id).toBe('view-1')
    expect(event.view.url).toBe('https://example.com/products/42')
    expect(event.action).toEqual({
      id: 'action-1',
      ids: ['action-1', 'action-2']
    })
    expect(event.display).toEqual({ viewport: 'desktop' })
    expect(event.context).toEqual({
      globalTag: 'root',
      viewTag: 'detail',
      productId: 42
    })
    expect(event.user).toEqual(
      jasmine.objectContaining({
        email: 'test@example.com',
        is_signin: 'T',
        is_login: true
      })
    )
  })

  it('should allow beforeSend to modify allowed fields and drop non-view events', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    startAssembly(
      lifeCycle,
      (event, domainContext) => {
        expect(domainContext).toEqual({ requestId: 'req-2' })
        event.resource.url = 'https://masked.example.com'
        event.context = { overwritten: true }
        return false
      }
    )
    lifeCycle.subscribe(LifeCycleEventType.RUM_EVENT_COLLECTED, collected)

    lifeCycle.notify(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, {
      startTime: 11,
      rawRumEvent: {
        type: RumEventType.RESOURCE,
        resource: {
          url: 'https://cdn.example.com/private.js'
        }
      },
      domainContext: { requestId: 'req-2' }
    })

    expect(collected).not.toHaveBeenCalled()
  })

  it('should not assemble or report events without a tracked session', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    startAssembly(lifeCycle, undefined, undefined, {
      findTrackedSession: () => undefined
    })
    lifeCycle.subscribe(LifeCycleEventType.RUM_EVENT_COLLECTED, collected)

    lifeCycle.notify(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, {
      startTime: 12,
      rawRumEvent: {
        type: RumEventType.RESOURCE,
        resource: {
          url: 'https://api.example.com/orders'
        }
      }
    })

    expect(collected).not.toHaveBeenCalled()
  })

  it('should buffer raw events until high entropy device information is ready', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    let resolveDeviceInfo
    startAssembly(lifeCycle, undefined, undefined, undefined, (callback) => {
      resolveDeviceInfo = callback
    })
    lifeCycle.subscribe(LifeCycleEventType.RUM_EVENT_COLLECTED, collected)

    lifeCycle.notify(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, {
      startTime: 13,
      rawRumEvent: {
        type: RumEventType.RESOURCE,
        resource: { url: 'https://cdn.example.com/deferred.js' }
      }
    })

    expect(collected).not.toHaveBeenCalled()
    resolveDeviceInfo({
      os: 'Windows',
      osVersion: '11',
      osVersionMajor: '11'
    })

    expect(collected.calls.mostRecent().args[0].device).toEqual({
      os: 'Windows',
      os_version: '11',
      os_version_major: '11'
    })
  })
})
