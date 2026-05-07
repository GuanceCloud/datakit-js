import { IncrementalSource, RecordType } from '../../../types'
import { NodePrivacyLevel } from '../../../constants'
import { record } from './record'
import { MUTATION_PROCESS_MIN_DELAY } from './mutationBatch'

describe('replay/record/record', () => {
  let container
  const ASYNC_MUTATION_TICK = MUTATION_PROCESS_MIN_DELAY + 20

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (container) {
      container.remove()
    }
  })

  function createLifeCycle() {
    return {
      subscribe() {
        return {
          unsubscribe: jasmine.createSpy('unsubscribe')
        }
      }
    }
  }

  function expectReplayCompatibleCanvasMutation(event, canvasId, width, height) {
    expect(event).toEqual(
      jasmine.objectContaining({
        type: RecordType.IncrementalSnapshot,
        data: jasmine.objectContaining({
          source: IncrementalSource.CanvasMutation,
          id: canvasId,
          type: '2D',
          commands: [
            jasmine.objectContaining({
              property: 'clearRect',
              args: [0, 0, width, height]
            }),
            jasmine.objectContaining({
              property: 'drawImage',
              args: [
                jasmine.objectContaining({
                  rr_type: 'ImageBitmap',
                  args: [
                    jasmine.objectContaining({
                      rr_type: 'Blob',
                      data: [
                        jasmine.objectContaining({
                          rr_type: 'ArrayBuffer',
                          base64: jasmine.any(String)
                        })
                      ],
                      type: jasmine.any(String)
                    })
                  ]
                }),
                0,
                0,
                width,
                height
              ]
            })
          ],
          encodedBytesCount: jasmine.any(Number)
        })
      })
    )
  }

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
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })

    const initialTypes = emittedRecords.map((event) => event.type)
    expect(initialTypes).toContain(RecordType.Meta)
    expect(initialTypes).toContain(RecordType.Focus)
    expect(initialTypes).toContain(RecordType.FullSnapshot)

    input.value = 'changed'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    const inputSnapshot = emittedRecords.find(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Input
    )
    expect(inputSnapshot.data.text).toBe('changed')

    recorder.takeSubsequentFullSnapshot(1234)

    const subsequentSnapshotEvents = emittedRecords.filter(
      (event) =>
        event.timestamp === 1234 &&
        (event.type === RecordType.Meta ||
          event.type === RecordType.Focus ||
          event.type === RecordType.FullSnapshot)
    )
    expect(subsequentSnapshotEvents.length).toBe(3)
  })

  it('should expose replay performance counters for mutation processing', () => {
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })

    const child = document.createElement('div')
    child.textContent = 'hello'
    container.appendChild(child)
    recorder.flushMutations()

    const replayPerformance = recorder.getReplayPerformanceForDebug()
    expect(replayPerformance.processMutationsCount).toBeGreaterThan(0)
    expect(replayPerformance.processMutationsDuration).toBeGreaterThanOrEqual(0)
    expect(replayPerformance.mutationCallbackCount).toBeGreaterThan(0)
    expect(replayPerformance.mutationRecordCount).toBeGreaterThan(0)
    expect(replayPerformance.mutationAddCount).toBeGreaterThan(0)
  })

  it('should batch consecutive mutation payloads into a single emitted snapshot', () => {
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })

    emittedRecords.length = 0

    container.appendChild(document.createElement('div'))
    container.appendChild(document.createElement('div'))
    recorder.flushMutations()

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    expect(mutationSnapshots.length).toBe(1)
    expect(mutationSnapshots[0].data.adds.length).toBe(2)
  })

  it('should expose dynamic div add mutations after flushMutations', () => {
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })

    emittedRecords.length = 0

    const dynamicDialog = document.createElement('div')
    dynamicDialog.setAttribute('data-testid', 'dynamic-replay-dialog')
    dynamicDialog.textContent = 'dynamic dialog'
    container.appendChild(dynamicDialog)

    recorder.flushMutations()

    const lastDomMutation = recorder.getLastDomMutationForDebug()
    expect(lastDomMutation).toBeDefined()
    expect(lastDomMutation.addsCount).toBeGreaterThan(0)
    expect(
      lastDomMutation.adds.some(function (add) {
        return (
          add &&
          add.node &&
          add.node.type === 2 &&
          add.node.attributes &&
          add.node.attributes['data-testid'] === 'dynamic-replay-dialog'
        )
      })
    ).toBeTrue()
  })

  it('should capture dynamically created div nodes after flushMutations', () => {
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })

    emittedRecords.length = 0

    const modal = document.createElement('div')
    modal.setAttribute('data-testid', 'dynamic-modal')
    modal.textContent = 'dynamic dialog'
    container.appendChild(modal)

    recorder.flushMutations()

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    const dynamicModalMutation = mutationSnapshots.some((event) =>
      event.data.adds.some(
        (add) =>
          add.node &&
          add.node.type === 2 &&
          add.node.tagName === 'div' &&
          add.node.attributes &&
          add.node.attributes['data-testid'] === 'dynamic-modal'
      )
    )

    expect(dynamicModalMutation).toBeTrue()
  })

  it('should flush pending mutation payloads before taking a subsequent full snapshot', () => {
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })

    emittedRecords.length = 0
    container.appendChild(document.createElement('div'))

    recorder.takeSubsequentFullSnapshot(4321)

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    const fullSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.FullSnapshot && event.timestamp === 4321
    )

    expect(mutationSnapshots.length).toBe(1)
    expect(fullSnapshots.length).toBe(1)
  })

  it('should keep only the latest text mutation for the same node within a merged mutation window', () => {
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })

    const textNode = document.createTextNode('a')
    container.appendChild(textNode)
    recorder.flushMutations()
    emittedRecords.length = 0

    textNode.textContent = 'b'
    textNode.textContent = 'c'
    recorder.flushMutations()

    const mutationSnapshot = emittedRecords.find(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )

    expect(mutationSnapshot.data.texts.length).toBe(1)
    expect(mutationSnapshot.data.texts[0].value).toBe('c')
  })

  it('should merge attribute mutations by id within a merged mutation window', () => {
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })

    const element = document.createElement('div')
    container.appendChild(element)
    recorder.flushMutations()
    emittedRecords.length = 0

    element.setAttribute('data-a', '1')
    element.setAttribute('data-b', '2')
    recorder.flushMutations()

    const mutationSnapshot = emittedRecords.find(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )

    expect(mutationSnapshot.data.attributes.length).toBe(1)
    expect(mutationSnapshot.data.attributes[0].attributes).toEqual({
      'data-a': '1',
      'data-b': '2'
    })
  })

  it('should split oversized mutation payloads into multiple emitted snapshots', () => {
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })

    for (let index = 0; index < 4; index += 1) {
      const child = document.createElement('div')
      child.textContent = 'x'.repeat(70000)
      container.appendChild(child)
    }

    recorder.flushMutations()

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )

    expect(mutationSnapshots.length).toBeGreaterThan(1)
    expect(
      mutationSnapshots.reduce((count, event) => count + event.data.adds.length, 0)
    ).toBe(4)
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
      lifeCycle: createLifeCycle()
    })

    expect(await recorder.snapshotCanvas(canvas)).toEqual({ ok: true })
    const canvasMutation = emittedRecords.find(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.CanvasMutation
    )
    expect(canvasMutation).toBeDefined()
    expectReplayCompatibleCanvasMutation(canvasMutation, jasmine.any(Number), 20, 10)
  })

  it('should emit replay-compatible canvas snapshot records from the continuous auto path', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 20
    canvas.height = 10
    container.appendChild(canvas)

    const emittedRecords = []
    let loopOptions
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 2,
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxEncodedBytes: 40000,
        replayCanvasMaxConcurrentEncodes: 1
      },
      lifeCycle: createLifeCycle(),
      startContinuousCanvasSnapshotLoop: function (options) {
        loopOptions = options
        return {
          stop: jasmine.createSpy('stopContinuousCanvasSnapshots'),
          reset: jasmine.createSpy('resetContinuousCanvasSnapshots')
        }
      }
    })

    emittedRecords.length = 0
    expect(await loopOptions.snapshotCanvas(canvas)).toEqual({ ok: true })

    const canvasMutation = emittedRecords.find(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.CanvasMutation
    )
    expect(canvasMutation).toBeDefined()
    expectReplayCompatibleCanvasMutation(canvasMutation, jasmine.any(Number), 20, 10)

    recorder.stop()
  })

  it("should emit replay-compatible canvas snapshot records from the command capture fallback path", async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 20
    canvas.height = 10
    container.appendChild(canvas)

    const emittedRecords = []
    let commandCaptureOptions
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all',
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxEncodedBytes: 40000,
        replayCanvasMaxConcurrentEncodes: 1
      },
      lifeCycle: createLifeCycle(),
      startCanvasCommandCapture: function (options) {
        commandCaptureOptions = options
        return {
          stop: jasmine.createSpy('stopCanvasCommandCapture'),
          reset: jasmine.createSpy('resetCanvasCommandCapture'),
          scanExistingCanvases: jasmine.createSpy('scanExistingCanvases')
        }
      }
    })

    emittedRecords.length = 0
    expect(
      await commandCaptureOptions.snapshotCanvas(canvas, {
        trigger: 'auto',
        scheduler: 'command_capture'
      })
    ).toEqual({ ok: true })

    const canvasMutation = emittedRecords.find(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.CanvasMutation
    )
    expect(canvasMutation).toBeDefined()
    expectReplayCompatibleCanvasMutation(canvasMutation, jasmine.any(Number), 20, 10)

    recorder.stop()
  })

  it('should start and stop the continuous canvas snapshot loop for numeric sampling', () => {
    const keepSessionAlive = jasmine.createSpy('keepSessionAlive')
    const stopContinuousCanvasSnapshots = jasmine.createSpy(
      'stopContinuousCanvasSnapshots'
    )
    const startContinuousCanvasSnapshotLoop = jasmine
      .createSpy('startContinuousCanvasSnapshotLoop')
      .and.callFake(function (options) {
        options.onDebug({
          scheduler: 'continuous_snapshot',
          status: 'completed',
          timestamp: 2234,
          eligibleCanvasCount: 3,
          selectedCanvasCount: 3,
          skippedBudgetCount: 0,
          results: [
            { canvasId: 31, ok: true },
            { canvasId: 32, ok: true },
            { canvasId: 33, ok: false, reason: 'below_threshold' }
          ]
        })
        return {
          stop: stopContinuousCanvasSnapshots,
          reset: jasmine.createSpy('resetContinuousCanvasSnapshots')
        }
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 2
      },
      lifeCycle: createLifeCycle(),
      sessionManager: {
        keepSessionAlive: keepSessionAlive
      },
      startContinuousCanvasSnapshotLoop: startContinuousCanvasSnapshotLoop
    })

    expect(startContinuousCanvasSnapshotLoop).toHaveBeenCalledWith(
      jasmine.objectContaining({
        configuration: jasmine.objectContaining({
          replayCanvasSampling: 2,
          replayCanvasMode: 'auto'
        }),
        getSerializedNodeId: jasmine.any(Function),
        onDebug: jasmine.any(Function),
        snapshotCanvas: jasmine.any(Function)
      })
    )
    expect(keepSessionAlive).toHaveBeenCalledTimes(1)
    expect(recorder.getLastAutoCanvasSnapshotResultForDebug()).toEqual({
      scheduler: 'continuous_snapshot',
      status: 'completed',
      startedAt: 2234,
      completedAt: 2234,
      timestamp: 2234,
      eligibleCanvasCount: 3,
      selectedCanvasCount: 3,
      skippedBudgetCount: 0,
      keepSessionAliveTriggered: true,
      results: [
        { canvasId: 31, ok: true, reason: undefined, priority: undefined },
        { canvasId: 32, ok: true, reason: undefined, priority: undefined },
        {
          canvasId: 33,
          ok: false,
          reason: 'below_threshold',
          priority: undefined
        }
      ]
    })

    recorder.stop()
    expect(stopContinuousCanvasSnapshots).toHaveBeenCalled()
  })

  it('should not keep the session alive when continuous runs only have hard failures', () => {
    const keepSessionAlive = jasmine.createSpy('keepSessionAlive')
    const startContinuousCanvasSnapshotLoop = jasmine
      .createSpy('startContinuousCanvasSnapshotLoop')
      .and.callFake(function (options) {
        options.onDebug({
          scheduler: 'continuous_snapshot',
          status: 'completed',
          timestamp: 1234,
          eligibleCanvasCount: 2,
          selectedCanvasCount: 2,
          skippedBudgetCount: 0,
          results: [
            { canvasId: 26, ok: false, reason: 'encode_failed' },
            { canvasId: 27, ok: false, reason: 'encode_too_large' }
          ]
        })
        return {
          stop: jasmine.createSpy('stopContinuousCanvasSnapshots'),
          reset: jasmine.createSpy('resetContinuousCanvasSnapshots')
        }
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 2
      },
      lifeCycle: createLifeCycle(),
      sessionManager: {
        keepSessionAlive: keepSessionAlive
      },
      startContinuousCanvasSnapshotLoop: startContinuousCanvasSnapshotLoop
    })

    expect(keepSessionAlive).not.toHaveBeenCalled()
    expect(recorder.getLastAutoCanvasSnapshotResultForDebug().scheduler).toBe(
      'continuous_snapshot'
    )
    recorder.stop()
  })

  it('should reset canvas observer caches and the continuous loop before taking a subsequent full snapshot', () => {
    const reset = jasmine.createSpy('reset')
    const resetContinuousCanvasSnapshotLoop = jasmine.createSpy(
      'resetContinuousCanvasSnapshotLoop'
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
        replayCanvasMode: 'auto',
        replayCanvasSampling: 2
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: createCanvasObserver,
      startContinuousCanvasSnapshotLoop: function () {
        return {
          stop: jasmine.createSpy('stopContinuousCanvasSnapshots'),
          reset: resetContinuousCanvasSnapshotLoop
        }
      }
    })

    recorder.takeSubsequentFullSnapshot(2234)

    expect(reset).toHaveBeenCalledTimes(1)
    expect(resetContinuousCanvasSnapshotLoop).toHaveBeenCalledTimes(1)
    recorder.stop()
  })

  it('should allow the next continuous rerun to emit after a full snapshot resets an in-flight canvas snapshot', async () => {
    let releaseFirstSnapshot
    const firstSnapshotPromise = new Promise((resolve) => {
      releaseFirstSnapshot = resolve
    })
    const snapshot = jasmine
      .createSpy('snapshot')
      .and.returnValues(firstSnapshotPromise, Promise.resolve({ ok: true }))
    const reset = jasmine.createSpy('reset')
    const canvasObserver = {
      snapshot,
      stop: jasmine.createSpy('stop'),
      reset
    }
    let loopOptions
    const startContinuousCanvasSnapshotLoop = jasmine
      .createSpy('startContinuousCanvasSnapshotLoop')
      .and.callFake(function (options) {
        loopOptions = options
        return {
          stop: jasmine.createSpy('stopContinuousCanvasSnapshots'),
          reset: jasmine.createSpy('resetContinuousCanvasSnapshotLoop')
        }
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 2
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function () {
        return canvasObserver
      },
      startContinuousCanvasSnapshotLoop: startContinuousCanvasSnapshotLoop
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

  it("should start canvas command capture when replayCanvasSampling is 'all'", () => {
    const stopCanvasCommandCapture = jasmine.createSpy('stopCanvasCommandCapture')
    const resetCanvasCommandCapture = jasmine.createSpy('resetCanvasCommandCapture')
    const scanExistingCanvases = jasmine.createSpy('scanExistingCanvases')
    let onCommandDebug
    let onCommandMutationDebug
    const startCanvasCommandCapture = jasmine
      .createSpy('startCanvasCommandCapture')
      .and.callFake(function (options) {
        onCommandDebug = options.onDebug
        onCommandMutationDebug = options.onMutationDebug
        return {
          stop: stopCanvasCommandCapture,
          reset: resetCanvasCommandCapture,
          scanExistingCanvases: scanExistingCanvases
        }
      })
    const startContinuousCanvasSnapshotLoop = jasmine
      .createSpy('startContinuousCanvasSnapshotLoop')
      .and.returnValue({
        stop: jasmine.createSpy('stopContinuousCanvasSnapshots'),
        reset: jasmine.createSpy('resetContinuousCanvasSnapshots')
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      startCanvasCommandCapture: startCanvasCommandCapture,
      startContinuousCanvasSnapshotLoop: startContinuousCanvasSnapshotLoop
    })

    expect(startCanvasCommandCapture).toHaveBeenCalledWith(
      jasmine.objectContaining({
        configuration: jasmine.objectContaining({
          replayCanvasSampling: 'all',
          replayCanvasMode: 'auto'
        }),
        emit: jasmine.any(Function),
        getCanvases: jasmine.any(Function)
      })
    )
    expect(scanExistingCanvases).toHaveBeenCalledTimes(1)
    expect(startContinuousCanvasSnapshotLoop).not.toHaveBeenCalled()

    onCommandMutationDebug({
      timestamp: 4321,
      canvasId: 26,
      trigger: 'auto',
      approxBytesCount: 123,
      commandCount: 1
    })
    onCommandDebug({
      scheduler: 'command_capture',
      status: 'completed',
      startedAt: 4321,
      completedAt: 4321,
      timestamp: 4321,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 1,
      skippedBudgetCount: 0,
      results: [{ canvasId: 26, ok: true }]
    })

    expect(recorder.getLastAutoCanvasSnapshotResultForDebug()).toEqual({
      scheduler: 'command_capture',
      status: 'completed',
      startedAt: 4321,
      completedAt: 4321,
      timestamp: 4321,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 1,
      skippedBudgetCount: 0,
      keepSessionAliveTriggered: false,
      results: [
        { canvasId: 26, ok: true, reason: undefined, priority: undefined }
      ]
    })
    expect(recorder.getLastCanvasMutationForDebug()).toEqual({
      timestamp: 4321,
      canvasId: 26,
      trigger: 'auto',
      encodedBytesCount: undefined,
      approxBytesCount: 123,
      commandCount: 1,
      width: undefined,
      height: undefined
    })

    recorder.takeSubsequentFullSnapshot(1234)
    expect(resetCanvasCommandCapture).toHaveBeenCalledTimes(1)
    expect(scanExistingCanvases).toHaveBeenCalledTimes(2)

    recorder.stop()
    expect(stopCanvasCommandCapture).toHaveBeenCalledTimes(1)
  })

  it('should default auto mode to the continuous snapshot path for numeric sampling', () => {
    const startContinuousCanvasSnapshotLoop = jasmine
      .createSpy('startContinuousCanvasSnapshotLoop')
      .and.returnValue({
        stop: jasmine.createSpy('stopContinuousCanvasSnapshots'),
        reset: jasmine.createSpy('resetContinuousCanvasSnapshots')
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto'
      },
      lifeCycle: createLifeCycle(),
      startContinuousCanvasSnapshotLoop: startContinuousCanvasSnapshotLoop
    })

    expect(startContinuousCanvasSnapshotLoop).toHaveBeenCalled()
    recorder.stop()
  })

  it('should expose command fallback debug results without keeping the session alive', () => {
    const keepSessionAlive = jasmine.createSpy('keepSessionAlive')
    let onCommandDebug
    const startCanvasCommandCapture = jasmine
      .createSpy('startCanvasCommandCapture')
      .and.callFake(function (options) {
        onCommandDebug = options.onDebug
        return {
          stop: jasmine.createSpy('stopCanvasCommandCapture'),
          reset: jasmine.createSpy('resetCanvasCommandCapture'),
          scanExistingCanvases: jasmine.createSpy('scanExistingCanvases')
        }
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      sessionManager: {
        keepSessionAlive: keepSessionAlive
      },
      startCanvasCommandCapture: startCanvasCommandCapture
    })

    onCommandDebug({
      scheduler: 'command_capture',
      status: 'fallback',
      startedAt: 5100,
      completedAt: 5101,
      timestamp: 5101,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 0,
      skippedBudgetCount: 0,
      results: [{ canvasId: 41, ok: false, reason: 'draw_image_video' }]
    })

    expect(keepSessionAlive).not.toHaveBeenCalled()
    expect(recorder.getLastAutoCanvasSnapshotResultForDebug()).toEqual({
      scheduler: 'command_capture',
      status: 'fallback',
      startedAt: 5100,
      completedAt: 5101,
      timestamp: 5101,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 0,
      skippedBudgetCount: 0,
      keepSessionAliveTriggered: false,
      results: [
        {
          canvasId: 41,
          ok: false,
          reason: 'draw_image_video',
          priority: undefined
        }
      ]
    })

    expect(recorder.getAutoCanvasSnapshotDebugHistoryForDebug()).toEqual([
      {
        scheduler: 'command_capture',
        status: 'fallback',
        startedAt: 5100,
        completedAt: 5101,
        timestamp: 5101,
        eligibleCanvasCount: 1,
        selectedCanvasCount: 0,
        skippedBudgetCount: 0,
        keepSessionAliveTriggered: false,
        results: [
          {
            canvasId: 41,
            ok: false,
            reason: 'draw_image_video',
            priority: undefined
          }
        ]
      }
    ])

    recorder.stop()
  })

  it('should expose path2d command fallback without emitting a successful command mutation', () => {
    const emit = jasmine.createSpy('emit')
    let onCommandDebug
    const startCanvasCommandCapture = jasmine
      .createSpy('startCanvasCommandCapture')
      .and.callFake(function (options) {
        onCommandDebug = options.onDebug
        return {
          stop: jasmine.createSpy('stopCanvasCommandCapture'),
          reset: jasmine.createSpy('resetCanvasCommandCapture'),
          scanExistingCanvases: jasmine.createSpy('scanExistingCanvases')
        }
      })

    const recorder = record({
      emit: emit,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      startCanvasCommandCapture: startCanvasCommandCapture
    })

    onCommandDebug({
      scheduler: 'command_capture',
      status: 'fallback',
      startedAt: 7100,
      completedAt: 7101,
      timestamp: 7101,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 0,
      skippedBudgetCount: 0,
      results: [{ canvasId: 173, ok: false, reason: 'path2d_argument' }]
    })

    expect(recorder.getLastAutoCanvasSnapshotResultForDebug()).toEqual({
      scheduler: 'command_capture',
      status: 'fallback',
      startedAt: 7100,
      completedAt: 7101,
      timestamp: 7101,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 0,
      skippedBudgetCount: 0,
      keepSessionAliveTriggered: false,
      results: [
        {
          canvasId: 173,
          ok: false,
          reason: 'path2d_argument',
          priority: undefined
        }
      ]
    })
    expect(recorder.getAutoCanvasSnapshotDebugHistoryForDebug()).toEqual([
      {
        scheduler: 'command_capture',
        status: 'fallback',
        startedAt: 7100,
        completedAt: 7101,
        timestamp: 7101,
        eligibleCanvasCount: 1,
        selectedCanvasCount: 0,
        skippedBudgetCount: 0,
        keepSessionAliveTriggered: false,
        results: [
          {
            canvasId: 173,
            ok: false,
            reason: 'path2d_argument',
            priority: undefined
          }
        ]
      }
    ])
    expect(recorder.getLastCanvasMutationForDebug()).toBeUndefined()
    expect(
      emit.calls.allArgs().some(function (args) {
        return (
          args[0] &&
          args[0].type === RecordType.IncrementalSnapshot &&
          args[0].data &&
          args[0].data.source === IncrementalSource.CanvasMutation
        )
      })
    ).toBeFalse()

    recorder.stop()
  })

  it('should preserve mixed path2d fallback and successful command results for multiple canvases', () => {
    const keepSessionAlive = jasmine.createSpy('keepSessionAlive')
    let onCommandDebug
    let onCommandMutationDebug
    const startCanvasCommandCapture = jasmine
      .createSpy('startCanvasCommandCapture')
      .and.callFake(function (options) {
        onCommandDebug = options.onDebug
        onCommandMutationDebug = options.onMutationDebug
        return {
          stop: jasmine.createSpy('stopCanvasCommandCapture'),
          reset: jasmine.createSpy('resetCanvasCommandCapture'),
          scanExistingCanvases: jasmine.createSpy('scanExistingCanvases')
        }
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      sessionManager: {
        keepSessionAlive: keepSessionAlive
      },
      startCanvasCommandCapture: startCanvasCommandCapture
    })

    onCommandMutationDebug({
      timestamp: 7151,
      canvasId: 84,
      trigger: 'auto',
      approxBytesCount: 120,
      commandCount: 3,
      width: 320,
      height: 180
    })
    onCommandDebug({
      scheduler: 'command_capture',
      status: 'completed',
      startedAt: 7150,
      completedAt: 7151,
      timestamp: 7151,
      eligibleCanvasCount: 2,
      selectedCanvasCount: 1,
      skippedBudgetCount: 0,
      results: [
        { canvasId: 173, ok: false, reason: 'path2d_argument' },
        { canvasId: 84, ok: true }
      ]
    })

    expect(keepSessionAlive).toHaveBeenCalledTimes(1)
    expect(recorder.getLastAutoCanvasSnapshotResultForDebug()).toEqual({
      scheduler: 'command_capture',
      status: 'completed',
      startedAt: 7150,
      completedAt: 7151,
      timestamp: 7151,
      eligibleCanvasCount: 2,
      selectedCanvasCount: 1,
      skippedBudgetCount: 0,
      keepSessionAliveTriggered: true,
      results: [
        {
          canvasId: 173,
          ok: false,
          reason: 'path2d_argument',
          priority: undefined
        },
        {
          canvasId: 84,
          ok: true,
          reason: undefined,
          priority: undefined
        }
      ]
    })
    expect(recorder.getAutoCanvasSnapshotDebugHistoryForDebug()).toEqual([
      {
        scheduler: 'command_capture',
        status: 'completed',
        startedAt: 7150,
        completedAt: 7151,
        timestamp: 7151,
        eligibleCanvasCount: 2,
        selectedCanvasCount: 1,
        skippedBudgetCount: 0,
        keepSessionAliveTriggered: false,
        results: [
          {
            canvasId: 173,
            ok: false,
            reason: 'path2d_argument',
            priority: undefined
          },
          {
            canvasId: 84,
            ok: true,
            reason: undefined,
            priority: undefined
          }
        ]
      }
    ])
    expect(recorder.getLastCanvasMutationForDebug()).toEqual({
      timestamp: 7151,
      canvasId: 84,
      trigger: 'auto',
      encodedBytesCount: undefined,
      approxBytesCount: 120,
      commandCount: 3,
      width: 320,
      height: 180
    })

    recorder.stop()
  })

  it('should expose invalid encoded payload diagnostics through canvas mutation debug state', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 20
    canvas.height = 10
    container.appendChild(canvas)

    const emittedRecords = []
    const recorder = record({
      emit: function (event) {
        emittedRecords.push(event)
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        return {
          snapshot: function () {
            options.onMutationDebug({
              timestamp: 9001,
              canvasId: 26,
              trigger: 'manual',
              reason: 'invalid_encoded_payload',
              encodedBytesCount: 7,
              width: 20,
              height: 10,
              diagnostics: {
                mimeType: 'image/webp',
                dataUrlLength: 32,
                base64Length: 9,
                base64Prefix: 'QUJD=REVG',
                base64Suffix: 'QUJD=REVG',
                firstPaddingIndex: 4,
                firstPaddingWindow: 'QUJD=REVG',
                invalidCharacterIndex: undefined,
                invalidCharacterWindow: undefined,
                hasMidstreamPadding: true
              }
            })
            return Promise.resolve({
              ok: false,
              reason: 'invalid_encoded_payload'
            })
          },
          stop: jasmine.createSpy('stopCanvasObserver'),
          reset: jasmine.createSpy('resetCanvasObserver')
        }
      }
    })
    emittedRecords.length = 0

    expect(await recorder.snapshotCanvas(canvas)).toEqual({
      ok: false,
      reason: 'invalid_encoded_payload'
    })
    expect(emittedRecords).toEqual([])
    expect(recorder.getLastCanvasMutationForDebug()).toEqual({
      timestamp: 9001,
      canvasId: 26,
      trigger: 'manual',
      reason: 'invalid_encoded_payload',
      encodedBytesCount: 7,
      approxBytesCount: undefined,
      commandCount: undefined,
      width: 20,
      height: 10,
      diagnostics: {
        mimeType: 'image/webp',
        dataUrlLength: 32,
        base64Length: 9,
        base64Prefix: 'QUJD=REVG',
        base64Suffix: 'QUJD=REVG',
        firstPaddingIndex: 4,
        firstPaddingWindow: 'QUJD=REVG',
        invalidCharacterIndex: undefined,
        invalidCharacterWindow: undefined,
        hasMidstreamPadding: true
      }
    })

    recorder.stop()
  })

  it('should keep the session alive when command fallback is followed by a completed snapshot result', () => {
    const keepSessionAlive = jasmine.createSpy('keepSessionAlive')
    let onCommandDebug
    const startCanvasCommandCapture = jasmine
      .createSpy('startCanvasCommandCapture')
      .and.callFake(function (options) {
        onCommandDebug = options.onDebug
        return {
          stop: jasmine.createSpy('stopCanvasCommandCapture'),
          reset: jasmine.createSpy('resetCanvasCommandCapture'),
          scanExistingCanvases: jasmine.createSpy('scanExistingCanvases')
        }
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      sessionManager: {
        keepSessionAlive: keepSessionAlive
      },
      startCanvasCommandCapture: startCanvasCommandCapture
    })

    onCommandDebug({
      scheduler: 'command_capture',
      status: 'fallback',
      startedAt: 6000,
      completedAt: 6001,
      timestamp: 6001,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 0,
      skippedBudgetCount: 0,
      results: [{ canvasId: 52, ok: false, reason: 'canvas_pattern' }]
    })
    onCommandDebug({
      scheduler: 'command_capture',
      status: 'completed',
      startedAt: 6002,
      completedAt: 6003,
      timestamp: 6003,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 1,
      skippedBudgetCount: 0,
      results: [{ canvasId: 52, ok: true }]
    })

    expect(keepSessionAlive).toHaveBeenCalledTimes(1)
    expect(recorder.getLastAutoCanvasSnapshotResultForDebug()).toEqual({
      scheduler: 'command_capture',
      status: 'completed',
      startedAt: 6002,
      completedAt: 6003,
      timestamp: 6003,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 1,
      skippedBudgetCount: 0,
      keepSessionAliveTriggered: true,
      results: [
        {
          canvasId: 52,
          ok: true,
          reason: undefined,
          priority: undefined
        }
      ]
    })
    expect(recorder.getAutoCanvasSnapshotDebugHistoryForDebug()).toEqual([
      {
        scheduler: 'command_capture',
        status: 'fallback',
        startedAt: 6000,
        completedAt: 6001,
        timestamp: 6001,
        eligibleCanvasCount: 1,
        selectedCanvasCount: 0,
        skippedBudgetCount: 0,
        keepSessionAliveTriggered: false,
        results: [
          {
            canvasId: 52,
            ok: false,
            reason: 'canvas_pattern',
            priority: undefined
          }
        ]
      },
      {
        scheduler: 'command_capture',
        status: 'completed',
        startedAt: 6002,
        completedAt: 6003,
        timestamp: 6003,
        eligibleCanvasCount: 1,
        selectedCanvasCount: 1,
        skippedBudgetCount: 0,
        keepSessionAliveTriggered: true,
        results: [
          {
            canvasId: 52,
            ok: true,
            reason: undefined,
            priority: undefined
          }
        ]
      }
    ])

    recorder.stop()
  })

  it('should reset command capture on subsequent full snapshot and keep later command debug results isolated', () => {
    const keepSessionAlive = jasmine.createSpy('keepSessionAlive')
    const resetCanvasCommandCapture = jasmine.createSpy('resetCanvasCommandCapture')
    const scanExistingCanvases = jasmine.createSpy('scanExistingCanvases')
    let onCommandDebug
    let onCommandMutationDebug
    const startCanvasCommandCapture = jasmine
      .createSpy('startCanvasCommandCapture')
      .and.callFake(function (options) {
        onCommandDebug = options.onDebug
        onCommandMutationDebug = options.onMutationDebug
        return {
          stop: jasmine.createSpy('stopCanvasCommandCapture'),
          reset: resetCanvasCommandCapture,
          scanExistingCanvases: scanExistingCanvases
        }
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      sessionManager: {
        keepSessionAlive: keepSessionAlive
      },
      startCanvasCommandCapture: startCanvasCommandCapture
    })

    onCommandMutationDebug({
      timestamp: 7001,
      canvasId: 61,
      trigger: 'auto',
      approxBytesCount: 101,
      commandCount: 1
    })
    onCommandDebug({
      scheduler: 'command_capture',
      status: 'completed',
      startedAt: 7000,
      completedAt: 7001,
      timestamp: 7001,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 1,
      skippedBudgetCount: 0,
      results: [{ canvasId: 61, ok: true }]
    })

    recorder.takeSubsequentFullSnapshot(7100)

    expect(resetCanvasCommandCapture).toHaveBeenCalledTimes(1)
    expect(scanExistingCanvases).toHaveBeenCalledTimes(2)

    onCommandMutationDebug({
      timestamp: 7201,
      canvasId: 62,
      trigger: 'auto',
      approxBytesCount: 202,
      commandCount: 2
    })
    onCommandDebug({
      scheduler: 'command_capture',
      status: 'completed',
      startedAt: 7200,
      completedAt: 7201,
      timestamp: 7201,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 1,
      skippedBudgetCount: 0,
      results: [{ canvasId: 62, ok: true }]
    })

    expect(keepSessionAlive).toHaveBeenCalledTimes(2)
    expect(recorder.getLastAutoCanvasSnapshotResultForDebug()).toEqual({
      scheduler: 'command_capture',
      status: 'completed',
      startedAt: 7200,
      completedAt: 7201,
      timestamp: 7201,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 1,
      skippedBudgetCount: 0,
      keepSessionAliveTriggered: true,
      results: [
        {
          canvasId: 62,
          ok: true,
          reason: undefined,
          priority: undefined
        }
      ]
    })
    expect(recorder.getLastCanvasMutationForDebug()).toEqual({
      timestamp: 7201,
      canvasId: 62,
      trigger: 'auto',
      encodedBytesCount: undefined,
      approxBytesCount: 202,
      commandCount: 2,
      width: undefined,
      height: undefined
    })
    expect(recorder.getAutoCanvasSnapshotDebugHistoryForDebug()).toEqual([
      jasmine.objectContaining({
        scheduler: 'command_capture',
        status: 'completed',
        startedAt: 7000,
        completedAt: 7001,
        timestamp: 7001,
        eligibleCanvasCount: 1,
        selectedCanvasCount: 1,
        skippedBudgetCount: 0,
        results: [
          {
            canvasId: 61,
            ok: true,
            reason: undefined,
            priority: undefined
          }
        ]
      }),
      {
        scheduler: 'command_capture',
        status: 'completed',
        startedAt: 7200,
        completedAt: 7201,
        timestamp: 7201,
        eligibleCanvasCount: 1,
        selectedCanvasCount: 1,
        skippedBudgetCount: 0,
        keepSessionAliveTriggered: true,
        results: [
          {
            canvasId: 62,
            ok: true,
            reason: undefined,
            priority: undefined
          }
        ]
      }
    ])

    recorder.stop()
  })

  it('should keep session alive for initial static canvas snapshots reported by command capture', () => {
    const keepSessionAlive = jasmine.createSpy('keepSessionAlive')
    let onCommandDebug
    let scanCount = 0
    const startCanvasCommandCapture = jasmine
      .createSpy('startCanvasCommandCapture')
      .and.callFake(function (options) {
        onCommandDebug = options.onDebug
        return {
          stop: jasmine.createSpy('stopCanvasCommandCapture'),
          reset: jasmine.createSpy('resetCanvasCommandCapture'),
          scanExistingCanvases: function () {
            scanCount += 1
            if (scanCount === 1) {
              onCommandDebug({
                scheduler: 'command_capture',
                status: 'completed',
                startedAt: 8050,
                completedAt: 8051,
                timestamp: 8051,
                eligibleCanvasCount: 1,
                selectedCanvasCount: 1,
                skippedBudgetCount: 0,
                results: [{ canvasId: 88, ok: true }]
              })
            }
          }
        }
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      sessionManager: {
        keepSessionAlive: keepSessionAlive
      },
      startCanvasCommandCapture: startCanvasCommandCapture
    })

    expect(keepSessionAlive).toHaveBeenCalledTimes(1)
    expect(recorder.getLastAutoCanvasSnapshotResultForDebug()).toEqual({
      scheduler: 'command_capture',
      status: 'completed',
      startedAt: 8050,
      completedAt: 8051,
      timestamp: 8051,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 1,
      skippedBudgetCount: 0,
      keepSessionAliveTriggered: true,
      results: [
        {
          canvasId: 88,
          ok: true,
          reason: undefined,
          priority: undefined
        }
      ]
    })
    expect(recorder.getAutoCanvasSnapshotDebugHistoryForDebug()).toEqual([
      jasmine.objectContaining({
        scheduler: 'command_capture',
        status: 'completed',
        startedAt: 8050,
        completedAt: 8051,
        timestamp: 8051,
        eligibleCanvasCount: 1,
        selectedCanvasCount: 1,
        results: [
          {
            canvasId: 88,
            ok: true,
            reason: undefined,
            priority: undefined
          }
        ]
      })
    ])

    recorder.stop()
  })

  it('should isolate later command debug from an earlier path2d fallback after subsequent full snapshot', () => {
    const resetCanvasCommandCapture = jasmine.createSpy('resetCanvasCommandCapture')
    const scanExistingCanvases = jasmine.createSpy('scanExistingCanvases')
    let onCommandDebug
    let onCommandMutationDebug
    const startCanvasCommandCapture = jasmine
      .createSpy('startCanvasCommandCapture')
      .and.callFake(function (options) {
        onCommandDebug = options.onDebug
        onCommandMutationDebug = options.onMutationDebug
        return {
          stop: jasmine.createSpy('stopCanvasCommandCapture'),
          reset: resetCanvasCommandCapture,
          scanExistingCanvases: scanExistingCanvases
        }
      })

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      startCanvasCommandCapture: startCanvasCommandCapture
    })

    onCommandDebug({
      scheduler: 'command_capture',
      status: 'fallback',
      startedAt: 9100,
      completedAt: 9101,
      timestamp: 9101,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 0,
      skippedBudgetCount: 0,
      results: [{ canvasId: 173, ok: false, reason: 'path2d_argument' }]
    })

    recorder.takeSubsequentFullSnapshot(9200)

    expect(resetCanvasCommandCapture).toHaveBeenCalledTimes(1)
    expect(scanExistingCanvases).toHaveBeenCalledTimes(2)

    onCommandMutationDebug({
      timestamp: 9203,
      canvasId: 173,
      trigger: 'auto',
      approxBytesCount: 88,
      commandCount: 4,
      width: 480,
      height: 220
    })
    onCommandDebug({
      scheduler: 'command_capture',
      status: 'completed',
      startedAt: 9201,
      completedAt: 9202,
      timestamp: 9202,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 1,
      skippedBudgetCount: 0,
      results: [{ canvasId: 173, ok: true }]
    })

    expect(recorder.getLastAutoCanvasSnapshotResultForDebug()).toEqual({
      scheduler: 'command_capture',
      status: 'completed',
      startedAt: 9201,
      completedAt: 9202,
      timestamp: 9202,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 1,
      skippedBudgetCount: 0,
      keepSessionAliveTriggered: false,
      results: [
        {
          canvasId: 173,
          ok: true,
          reason: undefined,
          priority: undefined
        }
      ]
    })
    expect(recorder.getLastCanvasMutationForDebug()).toEqual({
      timestamp: 9203,
      canvasId: 173,
      trigger: 'auto',
      encodedBytesCount: undefined,
      approxBytesCount: 88,
      commandCount: 4,
      width: 480,
      height: 220
    })
    expect(recorder.getAutoCanvasSnapshotDebugHistoryForDebug()).toEqual([
      {
        scheduler: 'command_capture',
        status: 'fallback',
        startedAt: 9100,
        completedAt: 9101,
        timestamp: 9101,
        eligibleCanvasCount: 1,
        selectedCanvasCount: 0,
        skippedBudgetCount: 0,
        keepSessionAliveTriggered: false,
        results: [
          {
            canvasId: 173,
            ok: false,
            reason: 'path2d_argument',
            priority: undefined
          }
        ]
      },
      {
        scheduler: 'command_capture',
        status: 'completed',
        startedAt: 9201,
        completedAt: 9202,
        timestamp: 9202,
        eligibleCanvasCount: 1,
        selectedCanvasCount: 1,
        skippedBudgetCount: 0,
        keepSessionAliveTriggered: true,
        results: [
          {
            canvasId: 173,
            ok: true,
            reason: undefined,
            priority: undefined
          }
        ]
      }
    ])

    recorder.stop()
  })

  it('should flush async mutation work before a subsequent full snapshot', (done) => {
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })

    container.appendChild(document.createElement('div'))

    setTimeout(() => {
      recorder.takeSubsequentFullSnapshot(5678)
      const mutationSnapshots = emittedRecords.filter(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
      )
      expect(mutationSnapshots.length).toBeGreaterThan(0)
      done()
    }, ASYNC_MUTATION_TICK)
  })
})
