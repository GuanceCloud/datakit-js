import { IncrementalSource, RecordType } from '../../../types'
import { NodePrivacyLevel } from '../../../constants'
import { record } from './record'

describe('replay/record/record', () => {
  let container

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (container) {
      container.remove()
    }
  })

  it('should require an emit function', () => {
    expect(() => record({ configuration: {}, lifeCycle: {} })).toThrowError(
      'emit function is required'
    )
  })

  it('should emit initial snapshots, input updates and subsequent full snapshots', () => {
    const input = document.createElement('input')
    input.value = 'initial'
    container.appendChild(input)

    const emittedRecords = []
    const recorder = record({
      emit: (record) => {
        emittedRecords.push(record)
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: {
        subscribe() {
          return {
            unsubscribe: jasmine.createSpy('unsubscribe')
          }
        }
      }
    })

    const initialTypes = emittedRecords.map((event) => event.type)
    expect(initialTypes).toContain(RecordType.Meta)
    expect(initialTypes).toContain(RecordType.Focus)
    expect(initialTypes).toContain(RecordType.FullSnapshot)

    const initialFullSnapshot = emittedRecords.find(
      (event) => event.type === RecordType.FullSnapshot
    )
    expect(initialFullSnapshot).toEqual(
      jasmine.objectContaining({
        timestamp: jasmine.any(Number),
        data: jasmine.objectContaining({
          node: jasmine.any(Object),
          initialOffset: jasmine.any(Object)
        })
      })
    )

    input.value = 'changed'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    const inputSnapshot = emittedRecords.find(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Input
    )
    expect(inputSnapshot).toEqual(
      jasmine.objectContaining({
        data: jasmine.objectContaining({
          source: IncrementalSource.Input,
          text: 'changed',
          id: jasmine.any(Number)
        })
      })
    )

    recorder.takeSubsequentFullSnapshot(1234)

    const subsequentSnapshotEvents = emittedRecords.filter(
      (event) =>
        event.timestamp === 1234 &&
        (event.type === RecordType.Meta ||
          event.type === RecordType.Focus ||
          event.type === RecordType.FullSnapshot)
    )
    expect(subsequentSnapshotEvents.length).toBe(3)

    expect(() => recorder.flushMutations()).not.toThrow()
    expect(() => recorder.stop()).not.toThrow()
  })

  it('should emit a canvas mutation for serialized canvases when snapshotCanvas is called', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 20
    canvas.height = 10
    container.appendChild(canvas)

    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxEncodedBytes: 40000,
        replayCanvasMaxConcurrentEncodes: 1
      },
      lifeCycle: {
        subscribe() {
          return {
            unsubscribe: jasmine.createSpy('unsubscribe')
          }
        }
      }
    })

    const result = await recorder.snapshotCanvas(canvas)

    expect(result).toEqual({ ok: true })

    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.CanvasMutation
      )
    ).toBeTrue()
  })

  it('should start and stop the auto canvas snapshot loop when auto mode is enabled', () => {
    const stopAutoCanvasSnapshots = jasmine.createSpy('stopAutoCanvasSnapshots')
    const keepSessionAlive = jasmine.createSpy('keepSessionAlive')
    const startAutoCanvasSnapshotLoop = jasmine
      .createSpy('startAutoCanvasSnapshotLoop')
      .and.callFake(function (options) {
        options.onDebug({
          status: 'completed',
          timestamp: 1234,
          eligibleCanvasCount: 2,
          selectedCanvasCount: 1,
          skippedBudgetCount: 1,
          results: [
            {
              canvasId: 26,
              ok: true,
              priority: 10
            }
          ]
        })
        return stopAutoCanvasSnapshots
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasAutoInterval: 1000
      },
      lifeCycle: {
        subscribe() {
          return {
            unsubscribe: jasmine.createSpy('unsubscribe')
          }
        }
      },
      sessionManager: {
        keepSessionAlive: keepSessionAlive
      },
      startAutoCanvasSnapshotLoop: startAutoCanvasSnapshotLoop
    })

    expect(startAutoCanvasSnapshotLoop).toHaveBeenCalledWith(
      jasmine.objectContaining({
        configuration: jasmine.objectContaining({
          replayCanvasMode: 'auto',
          replayCanvasAutoInterval: 1000
        }),
        getSerializedNodeId: jasmine.any(Function),
        onDebug: jasmine.any(Function),
        snapshotCanvas: jasmine.any(Function)
      })
    )
    expect(recorder.getLastAutoCanvasSnapshotResultForDebug()).toEqual({
      status: 'completed',
      timestamp: 1234,
      eligibleCanvasCount: 2,
      selectedCanvasCount: 1,
      skippedBudgetCount: 1,
      keepSessionAliveTriggered: true,
      results: [
        {
          canvasId: 26,
          ok: true,
          reason: undefined,
          priority: 10
        }
      ]
    })
    expect(keepSessionAlive).toHaveBeenCalledTimes(1)

    recorder.stop()
    expect(stopAutoCanvasSnapshots).toHaveBeenCalled()
  })

  it('should not keep the session alive when auto canvas runs are skipped', () => {
    const keepSessionAlive = jasmine.createSpy('keepSessionAlive')
    const startAutoCanvasSnapshotLoop = jasmine
      .createSpy('startAutoCanvasSnapshotLoop')
      .and.callFake(function (options) {
        options.onDebug({
          status: 'skipped_hidden',
          timestamp: 1234,
          eligibleCanvasCount: 0,
          selectedCanvasCount: 0,
          skippedBudgetCount: 0,
          results: []
        })
        return jasmine.createSpy('stopAutoCanvasSnapshots')
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto'
      },
      lifeCycle: {
        subscribe() {
          return {
            unsubscribe: jasmine.createSpy('unsubscribe')
          }
        }
      },
      sessionManager: {
        keepSessionAlive: keepSessionAlive
      },
      startAutoCanvasSnapshotLoop: startAutoCanvasSnapshotLoop
    })

    expect(keepSessionAlive).not.toHaveBeenCalled()
    expect(recorder.getLastAutoCanvasSnapshotResultForDebug()).toEqual({
      status: 'skipped_hidden',
      timestamp: 1234,
      eligibleCanvasCount: 0,
      selectedCanvasCount: 0,
      skippedBudgetCount: 0,
      keepSessionAliveTriggered: false,
      results: []
    })

    recorder.stop()
  })

  it('should keep the session alive when auto canvas runs are softly skipped by dedupe rules', () => {
    const keepSessionAlive = jasmine.createSpy('keepSessionAlive')
    const startAutoCanvasSnapshotLoop = jasmine
      .createSpy('startAutoCanvasSnapshotLoop')
      .and.callFake(function (options) {
        options.onDebug({
          status: 'completed',
          timestamp: 1234,
          eligibleCanvasCount: 2,
          selectedCanvasCount: 2,
          skippedBudgetCount: 0,
          results: [
            {
              canvasId: 26,
              ok: false,
              reason: 'below_threshold',
              priority: 0
            },
            {
              canvasId: 27,
              ok: false,
              reason: 'unchanged',
              priority: 0
            }
          ]
        })
        return jasmine.createSpy('stopAutoCanvasSnapshots')
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto'
      },
      lifeCycle: {
        subscribe() {
          return {
            unsubscribe: jasmine.createSpy('unsubscribe')
          }
        }
      },
      sessionManager: {
        keepSessionAlive: keepSessionAlive
      },
      startAutoCanvasSnapshotLoop: startAutoCanvasSnapshotLoop
    })

    expect(keepSessionAlive).toHaveBeenCalledTimes(1)
    expect(recorder.getLastAutoCanvasSnapshotResultForDebug()).toEqual({
      status: 'completed',
      timestamp: 1234,
      eligibleCanvasCount: 2,
      selectedCanvasCount: 2,
      skippedBudgetCount: 0,
      keepSessionAliveTriggered: true,
      results: [
        {
          canvasId: 26,
          ok: false,
          reason: 'below_threshold',
          priority: 0
        },
        {
          canvasId: 27,
          ok: false,
          reason: 'unchanged',
          priority: 0
        }
      ]
    })

    recorder.stop()
  })

  it('should not keep the session alive when auto canvas runs only have hard failures', () => {
    const keepSessionAlive = jasmine.createSpy('keepSessionAlive')
    const startAutoCanvasSnapshotLoop = jasmine
      .createSpy('startAutoCanvasSnapshotLoop')
      .and.callFake(function (options) {
        options.onDebug({
          status: 'completed',
          timestamp: 1234,
          eligibleCanvasCount: 2,
          selectedCanvasCount: 2,
          skippedBudgetCount: 0,
          results: [
            {
              canvasId: 26,
              ok: false,
              reason: 'encode_failed',
              priority: 0
            },
            {
              canvasId: 27,
              ok: false,
              reason: 'encode_too_large',
              priority: 0
            }
          ]
        })
        return jasmine.createSpy('stopAutoCanvasSnapshots')
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto'
      },
      lifeCycle: {
        subscribe() {
          return {
            unsubscribe: jasmine.createSpy('unsubscribe')
          }
        }
      },
      sessionManager: {
        keepSessionAlive: keepSessionAlive
      },
      startAutoCanvasSnapshotLoop: startAutoCanvasSnapshotLoop
    })

    expect(keepSessionAlive).not.toHaveBeenCalled()
    expect(recorder.getLastAutoCanvasSnapshotResultForDebug()).toEqual({
      status: 'completed',
      timestamp: 1234,
      eligibleCanvasCount: 2,
      selectedCanvasCount: 2,
      skippedBudgetCount: 0,
      keepSessionAliveTriggered: false,
      results: [
        {
          canvasId: 26,
          ok: false,
          reason: 'encode_failed',
          priority: 0
        },
        {
          canvasId: 27,
          ok: false,
          reason: 'encode_too_large',
          priority: 0
        }
      ]
    })

    recorder.stop()
  })

  it('should reset canvas observer caches before taking a subsequent full snapshot', () => {
    const reset = jasmine.createSpy('reset')
    const resetAutoCanvasSnapshotLoop = jasmine.createSpy(
      'resetAutoCanvasSnapshotLoop'
    )
    const createCanvasObserver = jasmine
      .createSpy('createCanvasObserver')
      .and.returnValue({
        snapshot: jasmine.createSpy('snapshot'),
        stop: jasmine.createSpy('stop'),
        reset: reset
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto'
      },
      lifeCycle: {
        subscribe() {
          return {
            unsubscribe: jasmine.createSpy('unsubscribe')
          }
        }
      },
      createCanvasObserver: createCanvasObserver,
      startAutoCanvasSnapshotLoop: function () {
        return {
          stop: jasmine.createSpy('stopAutoCanvasSnapshots'),
          reset: resetAutoCanvasSnapshotLoop
        }
      }
    })

    recorder.takeSubsequentFullSnapshot(1234)

    expect(reset).toHaveBeenCalledTimes(1)
    expect(resetAutoCanvasSnapshotLoop).toHaveBeenCalledTimes(1)

    recorder.stop()
  })

  it('should allow the next auto rerun to emit after a full snapshot resets an in-flight canvas snapshot', async () => {
    let releaseFirstSnapshot
    const firstSnapshotPromise = new Promise((resolve) => {
      releaseFirstSnapshot = resolve
    })
    const snapshot = jasmine
      .createSpy('snapshot')
      .and.returnValues(
        firstSnapshotPromise,
        Promise.resolve({ ok: true })
      )
    const reset = jasmine.createSpy('reset')
    const canvasObserver = {
      snapshot,
      stop: jasmine.createSpy('stop'),
      reset
    }
    let loopOptions
    const startAutoCanvasSnapshotLoop = jasmine
      .createSpy('startAutoCanvasSnapshotLoop')
      .and.callFake(function (options) {
        loopOptions = options
        return {
          stop: jasmine.createSpy('stopAutoCanvasSnapshots'),
          reset: jasmine.createSpy('resetAutoCanvasSnapshotLoop')
        }
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto'
      },
      lifeCycle: {
        subscribe() {
          return {
            unsubscribe: jasmine.createSpy('unsubscribe')
          }
        }
      },
      createCanvasObserver: function () {
        return canvasObserver
      },
      startAutoCanvasSnapshotLoop: startAutoCanvasSnapshotLoop
    })

    const canvas = document.createElement('canvas')
    container.appendChild(canvas)

    const staleSnapshotPromise = loopOptions.snapshotCanvas(canvas)

    recorder.takeSubsequentFullSnapshot(1234)

    releaseFirstSnapshot({ ok: false, reason: 'reset_during_snapshot' })
    expect(await staleSnapshotPromise).toEqual({
      ok: false,
      reason: 'reset_during_snapshot'
    })

    expect(await loopOptions.snapshotCanvas(canvas)).toEqual({ ok: true })
    expect(reset).toHaveBeenCalledTimes(1)
    expect(snapshot.calls.count()).toBe(2)

    recorder.stop()
  })
})
