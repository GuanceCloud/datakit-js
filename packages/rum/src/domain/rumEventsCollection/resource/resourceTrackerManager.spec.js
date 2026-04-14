import { createResourceTrackerManager } from './resourceTrackerManager'

describe('resourceTrackerManager', () => {
  beforeEach(() => {
    jasmine.clock().install()
  })

  afterEach(() => {
    jasmine.clock().uninstall()
  })

  it('should flush immediately when finishResource is called before the request completes', () => {
    const manager = createResourceTrackerManager()
    const flushed = jasmine.createSpy('flushed')
    const trackerId = manager.createTrackerId()

    manager.setFlushTrackedResource(flushed)
    manager.setResourceContext(trackerId, { order_id: 'before-request' })
    manager.finishResource(trackerId)

    expect(manager.getResource(trackerId)).toEqual(
      jasmine.objectContaining({
        trackerId: trackerId,
        status: 'finished',
        context: {
          order_id: 'before-request'
        }
      })
    )

    const tracked = manager.trackRequestResource(trackerId, {
      startTime: 10,
      rawRumEvent: {
        type: 'resource',
        resource: {
          method: 'GET',
          status: 200,
          url: 'https://example.com/a.css'
        }
      },
      domainContext: {
        requestHeaderContexts: {
          'x-rum-resource-id': trackerId
        }
      }
    })

    expect(tracked).toBeTrue()
    expect(flushed).toHaveBeenCalledTimes(1)
    expect(flushed).toHaveBeenCalledWith(
      jasmine.objectContaining({
        customerContext: {
          order_id: 'before-request'
        },
        rawRumEvent: jasmine.objectContaining({
          type: 'resource'
        })
      })
    )
    expect(manager.getResource(trackerId)).toEqual(
      jasmine.objectContaining({
        status: 'flushed'
      })
    )
  })

  it('should keep tracker state isolated across multiple concurrent resources', () => {
    const manager = createResourceTrackerManager()
    const flushed = jasmine.createSpy('flushed')
    const trackerIdA = manager.createTrackerId()
    const trackerIdB = manager.createTrackerId()

    manager.setFlushTrackedResource(flushed)
    manager.setResourceContext(trackerIdA, { order_id: 'A' })
    manager.setResourceContext(trackerIdB, { order_id: 'B' })

    manager.trackRequestResource(trackerIdA, {
      startTime: 1,
      rawRumEvent: {
        type: 'resource',
        resource: {
          method: 'GET',
          status: 200,
          url: 'https://example.com/a.css'
        }
      },
      domainContext: {}
    })
    manager.trackRequestResource(trackerIdB, {
      startTime: 2,
      rawRumEvent: {
        type: 'resource',
        resource: {
          method: 'POST',
          status: 201,
          url: 'https://example.com/b.css'
        }
      },
      domainContext: {}
    })

    manager.appendResourceContext(trackerIdB, { result: 'success' })
    manager.finishResource(trackerIdB)

    expect(flushed).toHaveBeenCalledTimes(1)
    expect(flushed.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        customerContext: {
          order_id: 'B',
          result: 'success'
        },
        rawRumEvent: jasmine.objectContaining({
          resource: jasmine.objectContaining({
            method: 'POST',
            status: 201
          })
        })
      })
    )
    expect(manager.getResource(trackerIdA)).toEqual(
      jasmine.objectContaining({
        status: 'request_collected',
        context: {
          order_id: 'A'
        }
      })
    )
  })

  it('should not reflush after timeout_flushed when context is appended and finishResource is called later', () => {
    const manager = createResourceTrackerManager()
    const flushed = jasmine.createSpy('flushed')
    const trackerId = manager.createTrackerId()

    manager.setFlushTrackedResource(flushed)
    manager.trackRequestResource(trackerId, {
      startTime: 1,
      rawRumEvent: {
        type: 'resource',
        resource: {
          method: 'GET',
          status: 200,
          url: 'https://example.com/timeout.css'
        }
      },
      domainContext: {}
    })

    jasmine.clock().tick(30000)

    expect(flushed).toHaveBeenCalledTimes(1)
    expect(manager.getResource(trackerId)).toEqual(
      jasmine.objectContaining({
        status: 'timeout_flushed'
      })
    )

    manager.appendResourceContext(trackerId, {
      result: 'late-update'
    })
    manager.finishResource(trackerId)

    expect(flushed).toHaveBeenCalledTimes(1)
    expect(manager.getResource(trackerId)).toEqual(
      jasmine.objectContaining({
        status: 'timeout_flushed',
        context: {}
      })
    )
  })

  it('should reject reuse of the same tracker id for a second tracked request', () => {
    const manager = createResourceTrackerManager()

    const trackerId = manager.createTrackerId()
    const firstTracked = manager.trackRequestResource(trackerId, {
      startTime: 1,
      rawRumEvent: {
        type: 'resource',
        resource: {
          method: 'GET',
          status: 200,
          url: 'https://example.com/first.css'
        }
      },
      domainContext: {}
    })
    const secondTracked = manager.trackRequestResource(trackerId, {
      startTime: 2,
      rawRumEvent: {
        type: 'resource',
        resource: {
          method: 'POST',
          status: 201,
          url: 'https://example.com/second.css'
        }
      },
      domainContext: {}
    })

    expect(firstTracked).toBeTrue()
    expect(secondTracked).toBeFalse()
    expect(manager.getResource(trackerId)).toEqual(
      jasmine.objectContaining({
        status: 'request_collected',
        resource: jasmine.objectContaining({
          method: 'GET',
          status: 200,
          url: 'https://example.com/first.css'
        })
      })
    )
  })

  it('should clear orphan trackers that never match any request', () => {
    const manager = createResourceTrackerManager()
    const trackerId = manager.createTrackerId()

    expect(manager.getResource(trackerId)).toEqual(
      jasmine.objectContaining({
        status: 'created'
      })
    )

    jasmine.clock().tick(5 * 60 * 1000)

    expect(manager.getResource(trackerId)).toBeUndefined()
  })

  it('should not recreate a cleared tracker when set, append, or finish is called later', () => {
    const manager = createResourceTrackerManager()
    const trackerId = manager.createTrackerId()

    jasmine.clock().tick(5 * 60 * 1000)

    expect(manager.getResource(trackerId)).toBeUndefined()

    manager.setResourceContext(trackerId, { order_id: 'late' })
    manager.appendResourceContext(trackerId, { result: 'late' })
    manager.finishResource(trackerId)

    expect(manager.getResource(trackerId)).toBeUndefined()
  })

  it('should clear flushed trackers after retention even when no flush handler is configured', () => {
    const manager = createResourceTrackerManager()
    const trackerId = manager.createTrackerId()

    manager.trackRequestResource(trackerId, {
      startTime: 1,
      rawRumEvent: {
        type: 'resource',
        resource: {
          method: 'GET',
          status: 200,
          url: 'https://example.com/no-handler.css'
        }
      },
      domainContext: {}
    })

    manager.finishResource(trackerId)

    expect(manager.getResource(trackerId)).toEqual(
      jasmine.objectContaining({
        status: 'flushed'
      })
    )

    jasmine.clock().tick(60 * 1000)

    expect(manager.getResource(trackerId)).toBeUndefined()
  })

  it('should return an isolated debug snapshot without exposing the internal raw event reference', () => {
    const manager = createResourceTrackerManager()
    const trackerId = manager.createTrackerId()

    manager.trackRequestResource(trackerId, {
      startTime: 1,
      rawRumEvent: {
        type: 'resource',
        resource: {
          method: 'GET',
          status: 200,
          url: 'https://example.com/debug.css',
          urlQuery: {
            trace: '1'
          }
        },
        _gc: {
          traceId: 'trace-id'
        }
      },
      domainContext: {}
    })

    const snapshot = manager.getResource(trackerId)
    snapshot.rawRumEvent.resource.url = 'https://example.com/mutated.css'
    snapshot.rawRumEvent.resource.urlQuery.trace = '0'
    snapshot.rawRumEvent._gc.traceId = 'mutated-trace-id'

    expect(manager.getResource(trackerId)).toEqual(
      jasmine.objectContaining({
        rawRumEvent: jasmine.objectContaining({
          resource: jasmine.objectContaining({
            url: 'https://example.com/debug.css',
            urlQuery: {
              trace: '1'
            }
          }),
          _gc: {
            traceId: 'trace-id'
          }
        })
      })
    )
  })

  it('should clear flushed trackers after retention even when flush handler throws', () => {
    const manager = createResourceTrackerManager()
    const trackerId = manager.createTrackerId()

    manager.setFlushTrackedResource(function () {
      throw new Error('flush failed')
    })

    manager.trackRequestResource(trackerId, {
      startTime: 1,
      rawRumEvent: {
        type: 'resource',
        resource: {
          method: 'GET',
          status: 200,
          url: 'https://example.com/throw.css'
        }
      },
      domainContext: {}
    })

    expect(function () {
      manager.finishResource(trackerId)
    }).not.toThrow()

    expect(manager.getResource(trackerId)).toEqual(
      jasmine.objectContaining({
        status: 'flushed'
      })
    )

    jasmine.clock().tick(60 * 1000)

    expect(manager.getResource(trackerId)).toBeUndefined()
  })

  it('should isolate additional nested debug fields beyond resource and _gc', () => {
    const manager = createResourceTrackerManager()
    const trackerId = manager.createTrackerId()

    manager.trackRequestResource(trackerId, {
      startTime: 1,
      rawRumEvent: {
        type: 'resource',
        resource: {
          method: 'GET',
          status: 200,
          url: 'https://example.com/extra.css'
        },
        extra: {
          nested: {
            value: 'original'
          }
        }
      },
      domainContext: {}
    })

    const snapshot = manager.getResource(trackerId)
    snapshot.rawRumEvent.extra.nested.value = 'mutated'

    expect(manager.getResource(trackerId)).toEqual(
      jasmine.objectContaining({
        rawRumEvent: jasmine.objectContaining({
          extra: {
            nested: {
              value: 'original'
            }
          }
        })
      })
    )
  })

  it('should isolate deep nested debug fields beyond two levels', () => {
    const manager = createResourceTrackerManager()
    const trackerId = manager.createTrackerId()

    manager.trackRequestResource(trackerId, {
      startTime: 1,
      rawRumEvent: {
        type: 'resource',
        deep: {
          level1: {
            level2: {
              level3: {
                value: 'original'
              }
            }
          }
        }
      },
      domainContext: {}
    })

    const snapshot = manager.getResource(trackerId)
    snapshot.rawRumEvent.deep.level1.level2.level3.value = 'mutated'

    expect(manager.getResource(trackerId)).toEqual(
      jasmine.objectContaining({
        rawRumEvent: jasmine.objectContaining({
          deep: {
            level1: {
              level2: {
                level3: {
                  value: 'original'
                }
              }
            }
          }
        })
      })
    )
  })
})
