import {
  LifeCycle,
  LifeCycleEventType,
  RequestType,
  ResourceType
} from '@cloudcare/browser-core'
import { startResourceCollection } from './resourceCollection'

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
})
