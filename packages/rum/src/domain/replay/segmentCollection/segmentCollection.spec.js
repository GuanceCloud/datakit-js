import { LifeCycle, LifeCycleEventType, Observable } from '@cloudcare/browser-core'
import {
  computeSegmentContext,
  doStartSegmentCollection,
  SEGMENT_DURATION_LIMIT,
  setSegmentBytesLimit
} from './segmentCollection'

describe('segmentCollection', () => {
  let originalSegmentBytesLimit

  beforeEach(() => {
    jasmine.clock().install()
    originalSegmentBytesLimit = 60000
    setSegmentBytesLimit(originalSegmentBytesLimit)
  })

  afterEach(() => {
    jasmine.clock().uninstall()
    setSegmentBytesLimit(originalSegmentBytesLimit)
  })

  function createEncoder() {
    const encoder = {
      empty: true,
      isEmpty() {
        return this.empty
      },
      write: jasmine.createSpy('write').and.callFake((data, callback) => {
        encoder.empty = false
        if (callback) {
          callback(data.length)
        }
      }),
      finish: jasmine.createSpy('finish').and.callFake((callback) => {
        callback({
          rawBytesCount: 100,
          output: new Uint8Array([1, 2, 3]),
          outputBytesCount: 3
        })
      })
    }
    return encoder
  }

  it('should compute segment context from session and view', () => {
    expect(
      computeSegmentContext(
        {
          sdkName: 'df_web_rum_sdk',
          sdkVersion: '1.0.0',
          applicationId: 'app-1',
          env: 'prod',
          service: 'fallback-service',
          version: 'fallback-version'
        },
        {
          findTrackedSession: () => ({ id: 'session-1' })
        },
        {
          findView: () => ({
            id: 'view-1',
            service: 'view-service',
            version: 'view-version'
          })
        }
      )
    ).toEqual({
      sdk: {
        name: 'df_web_rum_sdk',
        version: '1.0.0'
      },
      env: 'prod',
      service: 'view-service',
      version: 'view-version',
      app: {
        id: 'app-1'
      },
      session: {
        id: 'session-1'
      },
      view: {
        id: 'view-1'
      }
    })

    expect(
      computeSegmentContext(
        {},
        {
          findTrackedSession: () => undefined
        },
        {
          findView: () => ({ id: 'view-1' })
        }
      )
    ).toBeUndefined()
  })

  it('should flush a segment when a page-exit event occurs', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const sendOnExit = jasmine.createSpy('sendOnExit')
    const encoder = createEncoder()

    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit },
      encoder,
      false
    )

    segmentCollection.addRecord({ type: 2, timestamp: 10 })
    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, { reason: 'before_unload' })

    expect(sendOnExit).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  it('should flush a segment when the duration limit is reached', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const encoder = createEncoder()

    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      false
    )

    segmentCollection.addRecord({ type: 2, timestamp: 10 })
    jasmine.clock().tick(SEGMENT_DURATION_LIMIT)

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('should flush a segment when encoded bytes exceed the limit', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const encoder = createEncoder()
    setSegmentBytesLimit(5)

    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      false
    )

    segmentCollection.addRecord({ type: 2, timestamp: 10, value: 'x' })

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('should not send locked segments on view change until unlocked', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const encoder = createEncoder()

    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      true
    )

    segmentCollection.addRecord({ type: 2, timestamp: 10 })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)

    expect(send).not.toHaveBeenCalled()

    segmentCollection.unlockSegment()
    segmentCollection.addRecord({ type: 3, timestamp: 20 })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)

    expect(send).toHaveBeenCalledTimes(1)
  })
})
