import {
  LifeCycle,
  LifeCycleEventType,
  RequestType,
  ResourceType
} from '@cloudcare/browser-core'
import { startResourceCollection } from './resourceCollection'
import { createResourceTrackerManager } from './resourceTrackerManager'

describe('resourceCollection', () => {
  let OriginalPerformanceObserver

  class FakePerformanceObserver {
    constructor() {
      this.disconnect = jasmine.createSpy('disconnect')
      FakePerformanceObserver.instances.push(this)
    }

    observe() {}
  }

  FakePerformanceObserver.instances = []
  FakePerformanceObserver.supportedEntryTypes = ['resource']

  beforeEach(() => {
    OriginalPerformanceObserver = window.PerformanceObserver
    window.PerformanceObserver = FakePerformanceObserver
    globalThis.PerformanceObserver = FakePerformanceObserver
    FakePerformanceObserver.instances = []
  })

  afterEach(() => {
    window.PerformanceObserver = OriginalPerformanceObserver
    globalThis.PerformanceObserver = OriginalPerformanceObserver
  })

  it('should delay tracked request resources until finishResource is called', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const resourceTrackerManager = createResourceTrackerManager()
    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {},
      resourceTrackerManager
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    const resourceId = resourceTrackerManager.createTrackerId()
    resourceTrackerManager.setResourceContext(resourceId, {
      order_id: '123'
    })

    lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
      url: 'https://example.com/api/orders?x=1',
      method: 'POST',
      status: 204,
      type: RequestType.FETCH,
      duration: 12,
      startClocks: {
        relative: 100,
        timeStamp: 200
      },
      requestHeaderContexts: {
        'x-rum-resource-id': resourceId
      }
    })

    expect(collected).not.toHaveBeenCalled()
    expect(resourceTrackerManager.getResource(resourceId)).toEqual(
      jasmine.objectContaining({
        trackerId: resourceId,
        status: 'request_collected',
        context: {
          order_id: '123'
        },
        resource: jasmine.objectContaining({
          method: 'POST',
          status: 204
        })
      })
    )

    resourceTrackerManager.appendResourceContext(resourceId, {
      result: 'success'
    })
    resourceTrackerManager.finishResource(resourceId)

    expect(collected).toHaveBeenCalledTimes(1)
    expect(collected.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        customerContext: {
          order_id: '123',
          result: 'success'
        },
        rawRumEvent: jasmine.objectContaining({
          type: 'resource'
        })
      })
    )
  })

  it('should timeout flush tracked resources when finishResource is not called', () => {
    jasmine.clock().install()
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const resourceTrackerManager = createResourceTrackerManager()
    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {},
      resourceTrackerManager
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    const resourceId = resourceTrackerManager.createTrackerId()
    lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
      url: 'https://example.com/api/orders?x=1',
      method: 'GET',
      status: 200,
      type: RequestType.XHR,
      duration: 12,
      startClocks: {
        relative: 100,
        timeStamp: 200
      },
      requestHeaderContexts: {
        'x-rum-resource-id': resourceId
      }
    })

    expect(collected).not.toHaveBeenCalled()

    jasmine.clock().tick(30000)

    expect(collected).toHaveBeenCalledTimes(1)
    expect(resourceTrackerManager.getResource(resourceId)).toEqual(
      jasmine.objectContaining({
        status: 'timeout_flushed'
      })
    )
    jasmine.clock().uninstall()
  })

  it('should flush tracked resources when finishResource is called before request completion', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const resourceTrackerManager = createResourceTrackerManager()
    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {},
      resourceTrackerManager
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    const resourceId = resourceTrackerManager.createTrackerId()
    resourceTrackerManager.setResourceContext(resourceId, {
      order_id: 'finish-before-complete'
    })
    resourceTrackerManager.finishResource(resourceId)

    lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
      url: 'https://example.com/api/orders?finish=before',
      method: 'GET',
      status: 200,
      type: RequestType.XHR,
      duration: 12,
      startClocks: {
        relative: 100,
        timeStamp: 200
      },
      requestHeaderContexts: {
        'x-rum-resource-id': resourceId
      }
    })

    expect(collected).toHaveBeenCalledTimes(1)
    expect(collected.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        customerContext: {
          order_id: 'finish-before-complete'
        }
      })
    )
    expect(resourceTrackerManager.getResource(resourceId)).toEqual(
      jasmine.objectContaining({
        status: 'flushed'
      })
    )
  })

  it('should continue processing later resources when a RAW_RUM_EVENT_COLLECTED subscriber throws', () => {
    const lifeCycle = new LifeCycle()
    const crashingSubscriber = jasmine
      .createSpy('crashingSubscriber')
      .and.callFake(() => {
        throw new Error('subscriber boom')
      })
    const collected = jasmine.createSpy('collected')

    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {}
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    lifeCycle.subscribe(
      LifeCycleEventType.RAW_RUM_EVENT_COLLECTED,
      crashingSubscriber
    )

    expect(() => {
      lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
        url: 'https://example.com/a.js',
        method: 'GET',
        status: 200,
        type: RequestType.FETCH,
        duration: 12,
        startClocks: {
          relative: 100,
          timeStamp: 200
        }
      })
    }).not.toThrow()

    expect(() => {
      lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
        url: 'https://example.com/b.js',
        method: 'GET',
        status: 200,
        type: RequestType.FETCH,
        duration: 12,
        startClocks: {
          relative: 130,
          timeStamp: 230
        }
      })
    }).not.toThrow()

    expect(crashingSubscriber).toHaveBeenCalledTimes(2)
    expect(collected).toHaveBeenCalledTimes(2)
  })

  it('should match tracked xhr requests with mixed-case resource tracker headers', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const resourceTrackerManager = createResourceTrackerManager()
    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {},
      resourceTrackerManager
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    const resourceId = resourceTrackerManager.createTrackerId()
    resourceTrackerManager.setResourceContext(resourceId, {
      request_type: 'xhr'
    })

    lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
      url: 'https://example.com/api/orders?xhr=1',
      method: 'GET',
      status: 200,
      type: RequestType.XHR,
      duration: 12,
      startClocks: {
        relative: 100,
        timeStamp: 200
      },
      requestHeaderContexts: {
        'X-RUM-RESOURCE-ID': resourceId
      }
    })

    expect(collected).not.toHaveBeenCalled()
    resourceTrackerManager.finishResource(resourceId)
    expect(collected).toHaveBeenCalledTimes(1)
    expect(resourceTrackerManager.getResource(resourceId)).toEqual(
      jasmine.objectContaining({
        status: 'flushed',
        context: {
          request_type: 'xhr'
        }
      })
    )
  })

  it('should collect completed requests into raw resource events', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {}
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
      url: 'https://example.com/api/orders?x=1',
      method: 'POST',
      status: 204,
      type: RequestType.FETCH,
      duration: 12,
      startClocks: {
        relative: 100,
        timeStamp: 200
      },
      traceId: 'trace-id',
      spanId: 'span-id',
      traceSampled: true
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.rawRumEvent.type).toBe('resource')
    expect(event.rawRumEvent.resource.type).toBe(ResourceType.FETCH)
    expect(event.rawRumEvent.resource.method).toBe('POST')
    expect(event.rawRumEvent.resource.status).toBe(204)
    expect(event.rawRumEvent._gc).toEqual({
      traceId: 'trace-id',
      spanId: 'span-id'
    })
  })

  it('should preserve trace metadata for tracked requests after finishResource', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const resourceTrackerManager = createResourceTrackerManager()
    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {},
      resourceTrackerManager
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    const resourceId = resourceTrackerManager.createTrackerId()
    resourceTrackerManager.setResourceContext(resourceId, {
      trace_expected: 'true'
    })

    lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
      url: 'https://example.com/api/traced',
      method: 'POST',
      status: 202,
      type: RequestType.FETCH,
      duration: 12,
      startClocks: {
        relative: 100,
        timeStamp: 200
      },
      traceId: 'tracked-trace-id',
      spanId: 'tracked-span-id',
      traceSampled: true,
      requestHeaderContexts: {
        'x-rum-resource-id': resourceId
      }
    })

    expect(collected).not.toHaveBeenCalled()
    resourceTrackerManager.finishResource(resourceId)

    expect(collected).toHaveBeenCalledTimes(1)
    expect(collected.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        customerContext: {
          trace_expected: 'true'
        },
        rawRumEvent: jasmine.objectContaining({
          _gc: {
            traceId: 'tracked-trace-id',
            spanId: 'tracked-span-id'
          }
        })
      })
    )
  })

  it('should fall back to the normal resource path when the tracker id is missing', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const resourceTrackerManager = createResourceTrackerManager()
    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {},
      resourceTrackerManager
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
      url: 'https://example.com/api/missing-tracker',
      method: 'GET',
      status: 200,
      type: RequestType.XHR,
      duration: 12,
      startClocks: {
        relative: 100,
        timeStamp: 200
      },
      requestHeaderContexts: {
        'x-rum-resource-id': 'unknown-tracker-id'
      }
    })

    expect(collected).toHaveBeenCalledTimes(1)
    expect(collected.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        rawRumEvent: jasmine.objectContaining({
          type: 'resource',
          resource: jasmine.objectContaining({
            method: 'GET',
            status: 200
          })
        })
      })
    )
  })

  it('should downgrade the second request to the normal path when the same tracker id is reused', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const resourceTrackerManager = createResourceTrackerManager()
    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {},
      resourceTrackerManager
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    const resourceId = resourceTrackerManager.createTrackerId()
    resourceTrackerManager.setResourceContext(resourceId, {
      order_id: 'single-use'
    })

    lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
      url: 'https://example.com/api/first',
      method: 'GET',
      status: 200,
      type: RequestType.FETCH,
      duration: 12,
      startClocks: {
        relative: 100,
        timeStamp: 200
      },
      requestHeaderContexts: {
        'x-rum-resource-id': resourceId
      }
    })

    expect(collected).not.toHaveBeenCalled()

    lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
      url: 'https://example.com/api/second',
      method: 'POST',
      status: 201,
      type: RequestType.XHR,
      duration: 12,
      startClocks: {
        relative: 120,
        timeStamp: 220
      },
      requestHeaderContexts: {
        'x-rum-resource-id': resourceId
      }
    })

    expect(collected).toHaveBeenCalledTimes(1)
    expect(collected.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        rawRumEvent: jasmine.objectContaining({
          resource: jasmine.objectContaining({
            method: 'POST',
            status: 201
          })
        })
      })
    )

    resourceTrackerManager.finishResource(resourceId)

    expect(collected).toHaveBeenCalledTimes(2)
    expect(collected.calls.argsFor(1)[0]).toEqual(
      jasmine.objectContaining({
        customerContext: {
          order_id: 'single-use'
        },
        rawRumEvent: jasmine.objectContaining({
          resource: jasmine.objectContaining({
            method: 'GET',
            status: 200
          })
        })
      })
    )
  })

  it('should use request clocks when no matching performance timing exists', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const originalGetEntriesByName = performance.getEntriesByName
    performance.getEntriesByName = jasmine
      .createSpy('getEntriesByName')
      .and.returnValue([])

    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {}
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
      url: 'https://example.com/api/fallback',
      method: 'GET',
      status: 200,
      type: RequestType.XHR,
      duration: 12,
      startClocks: {
        relative: 44,
        timeStamp: 55
      }
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.startTime).toBe(44)
    expect(event.rawRumEvent.date).toBe(55)
    expect(event.domainContext.performanceEntry).toBeUndefined()

    performance.getEntriesByName = originalGetEntriesByName
  })

  it('should add custom resources and preserve saved context', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const collection = startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {}
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    collection.addResource(
      {
        type: ResourceType.OTHER,
        startClocks: {
          relative: 5,
          timeStamp: 6
        },
        context: { source: 'manual' }
      },
      { view: { id: 'view-1' } }
    )

    const event = collected.calls.mostRecent().args[0]
    expect(event.savedCommonContext).toEqual({ view: { id: 'view-1' } })
    expect(event.customerContext).toEqual({ source: 'manual' })
    expect(event.rawRumEvent.resource.type).toBe(ResourceType.OTHER)
  })

  it('should collect the initial document resource timing and stop the performance observer', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    const collection = startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      (_configuration, callback) => {
        callback({
          name: 'https://example.com/index.html',
          entryType: 'resource',
          initiatorType: 'initial_document',
          startTime: 0,
          duration: 10,
          responseStatus: 200,
          deliveryType: '',
          nextHopProtocol: 'h2',
          decodedBodySize: 1,
          encodedBodySize: 1,
          transferSize: 1,
          fetchStart: 0,
          domainLookupStart: 0,
          domainLookupEnd: 0,
          connectStart: 0,
          connectEnd: 0,
          requestStart: 1,
          responseStart: 5,
          responseEnd: 10
        })
      }
    )

    expect(collected).toHaveBeenCalled()
    expect(collected.calls.mostRecent().args[0].rawRumEvent.resource.type).toBe(
      ResourceType.DOCUMENT
    )

    collection.stop()
    expect(FakePerformanceObserver.instances[0].disconnect).toHaveBeenCalled()
  })

  it('should omit request duration when the request overlaps a frozen page state', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => true
      },
      {
        push: (task) => task()
      },
      () => {}
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
      url: 'https://example.com/api/frozen',
      method: 'GET',
      status: 200,
      type: RequestType.XHR,
      duration: 45,
      startClocks: {
        relative: 10,
        timeStamp: 20
      }
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.rawRumEvent.resource.duration).toBeUndefined()
    expect(event.rawRumEvent.resource.type).toBe(ResourceType.XHR)
  })

  it('should discard zero response status for performance resource entries', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      (_configuration, callback) => {
        callback({
          name: 'https://static.example.com/app.css',
          entryType: 'resource',
          initiatorType: 'link',
          startTime: 0,
          duration: 10,
          responseStatus: 0,
          deliveryType: '',
          nextHopProtocol: '',
          decodedBodySize: 1,
          encodedBodySize: 1,
          transferSize: 0,
          fetchStart: 0,
          domainLookupStart: 0,
          domainLookupEnd: 0,
          connectStart: 0,
          connectEnd: 0,
          requestStart: 1,
          responseStart: 5,
          responseEnd: 10
        })
      }
    )

    const event = collected.calls.mostRecent().args[0]
    expect(event.rawRumEvent.resource.status).toBeUndefined()
    expect(event.rawRumEvent.resource.statusGroup).toBeUndefined()
    expect(event.rawRumEvent.resource.protocol).toBeUndefined()
  })

  it("should normalize empty deliveryType to 'other' for performance resource entries", () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      (_configuration, callback) => {
        callback({
          name: 'https://static.example.com/app.css',
          entryType: 'resource',
          initiatorType: 'link',
          startTime: 0,
          duration: 10,
          responseStatus: 200,
          deliveryType: '',
          nextHopProtocol: 'h2',
          decodedBodySize: 1,
          encodedBodySize: 1,
          transferSize: 1,
          fetchStart: 0,
          domainLookupStart: 0,
          domainLookupEnd: 0,
          connectStart: 0,
          connectEnd: 0,
          requestStart: 1,
          responseStart: 5,
          responseEnd: 10
        })
      }
    )

    const event = collected.calls.mostRecent().args[0]
    expect(event.rawRumEvent.resource.deliveryType).toBe('other')
    expect(event.rawRumEvent.resource.protocol).toBe('h2')
  })

  it('should attach trace identifiers coming from performance resource entries', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      (_configuration, callback) => {
        callback({
          name: 'https://static.example.com/app.js',
          entryType: 'resource',
          initiatorType: 'script',
          startTime: 0,
          duration: 10,
          responseStatus: 200,
          deliveryType: 'cache',
          nextHopProtocol: 'h2',
          decodedBodySize: 1,
          encodedBodySize: 1,
          transferSize: 1,
          traceId: 'entry-trace-id',
          fetchStart: 0,
          domainLookupStart: 0,
          domainLookupEnd: 0,
          connectStart: 0,
          connectEnd: 0,
          requestStart: 1,
          responseStart: 5,
          responseEnd: 10
        })
      }
    )

    const event = collected.calls.mostRecent().args[0]
    expect(event.rawRumEvent._gc).toEqual({ traceId: 'entry-trace-id' })
  })

  it('should keep the original performance entry in domain context for resource timings', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const entry = {
      name: 'https://static.example.com/app.js',
      entryType: 'resource',
      initiatorType: 'script',
      startTime: 0,
      duration: 10,
      responseStatus: 204,
      deliveryType: 'cache',
      nextHopProtocol: 'h2',
      decodedBodySize: 1,
      encodedBodySize: 1,
      transferSize: 1,
      fetchStart: 0,
      domainLookupStart: 0,
      domainLookupEnd: 0,
      connectStart: 0,
      connectEnd: 0,
      requestStart: 1,
      responseStart: 5,
      responseEnd: 10
    }
    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      (_configuration, callback) => {
        callback(entry)
      }
    )

    const event = collected.calls.mostRecent().args[0]
    expect(event.domainContext.performanceEntry).toBe(entry)
    expect(event.rawRumEvent.resource.statusGroup).toBe('2xx')
  })

  it('should keep non-success response status groups for performance resource entries', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const entry = {
      name: 'https://static.example.com/missing.css',
      entryType: 'resource',
      initiatorType: 'link',
      startTime: 0,
      duration: 10,
      responseStatus: 404,
      deliveryType: 'cache',
      nextHopProtocol: 'h2',
      decodedBodySize: 1,
      encodedBodySize: 1,
      transferSize: 1,
      fetchStart: 0,
      domainLookupStart: 0,
      domainLookupEnd: 0,
      connectStart: 0,
      connectEnd: 0,
      requestStart: 1,
      responseStart: 5,
      responseEnd: 10
    }
    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      (_configuration, callback) => {
        callback(entry)
      }
    )

    const event = collected.calls.mostRecent().args[0]
    expect(event.rawRumEvent.resource.status).toBe(404)
    expect(event.rawRumEvent.resource.statusGroup).toBe('4xx')
  })

  it('should not attach tracing metadata for performance resource entries without a trace id', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      (_configuration, callback) => {
        callback({
          name: 'https://static.example.com/app.js',
          entryType: 'resource',
          initiatorType: 'script',
          startTime: 0,
          duration: 10,
          responseStatus: 200,
          deliveryType: 'cache',
          nextHopProtocol: 'h2',
          decodedBodySize: 1,
          encodedBodySize: 1,
          transferSize: 1,
          fetchStart: 0,
          domainLookupStart: 0,
          domainLookupEnd: 0,
          connectStart: 0,
          connectEnd: 0,
          requestStart: 1,
          responseStart: 5,
          responseEnd: 10
        })
      }
    )

    const event = collected.calls.mostRecent().args[0]
    expect(event.rawRumEvent._gc).toBeUndefined()
  })

  it('should add custom resources without a customer context when none is provided', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const collection = startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {}
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    collection.addResource({
      type: ResourceType.OTHER,
      startClocks: {
        relative: 7,
        timeStamp: 8
      }
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.customerContext).toBeUndefined()
    expect(event.rawRumEvent.resource.type).toBe(ResourceType.OTHER)
  })

  it('should keep the original custom resource in domain context', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const collection = startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {}
    )
    const resource = {
      type: ResourceType.OTHER,
      startClocks: {
        relative: 17,
        timeStamp: 18
      }
    }

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    collection.addResource(resource)

    const event = collected.calls.mostRecent().args[0]
    expect(event.startTime).toBe(17)
    expect(event.domainContext.resource).toBe(resource)
  })

  it('should use custom resource clocks for the emitted event date', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const collection = startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {}
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    collection.addResource(
      {
        type: ResourceType.OTHER,
        startClocks: {
          relative: 70,
          timeStamp: 80
        }
      },
      {}
    )

    const event = collected.calls.mostRecent().args[0]
    expect(event.startTime).toBe(70)
    expect(event.rawRumEvent.date).toBe(80)
    expect(event.savedCommonContext).toEqual({})
  })

  it('should keep savedCommonContext undefined for custom resources when none is provided', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const collection = startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {}
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    collection.addResource({
      type: ResourceType.OTHER,
      startClocks: {
        relative: 81,
        timeStamp: 82
      }
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.savedCommonContext).toBeUndefined()
    expect(event.domainContext.resource.context).toBeUndefined()
  })

  it('should not attach tracing metadata when the request was not sampled', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {}
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
      url: 'https://example.com/api/orders',
      method: 'GET',
      status: 200,
      type: RequestType.FETCH,
      duration: 10,
      startClocks: {
        relative: 50,
        timeStamp: 60
      },
      traceId: 'trace-id',
      spanId: 'span-id',
      traceSampled: false
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.rawRumEvent._gc).toBeUndefined()
  })

  it('should not attach tracing metadata when a sampled request is missing span identifiers', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {}
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
      url: 'https://example.com/api/orders',
      method: 'GET',
      status: 200,
      type: RequestType.FETCH,
      duration: 10,
      startClocks: {
        relative: 50,
        timeStamp: 60
      },
      traceId: 'trace-id',
      traceSampled: true
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.rawRumEvent._gc).toBeUndefined()
  })

  it('should not attach tracing metadata when a sampled request is missing a trace id', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {}
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
      url: 'https://example.com/api/orders',
      method: 'GET',
      status: 200,
      type: RequestType.FETCH,
      duration: 10,
      startClocks: {
        relative: 50,
        timeStamp: 60
      },
      spanId: 'span-id',
      traceSampled: true
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.rawRumEvent._gc).toBeUndefined()
  })

  it('should expose matched timing details and request domain context for completed requests', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const originalGetEntriesByName = performance.getEntriesByName
    const matchedEntry = {
      startTime: 19,
      duration: 10,
      fetchStart: 19,
      domainLookupStart: 19,
      domainLookupEnd: 20,
      connectStart: 20,
      connectEnd: 21,
      requestStart: 21,
      responseStart: 25,
      responseEnd: 29,
      responseStatus: 202,
      deliveryType: 'cache',
      nextHopProtocol: 'h3',
      decodedBodySize: 2,
      encodedBodySize: 2,
      transferSize: 2,
      toJSON: jasmine.createSpy('toJSON').and.returnValue({
        startTime: 19,
        duration: 10,
        responseStatus: 202,
        deliveryType: 'cache',
        nextHopProtocol: 'h3',
        decodedBodySize: 2,
        encodedBodySize: 2,
        transferSize: 2,
        fetchStart: 19,
        domainLookupStart: 19,
        domainLookupEnd: 20,
        connectStart: 20,
        connectEnd: 21,
        requestStart: 21,
        responseStart: 25,
        responseEnd: 29
      })
    }
    performance.getEntriesByName = jasmine
      .createSpy('getEntriesByName')
      .and.returnValue([matchedEntry])

    startResourceCollection(
      lifeCycle,
      {
        resourceUrlLimit: 1024,
        isIntakeUrl: () => false
      },
      {
        wasInPageStateDuringPeriod: () => false
      },
      {
        push: (task) => task()
      },
      () => {}
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    const xhr = {}
    const response = { ok: true }
    const input = { path: '/orders' }
    const init = { method: 'POST' }
    const error = new Error('network')
    lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
      url: 'https://example.com/api/orders?x=1',
      method: 'POST',
      status: 202,
      type: RequestType.FETCH,
      duration: 8,
      startClocks: {
        relative: 20,
        timeStamp: 30
      },
      xhr,
      response,
      input,
      init,
      error,
      isAborted: true,
      handlingStack: 'request-stack',
      requestHeaderContexts: [{ header: 'x-test' }]
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.startTime).toBe(19)
    expect(event.rawRumEvent.date).toEqual(jasmine.any(Number))
    expect(event.rawRumEvent.resource.deliveryType).toBe('cache')
    expect(event.rawRumEvent.resource.protocol).toBe('h3')
    expect(event.domainContext.performanceEntry).toEqual(jasmine.objectContaining({ responseStatus: 202 }))
    expect(event.domainContext.xhr).toBe(xhr)
    expect(event.domainContext.response).toBe(response)
    expect(event.domainContext.requestInput).toBe(input)
    expect(event.domainContext.requestInit).toBe(init)
    expect(event.domainContext.error).toBe(error)
    expect(event.domainContext.isAborted).toBeTrue()
    expect(event.domainContext.handlingStack).toBe('request-stack')
    expect(event.domainContext.requestHeaderContexts).toEqual([{ header: 'x-test' }])

    performance.getEntriesByName = originalGetEntriesByName
  })
})
