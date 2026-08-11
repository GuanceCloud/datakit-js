import { IncrementalSource, RecordType } from '../../../types'
import { NodePrivacyLevel } from '../../../constants'
import {
  MAX_FULL_SNAPSHOT_CANVAS_BASELINE_COUNT,
  MAX_DEFERRED_RECORDS,
  MAX_DEFERRED_RECORD_APPROX_BYTES,
  record
} from './record'
import {
  createMutationAddPublicationToken,
  createMutationTasksController,
  MAX_MUTATION_SERIALIZED_VALUE_CHARACTERS,
  processMutations,
  registerMutationAddPublicationToken
} from './mutationObserver'
import {
  SERIALIZATION_MAX_NODE_COUNT,
  SerializationContextStatus
} from './serialize'
import { setReplayCanvasContextType } from './canvasContext'
import { SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT } from './shadowRootsController'
import { createCanvas2DCommandRecorder } from './canvasCommandCapture'
import { startCanvasCommandCapture as startRealCanvasCommandCapture } from './canvasCommandObserver'
import { createCanvasObserver as createRealCanvasObserver } from './canvasObserver'
import {
  MAX_PENDING_MUTATION_NODES,
  MAX_QUEUED_MUTATION_RECORDS
} from './mutationBatch'

describe('replay/record/record', () => {
  let container

  beforeEach(() => {
    // Full snapshots keep a 1 MiB per-slice watermark and a bounded total
    // budget. Keep this suite independent from fixtures leaked by other specs.
    document.body.textContent = ''
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

  function flushPromises() {
    return new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  }

  async function flushAsyncObservedMutations(recorder) {
    // Let the native MutationObserver callback enqueue its throttled batch,
    // then drain that batch explicitly. A fixed delay is inherently flaky:
    // mutationBatch may wait up to its idle-callback timeout under full-suite
    // load.
    await Promise.resolve()
    recorder.flushMutations()
  }

  function expectReplayCompatibleCanvasMutation(event, canvasId, width, height) {
    expect(event).toEqual(
      jasmine.objectContaining({
        type: RecordType.IncrementalSnapshot,
        data: jasmine.objectContaining({
          source: IncrementalSource.CanvasMutation,
          id: canvasId,
          type: '2D',
          commands: jasmine.any(Array),
          encodedBytesCount: jasmine.any(Number)
        })
      })
    )

    const commands = event.data.commands
    expect(commands[0]).toEqual({
      property: 'clearRect',
      args: [0, 0, width, height]
    })
    expect(commands[1]).toEqual({
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
    expect(commands.length).toBe(2)
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

  it('should submit Meta, Focus and Full Snapshot through one baseline transaction', () => {
    const emittedRecords = []
    const emitBaseline = jasmine
      .createSpy('emitBaseline')
      .and.returnValue(true)

    record({
      emit: (event) => emittedRecords.push(event),
      $rEmitBaseline: emitBaseline,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })

    expect(emitBaseline).toHaveBeenCalledTimes(1)
    expect(
      emitBaseline.calls.mostRecent().args[0].map((event) => event.type)
    ).toEqual([
      RecordType.Meta,
      RecordType.Focus,
      RecordType.FullSnapshot
    ])
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.Meta ||
          event.type === RecordType.Focus ||
          event.type === RecordType.FullSnapshot
      )
    ).toBeFalse()
  })

  it('should retry the exact initial baseline transaction after encoder backpressure', () => {
    jasmine.clock().install()
    const attemptedBaselines = []
    let admissionBlocked = true
    let recorder

    try {
      recorder = record({
        emit: function () {
          return true
        },
        $rEmitBaseline: function (baselineRecords) {
          attemptedBaselines.push(baselineRecords)
          return !admissionBlocked
        },
        $rWasLastEmitBackpressured: () => admissionBlocked,
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle()
      })

      expect(attemptedBaselines.length).toBe(1)
      admissionBlocked = false
      jasmine.clock().tick(32)

      expect(attemptedBaselines.length).toBe(2)
      expect(attemptedBaselines[1]).toBe(attemptedBaselines[0])
      attemptedBaselines[1].forEach((record, index) => {
        expect(record).toBe(attemptedBaselines[0][index])
      })
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should retry the exact subsequent baseline transaction after encoder backpressure', () => {
    jasmine.clock().install()
    const attemptedBaselines = []
    let captureSubsequent = false
    let admissionBlocked = false
    let recorder

    try {
      recorder = record({
        emit: function () {
          return true
        },
        $rEmitBaseline: function (baselineRecords) {
          if (captureSubsequent) {
            attemptedBaselines.push(baselineRecords)
          }
          return !admissionBlocked
        },
        $rWasLastEmitBackpressured: () => admissionBlocked,
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle()
      })

      captureSubsequent = true
      admissionBlocked = true
      recorder.takeSubsequentFullSnapshot(12345)
      expect(attemptedBaselines.length).toBe(1)

      admissionBlocked = false
      jasmine.clock().tick(32)

      expect(attemptedBaselines.length).toBe(2)
      expect(attemptedBaselines[1]).toBe(attemptedBaselines[0])
      attemptedBaselines[1].forEach((record, index) => {
        expect(record).toBe(attemptedBaselines[0][index])
      })
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should reject an expired backpressured baseline during direct flush', () => {
    jasmine.clock().install()
    let performanceTime = 0
    spyOn(performance, 'now').and.callFake(() => performanceTime)
    const attemptedBaselines = []
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    let captureSubsequent = false
    let admissionBlocked = false
    let recorder

    try {
      recorder = record({
        emit: function () {
          return true
        },
        $rEmitBaseline: function (baselineRecords) {
          if (captureSubsequent) {
            attemptedBaselines.push(baselineRecords)
          }
          return !admissionBlocked
        },
        $rWasLastEmitBackpressured: () => admissionBlocked,
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle(),
        onFullSnapshotFailure
      })

      captureSubsequent = true
      admissionBlocked = true
      recorder.takeSubsequentFullSnapshot(12346)
      expect(attemptedBaselines.length).toBe(1)

      performanceTime = 30001
      admissionBlocked = false
      expect(recorder.flushScheduledFullSnapshot()).toBeTrue()

      expect(attemptedBaselines.length).toBe(1)
      expect(onFullSnapshotFailure).toHaveBeenCalledOnceWith(
        'full_snapshot_serialization_timeout'
      )
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should contain a baseline rebuild exception after backpressure', () => {
    jasmine.clock().install()
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    let observerOptions
    let admissionBlocked = false
    let throwOnCanvasReset = false
    let recorder

    try {
      recorder = record({
        emit: function () {
          return true
        },
        $rEmitBaseline: function () {
          return !admissionBlocked
        },
        $rWasLastEmitBackpressured: () => admissionBlocked,
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle(),
        onFullSnapshotFailure,
        initObservers: function (options) {
          observerOptions = options
          return {
            stop: function () {},
            flush: function () {},
            reset: function () {}
          }
        },
        createCanvasObserver: function () {
          return {
            snapshot: jasmine.createSpy('snapshot'),
            reset: function () {
              if (throwOnCanvasReset) {
                throw new Error('canvas reset failed')
              }
            },
            stop: jasmine.createSpy('stop')
          }
        }
      })

      admissionBlocked = true
      recorder.takeSubsequentFullSnapshot(12347)
      observerOptions.mutationActivityCb(container)
      throwOnCanvasReset = true
      admissionBlocked = false

      expect(() => jasmine.clock().tick(32)).not.toThrow()
      expect(onFullSnapshotFailure).toHaveBeenCalledOnceWith(
        'full_snapshot_serialization_error'
      )
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should stop safely when optional snapshot restore throws during direct flush', () => {
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    const stopWebGLObserver = jasmine.createSpy('stopWebGLObserver')
    let throwOnReset = false
    const resetWebGLObserver = jasmine
      .createSpy('resetWebGLObserver')
      .and.callFake(() => {
        if (throwOnReset) {
          throw new Error('webgl reset failed')
        }
      })
    const recorder = record({
      emit: function () {
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      onFullSnapshotFailure,
      startCanvasWebGLSnapshotObserver: function () {
        return {
          isWebGLCanvas: function () {
            return false
          },
          reset: resetWebGLObserver,
          stop: stopWebGLObserver
        }
      }
    })

    recorder.scheduleSubsequentFullSnapshot(12348, true)
    throwOnReset = true

    expect(() => recorder.flushScheduledFullSnapshot()).not.toThrow()
    expect(onFullSnapshotFailure).toHaveBeenCalledOnceWith(
      'full_snapshot_abandon_restore_error'
    )
    expect(stopWebGLObserver).toHaveBeenCalledTimes(1)
    recorder.stop()
  })

  it('should stop safely when optional snapshot timeout restore throws', () => {
    jasmine.clock().install()
    let performanceTime = 0
    spyOn(performance, 'now').and.callFake(() => performanceTime)
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    const stopWebGLObserver = jasmine.createSpy('stopWebGLObserver')
    let throwOnReset = false
    const resetWebGLObserver = jasmine
      .createSpy('resetWebGLObserver')
      .and.callFake(() => {
        if (throwOnReset) {
          throw new Error('webgl reset failed')
        }
      })
    let recorder

    try {
      recorder = record({
        emit: function () {
          return true
        },
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle(),
        onFullSnapshotFailure,
        startCanvasWebGLSnapshotObserver: function () {
          return {
            isWebGLCanvas: function () {
              return false
            },
            reset: resetWebGLObserver,
            stop: stopWebGLObserver
          }
        }
      })

      recorder.scheduleSubsequentFullSnapshot(12349, true)
      throwOnReset = true
      performanceTime = 30001

      expect(() => jasmine.clock().tick(1)).not.toThrow()
      expect(onFullSnapshotFailure).toHaveBeenCalledOnceWith(
        'full_snapshot_abandon_restore_error'
      )
      expect(stopWebGLObserver).toHaveBeenCalledTimes(1)
      const resetCountAfterFailure = resetWebGLObserver.calls.count()
      jasmine.clock().tick(100)
      expect(resetWebGLObserver).toHaveBeenCalledTimes(
        resetCountAfterFailure
      )
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should rebuild a backpressured baseline when the DOM generation changes', () => {
    jasmine.clock().install()
    const attemptedBaselines = []
    let observerOptions
    let captureSubsequent = false
    let admissionBlocked = false
    let serializerTaskCount = 0
    let recorder

    try {
      recorder = record({
        emit: function () {
          return true
        },
        $rEmitBaseline: function (baselineRecords) {
          if (captureSubsequent) {
            attemptedBaselines.push(baselineRecords)
          }
          return !admissionBlocked
        },
        $rWasLastEmitBackpressured: () => admissionBlocked,
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle(),
        initObservers: function (options) {
          observerOptions = options
          return {
            stop: function () {},
            flush: function () {
              return true
            },
            reset: function () {}
          }
        },
        $rCreateFullSnapshotSerializerTask: function () {
          serializerTaskCount += 1
          return {
            serializedNode: {
              type: 0,
              id: serializerTaskCount,
              state: container.getAttribute('data-state'),
              childNodes: []
            },
            processedNodeCount: 1,
            approxBytes: 128,
            advance: function () {
              return true
            }
          }
        }
      })

      container.setAttribute('data-state', 'before')
      captureSubsequent = true
      admissionBlocked = true
      recorder.takeSubsequentFullSnapshot(54321)
      const staleBaseline = attemptedBaselines[0]

      container.setAttribute('data-state', 'after')
      observerOptions.mutationActivityCb(container)
      admissionBlocked = false
      jasmine.clock().tick(32)
      jasmine.clock().tick(0)

      expect(attemptedBaselines.length).toBe(2)
      expect(attemptedBaselines[1]).not.toBe(staleBaseline)
      expect(attemptedBaselines[1][2]).not.toBe(staleBaseline[2])
      expect(attemptedBaselines[1][2].data.node.state).toBe('after')
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should admit same-task CSSOM before a scheduled snapshot without replaying it twice', () => {
    jasmine.clock().install()
    const style = document.createElement('style')
    container.appendChild(style)
    const emittedRecords = []
    let captureSubsequent = false
    let recorder

    try {
      recorder = record({
        emit: function (event) {
          if (captureSubsequent) {
            emittedRecords.push(event)
          }
          return true
        },
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle()
      })
      captureSubsequent = true

      recorder.scheduleSubsequentFullSnapshot(6000, true)
      style.sheet.insertRule(
        '.scheduled-cssom { color: rgb(1, 2, 3); }',
        0
      )

      const styleSheetRecordsBeforeBaseline = emittedRecords.filter(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.StyleSheetRule
      )
      expect(styleSheetRecordsBeforeBaseline.length).toBe(1)

      jasmine.clock().tick(1)

      const fullSnapshot = emittedRecords.find(
        (event) => event.type === RecordType.FullSnapshot
      )
      expect(fullSnapshot).toBeDefined()
      expect(JSON.stringify(fullSnapshot)).toContain('.scheduled-cssom')
      expect(
        emittedRecords.indexOf(styleSheetRecordsBeforeBaseline[0])
      ).toBeLessThan(emittedRecords.indexOf(fullSnapshot))
      expect(fullSnapshot.timestamp).toBeGreaterThanOrEqual(
        styleSheetRecordsBeforeBaseline[0].timestamp
      )
      expect(
        emittedRecords.filter(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.StyleSheetRule
        )
      ).toEqual(styleSheetRecordsBeforeBaseline)
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should rebuild a backpressured baseline after ignored CSSOM state changes', () => {
    jasmine.clock().install()
    const style = document.createElement('style')
    container.appendChild(style)
    style.sheet.insertRule('.rule-a { color: red; }', 0)
    style.sheet.insertRule('.rule-b { color: blue; }', 1)
    const attemptedBaselines = []
    const emittedRecords = []
    let captureSubsequent = false
    let admissionBlocked = false
    let recorder

    try {
      recorder = record({
        emit: function (event) {
          if (captureSubsequent) {
            emittedRecords.push(event)
          }
          return true
        },
        $rEmitBaseline: function (baselineRecords) {
          if (captureSubsequent) {
            attemptedBaselines.push(baselineRecords)
          }
          return !admissionBlocked
        },
        $rWasLastEmitBackpressured: function () {
          return admissionBlocked
        },
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle()
      })
      captureSubsequent = true
      admissionBlocked = true

      recorder.takeSubsequentFullSnapshot(6100)

      expect(attemptedBaselines.length).toBe(1)
      const staleBaseline = attemptedBaselines[0]
      expect(JSON.stringify(staleBaseline)).toContain('.rule-a')
      expect(JSON.stringify(staleBaseline)).not.toContain(
        '.rule-inserted'
      )

      style.sheet.insertRule(
        '.rule-inserted { color: green; }',
        1
      )
      style.sheet.deleteRule(0)
      expect(
        emittedRecords.filter(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.StyleSheetRule
        ).length
      ).toBe(2)

      admissionBlocked = false
      jasmine.clock().tick(32)
      jasmine.clock().tick(0)

      expect(attemptedBaselines.length).toBe(2)
      expect(attemptedBaselines[1]).not.toBe(staleBaseline)
      const acceptedCss = JSON.stringify(attemptedBaselines[1])
      expect(acceptedCss).not.toContain('.rule-a')
      expect(acceptedCss).toContain('.rule-inserted')
      expect(acceptedCss).toContain('.rule-b')
      expect(acceptedCss.indexOf('.rule-inserted')).toBeLessThan(
        acceptedCss.indexOf('.rule-b')
      )
      expect(
        emittedRecords.filter(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.StyleSheetRule
        ).length
      ).toBe(2)

      style.sheet.deleteRule(0)

      const laterStyleSheetRecords = emittedRecords.filter(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.StyleSheetRule
      )
      expect(laterStyleSheetRecords.length).toBe(3)
      expect(laterStyleSheetRecords[2].data).toEqual(
        jasmine.objectContaining({
          removes: [{ index: 0 }]
        })
      )
      expect(style.sheet.cssRules.length).toBe(1)
      expect(style.sheet.cssRules[0].selectorText).toBe('.rule-b')
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should restore CSSOM state to the old replay tail when an optional snapshot is abandoned', () => {
    const style = document.createElement('style')
    container.appendChild(style)
    style.sheet.insertRule('.rule-before { color: red; }', 0)
    const emittedRecords = []
    let captureSubsequent = false
    const recorder = record({
      emit: function (event) {
        if (captureSubsequent) {
          emittedRecords.push(event)
        }
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureSubsequent = true

    try {
      recorder.scheduleSubsequentFullSnapshot(6200, true)
      style.sheet.insertRule('.rule-during { color: green; }', 1)

      expect(
        emittedRecords.filter(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.StyleSheetRule
        ).length
      ).toBe(1)
      expect(recorder.flushScheduledFullSnapshot()).toBeTrue()

      expect(
        emittedRecords.some(
          (event) => event.type === RecordType.FullSnapshot
        )
      ).toBeFalse()
      let styleSheetRecords = emittedRecords.filter(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.StyleSheetRule
      )
      expect(styleSheetRecords.length).toBe(1)
      expect(styleSheetRecords[0].data).toEqual(
        jasmine.objectContaining({
          adds: [
            {
              rule: '.rule-during { color: green; }',
              index: 1
            }
          ]
        })
      )

      style.sheet.deleteRule(0)
      styleSheetRecords = emittedRecords.filter(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.StyleSheetRule
      )
      expect(styleSheetRecords.length).toBe(2)
      expect(styleSheetRecords[1].data).toEqual(
        jasmine.objectContaining({
          removes: [{ index: 0 }]
        })
      )
      expect(style.sheet.cssRules.length).toBe(1)
      expect(style.sheet.cssRules[0].selectorText).toBe('.rule-during')
    } finally {
      recorder.stop()
    }
  })

  it('should restore input state to the old replay tail when an optional snapshot is abandoned', () => {
    jasmine.clock().install()
    const input = document.createElement('input')
    input.value = 'before'
    container.appendChild(input)
    const emittedRecords = []
    let captureSubsequent = false
    let recorder

    try {
      recorder = record({
        emit: function (event) {
          if (captureSubsequent) {
            emittedRecords.push(event)
          }
          return true
        },
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle()
      })
      captureSubsequent = true

      recorder.scheduleSubsequentFullSnapshot(6300, true)
      input.value = 'during-optional-snapshot'
      input.dispatchEvent(new Event('input', { bubbles: true }))

      expect(
        emittedRecords.filter(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.Input
        ).length
      ).toBe(1)
      expect(recorder.flushScheduledFullSnapshot()).toBeTrue()

      const inputRecords = emittedRecords.filter(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Input
      )
      expect(inputRecords.length).toBe(1)
      expect(inputRecords[0].data).toEqual(
        jasmine.objectContaining({
          text: 'during-optional-snapshot'
        })
      )

      jasmine.clock().tick(0)
      expect(
        emittedRecords.filter(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.Input
        ).length
      ).toBe(1)
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should admit a real mandatory-snapshot interaction before its baseline', () => {
    jasmine.clock().install()
    const button = document.createElement('button')
    button.textContent = 'mandatory-target'
    container.appendChild(button)
    const emittedRecords = []
    let recorder

    try {
      recorder = record({
        emit: (event) => {
          emittedRecords.push(event)
          return true
        },
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle()
      })
      emittedRecords.length = 0

      recorder.scheduleSubsequentFullSnapshot(6400, false)
      button.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 12,
          clientY: 24
        })
      )

      const interaction = emittedRecords.find(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.MouseInteraction
      )
      expect(interaction).toBeDefined()
      expect(
        emittedRecords.some(
          (event) => event.type === RecordType.FullSnapshot
        )
      ).toBeFalse()

      jasmine.clock().tick(1)

      const fullSnapshot = emittedRecords.find(
        (event) => event.type === RecordType.FullSnapshot
      )
      expect(fullSnapshot).toBeDefined()
      expect(emittedRecords.indexOf(interaction)).toBeLessThan(
        emittedRecords.indexOf(fullSnapshot)
      )
      expect(interaction.timestamp).toBeLessThanOrEqual(
        fullSnapshot.timestamp
      )
      expect(JSON.stringify(fullSnapshot)).toContain('mandatory-target')
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should preserve interaction order when DOM activity promotes an optional snapshot', () => {
    jasmine.clock().install()
    const button = document.createElement('button')
    button.textContent = 'ordered-target'
    container.appendChild(button)
    const emittedRecords = []
    let recorder

    try {
      recorder = record({
        emit: (event) => {
          emittedRecords.push(event)
          return true
        },
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle()
      })
      emittedRecords.length = 0

      recorder.scheduleSubsequentFullSnapshot(6500, true)
      button.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 11,
          clientY: 21
        })
      )
      button.setAttribute('data-between-clicks', 'captured')
      button.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 33,
          clientY: 43
        })
      )

      const interactionsBeforeFlush = emittedRecords.filter(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.MouseInteraction
      )
      expect(
        interactionsBeforeFlush.map((event) => event.data.x)
      ).toEqual([11, 33])
      expect(recorder.flushScheduledFullSnapshot()).toBeTrue()

      const fullSnapshot = emittedRecords.find(
        (event) => event.type === RecordType.FullSnapshot
      )
      expect(fullSnapshot).toBeDefined()
      expect(JSON.stringify(fullSnapshot)).toContain(
        'data-between-clicks'
      )
      expect(
        interactionsBeforeFlush.every(
          (event) =>
            emittedRecords.indexOf(event) <
              emittedRecords.indexOf(fullSnapshot) &&
            event.timestamp <= fullSnapshot.timestamp
        )
      ).toBeTrue()
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should refresh a backpressured baseline timestamp without reserializing for a stateless event', () => {
    jasmine.clock().install()
    const emittedRecords = []
    const attemptedBaselines = []
    let observerOptions
    let serializerTaskCount = 0
    let captureSubsequent = false
    let admissionBlocked = false
    let recorder

    try {
      recorder = record({
        emit: (event) => {
          if (captureSubsequent) {
            emittedRecords.push(event)
          }
          return true
        },
        $rEmitBaseline: (baselineRecords) => {
          if (captureSubsequent) {
            attemptedBaselines.push(baselineRecords)
          }
          if (admissionBlocked) {
            return false
          }
          if (captureSubsequent) {
            emittedRecords.push(...baselineRecords)
          }
          return true
        },
        $rWasLastEmitBackpressured: () => admissionBlocked,
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle(),
        initObservers: function (options) {
          observerOptions = options
          return {
            stop: function () {},
            flush: function () {
              return true
            },
            reset: function () {}
          }
        },
        $rCreateFullSnapshotSerializerTask: function () {
          serializerTaskCount += 1
          return {
            serializedNode: {
              type: 0,
              id: serializerTaskCount,
              childNodes: []
            },
            processedNodeCount: 1,
            approxBytes: 128,
            advance: function () {
              return true
            }
          }
        }
      })
      const serializerTasksBeforeSubsequent = serializerTaskCount
      captureSubsequent = true
      admissionBlocked = true

      recorder.takeSubsequentFullSnapshot(7000, true)
      expect(attemptedBaselines.length).toBe(1)
      expect(serializerTaskCount).toBe(
        serializerTasksBeforeSubsequent + 1
      )

      const interactionRecord = {
        type: RecordType.IncrementalSnapshot,
        timestamp: 7001,
        data: {
          source: IncrementalSource.MouseInteraction,
          id: 1,
          type: 0,
          x: 1,
          y: 2
        }
      }
      observerOptions.mouseInteractionCb(interactionRecord)
      admissionBlocked = false
      jasmine.clock().tick(32)

      expect(attemptedBaselines.length).toBe(2)
      expect(serializerTaskCount).toBe(
        serializerTasksBeforeSubsequent + 1
      )
      const fullSnapshot = emittedRecords.find(
        (event) => event.type === RecordType.FullSnapshot
      )
      expect(emittedRecords.indexOf(interactionRecord)).toBeLessThan(
        emittedRecords.indexOf(fullSnapshot)
      )
      expect(fullSnapshot.timestamp).toBe(7001)
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should continue an initial full snapshot past one 50k-node slice', () => {
    jasmine.clock().install()
    const emittedRecords = []
    const maxNodeCounts = []
    let serializerTaskCount = 0
    let recorder

    try {
      recorder = record({
        emit: (event) => emittedRecords.push(event),
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle(),
        $rCreateFullSnapshotSerializerTask: function () {
          serializerTaskCount += 1
          const task = {
            serializedNode: {
              type: 0,
              id: serializerTaskCount,
              childNodes: []
            },
            processedNodeCount: 1,
            approxBytes: 128,
            advance: function (_deadline, maxNodeCount) {
              maxNodeCounts.push(maxNodeCount)
              if (
                maxNodeCount <=
                SERIALIZATION_MAX_NODE_COUNT + 1
              ) {
                task.processedNodeCount = maxNodeCount
                task.isMaxNodeCountReached = true
                return false
              }
              task.isMaxNodeCountReached = false
              task.processedNodeCount =
                SERIALIZATION_MAX_NODE_COUNT + 2
              task.isComplete = true
              return true
            }
          }
          return task
        }
      })

      expect(
        emittedRecords.some(
          (event) => event.type === RecordType.FullSnapshot
        )
      ).toBeFalse()

      jasmine.clock().tick(1)

      expect(serializerTaskCount).toBe(2)
      expect(Math.max.apply(Math, maxNodeCounts)).toBeGreaterThan(
        SERIALIZATION_MAX_NODE_COUNT + 1
      )
      expect(
        emittedRecords
          .filter(
            (event) =>
              event.type === RecordType.Meta ||
              event.type === RecordType.Focus ||
              event.type === RecordType.FullSnapshot
          )
          .map((event) => event.type)
      ).toEqual([RecordType.Meta, RecordType.Focus, RecordType.FullSnapshot])
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should cancel a pending initial full snapshot when stopped', () => {
    jasmine.clock().install()
    const emittedRecords = []
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    let advanceCount = 0

    try {
      const recorder = record({
        emit: (event) => emittedRecords.push(event),
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle(),
        onFullSnapshotFailure,
        $rCreateFullSnapshotSerializerTask: function () {
          return {
            serializedNode: {
              type: 0,
              id: 1,
              childNodes: []
            },
            processedNodeCount: 1,
            approxBytes: 128,
            advance: function () {
              advanceCount += 1
              return false
            }
          }
        }
      })

      expect(advanceCount).toBe(1)
      recorder.stop()
      jasmine.clock().tick(1)

      expect(advanceCount).toBe(1)
      expect(onFullSnapshotFailure).not.toHaveBeenCalled()
      expect(
        emittedRecords.some(
          (event) => event.type === RecordType.FullSnapshot
        )
      ).toBeFalse()
    } finally {
      jasmine.clock().uninstall()
    }
  })

  it('should use chunked watermarks for a subsequent full snapshot', () => {
    jasmine.clock().install()
    const emittedRecords = []
    const maxNodeCounts = []
    let serializerTaskCount = 0
    let recorder

    try {
      recorder = record({
        emit: (event) => emittedRecords.push(event),
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle(),
        $rCreateFullSnapshotSerializerTask: function () {
          serializerTaskCount += 1
          const task = {
            serializedNode: {
              type: 0,
              id: serializerTaskCount,
              childNodes: []
            },
            processedNodeCount: 1,
            approxBytes: 128,
            advance: function (_deadline, maxNodeCount) {
              maxNodeCounts.push(maxNodeCount)
              if (serializerTaskCount === 1) {
                return true
              }
              if (
                maxNodeCount <=
                SERIALIZATION_MAX_NODE_COUNT + 1
              ) {
                task.processedNodeCount = maxNodeCount
                task.isMaxNodeCountReached = true
                return false
              }
              task.isMaxNodeCountReached = false
              return true
            }
          }
          return task
        }
      })
      emittedRecords.length = 0

      recorder.takeSubsequentFullSnapshot(1236)
      jasmine.clock().tick(1)

      expect(Math.max.apply(Math, maxNodeCounts)).toBeGreaterThan(
        SERIALIZATION_MAX_NODE_COUNT + 1
      )
      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.FullSnapshot &&
            event.timestamp === 1236
        )
      ).toBeTrue()
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should reserve segment space above the full snapshot serializer cap', () => {
    jasmine.clock().install()
    const maxApproxBytes = []
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    let serializerTaskCount = 0
    let recorder

    try {
      recorder = record({
        emit: function () {
          return true
        },
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle(),
        onFullSnapshotFailure,
        $rCreateFullSnapshotSerializerTask: function () {
          serializerTaskCount += 1
          const task = {
            serializedNode: {
              type: 0,
              id: serializerTaskCount,
              childNodes: []
            },
            processedNodeCount: 1,
            approxBytes: 1,
            advance: function (_deadline, _maxNodeCount, maxBytes) {
              if (serializerTaskCount === 1) {
                return true
              }
              maxApproxBytes.push(maxBytes)
              task.approxBytes = maxBytes
              task.isMaxApproxBytesReached = true
              return false
            }
          }
          return task
        }
      })

      recorder.takeSubsequentFullSnapshot(1237)
      jasmine.clock().tick(1)

      expect(Math.max.apply(Math, maxApproxBytes)).toBeLessThanOrEqual(
        4 * 1024 * 1024 - 64 * 1024
      )
      expect(onFullSnapshotFailure).toHaveBeenCalledOnceWith(
        'full_snapshot_serialization_watermark'
      )
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should abandon an oversized best-effort full snapshot and keep recording', () => {
    jasmine.clock().install()
    const emittedRecords = []
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    let observerOptions
    let serializerTaskCount = 0
    let recorder

    try {
      recorder = record({
        emit: function (event) {
          emittedRecords.push(event)
          return true
        },
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle(),
        onFullSnapshotFailure,
        initObservers: function (options) {
          observerOptions = options
          return {
            stop: function () {},
            flush: function () {},
            reset: function () {}
          }
        },
        $rCreateFullSnapshotSerializerTask: function () {
          serializerTaskCount += 1
          const task = {
            serializedNode: {
              type: 0,
              id: serializerTaskCount,
              childNodes: []
            },
            processedNodeCount: 1,
            approxBytes: 1,
            advance: function (_deadline, _maxNodeCount, maxBytes) {
              if (serializerTaskCount === 1) {
                return true
              }
              task.approxBytes = maxBytes
              task.isMaxApproxBytesReached = true
              return false
            }
          }
          return task
        }
      })
      emittedRecords.length = 0

      recorder.takeSubsequentFullSnapshot(1238, true)
      jasmine.clock().tick(1)

      expect(onFullSnapshotFailure).not.toHaveBeenCalled()
      observerOptions.inputCb({ id: 1, text: 'still-recording' })
      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.Input
        )
      ).toBeTrue()
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should not let a best-effort request replace a pending mandatory snapshot', () => {
    jasmine.clock().install()
    const onMandatoryFullSnapshotStarted = jasmine.createSpy(
      'onMandatoryFullSnapshotStarted'
    )
    let serializerTaskCount = 0
    let recorder

    try {
      recorder = record({
        emit: function () {
          return true
        },
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle(),
        $rOnMandatoryFullSnapshotStarted:
          onMandatoryFullSnapshotStarted,
        $rCreateFullSnapshotSerializerTask: function () {
          serializerTaskCount += 1
          return {
            serializedNode: {
              type: 0,
              id: serializerTaskCount,
              childNodes: []
            },
            processedNodeCount: 1,
            approxBytes: 1,
            advance: function () {
              return serializerTaskCount === 1
            }
          }
        }
      })

      recorder.scheduleSubsequentFullSnapshot(2000, false, true)
      expect(serializerTaskCount).toBe(2)
      expect(
        onMandatoryFullSnapshotStarted
      ).toHaveBeenCalledTimes(1)

      recorder.takeSubsequentFullSnapshot(3000, true)

      expect(serializerTaskCount).toBe(2)
      expect(
        onMandatoryFullSnapshotStarted
      ).toHaveBeenCalledTimes(1)
    } finally {
      if (recorder) {
        recorder.stop(undefined, true)
      }
      jasmine.clock().uninstall()
    }
  })

  it('should restart an initial snapshot after ignored input state changes', () => {
    jasmine.clock().install()
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    const scroller = document.createElement('div')
    container.appendChild(checkbox)
    container.appendChild(scroller)
    const emittedRecords = []
    let observerOptions
    let serializerTaskCount = 0
    let staleScrollPositionRetained
    let recorder

    try {
      recorder = record({
        emit: (event) => emittedRecords.push(event),
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle(),
        initObservers: function (options) {
          observerOptions = options
          return {
            stop: function () {},
            flush: function () {},
            reset: function () {}
          }
        },
        $rCreateFullSnapshotSerializerTask: function (
          _document,
          serializerOptions
        ) {
          serializerTaskCount += 1
          serializerOptions.onSerializedNode(checkbox, container)
          const scrollPositions =
            serializerOptions.serializationContext.elementsScrollPositions
          if (serializerTaskCount < 3) {
            scrollPositions.set(scroller, {
              scrollLeft: 0,
              scrollTop: 40
            })
          } else {
            staleScrollPositionRetained = scrollPositions.has(scroller)
          }
          return {
            serializedNode: {
              type: 0,
              id: serializerTaskCount,
              childNodes: [
                {
                  type: 2,
                  id: 10,
                  tagName: 'input',
                  attributes: {
                    checked: checkbox.checked
                  },
                  childNodes: []
                }
              ]
            },
            processedNodeCount: 1,
            approxBytes: 128,
            advance: function () {
              return serializerTaskCount >= 3
            }
          }
        }
      })

      checkbox.checked = true
      expect(observerOptions.isNodeIgnored(checkbox)).toBeTrue()
      jasmine.clock().tick(1)

      expect(serializerTaskCount).toBe(3)
      expect(staleScrollPositionRetained).toBeFalse()
      const fullSnapshot = emittedRecords.find(
        (event) => event.type === RecordType.FullSnapshot
      )
      expect(
        fullSnapshot.data.node.childNodes[0].attributes.checked
      ).toBeTrue()
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should not publish a subsequent full snapshot rejected by the segment layer', () => {
    const emittedRecords = []
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    let rejectSubsequentFullSnapshot = false
    const recorder = record({
      emit: (event) => {
        emittedRecords.push(event)
        if (
          rejectSubsequentFullSnapshot &&
          event.type === RecordType.FullSnapshot
        ) {
          return false
        }
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      onFullSnapshotFailure
    })
    emittedRecords.length = 0
    rejectSubsequentFullSnapshot = true

    recorder.takeSubsequentFullSnapshot(1235)

    expect(onFullSnapshotFailure).toHaveBeenCalledOnceWith(
      'full_snapshot_admission_rejected'
    )
    const laterChild = document.createElement('div')
    container.appendChild(laterChild)
    recorder.flushMutations()
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
      )
    ).toBeFalse()
  })

  it('should not classify a permanent baseline rejection from stale local backpressure', () => {
    jasmine.clock().install()
    let observerOptions
    let transportBackpressured = false
    let rejectSubsequentBaseline = false
    const attemptedBaselines = []
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    let recorder
    try {
      recorder = record({
        emit: function (event) {
          if (
            transportBackpressured &&
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.Input
          ) {
            return false
          }
          return true
        },
        $rEmitBaseline: function (baselineRecords) {
          if (rejectSubsequentBaseline) {
            attemptedBaselines.push(baselineRecords)
            return false
          }
          return true
        },
        $rWasLastEmitBackpressured: function () {
          return transportBackpressured
        },
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle(),
        onFullSnapshotFailure,
        initObservers: function (options) {
          observerOptions = options
          return {
            stop: function () {},
            flush: function () {
              return true
            },
            reset: function () {}
          }
        }
      })

      transportBackpressured = true
      observerOptions.inputCb({ id: 1, text: 'deferred' })
      transportBackpressured = false
      observerOptions.mutationCb({
        adds: [],
        removes: [],
        texts: [{ id: 2, value: 'blocked-by-local-barrier' }],
        attributes: []
      })
      recorder.flushMutations()

      rejectSubsequentBaseline = true
      recorder.takeSubsequentFullSnapshot(1236)

      expect(attemptedBaselines.length).toBe(1)
      expect(onFullSnapshotFailure).toHaveBeenCalledOnceWith(
        'full_snapshot_admission_rejected'
      )
      jasmine.clock().tick(64)
      expect(attemptedBaselines.length).toBe(1)
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should keep a rejected structural mutation unpublished and request a full snapshot', () => {
    const acceptedRecords = []
    const attemptedRecords = []
    let rejectNextMutation = false
    const recorder = record({
      emit: (event) => {
        attemptedRecords.push(event)
        if (
          rejectNextMutation &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          rejectNextMutation = false
          return false
        }
        acceptedRecords.push(event)
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    attemptedRecords.length = 0
    acceptedRecords.length = 0

    const rejectedChild = document.createElement('div')
    rejectedChild.setAttribute('data-testid', 'rejected-child')
    rejectNextMutation = true
    container.appendChild(rejectedChild)
    recorder.flushMutations()

    expect(
      recorder.getSerializedNodeIdForDebug(rejectedChild)
    ).toBeUndefined()
    expect(acceptedRecords).toEqual([])
    expect(recorder.flushScheduledFullSnapshot()).toBeTrue()

    recorder.stop()
  })

  it('should replace a rejected non-structural mutation with a baseline', () => {
    const element = document.createElement('div')
    container.appendChild(element)
    const acceptedRecords = []
    const attemptedRecords = []
    let rejectNextMutation = false
    const recorder = record({
      emit: (event) => {
        attemptedRecords.push(event)
        if (
          rejectNextMutation &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          rejectNextMutation = false
          return false
        }
        acceptedRecords.push(event)
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    attemptedRecords.length = 0
    acceptedRecords.length = 0

    rejectNextMutation = true
    element.setAttribute('data-rejected', 'ignored')
    recorder.flushMutations()

    expect(attemptedRecords.length).toBe(1)
    expect(acceptedRecords).toEqual([])
    expect(recorder.flushScheduledFullSnapshot()).toBeTrue()

    element.setAttribute('data-after-rejection', 'captured')
    recorder.flushMutations()

    expect(
      acceptedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.attributes.some(
            (attributeMutation) =>
              attributeMutation.attributes['data-after-rejection'] ===
              'captured'
          )
      )
    ).toBeTrue()
    recorder.stop()
  })

  it('should replace a rejected stylesheet rule with a baseline', () => {
    let observerOptions
    let rejectStyleSheetRule = false
    const emittedRecords = []
    const recorder = record({
      emit: (event) => {
        if (
          rejectStyleSheetRule &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.StyleSheetRule
        ) {
          rejectStyleSheetRule = false
          return false
        }
        emittedRecords.push(event)
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      initObservers: function (options) {
        observerOptions = options
        return {
          stop: jasmine.createSpy('stopObservers'),
          flush: jasmine.createSpy('flushObservers'),
          reset: jasmine.createSpy('resetObservers')
        }
      }
    })
    emittedRecords.length = 0
    rejectStyleSheetRule = true

    observerOptions.styleSheetCb({
      id: 1,
      adds: [{ rule: 'body { color: red; }', index: 0 }]
    })

    expect(recorder.flushScheduledFullSnapshot()).toBeTrue()
    expect(
      emittedRecords
        .map((event) => event.type)
        .filter(
          (type) =>
            type === RecordType.Meta ||
            type === RecordType.Focus ||
            type === RecordType.FullSnapshot
        )
    ).toEqual([
      RecordType.Meta,
      RecordType.Focus,
      RecordType.FullSnapshot
    ])
    recorder.stop()
  })

  it('should retry direct input and scroll records with exact object identity', () => {
    jasmine.clock().install()
    const attemptsBySource = {}
    let observerOptions
    let backpressuredSource
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot &&
          (event.data.source === IncrementalSource.Input ||
            event.data.source === IncrementalSource.Scroll)
        ) {
          const sourceAttempts =
            attemptsBySource[event.data.source] || []
          sourceAttempts.push(event)
          attemptsBySource[event.data.source] = sourceAttempts
          if (event.data.source === backpressuredSource) {
            return false
          }
        }
        return true
      },
      $rWasLastEmitBackpressured: () =>
        backpressuredSource !== undefined,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      initObservers: function (options) {
        observerOptions = options
        return {
          stop: jasmine.createSpy('stopObservers'),
          flush: jasmine.createSpy('flushObservers'),
          reset: jasmine.createSpy('resetObservers')
        }
      }
    })
    captureEmits = true

    try {
      backpressuredSource = IncrementalSource.Input
      observerOptions.inputCb({
        id: 1,
        text: 'typed-under-backpressure',
        isChecked: false
      })
      expect(attemptsBySource[IncrementalSource.Input].length).toBe(1)

      backpressuredSource = undefined
      jasmine.clock().tick(32)
      expect(attemptsBySource[IncrementalSource.Input].length).toBe(2)
      expect(attemptsBySource[IncrementalSource.Input][1]).toBe(
        attemptsBySource[IncrementalSource.Input][0]
      )

      backpressuredSource = IncrementalSource.Scroll
      observerOptions.scrollCb({ id: 1, x: 0, y: 24 })
      expect(attemptsBySource[IncrementalSource.Scroll].length).toBe(1)

      backpressuredSource = undefined
      jasmine.clock().tick(32)
      expect(attemptsBySource[IncrementalSource.Scroll].length).toBe(2)
      expect(attemptsBySource[IncrementalSource.Scroll][1]).toBe(
        attemptsBySource[IncrementalSource.Scroll][0]
      )
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()
    } finally {
      try {
        recorder.stop()
      } finally {
        jasmine.clock().uninstall()
      }
    }
  })

  it('should supersede a preexisting direct state retry with a fresh snapshot', () => {
    jasmine.clock().install()
    const attemptedInputRecords = []
    const acceptedInputRecords = []
    const emittedRecords = []
    let observerOptions
    let inputBackpressured = true
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Input
        ) {
          attemptedInputRecords.push(event)
          if (inputBackpressured) {
            return false
          }
          acceptedInputRecords.push(event)
        }
        if (captureEmits) {
          emittedRecords.push(event)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => inputBackpressured,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      initObservers: function (options) {
        observerOptions = options
        return {
          stop: jasmine.createSpy('stopObservers'),
          flush: jasmine.createSpy('flushObservers'),
          reset: jasmine.createSpy('resetObservers')
        }
      }
    })
    captureEmits = true

    try {
      observerOptions.inputCb({
        id: 1,
        text: 'state-before-periodic-snapshot',
        isChecked: false
      })
      expect(attemptedInputRecords.length).toBe(1)

      const fullSnapshotTimestamp =
        attemptedInputRecords[0].timestamp + 1
      recorder.takeSubsequentFullSnapshot(fullSnapshotTimestamp)
      expect(attemptedInputRecords.length).toBe(2)
      expect(attemptedInputRecords[1]).toBe(attemptedInputRecords[0])
      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.FullSnapshot &&
            event.timestamp === fullSnapshotTimestamp
        )
      ).toBeTrue()

      inputBackpressured = false
      jasmine.clock().tick(100)
      expect(acceptedInputRecords).toEqual([])
    } finally {
      try {
        recorder.stop()
      } finally {
        jasmine.clock().uninstall()
      }
    }
  })

  it('should supersede a preexisting direct canvas retry with a fresh snapshot', () => {
    jasmine.clock().install()
    const attemptedCanvasRecords = []
    const acceptedCanvasRecords = []
    const emittedRecords = []
    let emitCanvasRecord
    let canvasBackpressured = true
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.CanvasMutation
        ) {
          attemptedCanvasRecords.push(event)
          if (canvasBackpressured) {
            return false
          }
          acceptedCanvasRecords.push(event)
        }
        if (captureEmits) {
          emittedRecords.push(event)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => canvasBackpressured,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        emitCanvasRecord = options.emit
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: jasmine.createSpy('resetCanvasObserver'),
          stop: jasmine.createSpy('stopCanvasObserver')
        }
      }
    })
    captureEmits = true
    const canvasRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 2100,
      data: {
        source: IncrementalSource.CanvasMutation,
        id: 1,
        type: '2D',
        commands: [],
        encodedBytesCount: 0
      }
    }

    try {
      emitCanvasRecord(canvasRecord)
      expect(attemptedCanvasRecords).toEqual([canvasRecord])

      recorder.takeSubsequentFullSnapshot(2200)
      expect(attemptedCanvasRecords).toEqual([
        canvasRecord,
        canvasRecord
      ])
      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.FullSnapshot &&
            event.timestamp === 2200
        )
      ).toBeTrue()

      canvasBackpressured = false
      jasmine.clock().tick(100)
      expect(acceptedCanvasRecords).toEqual([])
    } finally {
      try {
        recorder.stop()
      } finally {
        jasmine.clock().uninstall()
      }
    }
  })

  it('should admit previous-tail state before a replacement snapshot', () => {
    const emittedRecords = []
    let emitCanvasRecord
    let observerOptions
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (captureEmits) {
          emittedRecords.push(event)
        }
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        emitCanvasRecord = options.emit
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: jasmine.createSpy('resetCanvasObserver'),
          stop: jasmine.createSpy('stopCanvasObserver')
        }
      },
      initObservers: function (options) {
        observerOptions = options
        return {
          stop: jasmine.createSpy('stopObservers'),
          flush: jasmine.createSpy('flushObservers'),
          reset: jasmine.createSpy('resetObservers')
        }
      }
    })
    captureEmits = true
    const canvasRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 2302,
      data: {
        source: IncrementalSource.CanvasMutation,
        id: 1,
        type: '2D',
        commands: [],
        encodedBytesCount: 0
      }
    }

    try {
      recorder.scheduleSubsequentFullSnapshot(2300)
      observerOptions.inputCb({
        id: 1,
        text: 'state-during-snapshot',
        isChecked: false
      })
      emitCanvasRecord(canvasRecord)

      expect(emittedRecords).toEqual([
        jasmine.objectContaining({
          data: jasmine.objectContaining({
            source: IncrementalSource.Input
          })
        }),
        canvasRecord
      ])
      recorder.takeSubsequentFullSnapshot(2300)

      const fullSnapshotIndex = emittedRecords.findIndex(
        (event) => event.type === RecordType.FullSnapshot
      )
      const inputIndex = emittedRecords.findIndex(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Input
      )
      const canvasIndex = emittedRecords.indexOf(canvasRecord)
      expect(fullSnapshotIndex).toBeGreaterThanOrEqual(0)
      expect(inputIndex).toBeLessThan(fullSnapshotIndex)
      expect(canvasIndex).toBeGreaterThan(inputIndex)
      expect(canvasIndex).toBeLessThan(fullSnapshotIndex)
      expect(
        emittedRecords[fullSnapshotIndex].timestamp
      ).toBeGreaterThanOrEqual(emittedRecords[inputIndex].timestamp)
    } finally {
      recorder.stop()
    }
  })

  it('should drain old transaction records before a replacement snapshot', () => {
    const emittedRecords = []
    let emitCanvasRecord
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (captureEmits) {
          emittedRecords.push(event)
        }
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        emitCanvasRecord = options.emit
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: jasmine.createSpy('resetCanvasObserver'),
          stop: jasmine.createSpy('stopCanvasObserver')
        }
      }
    })
    captureEmits = true
    const oldCanvasRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 2401,
      data: {
        source: IncrementalSource.CanvasMutation,
        id: 1,
        type: '2D',
        commands: [],
        encodedBytesCount: 0
      }
    }

    try {
      recorder.scheduleSubsequentFullSnapshot(2400)
      emitCanvasRecord(oldCanvasRecord)
      expect(emittedRecords).toEqual([oldCanvasRecord])

      recorder.takeSubsequentFullSnapshot(2500)

      const oldCanvasIndex = emittedRecords.indexOf(oldCanvasRecord)
      const replacementSnapshotIndex = emittedRecords.findIndex(
        (event) =>
          event.type === RecordType.FullSnapshot &&
          event.timestamp === 2500
      )
      expect(oldCanvasIndex).toBeGreaterThanOrEqual(0)
      expect(replacementSnapshotIndex).toBeGreaterThan(oldCanvasIndex)
      expect(
        emittedRecords.slice(replacementSnapshotIndex + 1)
      ).not.toContain(oldCanvasRecord)
    } finally {
      recorder.stop()
    }
  })

  it('should bound pre-snapshot drain and make retired state non-discardable', () => {
    jasmine.clock().install()
    const attemptedCanvasRecords = []
    const emittedRecords = []
    let emitCanvasRecord
    let canvasBackpressured = true
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.CanvasMutation
        ) {
          attemptedCanvasRecords.push(event)
          if (canvasBackpressured) {
            return false
          }
        }
        if (captureEmits) {
          emittedRecords.push(event)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => canvasBackpressured,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        emitCanvasRecord = options.emit
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: jasmine.createSpy('resetCanvasObserver'),
          stop: jasmine.createSpy('stopCanvasObserver')
        }
      }
    })
    captureEmits = true
    const firstCanvasRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 3000,
      data: {
        source: IncrementalSource.CanvasMutation,
        id: 1,
        type: '2D',
        commands: [],
        encodedBytesCount: 0
      }
    }

    try {
      emitCanvasRecord(firstCanvasRecord)
      for (let index = 1; index <= 10; index += 1) {
        emitCanvasRecord({
          type: RecordType.IncrementalSnapshot,
          timestamp: 3000 + index,
          data: {
            source: IncrementalSource.CanvasMutation,
            id: 1,
            type: '2D',
            commands: [],
            encodedBytesCount: 0
          }
        })
      }
      expect(attemptedCanvasRecords).toEqual([firstCanvasRecord])

      let performanceCallCount = 0
      spyOn(performance, 'now').and.callFake(() => {
        performanceCallCount += 1
        return performanceCallCount === 1 ? 0 : 5
      })
      canvasBackpressured = false
      recorder.scheduleSubsequentFullSnapshot(4000, true)
      expect(recorder.flushScheduledFullSnapshot()).toBeTrue()

      // One cached record is retried, then the 4 ms slice retires the rest.
      expect(attemptedCanvasRecords).toEqual([
        firstCanvasRecord,
        firstCanvasRecord
      ])
      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.FullSnapshot &&
            event.timestamp === 4000
        )
      ).toBeTrue()
    } finally {
      try {
        recorder.stop()
      } finally {
        jasmine.clock().uninstall()
      }
    }
  })

  it('should replace a permanently rejected direct state record with a baseline', () => {
    const emittedRecords = []
    const attemptedInputRecords = []
    let observerOptions
    let rejectInput = false
    const recorder = record({
      emit: (event) => {
        if (
          rejectInput &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Input
        ) {
          attemptedInputRecords.push(event)
          return false
        }
        emittedRecords.push(event)
        return true
      },
      $rWasLastEmitBackpressured: () => false,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      initObservers: function (options) {
        observerOptions = options
        return {
          stop: jasmine.createSpy('stopObservers'),
          flush: jasmine.createSpy('flushObservers'),
          reset: jasmine.createSpy('resetObservers')
        }
      }
    })
    emittedRecords.length = 0
    rejectInput = true

    try {
      observerOptions.inputCb({
        id: 1,
        text: 'permanently-rejected',
        isChecked: false
      })

      expect(attemptedInputRecords.length).toBe(1)
      expect(recorder.flushScheduledFullSnapshot()).toBeTrue()
      expect(
        emittedRecords.some(
          (event) => event.type === RecordType.FullSnapshot
        )
      ).toBeTrue()
    } finally {
      recorder.stop()
    }
  })

  it('should drop a permanently rejected direct stateless record', () => {
    jasmine.clock().install()
    let observerOptions
    let rejectInteraction = false
    const attemptedRecords = []
    const interactionRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 1001,
      data: {
        source: IncrementalSource.MouseInteraction,
        id: 1,
        type: 0
      }
    }
    const recorder = record({
      emit: (event) => {
        if (rejectInteraction && event === interactionRecord) {
          attemptedRecords.push(event)
          return false
        }
        return true
      },
      $rWasLastEmitBackpressured: () => false,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      initObservers: function (options) {
        observerOptions = options
        return {
          stop: jasmine.createSpy('stopObservers'),
          flush: jasmine.createSpy('flushObservers'),
          reset: jasmine.createSpy('resetObservers')
        }
      }
    })
    rejectInteraction = true

    try {
      observerOptions.mouseInteractionCb(interactionRecord)
      jasmine.clock().tick(100)

      expect(attemptedRecords).toEqual([interactionRecord])
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()
    } finally {
      try {
        recorder.stop()
      } finally {
        jasmine.clock().uninstall()
      }
    }
  })

  it('should keep stateless interaction checks side-effect free for pending adds', () => {
    let observerOptions
    const refreshPendingRoot = jasmine.createSpy(
      'refreshAndFlushPendingRootForNode'
    )
    const recorder = record({
      emit: function () {
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      initObservers: function (options) {
        observerOptions = options
        return {
          refreshAndFlushPendingRootForNode: refreshPendingRoot,
          stop: jasmine.createSpy('stopObservers'),
          flush: jasmine.createSpy('flushObservers'),
          reset: jasmine.createSpy('resetObservers')
        }
      }
    })
    const pendingNode = document.createElement('div')
    container.appendChild(pendingNode)
    const publicationToken = createMutationAddPublicationToken()
    observerOptions.mutationNodeSerializationCb(
      pendingNode,
      container,
      publicationToken
    )

    try {
      // Mouse move, click and frustration all use this strict predicate. It
      // only observes published membership and must not advance/rebuild the
      // pending serializer.
      expect(
        observerOptions.isNodeIgnoredForStatelessObserver(pendingNode)
      ).toBeTrue()
      expect(
        observerOptions.isNodeIgnoredForStatelessObserver(pendingNode)
      ).toBeTrue()
      expect(
        observerOptions.isNodeIgnoredForStatelessObserver(pendingNode)
      ).toBeTrue()
      expect(refreshPendingRoot).not.toHaveBeenCalled()
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()

      // Stateful input/scroll/media/CSS checks retain the ordered refresh
      // path so their state can bind to the eventual add admission.
      expect(observerOptions.isNodeIgnored(pendingNode)).toBeTrue()
      expect(refreshPendingRoot).toHaveBeenCalledOnceWith(pendingNode)
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()
    } finally {
      recorder.stop()
    }
  })

  it('should retry the exact same mutation record until encoder backpressure clears', () => {
    const attemptedMutations = []
    let mutationAttemptCount = 0
    const recorder = record({
      emit: (event) => {
        if (
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          attemptedMutations.push(event)
          mutationAttemptCount += 1
          return mutationAttemptCount > 3
        }
        return true
      },
      $rWasLastEmitBackpressured: () => mutationAttemptCount <= 3,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })

    const child = document.createElement('div')
    child.setAttribute('data-testid', 'retried-child')
    container.appendChild(child)

    try {
      recorder.flushMutations()
      expect(attemptedMutations.length).toBe(1)
      expect(recorder.getSerializedNodeIdForDebug(child)).toBeUndefined()

      // An explicit drain follows the same admission path as the scheduled
      // retry, without making this object-identity contract depend on timers.
      recorder.flushMutations()
      recorder.flushMutations()
      recorder.flushMutations()

      expect(attemptedMutations.length).toBe(4)
      attemptedMutations.slice(1).forEach((attempt) => {
        expect(attempt).toBe(attemptedMutations[0])
        expect(attempt.timestamp).toBe(attemptedMutations[0].timestamp)
      })
      expect(recorder.getSerializedNodeIdForDebug(child)).toEqual(
        jasmine.any(Number)
      )
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()
    } finally {
      recorder.stop()
    }
  })

  it('should supersede a backpressured mutation without recursively starting recovery', () => {
    let admissionBlocked = true
    let captureMutations = false
    let replacementSnapshotCount = 0
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    const recorder = record({
      emit: (event) => {
        if (
          captureMutations &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          return false
        }
        if (
          captureMutations &&
          event.type === RecordType.FullSnapshot
        ) {
          replacementSnapshotCount += 1
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      onFullSnapshotFailure
    })
    captureMutations = true

    const child = document.createElement('div')
    container.appendChild(child)
    recorder.flushMutations()
    admissionBlocked = false

    recorder.takeSubsequentFullSnapshot(1500)

    expect(replacementSnapshotCount).toBe(1)
    expect(onFullSnapshotFailure).not.toHaveBeenCalled()
    recorder.stop()
  })

  it('should preserve mutations inside a queued add until its admission clears', () => {
    const attemptedMutations = []
    const acceptedMutations = []
    let admissionBlocked = true
    let captureMutations = false
    const recorder = record({
      emit: (event) => {
        if (
          captureMutations &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          attemptedMutations.push(event)
          if (admissionBlocked) {
            return false
          }
          acceptedMutations.push(event)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureMutations = true

    const parent = document.createElement('section')
    parent.setAttribute('data-state', 'initial')
    container.appendChild(parent)

    try {
      recorder.flushMutations()

      expect(attemptedMutations.length).toBe(1)
      expect(recorder.getSerializedNodeIdForDebug(parent)).toBeUndefined()

      parent.setAttribute('data-state', 'updated')
      const child = document.createElement('span')
      child.textContent = 'added-during-backpressure'
      parent.appendChild(child)
      recorder.flushMutations()

      // The dependent mutation is staged behind the exact parent add; it must
      // not overtake it while the encoder remains backpressured.
      expect(attemptedMutations.length).toBe(1)
      expect(acceptedMutations).toEqual([])

      admissionBlocked = false
      recorder.flushMutations()

      expect(acceptedMutations.length).toBe(2)
      expect(attemptedMutations[1]).toBe(attemptedMutations[0])
      const parentAdd = acceptedMutations[0].data.adds.find(
        (add) => add.node.tagName === 'section'
      )
      expect(parentAdd).toBeDefined()
      expect(acceptedMutations[1].data.attributes).toContain(
        jasmine.objectContaining({
          id: parentAdd.node.id,
          attributes: jasmine.objectContaining({
            'data-state': 'updated'
          })
        })
      )
      expect(acceptedMutations[1].data.adds).toContain(
        jasmine.objectContaining({
          parentId: parentAdd.node.id,
          node: jasmine.objectContaining({
            tagName: 'span'
          })
        })
      )
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()
    } finally {
      recorder.stop()
    }
  })

  it('should publish queued-node input and CSSOM state at its structural boundary', () => {
    const acceptedSources = []
    let admissionBlocked = true
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot
        ) {
          if (
            event.data.source === IncrementalSource.Mutation &&
            admissionBlocked
          ) {
            return false
          }
          acceptedSources.push(event.data.source)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureEmits = true

    const input = document.createElement('input')
    const style = document.createElement('style')
    container.appendChild(input)
    container.appendChild(style)

    try {
      recorder.flushMutations()
      expect(recorder.getSerializedNodeIdForDebug(input)).toBeUndefined()

      input.value = 'typed-before-add-admission'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      style.sheet.insertRule('body { color: rgb(1, 2, 3); }', 0)

      input.setAttribute('data-after-state', 'true')
      recorder.flushMutations()
      expect(acceptedSources).toEqual([])

      admissionBlocked = false
      recorder.flushMutations()

      expect(acceptedSources).toEqual([
        IncrementalSource.Mutation,
        IncrementalSource.Input,
        IncrementalSource.StyleSheetRule,
        IncrementalSource.Mutation
      ])
      expect(recorder.getSerializedNodeIdForDebug(input)).toEqual(
        jasmine.any(Number)
      )
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()
    } finally {
      recorder.stop()
    }
  })

  it('should flush the mutation emit buffer before queued-node state', async () => {
    jasmine.clock().install()
    const idleCallbacks = []
    spyOn(window, 'requestIdleCallback').and.callFake((callback) => {
      idleCallbacks.push(callback)
      return idleCallbacks.length
    })
    spyOn(window, 'cancelIdleCallback').and.callFake(() => {})
    const acceptedSources = []
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot
        ) {
          acceptedSources.push(event.data.source)
        }
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureEmits = true

    const input = document.createElement('input')
    const style = document.createElement('style')
    container.appendChild(input)
    container.appendChild(style)

    try {
      // Deliver the native MutationObserver callback and its throttled batch,
      // but stop before record()'s 16 ms mutation emit timer fires.
      await Promise.resolve()
      expect(idleCallbacks.length).toBeGreaterThan(0)
      idleCallbacks.splice(0).forEach((callback) => {
        callback({
          didTimeout: false,
          timeRemaining: () => 50
        })
      })
      jasmine.clock().tick(48)
      expect(acceptedSources).toEqual([])

      input.value = 'state-before-emit-timer'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      style.sheet.insertRule('body { color: blue; }', 0)

      expect(acceptedSources).toEqual([
        IncrementalSource.Mutation,
        IncrementalSource.Input,
        IncrementalSource.StyleSheetRule
      ])
    } finally {
      try {
        recorder.stop()
      } finally {
        jasmine.clock().uninstall()
      }
    }
  })

  it('should admit earlier mutations before a future deferred barrier', () => {
    const acceptedSources = []
    let attemptedMutationCount = 0
    let admissionBlocked = true
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot
        ) {
          if (event.data.source === IncrementalSource.Mutation) {
            attemptedMutationCount += 1
            if (admissionBlocked) {
              return false
            }
          }
          acceptedSources.push(event.data.source)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureEmits = true

    const earlierNode = document.createElement('div')
    earlierNode.textContent = 'a'.repeat(70000)
    const barrierInput = document.createElement('input')
    barrierInput.setAttribute('data-padding', 'b'.repeat(70000))
    container.appendChild(earlierNode)
    container.appendChild(barrierInput)

    try {
      recorder.flushMutations()
      expect(attemptedMutationCount).toBe(1)

      barrierInput.value = 'state-after-b'
      barrierInput.dispatchEvent(new Event('input', { bubbles: true }))

      admissionBlocked = false
      recorder.flushMutations()

      expect(acceptedSources).toEqual([
        IncrementalSource.Mutation,
        IncrementalSource.Mutation,
        IncrementalSource.Input
      ])
      expect(recorder.getSerializedNodeIdForDebug(earlierNode)).toEqual(
        jasmine.any(Number)
      )
      expect(recorder.getSerializedNodeIdForDebug(barrierInput)).toEqual(
        jasmine.any(Number)
      )
    } finally {
      recorder.stop()
    }
  })

  it('should not merge a later pure add across a deferred barrier', () => {
    const acceptedRecords = []
    let admissionBlocked = true
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot
        ) {
          if (
            event.data.source === IncrementalSource.Mutation &&
            admissionBlocked
          ) {
            return false
          }
          acceptedRecords.push(event)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureEmits = true

    const earlierNode = document.createElement('div')
    earlierNode.textContent = 'a'.repeat(70000)
    const barrierInput = document.createElement('input')
    barrierInput.setAttribute('data-role', 'barrier-b')
    barrierInput.setAttribute('data-padding', 'b'.repeat(40000))
    container.appendChild(earlierNode)
    container.appendChild(barrierInput)

    try {
      recorder.flushMutations()

      barrierInput.value = 'event-x'
      barrierInput.dispatchEvent(new Event('input', { bubbles: true }))

      const laterNode = document.createElement('div')
      laterNode.setAttribute('data-role', 'later-c')
      container.appendChild(laterNode)
      recorder.flushMutations()

      admissionBlocked = false
      recorder.flushMutations()

      expect(
        acceptedRecords.map((event) => event.data.source)
      ).toEqual([
        IncrementalSource.Mutation,
        IncrementalSource.Mutation,
        IncrementalSource.Input,
        IncrementalSource.Mutation
      ])
      expect(
        acceptedRecords[1].data.adds.some(
          (add) => add.node.attributes['data-role'] === 'later-c'
        )
      ).toBeFalse()
      expect(acceptedRecords[3].data.adds).toContain(
        jasmine.objectContaining({
          node: jasmine.objectContaining({
            attributes: jasmine.objectContaining({
              'data-role': 'later-c'
            })
          })
        })
      )
    } finally {
      recorder.stop()
    }
  })

  it('should publish cached canvas commands before a later DOM barrier', () => {
    const acceptedRecords = []
    const cachedCanvasRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 1200,
      data: {
        source: IncrementalSource.CanvasMutation,
        id: 777,
        type: '2D',
        commands: [
          {
            property: 'fillRect',
            args: [1, 2, 3, 4]
          }
        ],
        encodedBytesCount: 16
      }
    }
    let admissionBlocked = true
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot
        ) {
          if (
            event.data.source === IncrementalSource.Mutation &&
            admissionBlocked
          ) {
            return false
          }
          acceptedRecords.push(event)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      startCanvasCommandCapture: function (options) {
        return {
          $rRetryPublishedCanvas: function () {
            options.emit(cachedCanvasRecord)
          },
          reset: jasmine.createSpy('resetCanvasCommandCapture'),
          scanExistingCanvases: jasmine.createSpy(
            'scanExistingCanvases'
          ),
          stop: jasmine.createSpy('stopCanvasCommandCapture')
        }
      }
    })
    captureEmits = true

    const canvas = document.createElement('canvas')
    canvas.setAttribute('data-role', 'canvas-a')
    container.appendChild(canvas)

    try {
      recorder.flushMutations()
      expect(acceptedRecords).toEqual([])

      const laterInput = document.createElement('input')
      laterInput.setAttribute('data-role', 'later-b')
      container.appendChild(laterInput)
      recorder.flushMutations()
      laterInput.value = 'state-after-b'
      laterInput.dispatchEvent(new Event('input', { bubbles: true }))
      expect(acceptedRecords).toEqual([])

      admissionBlocked = false
      recorder.flushMutations()

      expect(
        acceptedRecords.map((event) => event.data.source)
      ).toEqual([
        IncrementalSource.Mutation,
        IncrementalSource.CanvasMutation,
        IncrementalSource.Mutation,
        IncrementalSource.Input
      ])
      expect(acceptedRecords[0].data.adds).toContain(
        jasmine.objectContaining({
          node: jasmine.objectContaining({ tagName: 'canvas' })
        })
      )
      expect(acceptedRecords[2].data.adds).toContain(
        jasmine.objectContaining({
          node: jasmine.objectContaining({ tagName: 'input' })
        })
      )
      expect(acceptedRecords[1]).toBe(cachedCanvasRecord)
    } finally {
      recorder.stop()
    }
  })

  it('should serialize same-task CSSOM state in the style add', () => {
    let captureEmits = false
    const emittedRecords = []
    const recorder = record({
      emit: (event) => {
        if (captureEmits) {
          emittedRecords.push(event)
        }
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureEmits = true

    const style = document.createElement('style')
    container.appendChild(style)

    try {
      // This runs before the native MutationObserver callback has serialized
      // or staged the style element, so no CSSOM incremental record can carry
      // a valid node id yet. The later add serializer reads sheet.cssRules.
      style.sheet.insertRule('body { color: red; }', 0)
      recorder.flushMutations()

      const styleAdd = emittedRecords
        .filter(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.Mutation
        )
        .flatMap((event) => event.data.adds)
        .find((add) => add.node.tagName === 'style')
      expect(styleAdd).toBeDefined()
      expect(styleAdd.node.attributes._cssText).toContain('color: red')
      expect(
        emittedRecords.some(
          (event) => event.type === RecordType.FullSnapshot
        )
      ).toBeFalse()
      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.StyleSheetRule
        )
      ).toBeFalse()
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()
    } finally {
      recorder.stop()
    }
  })

  it('should not recover an unserialized stylesheet in a hidden subtree', () => {
    let captureEmits = false
    let replacementSnapshotCount = 0
    const recorder = record({
      emit: (event) => {
        if (captureEmits && event.type === RecordType.FullSnapshot) {
          replacementSnapshotCount += 1
        }
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureEmits = true

    const hiddenSubtree = document.createElement('div')
    hiddenSubtree.setAttribute('data-gc-privacy', 'hidden')
    const style = document.createElement('style')
    hiddenSubtree.appendChild(style)
    container.appendChild(hiddenSubtree)

    try {
      expect(style.sheet).not.toBeNull()
      style.sheet.insertRule('body { color: private; }', 0)

      expect(replacementSnapshotCount).toBe(0)
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()
    } finally {
      recorder.stop()
    }
  })

  it('should time-slice deferred state records at a mutation barrier', () => {
    jasmine.clock().install()
    spyOn(performance, 'now').and.returnValue(0)
    let admissionBlocked = true
    let captureEmits = false
    const acceptedSources = []
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot
        ) {
          if (
            event.data.source === IncrementalSource.Mutation &&
            admissionBlocked
          ) {
            return false
          }
          acceptedSources.push(event.data.source)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureEmits = true

    const input = document.createElement('input')
    container.appendChild(input)

    try {
      recorder.flushMutations()
      for (let index = 0; index < 3; index += 1) {
        input.value = String(index).repeat(70000)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }

      admissionBlocked = false
      recorder.flushMutations()

      expect(acceptedSources).toEqual([
        IncrementalSource.Mutation,
        IncrementalSource.Input,
        IncrementalSource.Input
      ])

      jasmine.clock().tick(0)
      expect(acceptedSources).toEqual([
        IncrementalSource.Mutation,
        IncrementalSource.Input,
        IncrementalSource.Input,
        IncrementalSource.Input
      ])
    } finally {
      try {
        recorder.stop()
      } finally {
        jasmine.clock().uninstall()
      }
    }
  })

  it('should admit a retried previous-tail record before a later DOM baseline', () => {
    jasmine.clock().install()
    const acceptedSources = []
    const emittedRecords = []
    let emitRecord
    let admissionBlocked = true
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot
        ) {
          if (
            event.data.source === IncrementalSource.Scroll &&
            admissionBlocked
          ) {
            return false
          }
          acceptedSources.push(event.data.source)
        }
        if (captureEmits) {
          emittedRecords.push(event)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        emitRecord = options.emit
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: jasmine.createSpy('reset'),
          stop: jasmine.createSpy('stop')
        }
      }
    })
    captureEmits = true

    try {
      recorder.scheduleSubsequentFullSnapshot(1000)
      emitRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 1001,
        data: {
          source: IncrementalSource.Scroll,
          id: 1,
          x: 0,
          y: 10
        }
      })
      // Complete the baseline synchronously. Its unbound Scroll tail is now
      // waiting on an encoder-backpressure retry.
      recorder.takeSubsequentFullSnapshot(1000)

      const input = document.createElement('input')
      container.appendChild(input)
      recorder.flushMutations()
      input.value = 'state-after-add'
      input.dispatchEvent(new Event('input', { bubbles: true }))

      admissionBlocked = false
      jasmine.clock().tick(32)
      jasmine.clock().tick(0)

      expect(acceptedSources).toEqual([IncrementalSource.Scroll])
      const fullSnapshot = emittedRecords.find(
        (event) => event.type === RecordType.FullSnapshot
      )
      expect(fullSnapshot).toBeDefined()
      expect(JSON.stringify(fullSnapshot)).toContain('state-after-add')
    } finally {
      try {
        recorder.stop()
      } finally {
        jasmine.clock().uninstall()
      }
    }
  })

  it('should supersede the DOM tail after a deferred CSSOM gap', () => {
    const emittedRecords = []
    let transientMutationBackpressure = true
    let rejectStyleSheetRulePermanently = false
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot
        ) {
          if (
            event.data.source === IncrementalSource.Mutation &&
            transientMutationBackpressure
          ) {
            return false
          }
          if (
            event.data.source === IncrementalSource.StyleSheetRule &&
            rejectStyleSheetRulePermanently
          ) {
            return false
          }
        }
        if (captureEmits) {
          emittedRecords.push(event)
        }
        return true
      },
      $rWasLastEmitBackpressured: () =>
        transientMutationBackpressure,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureEmits = true

    const style = document.createElement('style')
    style.setAttribute('data-role', 'barrier-a')
    container.appendChild(style)

    try {
      recorder.flushMutations()
      style.sheet.insertRule('body { color: green; }', 0)

      const laterNode = document.createElement('div')
      laterNode.setAttribute('data-role', 'later-b')
      container.appendChild(laterNode)
      recorder.flushMutations()

      transientMutationBackpressure = false
      rejectStyleSheetRulePermanently = true
      recorder.flushMutations()

      const incrementalRecordsBeforeBaseline = emittedRecords.filter(
        (event) => event.type === RecordType.IncrementalSnapshot
      )
      expect(incrementalRecordsBeforeBaseline.length).toBe(1)
      expect(
        incrementalRecordsBeforeBaseline[0].data.adds.some(
          (add) => add.node.attributes['data-role'] === 'barrier-a'
        )
      ).toBeTrue()
      expect(
        incrementalRecordsBeforeBaseline[0].data.adds.some(
          (add) => add.node.attributes['data-role'] === 'later-b'
        )
      ).toBeFalse()

      rejectStyleSheetRulePermanently = false
      expect(recorder.flushScheduledFullSnapshot()).toBeTrue()

      const replacementSnapshot = emittedRecords.find(
        (event) => event.type === RecordType.FullSnapshot
      )
      expect(replacementSnapshot).toBeDefined()
      expect(JSON.stringify(replacementSnapshot)).toContain('color: green')
      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.StyleSheetRule
        )
      ).toBeFalse()
      expect(
        emittedRecords
          .filter(
            (event) =>
              event.type === RecordType.IncrementalSnapshot &&
              event.data.source === IncrementalSource.Mutation
          )
          .some((event) =>
            event.data.adds.some(
              (add) => add.node.attributes['data-role'] === 'later-b'
            )
          )
      ).toBeFalse()
    } finally {
      recorder.stop()
    }
  })

  it('should retire queued state before an overflow recovery baseline', () => {
    // This case verifies retirement ordering, not time slicing. Keep the
    // serializer clock deterministic so the 4,097-attribute recovery tree is
    // not rejected by the one-slice explicit flush on slower test runs.
    spyOn(performance, 'now').and.returnValue(0)
    const overflowElement = document.createElement('div')
    container.appendChild(overflowElement)
    const emittedRecords = []
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    let admissionBlocked = true
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          admissionBlocked
        ) {
          return false
        }
        if (captureEmits) {
          emittedRecords.push(event)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      onFullSnapshotFailure,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureEmits = true

    const queuedInput = document.createElement('input')
    container.appendChild(queuedInput)

    try {
      recorder.flushMutations()
      queuedInput.value = 'superseded-input-state'
      queuedInput.dispatchEvent(new Event('input', { bubbles: true }))

      // Exceed the raw mutation-record watermark while the input add remains
      // backpressured. Recovery may retain an admitted safe prefix, but this
      // queued barrier and its state must be retired before the baseline.
      for (
        let index = 0;
        index < MAX_QUEUED_MUTATION_RECORDS + 1;
        index += 1
      ) {
        overflowElement.setAttribute('data-overflow-' + index, 'x')
      }
      recorder.flushMutations()

      admissionBlocked = false
      expect(recorder.flushScheduledFullSnapshot()).toBeTrue()
      expect(onFullSnapshotFailure).not.toHaveBeenCalled()

      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.Input
        )
      ).toBeFalse()
      expect(
        emittedRecords
          .filter(
            (event) =>
              event.type === RecordType.IncrementalSnapshot &&
              event.data.source === IncrementalSource.Mutation
          )
          .some((event) =>
            event.data.adds.some(
              (add) => add.node.tagName === 'input'
            )
          )
      ).toBeFalse()
      const replacementSnapshot = emittedRecords.find(
        (event) => event.type === RecordType.FullSnapshot
      )
      expect(replacementSnapshot).toBeDefined()
      expect(JSON.stringify(replacementSnapshot)).toContain(
        'superseded-input-state'
      )
    } finally {
      recorder.stop()
    }
  })

  it('should retire an unbound deferred tail before overflow recovery', () => {
    jasmine.clock().install()
    const overflowElement = document.createElement('div')
    container.appendChild(overflowElement)
    const emittedRecords = []
    let emitRecord
    let admissionBlocked = true
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Scroll &&
          admissionBlocked
        ) {
          return false
        }
        if (captureEmits) {
          emittedRecords.push(event)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        emitRecord = options.emit
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: jasmine.createSpy('reset'),
          stop: jasmine.createSpy('stop')
        }
      }
    })
    captureEmits = true

    try {
      recorder.scheduleSubsequentFullSnapshot(3000)
      emitRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 3001,
        data: {
          source: IncrementalSource.Scroll,
          id: 1,
          x: 0,
          y: 20
        }
      })
      recorder.takeSubsequentFullSnapshot(3000)

      // The Scroll record is now an unbound deferred retry. A later mutation
      // overflow starts a mandatory transaction that supersedes it entirely.
      for (
        let index = 0;
        index < MAX_QUEUED_MUTATION_RECORDS + 1;
        index += 1
      ) {
        overflowElement.setAttribute('data-overflow-' + index, 'x')
      }
      recorder.flushMutations()

      admissionBlocked = false
      expect(recorder.flushScheduledFullSnapshot()).toBeTrue()
      jasmine.clock().tick(32)

      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.Scroll
        )
      ).toBeFalse()
      expect(
        emittedRecords.filter(
          (event) => event.type === RecordType.FullSnapshot
        ).length
      ).toBeGreaterThan(0)
    } finally {
      try {
        recorder.stop()
      } finally {
        jasmine.clock().uninstall()
      }
    }
  })

  it('should discard old-view deferred state at the public view boundary', () => {
    const emittedRecords = []
    let admissionBlocked = true
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          admissionBlocked
        ) {
          return false
        }
        if (captureEmits) {
          emittedRecords.push(event)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureEmits = true

    const oldViewInput = document.createElement('input')
    container.appendChild(oldViewInput)

    try {
      recorder.flushMutations()
      oldViewInput.value = 'old-view-state'
      oldViewInput.dispatchEvent(new Event('input', { bubbles: true }))

      recorder.prepareForViewChange()
      admissionBlocked = false
      recorder.takeSubsequentFullSnapshot(2000)

      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.Input
        )
      ).toBeFalse()
      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.FullSnapshot &&
            event.timestamp === 2000
        )
      ).toBeTrue()
    } finally {
      recorder.stop()
    }
  })

  it('should atomically drop a still-pending view tail before the next baseline', () => {
    jasmine.clock().install()
    const emittedRecords = []
    const flushObservers = jasmine
      .createSpy('flushObservers')
      .and.returnValue('pending')
    const resetObservers = jasmine.createSpy('resetObservers')
    let serializerTaskCount = 0
    let recorder

    try {
      recorder = record({
        emit: (event) => {
          emittedRecords.push(event)
          return true
        },
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle(),
        initObservers: function () {
          return {
            stop: function () {},
            flush: flushObservers,
            reset: resetObservers
          }
        },
        $rCreateFullSnapshotSerializerTask: function () {
          serializerTaskCount += 1
          return {
            serializedNode: {
              type: 0,
              id: serializerTaskCount,
              state: container.getAttribute('data-view-state'),
              childNodes: []
            },
            processedNodeCount: 1,
            approxBytes: 128,
            advance: function () {
              return true
            }
          }
        }
      })
      emittedRecords.length = 0
      container.setAttribute('data-view-state', 'new-view-dom')
      let now = 0
      spyOn(performance, 'now').and.callFake(() => {
        now += 20
        return now
      })

      expect(recorder.prepareForViewChange()).toBe('pending')
      const flushCountAtBoundary = flushObservers.calls.count()
      expect(resetObservers).toHaveBeenCalled()
      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.Mutation
        )
      ).toBeFalse()

      recorder.takeSubsequentFullSnapshot(2001)
      const nextViewSnapshot = emittedRecords.find(
        (event) =>
          event.type === RecordType.FullSnapshot &&
          event.timestamp === 2001
      )
      expect(nextViewSnapshot.data.node.state).toBe('new-view-dom')

      jasmine.clock().tick(0)
      expect(flushObservers.calls.count()).toBe(flushCountAtBoundary)
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should stop with no half-published mutation when the bounded drain stays pending', () => {
    jasmine.clock().install()
    const emittedRecords = []
    const cleanupOrder = []
    const flushObservers = jasmine
      .createSpy('flushObservers')
      .and.callFake(() => {
        cleanupOrder.push('flush')
        return 'pending'
      })
    let recorder

    try {
      recorder = record({
        emit: (event) => {
          emittedRecords.push(event)
          return true
        },
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle(),
        initObservers: function () {
          return {
            stop: function () {
              cleanupOrder.push('stop')
            },
            flush: flushObservers,
            reset: function () {}
          }
        }
      })
      emittedRecords.length = 0
      let now = 0
      spyOn(performance, 'now').and.callFake(() => {
        now += 20
        return now
      })

      recorder.stop()
      jasmine.clock().tick(0)

      expect(cleanupOrder).toEqual(['flush', 'stop'])
      expect(flushObservers).toHaveBeenCalledTimes(1)
      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.Mutation
        )
      ).toBeFalse()
    } finally {
      jasmine.clock().uninstall()
    }
  })

  it('should preserve shadow mutations inside a queued add until admission clears', () => {
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    host.appendChild(document.createElement('span'))
    container.appendChild(host)
    const attemptedMutations = []
    const acceptedMutations = []
    let admissionBlocked = true
    let captureMutations = false
    const recorder = record({
      emit: (event) => {
        if (
          captureMutations &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          attemptedMutations.push(event)
          if (admissionBlocked) {
            return false
          }
          acceptedMutations.push(event)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureMutations = true

    const parent = document.createElement('section')
    parent.setAttribute('data-state', 'initial')
    shadowRoot.appendChild(parent)

    try {
      recorder.flushMutations()
      expect(attemptedMutations.length).toBe(1)

      parent.setAttribute('data-state', 'updated')
      const child = document.createElement('span')
      parent.appendChild(child)
      recorder.flushMutations()

      expect(attemptedMutations.length).toBe(1)
      admissionBlocked = false
      recorder.flushMutations()

      expect(acceptedMutations.length).toBe(2)
      const parentAdd = acceptedMutations[0].data.adds.find(
        (add) => add.node.tagName === 'section'
      )
      expect(parentAdd).toBeDefined()
      expect(acceptedMutations[1].data.attributes).toContain(
        jasmine.objectContaining({
          id: parentAdd.node.id,
          attributes: jasmine.objectContaining({
            'data-state': 'updated'
          })
        })
      )
      expect(acceptedMutations[1].data.adds).toContain(
        jasmine.objectContaining({
          parentId: parentAdd.node.id
        })
      )
    } finally {
      recorder.stop()
    }
  })

  it('should keep the new shadow-root generation active after a subsequent full snapshot', () => {
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const input = document.createElement('input')
    input.value = 'shadow-value'
    shadowRoot.appendChild(input)
    // The serializer currently opens an element iterator through its light DOM
    // before visiting the associated shadow root.
    host.appendChild(document.createElement('span'))
    container.appendChild(host)

    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0
    spyOn(performance, 'now').and.returnValue(0)

    recorder.takeSubsequentFullSnapshot(1500)
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.FullSnapshot && event.timestamp === 1500
      )
    ).toBeTrue()
    emittedRecords.length = 0
    input.dispatchEvent(
      new Event('change', { bubbles: true, composed: false })
    )

    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Input &&
          event.data.text === 'shadow-value'
      )
    ).toBeTrue()
    recorder.stop()
  })

  it('should restart a full snapshot for native shadow mutations queued during serialization', () => {
    jasmine.clock().install()
    spyOn(performance, 'now').and.returnValue(0)
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const shadowText = document.createTextNode('before-shadow-change')
    shadowRoot.appendChild(shadowText)
    host.appendChild(document.createElement('span'))
    const marker = document.createElement('p')
    const markerText = document.createTextNode('snapshot-marker')
    marker.appendChild(markerText)
    container.appendChild(host)
    container.appendChild(marker)
    const emittedRecords = []
    let mutateDuringSnapshot = false
    const recorder = record({
      emit: (event) => {
        emittedRecords.push(event)
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        shouldMaskNode: function (node) {
          if (mutateDuringSnapshot && node === markerText) {
            mutateDuringSnapshot = false
            shadowText.textContent = 'during-shadow-change'
          }
          return false
        }
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    try {
      mutateDuringSnapshot = true
      recorder.takeSubsequentFullSnapshot(1501)
      jasmine.clock().tick(1)

      const fullSnapshots = emittedRecords.filter(
        (event) => event.type === RecordType.FullSnapshot
      )
      expect(fullSnapshots.length).toBe(1)
      expect(fullSnapshots[0].timestamp).toBeGreaterThanOrEqual(1501)
      expect(JSON.stringify(fullSnapshots[0].data.node)).toContain(
        'during-shadow-change'
      )
      expect(JSON.stringify(fullSnapshots[0].data.node)).not.toContain(
        'before-shadow-change'
      )
    } finally {
      recorder.stop()
      jasmine.clock().uninstall()
    }
  })

  it('should publish a dynamically attached open shadow root before its internal mutations', () => {
    const host = document.createElement('div')
    container.appendChild(host)
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    const shadowRoot = host.attachShadow({ mode: 'open' })
    const input = document.createElement('input')
    input.value = 'before-publication'
    shadowRoot.appendChild(input)
    input.dispatchEvent(
      new Event('change', { bubbles: true, composed: false })
    )

    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Input
      )
    ).toBeFalse()

    recorder.flushMutations()

    const shadowRootId = recorder.getSerializedNodeIdForDebug(shadowRoot)
    const inputId = recorder.getSerializedNodeIdForDebug(input)
    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    const shadowRootAddIndex = mutationSnapshots.findIndex((event) =>
      event.data.adds.some((add) => add.node.id === shadowRootId)
    )
    const inputAddIndex = mutationSnapshots.findIndex((event) =>
      event.data.adds.some((add) => add.node.id === inputId)
    )

    expect(shadowRootId).toEqual(jasmine.any(Number))
    expect(inputId).toEqual(jasmine.any(Number))
    expect(shadowRootAddIndex).toBeGreaterThanOrEqual(0)
    expect(inputAddIndex).toBeGreaterThan(shadowRootAddIndex)
    expect(
      mutationSnapshots[shadowRootAddIndex].data.adds[0]
    ).toEqual(
      jasmine.objectContaining({
        parentId: recorder.getSerializedNodeIdForDebug(host),
        nextId: null,
        node: jasmine.objectContaining({
          id: shadowRootId,
          isShadowRoot: true
        })
      })
    )

    emittedRecords.length = 0
    input.value = 'after-publication'
    input.dispatchEvent(
      new Event('change', { bubbles: true, composed: false })
    )
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Input &&
          event.data.id === inputId &&
          event.data.text === 'after-publication'
      )
    ).toBeTrue()

    recorder.stop()
  })

  it('should release a rejected dynamic shadow-root observer', () => {
    const host = document.createElement('div')
    container.appendChild(host)
    let rejectNextMutation = false
    const recorder = record({
      emit: (event) => {
        if (
          rejectNextMutation &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          rejectNextMutation = false
          return false
        }
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })

    rejectNextMutation = true
    const rejectedShadowRoot = host.attachShadow({ mode: 'open' })

    expect(rejectNextMutation).toBeFalse()
    expect(
      recorder.getSerializedNodeIdForDebug(rejectedShadowRoot)
    ).toBeUndefined()

    for (
      let index = 0;
      index < SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT;
      index += 1
    ) {
      const detachedHost = document.createElement('div')
      const shadowRoot = detachedHost.attachShadow({ mode: 'open' })
      expect(
        recorder.shadowRootsController.addShadowRoot(shadowRoot)
      ).toBeTrue()
    }

    recorder.stop()
  })

  it('should rebuild and publish a pending host when a shadow root is attached before its add', () => {
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const emittedRecords = []
    let observerOptions
    let mutationTasksController
    const recorder = record({
      emit: (event) => {
        emittedRecords.push(event)
        return true
      },
      configuration,
      lifeCycle: createLifeCycle(),
      initObservers: function (options) {
        observerOptions = options
        return {
          flush: function () {},
          refreshAndFlushPendingRootForNode: function (node) {
            return mutationTasksController
              ? mutationTasksController.refreshAndFlushPendingRootForNode(
                  node
                )
              : undefined
          },
          reset: function () {
            if (mutationTasksController) {
              mutationTasksController.reset()
            }
          },
          stop: function () {}
        }
      }
    })
    emittedRecords.length = 0
    mutationTasksController = createMutationTasksController(
      observerOptions.mutationCb,
      configuration,
      observerOptions.shadowRootsController,
      observerOptions.mutationPerfCb,
      observerOptions.mutationOverflowCb,
      observerOptions.mutationNodeSerializationCb,
      observerOptions.isNodeIgnored
    )
    const host = document.createElement('div')
    container.appendChild(host)

    try {
      expect(
        mutationTasksController.addPendingRootTask(host, {
          serializedNodeIds: new Set(),
          parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
          serializationContext: {
            status: SerializationContextStatus.MUTATION,
            shadowRootsController: observerOptions.shadowRootsController
          },
          configuration
        })
      ).toBeTrue()
      const pendingHostTask =
        mutationTasksController.findPendingRootTask(host)
      expect(
        JSON.stringify(pendingHostTask.serializerTask.serializedNode)
      ).not.toContain('isShadowRoot')

      const shadowRoot = host.attachShadow({ mode: 'open' })
      const child = document.createElement('span')
      shadowRoot.appendChild(child)
      recorder.flushMutations()

      const mutationSnapshots = emittedRecords.filter(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
      )
      const hostAddIndex = mutationSnapshots.findIndex((event) =>
        event.data.adds.some(
          (add) =>
            add.node.id ===
            recorder.getSerializedNodeIdForDebug(host)
        )
      )
      const childAddIndex = mutationSnapshots.findIndex((event) =>
        event.data.adds.some(
          (add) =>
            add.node.id ===
            recorder.getSerializedNodeIdForDebug(child)
        )
      )
      expect(hostAddIndex).toBeGreaterThanOrEqual(0)
      expect(childAddIndex).toBeGreaterThan(hostAddIndex)
      const hostAdd = mutationSnapshots[hostAddIndex].data.adds.find(
        (add) =>
          add.node.id === recorder.getSerializedNodeIdForDebug(host)
      )
      const serializedShadowRoot = hostAdd.node.childNodes.find(
        (node) => node.isShadowRoot
      )

      expect(serializedShadowRoot).toEqual(
        jasmine.objectContaining({
          id: recorder.getSerializedNodeIdForDebug(shadowRoot),
          isShadowRoot: true
        })
      )
      expect(recorder.getSerializedNodeIdForDebug(child)).toEqual(
        jasmine.any(Number)
      )
    } finally {
      mutationTasksController.stop()
      recorder.stop()
    }
  })

  it('should roll back a dynamic shadow root when its pending host add is rejected', () => {
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const mutationSnapshots = []
    let rejectNextMutation = false
    let observerOptions
    let mutationTasksController
    const recorder = record({
      emit: (event) => {
        if (
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          mutationSnapshots.push(event)
          if (rejectNextMutation) {
            rejectNextMutation = false
            return false
          }
        }
        return true
      },
      configuration,
      lifeCycle: createLifeCycle(),
      initObservers: function (options) {
        observerOptions = options
        return {
          flush: function () {},
          refreshAndFlushPendingRootForNode: function (node) {
            return mutationTasksController
              ? mutationTasksController.refreshAndFlushPendingRootForNode(
                  node
                )
              : undefined
          },
          reset: function () {
            if (mutationTasksController) {
              mutationTasksController.reset()
            }
          },
          stop: function () {}
        }
      }
    })
    mutationTasksController = createMutationTasksController(
      observerOptions.mutationCb,
      configuration,
      observerOptions.shadowRootsController,
      observerOptions.mutationPerfCb,
      observerOptions.mutationOverflowCb,
      observerOptions.mutationNodeSerializationCb,
      observerOptions.isNodeIgnored
    )
    const host = document.createElement('div')
    container.appendChild(host)

    try {
      expect(
        mutationTasksController.addPendingRootTask(host, {
          parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
          serializationContext: {
            status: SerializationContextStatus.MUTATION,
            shadowRootsController: observerOptions.shadowRootsController
          },
          configuration
        })
      ).toBeTrue()
      expect(mutationSnapshots).toEqual([])

      rejectNextMutation = true
      const shadowRoot = host.attachShadow({ mode: 'open' })

      expect(rejectNextMutation).toBeFalse()
      expect(mutationSnapshots.length).toBe(1)
      expect(mutationSnapshots[0].data.adds.length).toBe(1)
      expect(
        mutationSnapshots.some((event) =>
          event.data.adds.some(
            (add) => add.node && add.node.isShadowRoot
          )
        )
      ).toBeFalse()
      expect(recorder.getSerializedNodeIdForDebug(host)).toBeUndefined()
      expect(
        recorder.getSerializedNodeIdForDebug(shadowRoot)
      ).toBeUndefined()

      for (
        let index = 0;
        index < SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT;
        index += 1
      ) {
        const detachedHost = document.createElement('div')
        const availableShadowRoot = detachedHost.attachShadow({
          mode: 'open'
        })
        expect(
          recorder.shadowRootsController.addShadowRoot(
            availableShadowRoot
          )
        ).toBeTrue()
      }
    } finally {
      mutationTasksController.stop()
      recorder.stop()
    }
  })

  it('should serialize a dynamic shadow root inside an unpublished outer host add', () => {
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    const host = document.createElement('div')
    container.appendChild(host)
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const child = document.createElement('span')
    shadowRoot.appendChild(child)
    recorder.flushMutations()

    const hostId = recorder.getSerializedNodeIdForDebug(host)
    const shadowRootId = recorder.getSerializedNodeIdForDebug(shadowRoot)
    const childId = recorder.getSerializedNodeIdForDebug(child)
    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    const hostAdd = mutationSnapshots
      .reduce((adds, event) => adds.concat(event.data.adds), [])
      .find((add) => add.node.id === hostId)
    const hostAddIndex = mutationSnapshots.findIndex((event) =>
      event.data.adds.some((add) => add.node.id === hostId)
    )
    const childAddIndex = mutationSnapshots.findIndex((event) =>
      event.data.adds.some((add) => add.node.id === childId)
    )

    expect(hostAdd).toBeDefined()
    expect(JSON.stringify(hostAdd.node)).toContain(
      '"id":' + shadowRootId
    )
    expect(childAddIndex).toBeGreaterThan(hostAddIndex)
    expect(
      mutationSnapshots.some((event) =>
        event.data.adds.some((add) => add.node.id === shadowRootId)
      )
    ).toBeFalse()

    recorder.stop()
  })

  it('should rebuild a pending host owned by an active shadow-root observer', () => {
    const outerHost = document.createElement('div')
    const outerShadowRoot = outerHost.attachShadow({ mode: 'open' })
    container.appendChild(outerHost)
    const emittedRecords = []
    const recorder = record({
      emit: (event) => {
        emittedRecords.push(event)
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    const nestedHost = document.createElement('section')
    outerShadowRoot.appendChild(nestedHost)
    const nestedShadowRoot = nestedHost.attachShadow({ mode: 'open' })
    const child = document.createElement('span')
    nestedShadowRoot.appendChild(child)
    recorder.flushMutations()

    const nestedHostId =
      recorder.getSerializedNodeIdForDebug(nestedHost)
    const nestedShadowRootId =
      recorder.getSerializedNodeIdForDebug(nestedShadowRoot)
    const childId = recorder.getSerializedNodeIdForDebug(child)
    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    const nestedHostAddIndex = mutationSnapshots.findIndex((event) =>
      event.data.adds.some((add) => add.node.id === nestedHostId)
    )
    const childAddIndex = mutationSnapshots.findIndex((event) =>
      event.data.adds.some((add) => add.node.id === childId)
    )

    expect(nestedHostAddIndex).toBeGreaterThanOrEqual(0)
    expect(childAddIndex).toBeGreaterThan(nestedHostAddIndex)
    expect(
      JSON.stringify(
        mutationSnapshots[nestedHostAddIndex].data.adds
      )
    ).toContain('"id":' + nestedShadowRootId)

    recorder.stop()
  })

  it('should not capture a dynamically attached closed shadow root', () => {
    const host = document.createElement('div')
    container.appendChild(host)
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    const closedShadowRoot = host.attachShadow({ mode: 'closed' })
    const child = document.createElement('span')
    closedShadowRoot.appendChild(child)
    recorder.flushMutations()

    expect(host.shadowRoot).toBeNull()
    expect(
      recorder.getSerializedNodeIdForDebug(closedShadowRoot)
    ).toBeUndefined()
    expect(recorder.getSerializedNodeIdForDebug(child)).toBeUndefined()
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
      )
    ).toBeFalse()

    recorder.stop()
  })

  it('should observe dynamic shadow roots beyond one flush page', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const hosts = []
    for (
      let index = 0;
      index < SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT + 1;
      index += 1
    ) {
      const host = document.createElement('div')
      container.appendChild(host)
      hosts.push(host)
    }
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    const shadowRoots = hosts.map((host) =>
      host.attachShadow({ mode: 'open' })
    )
    while (recorder.flushMutations() === 'pending') {}
    emittedRecords.length = 0

    const admittedChild = document.createElement('span')
    const skippedChild = document.createElement('span')
    shadowRoots[0].appendChild(admittedChild)
    shadowRoots[SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT].appendChild(
      skippedChild
    )
    while (recorder.flushMutations() === 'pending') {}

    expect(
      recorder.getSerializedNodeIdForDebug(admittedChild)
    ).toEqual(jasmine.any(Number))
    expect(
      recorder.getSerializedNodeIdForDebug(skippedChild)
    ).toEqual(jasmine.any(Number))

    recorder.stop()
  })

  it('should keep every shadow root active beyond one flush page', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const shadowHosts = []
    const shadowRoots = []
    const shadowInputs = []
    const shadowCanvases = []
    for (
      let index = 0;
      index < SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT + 1;
      index += 1
    ) {
      const host = document.createElement('div')
      const shadowRoot = host.attachShadow({ mode: 'open' })
      const input = document.createElement('input')
      input.value = `initial-${index}`
      shadowRoot.appendChild(input)
      const canvas = document.createElement('canvas')
      shadowRoot.appendChild(canvas)
      container.appendChild(host)
      shadowHosts.push(host)
      shadowRoots.push(shadowRoot)
      shadowInputs.push(input)
      shadowCanvases.push(canvas)
    }
    const outerElement = document.createElement('div')
    container.appendChild(outerElement)
    const escapedInput = document.createElement('input')
    const escapedCanvas = document.createElement('canvas')
    shadowRoots[0].appendChild(escapedInput)
    shadowRoots[0].appendChild(escapedCanvas)
    const emittedRecords = []
    const onFullSnapshotFailure = jasmine.createSpy('onFullSnapshotFailure')
    const snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      onFullSnapshotFailure,
      createCanvasObserver: function () {
        return {
          snapshot: snapshotCanvas,
          reset: jasmine.createSpy('resetCanvasObserver'),
          stop: jasmine.createSpy('stopCanvasObserver')
        }
      }
    })
    const flushAllMutations = function () {
      while (recorder.flushMutations() === 'pending') {}
    }

    expect(
      emittedRecords.some((event) => event.type === RecordType.FullSnapshot)
    ).toBeTrue()
    expect(onFullSnapshotFailure).not.toHaveBeenCalled()
    expect(
      recorder.getSerializedNodeIdForDebug(shadowInputs[0])
    ).toEqual(jasmine.any(Number))
    expect(
      recorder.getSerializedNodeIdForDebug(
        shadowRoots[SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT]
      )
    ).toEqual(jasmine.any(Number))
    expect(
      recorder.getSerializedNodeIdForDebug(
        shadowInputs[SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT]
      )
    ).toEqual(jasmine.any(Number))

    emittedRecords.length = 0
    outerElement.setAttribute('data-outer', 'changed')
    const capturedShadowChild = document.createElement('span')
    shadowRoots[0].appendChild(capturedShadowChild)
    const skippedShadowChild = document.createElement('span')
    shadowRoots[SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT].appendChild(
      skippedShadowChild
    )
    flushAllMutations()

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    const outerElementId =
      recorder.getSerializedNodeIdForDebug(outerElement)
    const capturedShadowChildId =
      recorder.getSerializedNodeIdForDebug(capturedShadowChild)
    expect(
      mutationSnapshots.some((event) =>
        event.data.attributes.some(
          (attributeMutation) =>
            attributeMutation.id === outerElementId &&
            attributeMutation.attributes['data-outer'] === 'changed'
        )
      )
    ).toBeTrue()
    expect(capturedShadowChildId).toEqual(jasmine.any(Number))
    expect(
      mutationSnapshots.some((event) =>
        event.data.adds.some(
          (addMutation) =>
            addMutation.node.id === capturedShadowChildId
        )
      )
    ).toBeTrue()
    expect(
      recorder.getSerializedNodeIdForDebug(skippedShadowChild)
    ).toEqual(jasmine.any(Number))

    emittedRecords.length = 0
    shadowInputs[0].value = 'captured-change'
    shadowInputs[SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT].value =
      'skipped-change'
    shadowInputs[0].dispatchEvent(
      new Event('change', { bubbles: true, composed: false })
    )
    shadowInputs[SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT].dispatchEvent(
      new Event('change', { bubbles: true, composed: false })
    )
    const inputSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Input
    )
    expect(
      inputSnapshots.some(
        (event) => event.data.text === 'captured-change'
      )
    ).toBeTrue()
    expect(
      inputSnapshots.some(
        (event) => event.data.text === 'skipped-change'
      )
    ).toBeTrue()

    emittedRecords.length = 0
    // Reordering hosts must not rotate observation membership: every root is
    // part of the next baseline as well.
    container.appendChild(shadowHosts[0])
    recorder.takeSubsequentFullSnapshot(1600)
    // Native shadow queues are reset in bounded pages before publishing the
    // baseline. This fixture deliberately spans two pages.
    recorder.flushScheduledFullSnapshot()
    expect(
      emittedRecords.some(
        (event) => event.type === RecordType.FullSnapshot
      )
    ).toBeTrue()
    while (recorder.shadowRootsController.flush() === 'pending') {}
    expect(onFullSnapshotFailure).not.toHaveBeenCalled()
    expect(
      recorder.getSerializedNodeIdForDebug(shadowInputs[0])
    ).toEqual(jasmine.any(Number))
    expect(
      recorder.getSerializedNodeIdForDebug(
        shadowInputs[SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT]
      )
    ).toEqual(jasmine.any(Number))

    emittedRecords.length = 0
    shadowInputs[0].value = 'skipped-after-snapshot'
    shadowInputs[SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT].value =
      'captured-after-snapshot'
    shadowInputs[0].dispatchEvent(
      new Event('input', { bubbles: true, composed: true })
    )
    shadowInputs[0].dispatchEvent(
      new Event('change', { bubbles: true, composed: false })
    )
    shadowInputs[SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT].dispatchEvent(
      new Event('change', { bubbles: true, composed: false })
    )
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Input &&
          event.data.text === 'captured-after-snapshot'
      )
    ).toBeTrue()
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Input &&
          event.data.text === 'skipped-after-snapshot'
      )
    ).toBeTrue()

    snapshotCanvas.calls.reset()
    recorder.snapshotCanvas(shadowCanvases[0])
    recorder.snapshotCanvas(
      shadowCanvases[SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT]
    )
    expect(snapshotCanvas).toHaveBeenCalledTimes(2)
    expect(snapshotCanvas).toHaveBeenCalledWith(
      shadowCanvases[0],
      jasmine.objectContaining({ trigger: 'manual' })
    )
    expect(snapshotCanvas).toHaveBeenCalledWith(
      shadowCanvases[SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT],
      jasmine.objectContaining({ trigger: 'manual' })
    )

    // Moving a node out of a shadow root changes its live ancestor chain
    // before MutationObserver can publish the corresponding add. Its old id
    // must remain unusable until that structural record is emitted.
    emittedRecords.length = 0
    snapshotCanvas.calls.reset()
    container.appendChild(escapedInput)
    container.appendChild(escapedCanvas)
    escapedInput.value = 'before-published-add'
    escapedInput.dispatchEvent(
      new Event('input', { bubbles: true, composed: true })
    )
    recorder.snapshotCanvas(escapedCanvas)
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Input &&
          event.data.text === 'before-published-add'
      )
    ).toBeFalse()
    expect(snapshotCanvas).not.toHaveBeenCalled()

    flushAllMutations()
    expect(
      recorder.getSerializedNodeIdForDebug(escapedInput)
    ).toEqual(jasmine.any(Number))
    emittedRecords.length = 0
    escapedInput.value = 'after-published-add'
    escapedInput.dispatchEvent(
      new Event('input', { bubbles: true, composed: true })
    )
    recorder.snapshotCanvas(escapedCanvas)
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Input &&
          event.data.text === 'after-published-add'
      )
    ).toBeTrue()
    expect(snapshotCanvas).toHaveBeenCalledOnceWith(
      escapedCanvas,
      jasmine.objectContaining({ trigger: 'manual' })
    )

    // A later generation must keep both roots active as well.
    container.appendChild(
      shadowHosts[SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT]
    )
    emittedRecords.length = 0
    recorder.takeSubsequentFullSnapshot(1700)
    recorder.flushScheduledFullSnapshot()
    expect(
      recorder.getSerializedNodeIdForDebug(shadowInputs[0])
    ).toEqual(jasmine.any(Number))
    expect(
      recorder.getSerializedNodeIdForDebug(
        shadowInputs[SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT]
      )
    ).toEqual(jasmine.any(Number))

    snapshotCanvas.calls.reset()
    recorder.snapshotCanvas(shadowCanvases[0])
    recorder.snapshotCanvas(
      shadowCanvases[SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT]
    )
    expect(snapshotCanvas).toHaveBeenCalledTimes(2)
    expect(snapshotCanvas).toHaveBeenCalledWith(
      shadowCanvases[0],
      jasmine.objectContaining({ trigger: 'manual' })
    )
    expect(snapshotCanvas).toHaveBeenCalledWith(
      shadowCanvases[SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT],
      jasmine.objectContaining({ trigger: 'manual' })
    )

    recorder.stop()
    emittedRecords.length = 0
    shadowInputs[0].value = 'after-stop'
    outerElement.setAttribute('data-after-stop', 'ignored')
    recorder.flushMutations()
    expect(emittedRecords).toEqual([])
  })

  it('should keep a removed node unpublished until its re-add mutation is emitted', () => {
    const input = document.createElement('input')
    container.appendChild(input)
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })

    emittedRecords.length = 0
    input.remove()
    recorder.flushMutations()
    expect(recorder.getSerializedNodeIdForDebug(input)).toBeUndefined()

    container.appendChild(input)
    input.value = 'before-readd'
    input.dispatchEvent(
      new Event('input', { bubbles: true, composed: true })
    )
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Input &&
          event.data.text === 'before-readd'
      )
    ).toBeFalse()

    recorder.flushMutations()
    expect(
      recorder.getSerializedNodeIdForDebug(input)
    ).toEqual(jasmine.any(Number))

    emittedRecords.length = 0
    input.value = 'after-readd'
    input.dispatchEvent(
      new Event('input', { bubbles: true, composed: true })
    )
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Input &&
          event.data.text === 'after-readd'
      )
    ).toBeTrue()

    recorder.stop()
  })

  it('should restore published nodes after pending mutation tokens are canceled, reset, or refreshed', () => {
    const resetInput = document.createElement('input')
    const canceledInput = document.createElement('input')
    const refreshedInput = document.createElement('input')
    container.appendChild(resetInput)
    container.appendChild(canceledInput)
    container.appendChild(refreshedInput)

    let observerOptions
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration,
      lifeCycle: createLifeCycle(),
      initObservers: function (options) {
        observerOptions = options
        return {
          flush: function () {},
          reset: function () {},
          stop: function () {}
        }
      }
    })
    const publishedIds = {
      reset: recorder.getSerializedNodeIdForDebug(resetInput),
      canceled: recorder.getSerializedNodeIdForDebug(canceledInput),
      refreshed: recorder.getSerializedNodeIdForDebug(refreshedInput)
    }
    const mutationTasksController = createMutationTasksController(
      observerOptions.mutationCb,
      configuration,
      observerOptions.shadowRootsController,
      observerOptions.mutationPerfCb,
      observerOptions.mutationOverflowCb,
      observerOptions.mutationNodeSerializationCb,
      observerOptions.isNodeIgnored
    )
    const addPendingRootTask = function (node) {
      return mutationTasksController.addPendingRootTask(node, {
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController: observerOptions.shadowRootsController
        },
        configuration
      })
    }

    try {
      expect(addPendingRootTask(resetInput)).toBeTrue()
      expect(recorder.getSerializedNodeIdForDebug(resetInput)).toBeUndefined()
      mutationTasksController.reset()
      expect(recorder.getSerializedNodeIdForDebug(resetInput)).toBe(
        publishedIds.reset
      )

      expect(addPendingRootTask(canceledInput)).toBeTrue()
      const canceledTask =
        mutationTasksController.findPendingRootTask(canceledInput)
      expect(
        recorder.getSerializedNodeIdForDebug(canceledInput)
      ).toBeUndefined()
      canceledInput.remove()
      expect(
        mutationTasksController.handlePendingRootRemoval(
          canceledTask,
          canceledInput
        )
      ).toBeTrue()
      container.appendChild(canceledInput)
      expect(recorder.getSerializedNodeIdForDebug(canceledInput)).toBe(
        publishedIds.canceled
      )

      const pendingRoot = document.createElement('section')
      container.appendChild(pendingRoot)
      pendingRoot.appendChild(refreshedInput)
      expect(addPendingRootTask(pendingRoot)).toBeTrue()
      const refreshedTask =
        mutationTasksController.findPendingRootTask(pendingRoot)
      expect(
        refreshedTask.serializerTask.advance(Infinity, 5000, 200000)
      ).toBeTrue()
      expect(
        recorder.getSerializedNodeIdForDebug(refreshedInput)
      ).toBeUndefined()

      container.appendChild(refreshedInput)
      expect(
        mutationTasksController.refreshPendingRootTask(refreshedTask)
      ).toBeTrue()
      expect(recorder.getSerializedNodeIdForDebug(refreshedInput)).toBe(
        publishedIds.refreshed
      )
    } finally {
      mutationTasksController.stop()
      recorder.stop()
    }
  })

  it('should exclude stale ids from mutations and next-sibling placement after a new baseline', () => {
    const parent = document.createElement('div')
    const staleLink = document.createElement('link')
    staleLink.rel = 'canonical'
    const stableSibling = document.createElement('span')
    parent.appendChild(staleLink)
    parent.appendChild(stableSibling)
    container.appendChild(parent)
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    const staleId = recorder.getSerializedNodeIdForDebug(staleLink)
    expect(staleId).toEqual(jasmine.any(Number))

    // An icon link is intentionally absent from the replacement baseline, but
    // its process-wide serializer id still exists.
    staleLink.rel = 'icon'
    recorder.takeSubsequentFullSnapshot(1800)
    expect(recorder.getSerializedNodeIdForDebug(staleLink)).toBeUndefined()
    const stableSiblingId =
      recorder.getSerializedNodeIdForDebug(stableSibling)

    emittedRecords.length = 0
    staleLink.setAttribute('data-stale', 'ignored')
    recorder.flushMutations()
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.attributes.some(
            (attributeMutation) => attributeMutation.id === staleId
          )
      )
    ).toBeFalse()

    const inserted = document.createElement('strong')
    parent.insertBefore(inserted, staleLink)
    recorder.flushMutations()
    const insertedId = recorder.getSerializedNodeIdForDebug(inserted)
    const insertedAdd = emittedRecords
      .filter(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
      )
      .flatMap((event) => event.data.adds)
      .find((add) => add.node.id === insertedId)
    expect(insertedAdd).toEqual(
      jasmine.objectContaining({
        nextId: stableSiblingId
      })
    )
    expect(insertedAdd.nextId).not.toBe(staleId)

    emittedRecords.length = 0
    staleLink.remove()
    recorder.flushMutations()
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.removes.some((remove) => remove.id === staleId)
      )
    ).toBeFalse()

    recorder.stop()
  })

  it('should time-slice a large subsequent full snapshot before emitting one ordered baseline', () => {
    for (let index = 0; index < 120; index += 1) {
      const child = document.createElement('span')
      child.setAttribute('data-index', String(index))
      container.appendChild(child)
    }
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0
    jasmine.clock().install()
    let now = 0
    spyOn(performance, 'now').and.callFake(() => now++)

    try {
      recorder.takeSubsequentFullSnapshot(2345)

      expect(
        emittedRecords.some(
          (event) => event.type === RecordType.FullSnapshot
        )
      ).toBeFalse()

      jasmine.clock().tick(1)

      expect(
        emittedRecords
          .filter(
            (event) =>
              event.timestamp === 2345 &&
              (event.type === RecordType.Meta ||
                event.type === RecordType.Focus ||
                event.type === RecordType.FullSnapshot)
          )
          .map((event) => event.type)
      ).toEqual([RecordType.Meta, RecordType.Focus, RecordType.FullSnapshot])
    } finally {
      recorder.stop()
      jasmine.clock().uninstall()
    }
  })

  it('should not count time spent waiting in the background against the full snapshot budget', () => {
    for (let index = 0; index < 120; index += 1) {
      container.appendChild(document.createElement('span'))
    }
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0
    jasmine.clock().install()
    let now = 0
    spyOn(performance, 'now').and.callFake(() => now)

    try {
      recorder.scheduleSubsequentFullSnapshot(2350)
      // Simulate a timer frozen while the document is hidden. Serialization
      // itself still stays within one short active slice after resume.
      now = 5000
      jasmine.clock().tick(1)

      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.FullSnapshot && event.timestamp === 2350
        )
      ).toBeTrue()
    } finally {
      recorder.stop()
      jasmine.clock().uninstall()
    }
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
    expect(replayPerformance.mutationSerializationCount).toBeGreaterThan(0)
    expect(
      replayPerformance.mutationSerializationDuration
    ).toBeGreaterThanOrEqual(0)
    expect(replayPerformance.mutationCallbackCount).toBeGreaterThan(0)
    expect(replayPerformance.mutationRecordCount).toBeGreaterThan(0)
    expect(replayPerformance.mutationAddCount).toBeGreaterThan(0)
    expect(replayPerformance.fullSnapshotCount).toBe(1)
    expect(replayPerformance.fullSnapshotDuration).toBeGreaterThanOrEqual(0)
  })

  it('should accumulate local mutation root drops and expose the last reason', () => {
    let observerOptions
    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      initObservers: function (options) {
        observerOptions = options
        return {
          flush: function () {},
          reset: function () {},
          stop: function () {}
        }
      }
    })

    try {
      observerOptions.mutationPerfCb({
        mutationLocalDropCount: 1,
        mutationLocalDropReason: 'mutation_root_admission_watermark'
      })
      observerOptions.mutationPerfCb({
        mutationLocalDropCount: 1,
        mutationLocalDropReason:
          'mutation_root_retained_bytes_watermark'
      })

      expect(recorder.getReplayPerformanceForDebug()).toEqual(
        jasmine.objectContaining({
          mutationLocalDropCount: 2,
          mutationLocalDropLastReason:
            'mutation_root_retained_bytes_watermark'
        })
      )
    } finally {
      recorder.stop()
    }
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

  it('should expose a bounded summary for dynamic div add mutations', () => {
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
    const summarizedAdd = lastDomMutation.adds.find(function (add) {
      return add && add.node && add.node.tagName === 'div'
    })
    expect(summarizedAdd.node.type).toBe(2)
    expect(summarizedAdd.node.attributes).toBeUndefined()
    expect(summarizedAdd.node.childNodes).toBeUndefined()
  })

  it('should retain and clone only bounded DOM mutation summaries', () => {
    const recorder = record({
      emit: () => {},
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })

    for (let index = 0; index < 8; index += 1) {
      const child = document.createElement('article')
      child.setAttribute('data-large', 'x'.repeat(1000))
      child.textContent = 'y'.repeat(1000)
      container.appendChild(child)
    }
    recorder.flushMutations()

    const firstRead = recorder.getLastDomMutationForDebug()
    expect(firstRead.addsCount).toBe(8)
    expect(firstRead.adds.length).toBe(5)
    firstRead.adds.forEach((add) => {
      expect(add.node.attributes).toBeUndefined()
      expect(add.node.childNodes).toBeUndefined()
    })
    expect(JSON.stringify(firstRead).length).toBeLessThan(2000)

    firstRead.adds[0].node.tagName = 'changed'
    const secondRead = recorder.getLastDomMutationForDebug()
    expect(secondRead.adds[0].node.tagName).toBe('article')
    expect(recorder.getDomMutationHistoryForDebug()).toEqual([secondRead])
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

  it('should replace an oversized new subtree with a baseline and keep tracking it', () => {
    jasmine.clock().install()
    spyOn(performance, 'now').and.returnValue(0)
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    const largeRoot = document.createElement('section')
    largeRoot.setAttribute('data-large-root', 'ready')
    const descendants = document.createDocumentFragment()
    for (let index = 0; index < 5001; index += 1) {
      descendants.appendChild(document.createElement('i'))
    }
    largeRoot.appendChild(descendants)
    container.appendChild(largeRoot)

    expect(recorder.flushMutations()).toBeFalse()
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
      )
    ).toBeFalse()

    jasmine.clock().tick(1)
    const replacementSnapshots = emittedRecords.filter(
      (event) => event.type === RecordType.FullSnapshot
    )
    expect(replacementSnapshots.length).toBe(1)
    const pendingNodes = [replacementSnapshots[0].data.node]
    let serializedLargeRoot
    while (pendingNodes.length && !serializedLargeRoot) {
      const serializedNode = pendingNodes.pop()
      if (
        serializedNode.attributes &&
        serializedNode.attributes['data-large-root'] === 'ready'
      ) {
        serializedLargeRoot = serializedNode
      } else if (serializedNode.childNodes) {
        pendingNodes.push(...serializedNode.childNodes)
      }
    }
    expect(serializedLargeRoot).toBeDefined()

    largeRoot.setAttribute('data-after-baseline', 'captured')
    recorder.flushMutations()
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.attributes.some(
            (attributeMutation) =>
              attributeMutation.attributes['data-after-baseline'] ===
              'captured'
          )
      )
    ).toBeTrue()

    recorder.stop()
    jasmine.clock().uninstall()
  })

  it('should discard pending mutation work superseded by a subsequent full snapshot', () => {
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
      (event) => event.type === RecordType.FullSnapshot
    )

    expect(mutationSnapshots.length).toBe(0)
    expect(fullSnapshots.length).toBe(1)
    expect(fullSnapshots[0].timestamp).toBeGreaterThanOrEqual(4321)
  })

  it('should defer lifecycle full snapshots and coalesce them to the latest view', () => {
    jasmine.clock().install()
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    recorder.scheduleSubsequentFullSnapshot(1000)
    recorder.scheduleSubsequentFullSnapshot(2000)
    recorder.scheduleSubsequentFullSnapshot(1500)

    expect(
      emittedRecords.some((event) => event.type === RecordType.FullSnapshot)
    ).toBeFalse()

    jasmine.clock().tick(1)

    const fullSnapshots = emittedRecords.filter(
      (event) => event.type === RecordType.FullSnapshot
    )
    expect(fullSnapshots.length).toBe(1)
    expect(fullSnapshots[0].timestamp).toBe(2000)
    jasmine.clock().uninstall()
  })

  it('should preserve a mandatory transaction deadline across a raw take', () => {
    jasmine.clock().install()
    let performanceTime = 0
    spyOn(performance, 'now').and.callFake(() => performanceTime)
    let serializerTaskCount = 0
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    const onMandatoryFullSnapshotStarted = jasmine.createSpy(
      'onMandatoryFullSnapshotStarted'
    )
    const onMandatoryFullSnapshotAbandoned = jasmine.createSpy(
      'onMandatoryFullSnapshotAbandoned'
    )
    let recorder

    try {
      recorder = record({
        emit: function () {
          return true
        },
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        lifeCycle: createLifeCycle(),
        onFullSnapshotFailure,
        $rOnMandatoryFullSnapshotStarted:
          onMandatoryFullSnapshotStarted,
        $rOnMandatoryFullSnapshotAbandoned:
          onMandatoryFullSnapshotAbandoned,
        $rCreateFullSnapshotSerializerTask: function () {
          serializerTaskCount += 1
          return {
            serializedNode: {
              type: 0,
              id: serializerTaskCount,
              childNodes: []
            },
            processedNodeCount: 1,
            approxBytes: 1,
            advance: function () {
              return serializerTaskCount === 1
            }
          }
        }
      })

      recorder.scheduleSubsequentFullSnapshot(5000, false, true)
      performanceTime = 29000
      recorder.takeSubsequentFullSnapshot(5001)

      expect(onMandatoryFullSnapshotStarted).toHaveBeenCalledTimes(1)
      performanceTime = 30001
      expect(recorder.flushScheduledFullSnapshot()).toBeTrue()
      expect(onFullSnapshotFailure).toHaveBeenCalledOnceWith(
        'full_snapshot_serialization_timeout'
      )
      expect(onMandatoryFullSnapshotAbandoned).toHaveBeenCalledTimes(1)
    } finally {
      if (recorder) {
        recorder.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should abandon discardable recovery when replacement requests exhaust the restart budget', () => {
    const emittedRecords = []
    const resetCanvasObserver = jasmine.createSpy('resetCanvasObserver')
    const onFullSnapshotFailure = jasmine.createSpy('onFullSnapshotFailure')
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      onFullSnapshotFailure,
      createCanvasObserver: function () {
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: resetCanvasObserver,
          stop: jasmine.createSpy('stop')
        }
      }
    })
    emittedRecords.length = 0

    let nextTimerId = 0
    const scheduledTimers = []
    spyOn(window, 'setTimeout').and.callFake((callback) => {
      const timer = {
        callback,
        cancelled: false,
        id: ++nextTimerId
      }
      scheduledTimers.push(timer)
      return timer.id
    })
    spyOn(window, 'clearTimeout').and.callFake((timerId) => {
      const timer = scheduledTimers.find((entry) => entry.id === timerId)
      if (timer) {
        timer.cancelled = true
      }
    })

    function runNextTimer() {
      while (scheduledTimers.length) {
        const timer = scheduledTimers.shift()
        if (!timer.cancelled) {
          timer.callback()
          return
        }
      }
      fail('expected a pending full snapshot timer')
    }

    try {
      recorder.scheduleSubsequentFullSnapshot(5000, true)
      for (let requestIndex = 0; requestIndex < 4; requestIndex += 1) {
        recorder.scheduleSubsequentFullSnapshot(
          5001 + requestIndex,
          true
        )
        runNextTimer()
      }

      expect(onFullSnapshotFailure).not.toHaveBeenCalled()
      // The initial attempt and each admitted restart get a fresh canvas
      // generation. Exhaustion then resets once more while restoring the
      // pre-transaction Canvas baseline.
      expect(resetCanvasObserver).toHaveBeenCalledTimes(5)
      expect(
        emittedRecords.some(
          (event) => event.type === RecordType.FullSnapshot
        )
      ).toBeFalse()

      const laterChild = document.createElement('span')
      laterChild.setAttribute('data-after-restart-budget', 'captured')
      container.appendChild(laterChild)
      recorder.flushMutations()
      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.Mutation &&
            event.data.adds.some(
              (add) =>
                add.node &&
                add.node.attributes &&
                add.node.attributes['data-after-restart-budget'] ===
                  'captured'
            )
        )
      ).toBeTrue()
    } finally {
      recorder.stop()
    }
  })

  it('should bound the synchronous fallback and keep waiting for a quiet baseline', () => {
    const emittedRecords = []
    const onFullSnapshotFailure = jasmine.createSpy('onFullSnapshotFailure')
    let observerOptions
    let serializerTaskCount = 0
    let completeNextTask = false
    let pendingAdvanceCount = 0
    let consumeAdvanceDeadline = false
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      onFullSnapshotFailure,
      initObservers: function (options) {
        observerOptions = options
        return {
          stop: function () {},
          flush: function () {},
          reset: function () {}
        }
      },
      $rCreateFullSnapshotSerializerTask: function () {
        serializerTaskCount += 1
        return {
          serializedNode: {
            type: 0,
            id: serializerTaskCount,
            childNodes: []
          },
          processedNodeCount: 1,
          approxBytes: 128,
          advance: function (deadline) {
            if (consumeAdvanceDeadline) {
              performanceTime = deadline
            }
            if (serializerTaskCount === 1 || completeNextTask) {
              return true
            }
            pendingAdvanceCount += 1
            return false
          }
        }
      }
    })
    emittedRecords.length = 0

    let nextTimerId = 0
    const scheduledTimers = []
    spyOn(window, 'setTimeout').and.callFake((callback, delay) => {
      const timer = {
        callback,
        cancelled: false,
        delay,
        id: ++nextTimerId
      }
      scheduledTimers.push(timer)
      return timer.id
    })
    spyOn(window, 'clearTimeout').and.callFake((timerId) => {
      const timer = scheduledTimers.find((entry) => entry.id === timerId)
      if (timer) {
        timer.cancelled = true
      }
    })
    let performanceTime = 0
    spyOn(performance, 'now').and.callFake(() => performanceTime)

    function runNextTimerWithDelay(delay) {
      const timer = scheduledTimers.find(
        (entry) => !entry.cancelled && entry.delay === delay
      )
      expect(timer).toBeDefined()
      timer.cancelled = true
      timer.callback()
    }

    try {
      recorder.scheduleSubsequentFullSnapshot(5050, false, true)
      for (let requestIndex = 0; requestIndex < 4; requestIndex += 1) {
        recorder.scheduleSubsequentFullSnapshot(
          5051 + requestIndex,
          false,
          true
        )
        runNextTimerWithDelay(0)
      }

      expect(onFullSnapshotFailure).not.toHaveBeenCalled()
      expect(
        scheduledTimers.some(
          (timer) => !timer.cancelled && timer.delay === 250
        )
      ).toBeTrue()

      for (let churnIndex = 0; churnIndex < 4; churnIndex += 1) {
        observerOptions.mutationActivityCb(container)
        performanceTime += 251
        if (churnIndex === 3) {
          completeNextTask = true
        }
        runNextTimerWithDelay(250)
      }

      expect(onFullSnapshotFailure).not.toHaveBeenCalled()
      expect(serializerTaskCount).toBe(6)
      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.FullSnapshot &&
            event.timestamp === 5054
        )
      ).toBeTrue()

      completeNextTask = false
      pendingAdvanceCount = 0
      recorder.scheduleSubsequentFullSnapshot(5060, false, true)
      for (let requestIndex = 0; requestIndex < 4; requestIndex += 1) {
        recorder.scheduleSubsequentFullSnapshot(
          5061 + requestIndex,
          false,
          true
        )
        runNextTimerWithDelay(0)
      }
      for (let churnIndex = 0; churnIndex < 4; churnIndex += 1) {
        observerOptions.mutationActivityCb(container)
        performanceTime += 251
        let synchronousStartedAt
        if (churnIndex === 3) {
          consumeAdvanceDeadline = true
          synchronousStartedAt = performanceTime
        }
        runNextTimerWithDelay(250)
        if (churnIndex === 3) {
          // The non-yielding fallback gets three 4 ms slices and may not
          // consume more than the single-frame 12 ms budget.
          expect(performanceTime - synchronousStartedAt).toBe(12)
        }
      }

      expect(pendingAdvanceCount).toBe(3)
      expect(onFullSnapshotFailure).not.toHaveBeenCalled()
      expect(
        scheduledTimers.some(
          (timer) => !timer.cancelled && timer.delay === 250
        )
      ).toBeTrue()

      consumeAdvanceDeadline = false
      completeNextTask = true
      runNextTimerWithDelay(250)
      expect(onFullSnapshotFailure).not.toHaveBeenCalled()
      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.FullSnapshot &&
            event.timestamp === 5064
        )
      ).toBeTrue()

      completeNextTask = false
      pendingAdvanceCount = 0
      recorder.scheduleSubsequentFullSnapshot(5070, false, true)
      const finalTransactionStartedAt = performanceTime
      for (let requestIndex = 0; requestIndex < 4; requestIndex += 1) {
        recorder.scheduleSubsequentFullSnapshot(
          5071 + requestIndex,
          false,
          true
        )
        runNextTimerWithDelay(0)
      }
      for (let churnIndex = 0; churnIndex < 4; churnIndex += 1) {
        observerOptions.mutationActivityCb(container)
        performanceTime += 251
        if (churnIndex === 3) {
          consumeAdvanceDeadline = true
        }
        runNextTimerWithDelay(250)
      }

      expect(onFullSnapshotFailure).not.toHaveBeenCalled()
      performanceTime = finalTransactionStartedAt + 30001
      observerOptions.mutationActivityCb(container)
      runNextTimerWithDelay(250)
      expect(onFullSnapshotFailure).toHaveBeenCalledOnceWith(
        'full_snapshot_serialization_timeout'
      )
    } finally {
      recorder.stop()
    }
  })

  it('should preserve active serialization time across a quiet-window retry', () => {
    let performanceTime = 0
    spyOn(performance, 'now').and.callFake(() => performanceTime)
    let serializerTaskCount = 0
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    const recorder = record({
      emit: function () {
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      onFullSnapshotFailure,
      $rCreateFullSnapshotSerializerTask: function () {
        serializerTaskCount += 1
        return {
          serializedNode: {
            type: 0,
            id: serializerTaskCount,
            childNodes: []
          },
          processedNodeCount: 1,
          approxBytes: 1,
          advance: function () {
            if (serializerTaskCount === 1) {
              return true
            }
            if (serializerTaskCount === 2) {
              performanceTime += 600
            } else if (serializerTaskCount === 6) {
              performanceTime += 401
            }
            return false
          }
        }
      }
    })

    let nextTimerId = 0
    const scheduledTimers = []
    spyOn(window, 'setTimeout').and.callFake((callback, delay) => {
      const timer = {
        callback,
        cancelled: false,
        delay,
        id: ++nextTimerId
      }
      scheduledTimers.push(timer)
      return timer.id
    })
    spyOn(window, 'clearTimeout').and.callFake((timerId) => {
      const timer = scheduledTimers.find((entry) => entry.id === timerId)
      if (timer) {
        timer.cancelled = true
      }
    })

    function runNextTimerWithDelay(delay) {
      const timer = scheduledTimers.find(
        (entry) => !entry.cancelled && entry.delay === delay
      )
      expect(timer).toBeDefined()
      timer.cancelled = true
      timer.callback()
    }

    try {
      recorder.scheduleSubsequentFullSnapshot(5080, false, true)
      runNextTimerWithDelay(0)
      for (let requestIndex = 0; requestIndex < 4; requestIndex += 1) {
        recorder.scheduleSubsequentFullSnapshot(
          5081 + requestIndex,
          false,
          true
        )
        runNextTimerWithDelay(0)
      }

      expect(onFullSnapshotFailure).not.toHaveBeenCalled()
      runNextTimerWithDelay(250)
      expect(onFullSnapshotFailure).toHaveBeenCalledOnceWith(
        'full_snapshot_serialization_timeout'
      )
    } finally {
      recorder.stop()
    }
  })

  it('should capture same-task DOM mutation before an optional snapshot flush', () => {
    jasmine.clock().install()
    const emittedRecords = []
    const onFullSnapshotFailure = jasmine.createSpy('onFullSnapshotFailure')
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      onFullSnapshotFailure
    })
    emittedRecords.length = 0

    try {
      recorder.scheduleSubsequentFullSnapshot(5100, true)
      container.setAttribute('data-mutated-during-snapshot', 'true')
      expect(recorder.flushScheduledFullSnapshot()).toBeTrue()

      expect(onFullSnapshotFailure).not.toHaveBeenCalled()
      const fullSnapshots = emittedRecords.filter(
        (event) => event.type === RecordType.FullSnapshot
      )
      expect(fullSnapshots.length).toBe(1)
      expect(JSON.stringify(fullSnapshots[0])).toContain(
        'data-mutated-during-snapshot'
      )
    } finally {
      recorder.stop()
      jasmine.clock().uninstall()
    }
  })

  it('should keep admitted old-tail records and reset canvas baselines when a full snapshot restarts', () => {
    jasmine.clock().install()
    const emittedRecords = []
    let emitRecord
    const canvasObserverReset = jasmine.createSpy('canvasObserverReset')
    const canvasCommandCaptureReset = jasmine.createSpy(
      'canvasCommandCaptureReset'
    )
    const canvasWebGLSnapshotObserverReset = jasmine.createSpy(
      'canvasWebGLSnapshotObserverReset'
    )
    const canvasSnapshotLoopReset = jasmine.createSpy(
      'canvasSnapshotLoopReset'
    )
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        emitRecord = options.emit
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: canvasObserverReset,
          stop: jasmine.createSpy('stop')
        }
      },
      startCanvasCommandCapture: function () {
        return {
          reset: canvasCommandCaptureReset,
          stop: jasmine.createSpy('stop')
        }
      },
      startCanvasWebGLSnapshotObserver: function () {
        return {
          reset: canvasWebGLSnapshotObserverReset,
          stop: jasmine.createSpy('stop')
        }
      },
      startContinuousCanvasSnapshotLoop: function () {
        return {
          reset: canvasSnapshotLoopReset,
          stop: jasmine.createSpy('stop')
        }
      }
    })
    emittedRecords.length = 0

    const canvasRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 1001,
      data: {
        source: IncrementalSource.CanvasMutation,
        id: 1,
        commands: []
      }
    }
    const scrollRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 1002,
      data: {
        source: IncrementalSource.Scroll,
        id: 1,
        x: 0,
        y: 10
      }
    }

    recorder.scheduleSubsequentFullSnapshot(1000)
    expect(canvasObserverReset).toHaveBeenCalledTimes(1)
    expect(canvasCommandCaptureReset).toHaveBeenCalledTimes(1)
    expect(canvasWebGLSnapshotObserverReset).toHaveBeenCalledTimes(1)
    expect(canvasSnapshotLoopReset).toHaveBeenCalledTimes(1)
    emitRecord(canvasRecord)
    emitRecord(scrollRecord)
    container.appendChild(document.createElement('div'))
    recorder.flushMutations()

    expect(emittedRecords).toEqual([canvasRecord, scrollRecord])

    jasmine.clock().tick(1)

    const fullSnapshotIndex = emittedRecords.findIndex(
      (event) => event.type === RecordType.FullSnapshot
    )
    const canvasRecordIndex = emittedRecords.indexOf(canvasRecord)
    const scrollRecordIndex = emittedRecords.indexOf(scrollRecord)
    const mutationRecords = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )

    expect(fullSnapshotIndex).toBeGreaterThanOrEqual(0)
    expect(canvasRecordIndex).toBeLessThan(fullSnapshotIndex)
    expect(scrollRecordIndex).toBeLessThan(fullSnapshotIndex)
    expect(mutationRecords).toEqual([])
    expect(canvasObserverReset).toHaveBeenCalledTimes(2)
    expect(canvasCommandCaptureReset).toHaveBeenCalledTimes(2)
    expect(canvasWebGLSnapshotObserverReset).toHaveBeenCalledTimes(2)
    expect(canvasSnapshotLoopReset).toHaveBeenCalledTimes(2)

    recorder.stop()
    jasmine.clock().uninstall()
  })

  it('should admit old-tail non-DOM records before a synchronous subsequent full snapshot', () => {
    jasmine.clock().install()
    const emittedRecords = []
    let emitRecord
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        emitRecord = options.emit
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: jasmine.createSpy('reset'),
          stop: jasmine.createSpy('stop')
        }
      }
    })
    emittedRecords.length = 0

    const interactionRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 2001,
      data: {
        source: IncrementalSource.MouseInteraction,
        id: 1,
        type: 0
      }
    }

    recorder.scheduleSubsequentFullSnapshot(1000)
    emitRecord(interactionRecord)
    recorder.takeSubsequentFullSnapshot(2000)

    const fullSnapshotIndex = emittedRecords.findIndex(
      (event) => event.type === RecordType.FullSnapshot
    )
    expect(fullSnapshotIndex).toBeGreaterThanOrEqual(0)
    expect(emittedRecords.indexOf(interactionRecord)).toBeLessThan(
      fullSnapshotIndex
    )

    jasmine.clock().tick(1)
    expect(
      emittedRecords.filter((event) => event.type === RecordType.FullSnapshot)
        .length
    ).toBe(1)

    recorder.stop()
    jasmine.clock().uninstall()
  })

  it('should retry previous-tail Canvas records in order before the baseline', () => {
    jasmine.clock().install()
    const emittedRecords = []
    let emitRecord
    let admissionBlocked = true
    const recorder = record({
      emit: (event) => {
        if (
          admissionBlocked &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.CanvasMutation
        ) {
          return false
        }
        emittedRecords.push(event)
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        emitRecord = options.emit
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: jasmine.createSpy('reset'),
          stop: jasmine.createSpy('stop')
        }
      }
    })
    emittedRecords.length = 0
    const canvasRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 2001,
      data: {
        source: IncrementalSource.CanvasMutation,
        id: 1,
        commands: []
      }
    }
    const scrollRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 2002,
      data: {
        source: IncrementalSource.Scroll,
        id: 1,
        x: 0,
        y: 20
      }
    }

    recorder.scheduleSubsequentFullSnapshot(2000)
    emitRecord(canvasRecord)
    recorder.takeSubsequentFullSnapshot(2000)
    emitRecord(scrollRecord)
    const laterChild = document.createElement('div')
    laterChild.setAttribute('data-after-deferred-canvas', 'true')
    container.appendChild(laterChild)
    recorder.flushMutations()

    expect(emittedRecords.indexOf(canvasRecord)).toBe(-1)
    expect(emittedRecords.indexOf(scrollRecord)).toBe(-1)

    admissionBlocked = false
    jasmine.clock().tick(100)

    const fullSnapshotIndex = emittedRecords.findIndex(
      (event) => event.type === RecordType.FullSnapshot
    )
    const canvasRecordIndex = emittedRecords.indexOf(canvasRecord)
    const scrollRecordIndex = emittedRecords.indexOf(scrollRecord)
    const domRecordIndex = emittedRecords.findIndex(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation &&
        event.data.adds.some(
          (add) =>
            add.node &&
            add.node.attributes &&
            add.node.attributes['data-after-deferred-canvas'] === 'true'
        )
    )
    expect(canvasRecordIndex).toBeLessThan(fullSnapshotIndex)
    expect(scrollRecordIndex).toBeGreaterThan(canvasRecordIndex)
    expect(scrollRecordIndex).toBeLessThan(fullSnapshotIndex)
    expect(domRecordIndex).toBe(-1)

    recorder.stop()
    jasmine.clock().uninstall()
  })

  it('should replace a permanently rejected previous-tail Canvas state', () => {
    jasmine.clock().install()
    const canvas = document.createElement('canvas')
    container.appendChild(canvas)
    let emitRecord
    let rejectDeferredCanvas = false
    const snapshot = jasmine.createSpy('snapshot')
    const recorder = record({
      emit: (event) => {
        if (
          rejectDeferredCanvas &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.CanvasMutation
        ) {
          rejectDeferredCanvas = false
          return false
        }
        return true
      },
      $rWasLastEmitBackpressured: () => false,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        emitRecord = options.emit
        return {
          snapshot,
          reset: jasmine.createSpy('reset'),
          stop: jasmine.createSpy('stop')
        }
      }
    })
    snapshot.calls.reset()
    const canvasRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 2101,
      data: {
        source: IncrementalSource.CanvasMutation,
        id: 1,
        commands: []
      }
    }

    recorder.scheduleSubsequentFullSnapshot(2100)
    rejectDeferredCanvas = true
    emitRecord(canvasRecord)
    recorder.takeSubsequentFullSnapshot(2100)

    // The rejected state record makes the candidate mandatory; its Canvas
    // baseline supersedes the missing old-tail state.
    expect(snapshot).toHaveBeenCalled()

    recorder.stop()
    jasmine.clock().uninstall()
  })

  it('should switch an existing canvas context to snapshot fallback across a full snapshot', () => {
    jasmine.clock().install()
    const canvas = document.createElement('canvas')
    container.appendChild(canvas)
    const context = canvas.getContext('2d')
    const emittedRecords = []
    const frameCallbacks = []
    const requestSnapshotFallback = jasmine.createSpy(
      'requestSnapshotFallback'
    )
    let commandRecorder
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function () {
        return {
          snapshot: jasmine
            .createSpy('snapshot')
            .and.returnValue(Promise.resolve({ ok: true })),
          reset: jasmine.createSpy('resetCanvasObserver'),
          stop: jasmine.createSpy('stopCanvasObserver')
        }
      },
      startCanvasCommandCapture: function (options) {
        commandRecorder = createCanvas2DCommandRecorder({
          emit: options.emit,
          getCanvasId: function () {
            return 42
          },
          requestAnimationFrameImpl: function (callback) {
            frameCallbacks.push(callback)
            return frameCallbacks.length
          },
          cancelAnimationFrameImpl: function () {},
          requestSnapshotFallback: requestSnapshotFallback
        })
        return {
          reset: commandRecorder.reset,
          stop: commandRecorder.stop,
          scanExistingCanvases: function () {}
        }
      }
    })
    commandRecorder.patchContext(context)
    emittedRecords.length = 0

    try {
      recorder.scheduleSubsequentFullSnapshot(2000)
      context.fillRect(1, 2, 3, 4)
      frameCallbacks.shift()()

      expect(emittedRecords).toEqual([])
      expect(requestSnapshotFallback).toHaveBeenCalledOnceWith(
        context,
        'canvas_state_reset'
      )

      jasmine.clock().tick(1)
      context.fillRect(5, 6, 7, 8)
      frameCallbacks.shift()()

      const canvasMutations = emittedRecords.filter(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.CanvasMutation
      )
      expect(canvasMutations).toEqual([])
      expect(requestSnapshotFallback).toHaveBeenCalledTimes(2)
      expect(requestSnapshotFallback.calls.mostRecent().args).toEqual([
        context,
        'canvas_state_reset'
      ])
    } finally {
      recorder.stop()
      jasmine.clock().uninstall()
    }
  })

  it('should discard pending canvas commands before a subsequent full snapshot', async () => {
    const emittedRecords = []
    let scheduledFrameCallback
    let releaseBaseline
    const baselinePromise = new Promise((resolve) => {
      releaseBaseline = resolve
    })
    const snapshot = jasmine
      .createSpy('snapshot')
      .and.returnValues(
        baselinePromise,
        Promise.resolve({ ok: true })
      )
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function () {
        return {
          snapshot: snapshot,
          reset: jasmine.createSpy('resetCanvasObserver'),
          stop: jasmine.createSpy('stopCanvasObserver')
        }
      },
      startCanvasCommandCapture: function (options) {
        return startRealCanvasCommandCapture(
          Object.assign({}, options, {
            requestAnimationFrameImpl: function (callback) {
              scheduledFrameCallback = callback
              return 1
            },
            cancelAnimationFrameImpl: jasmine.createSpy(
              'cancelAnimationFrame'
            )
          })
        )
      }
    })
    const canvas = document.createElement('canvas')
    container.appendChild(canvas)
    recorder.flushMutations()
    const context = canvas.getContext('2d')
    emittedRecords.length = 0

    context.setTransform(1, 0, 0, 1, 12, 8)
    context.globalAlpha = 0.25
    expect(scheduledFrameCallback).toEqual(jasmine.any(Function))

    recorder.takeSubsequentFullSnapshot(2200)
    scheduledFrameCallback()
    context.fillRect(0, 0, 5, 5)

    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.FullSnapshot &&
          event.timestamp === 2200
      )
    ).toBeTrue()
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.CanvasMutation &&
          event.data.commands.some(
            (command) =>
              command.property === 'setTransform' ||
              command.property === 'globalAlpha'
          )
      )
    ).toBeFalse()

    expect(snapshot).toHaveBeenCalledTimes(1)
    releaseBaseline({ ok: true })
    await flushPromises()
    await flushPromises()

    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.CanvasMutation &&
          event.data.commands.some(
            (command) =>
              command.property === 'setTransform' ||
              command.property === 'globalAlpha' ||
              command.property === 'fillRect'
          )
      )
    ).toBeFalse()
    recorder.stop()
  })

  it('should resume canvas command capture after abandoning a discardable full snapshot', () => {
    const reset = jasmine.createSpy('resetCanvasCommandCapture')
    const scanExistingCanvases = jasmine.createSpy(
      'scanExistingCanvases'
    )
    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      startCanvasCommandCapture: function () {
        return {
          reset: reset,
          scanExistingCanvases: scanExistingCanvases,
          stop: jasmine.createSpy('stopCanvasCommandCapture')
        }
      }
    })

    expect(scanExistingCanvases).toHaveBeenCalledTimes(1)
    recorder.scheduleSubsequentFullSnapshot(2250, true)
    expect(reset).toHaveBeenCalledTimes(1)

    expect(recorder.flushScheduledFullSnapshot()).toBeTrue()
    expect(scanExistingCanvases).toHaveBeenCalledTimes(2)
    recorder.stop()
  })

  it('should bound records deferred until a full snapshot', () => {
    jasmine.clock().install()
    const emittedRecords = []
    let emitRecord
    let interactionBackpressured = false
    const recorder = record({
      emit: (event) => {
        if (
          interactionBackpressured &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.MouseInteraction
        ) {
          return false
        }
        emittedRecords.push(event)
        return true
      },
      $rWasLastEmitBackpressured: () => interactionBackpressured,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        emitRecord = options.emit
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: jasmine.createSpy('reset'),
          stop: jasmine.createSpy('stop')
        }
      }
    })
    emittedRecords.length = 0

    recorder.scheduleSubsequentFullSnapshot(3000)
    interactionBackpressured = true
    for (let index = 0; index < MAX_DEFERRED_RECORDS + 5; index += 1) {
      emitRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: index,
        data: {
          source: IncrementalSource.MouseInteraction,
          id: index,
          type: 0
        }
      })
    }

    interactionBackpressured = false
    jasmine.clock().tick(1)

    const deferredRecords = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.MouseInteraction
    )
    expect(deferredRecords.length).toBe(MAX_DEFERRED_RECORDS)
    expect(deferredRecords[0].timestamp).toBe(5)
    expect(deferredRecords[deferredRecords.length - 1].timestamp).toBe(
      MAX_DEFERRED_RECORDS + 4
    )

    recorder.stop()
    jasmine.clock().uninstall()
  })

  it('should bound deferred records by bytes as well as count', () => {
    jasmine.clock().install()
    const emittedRecords = []
    let emitRecord
    let interactionBackpressured = false
    const recorder = record({
      emit: (event) => {
        if (
          interactionBackpressured &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.MouseInteraction
        ) {
          return false
        }
        emittedRecords.push(event)
        return true
      },
      $rWasLastEmitBackpressured: () => interactionBackpressured,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        emitRecord = options.emit
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: jasmine.createSpy('reset'),
          stop: jasmine.createSpy('stop')
        }
      }
    })
    emittedRecords.length = 0

    recorder.scheduleSubsequentFullSnapshot(3050)
    interactionBackpressured = true
    for (let index = 0; index < 6; index += 1) {
      emitRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: index,
        data: {
          source: IncrementalSource.MouseInteraction,
          id: index,
          type: 0,
          payload: 'x'.repeat(100000)
        }
      })
    }

    interactionBackpressured = false
    jasmine.clock().tick(1)

    const deferredRecords = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.MouseInteraction
    )
    expect(deferredRecords.length).toBeLessThan(6)
    expect(
      deferredRecords.reduce(
        (bytes, event) => bytes + event.data.payload.length * 2,
        0
      )
    ).toBeLessThanOrEqual(MAX_DEFERRED_RECORD_APPROX_BYTES)
    expect(deferredRecords[deferredRecords.length - 1].timestamp).toBe(5)

    recorder.stop()
    jasmine.clock().uninstall()
  })

  it('should drop a stateless barrier flood without starting a baseline', () => {
    const emittedRecords = []
    let emitRecord
    let admissionBlocked = true
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          admissionBlocked
        ) {
          return false
        }
        if (captureEmits) {
          emittedRecords.push(event)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        emitRecord = options.emit
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: jasmine.createSpy('reset'),
          stop: jasmine.createSpy('stop')
        }
      }
    })
    captureEmits = true

    const pendingNode = document.createElement('div')
    container.appendChild(pendingNode)

    try {
      recorder.flushMutations()
      for (let index = 0; index < MAX_DEFERRED_RECORDS + 5; index += 1) {
        emitRecord({
          type: RecordType.IncrementalSnapshot,
          timestamp: index,
          data: {
            source: IncrementalSource.MouseInteraction,
            id: 1,
            type: 0
          }
        })
      }

      admissionBlocked = false
      recorder.flushMutations()

      expect(
        emittedRecords.filter(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.MouseInteraction
        ).length
      ).toBe(MAX_DEFERRED_RECORDS)
      expect(
        emittedRecords.some(
          (event) => event.type === RecordType.FullSnapshot
        )
      ).toBeFalse()
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()
    } finally {
      recorder.stop()
    }
  })

  it('should recover when deferred input state is evicted', () => {
    const emittedRecords = []
    let emitRecord
    let admissionBlocked = true
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          admissionBlocked
        ) {
          return false
        }
        if (captureEmits) {
          emittedRecords.push(event)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        emitRecord = options.emit
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: jasmine.createSpy('reset'),
          stop: jasmine.createSpy('stop')
        }
      }
    })
    captureEmits = true

    const pendingInput = document.createElement('input')
    container.appendChild(pendingInput)

    try {
      recorder.flushMutations()
      for (let index = 0; index < MAX_DEFERRED_RECORDS + 1; index += 1) {
        emitRecord({
          type: RecordType.IncrementalSnapshot,
          timestamp: index,
          data: {
            source: IncrementalSource.Input,
            id: 1,
            text: String(index)
          }
        })
      }

      admissionBlocked = false
      expect(recorder.flushScheduledFullSnapshot()).toBeTrue()
      expect(
        emittedRecords.some(
          (event) => event.type === RecordType.FullSnapshot
        )
      ).toBeTrue()
      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.Input
        )
      ).toBeFalse()
    } finally {
      recorder.stop()
    }
  })

  it('should emit previous-tail records and the scheduled full snapshot before stop', () => {
    jasmine.clock().install()
    const emittedRecords = []
    let emitRecord
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        emitRecord = options.emit
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: jasmine.createSpy('reset'),
          stop: jasmine.createSpy('stop')
        }
      }
    })
    emittedRecords.length = 0

    recorder.scheduleSubsequentFullSnapshot(4000)
    emitRecord({
      type: RecordType.IncrementalSnapshot,
      timestamp: 4001,
      data: {
        source: IncrementalSource.CanvasMutation,
        id: 1,
        commands: []
      }
    })
    recorder.stop()
    jasmine.clock().tick(1)

    const fullSnapshotIndex = emittedRecords.findIndex(
      (event) => event.type === RecordType.FullSnapshot
    )
    const canvasMutationIndex = emittedRecords.findIndex(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.CanvasMutation
    )
    expect(fullSnapshotIndex).toBeGreaterThanOrEqual(0)
    expect(canvasMutationIndex).toBeLessThan(fullSnapshotIndex)
    expect(
      emittedRecords.filter((event) => event.type === RecordType.FullSnapshot)
        .length
    ).toBe(1)
    jasmine.clock().uninstall()
  })

  it('should flush native mutation records synchronously before stop', () => {
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    const child = document.createElement('div')
    child.setAttribute('data-testid', 'added-before-stop')
    container.appendChild(child)
    recorder.stop()

    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.adds.some(
            (add) =>
              add.node &&
              add.node.attributes &&
              add.node.attributes['data-testid'] === 'added-before-stop'
          )
      )
    ).toBeTrue()
  })

  it('should not start a recovery snapshot when the final stop drain overflows', () => {
    const overflowTargets = []
    for (let index = 0; index < 11; index += 1) {
      const target = document.createElement('div')
      container.appendChild(target)
      overflowTargets.push(target)
    }
    const emittedRecords = []
    const resetCanvasObserver = jasmine.createSpy('resetCanvasObserver')
    const stopCanvasObserver = jasmine.createSpy('stopCanvasObserver')
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function () {
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: resetCanvasObserver,
          stop: stopCanvasObserver
        }
      }
    })
    emittedRecords.length = 0

    for (let index = 0; index < 1001; index += 1) {
      overflowTargets[index % overflowTargets.length].setAttribute(
        `data-stop-overflow-${index}`,
        String(index)
      )
    }
    recorder.stop()

    expect(resetCanvasObserver).not.toHaveBeenCalled()
    expect(stopCanvasObserver).toHaveBeenCalledTimes(1)
    expect(
      emittedRecords.some((event) => event.type === RecordType.FullSnapshot)
    ).toBeFalse()
  })

  it('should publish both sides of a final chunked cross-root move atomically', () => {
    // This assertion covers structural atomicity, not teardown wall time. Keep
    // stop()'s 12 ms boundary deterministic so a busy test host cannot abandon
    // the still-correct transaction before its final normalization chunk.
    spyOn(performance, 'now').and.returnValue(0)
    const destinationHost = document.createElement('div')
    const destinationRoot = destinationHost.attachShadow({ mode: 'open' })
    const child = document.createElement('span')
    const overflowTargets = []
    container.appendChild(destinationHost)
    container.appendChild(child)
    for (let index = 0; index < 11; index += 1) {
      const target = document.createElement('div')
      container.appendChild(target)
      overflowTargets.push(target)
    }

    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    const childId = recorder.getSerializedNodeIdForDebug(child)
    emittedRecords.length = 0

    destinationRoot.appendChild(child)
    for (let index = 0; index < 1001; index += 1) {
      overflowTargets[index % overflowTargets.length].setAttribute(
        `data-cross-root-overflow-${index}`,
        String(index)
      )
    }
    recorder.stop()

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    expect(
      mutationSnapshots.some((event) =>
        event.data.adds.some(
          (add) => add.node && add.node.id === childId
        ) &&
        event.data.removes.some((remove) => remove.id === childId)
      )
    ).toBeTrue()
  })

  it('should stop when a mandatory oversized recovery cannot be serialized', () => {
    const emittedRecords = []
    const resetCanvasObserver = jasmine.createSpy('resetCanvasObserver')
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function () {
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: resetCanvasObserver,
          stop: jasmine.createSpy('stopCanvasObserver')
        }
      },
      onFullSnapshotFailure
    })
    emittedRecords.length = 0
    let now = 0
    spyOn(performance, 'now').and.callFake(() => {
      now += 2
      return now
    })

    const child = document.createElement('div')
    let current = child
    for (let depth = 0; depth < 1000; depth += 1) {
      const nested = document.createElement('div')
      current.appendChild(nested)
      current = nested
    }
    container.appendChild(child)

    recorder.flushMutations()
    expect(resetCanvasObserver).toHaveBeenCalledTimes(1)
    expect(recorder.flushScheduledFullSnapshot()).toBeTrue()
    expect(resetCanvasObserver).toHaveBeenCalledTimes(1)
    expect(onFullSnapshotFailure).toHaveBeenCalled()
    const laterChild = document.createElement('span')
    laterChild.setAttribute('data-after-discard', 'true')
    container.appendChild(laterChild)
    recorder.flushMutations()

    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.adds.some(
            (add) =>
              add.node &&
              add.node.attributes &&
              add.node.attributes['data-after-discard'] === 'true'
          )
      )
    ).toBeFalse()
    expect(
      emittedRecords.some((event) => event.type === RecordType.FullSnapshot)
    ).toBeFalse()
    recorder.stop()
  })

  it('should restore published shadow root observers after an optional snapshot is abandoned', () => {
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const shadowChild = document.createElement('span')
    shadowRoot.appendChild(shadowChild)
    container.appendChild(host)
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    for (let index = 0; index < 300; index += 1) {
      container.appendChild(document.createElement('div'))
    }
    recorder.flushMutations()
    emittedRecords.length = 0
    let now = performance.now()
    spyOn(performance, 'now').and.callFake(() => {
      now += 0.1
      return now
    })
    recorder.scheduleSubsequentFullSnapshot(4000, true)
    expect(recorder.flushScheduledFullSnapshot()).toBeTrue()
    expect(
      emittedRecords.some((event) => event.type === RecordType.FullSnapshot)
    ).toBeFalse()

    shadowChild.setAttribute('data-after-recovery', 'captured')
    recorder.flushMutations()
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.attributes.some(
            (attributeMutation) =>
              attributeMutation.attributes['data-after-recovery'] ===
              'captured'
          )
      )
    ).toBeTrue()

    recorder.stop()
  })

  it('should resume records after abandoning an incomplete scheduled full snapshot', () => {
    const input = document.createElement('input')
    container.appendChild(input)
    for (let index = 0; index < 100; index += 1) {
      container.appendChild(document.createElement('div'))
    }
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    const initialInputId = recorder.getSerializedNodeIdForDebug(input)
    emittedRecords.length = 0
    let now = 0
    const nowSpy = spyOn(performance, 'now').and.callFake(() => {
      now += 2
      return now
    })

    recorder.scheduleSubsequentFullSnapshot(4050, true)
    expect(recorder.getSerializedNodeIdForDebug(input)).toBeUndefined()
    expect(recorder.flushScheduledFullSnapshot()).toBeTrue()
    expect(recorder.getSerializedNodeIdForDebug(input)).toBe(initialInputId)
    nowSpy.and.returnValue(now)

    input.value = 'after-abandoned-baseline'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Input &&
          event.data.text === 'after-abandoned-baseline'
      )
    ).toBeTrue()

    const laterChild = document.createElement('span')
    laterChild.setAttribute('data-after-incomplete-snapshot', 'true')
    container.appendChild(laterChild)
    recorder.flushMutations()

    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.adds.some(
            (add) =>
              add.node &&
              add.node.attributes &&
              add.node.attributes['data-after-incomplete-snapshot'] === 'true'
          )
      )
    ).toBeTrue()
    expect(
      emittedRecords.some((event) => event.type === RecordType.FullSnapshot)
    ).toBeFalse()
    recorder.stop()
  })

  it('should abandon a multi-slice full snapshot without blocking stop', () => {
    const emittedRecords = []
    const onMandatoryFullSnapshotStarted = jasmine.createSpy(
      'onMandatoryFullSnapshotStarted'
    )
    const onMandatoryFullSnapshotAbandoned = jasmine.createSpy(
      'onMandatoryFullSnapshotAbandoned'
    )
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      $rOnMandatoryFullSnapshotStarted:
        onMandatoryFullSnapshotStarted,
      $rOnMandatoryFullSnapshotAbandoned:
        onMandatoryFullSnapshotAbandoned
    })
    emittedRecords.length = 0
    for (let index = 0; index < 300; index += 1) {
      container.appendChild(document.createElement('span'))
    }

    let now = performance.now()
    const nowSpy = spyOn(performance, 'now').and.callFake(() => {
      now += 0.1
      return now
    })
    recorder.scheduleSubsequentFullSnapshot(4060, false, true)
    recorder.stop()

    expect(
      emittedRecords.filter(
        (event) =>
          event.type === RecordType.FullSnapshot &&
          event.timestamp === 4060
      ).length
    ).toBe(0)
    expect(nowSpy.calls.count()).toBeLessThan(60)
    expect(onMandatoryFullSnapshotStarted).toHaveBeenCalledTimes(1)
    expect(onMandatoryFullSnapshotAbandoned).toHaveBeenCalledTimes(1)
  })

  it('should stop instead of restoring an unpublished mandatory tail when recovery initialization throws', () => {
    const emittedRecords = []
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    const onMandatoryFullSnapshotStarted = jasmine.createSpy(
      'onMandatoryFullSnapshotStarted'
    )
    const onMandatoryFullSnapshotAbandoned = jasmine.createSpy(
      'onMandatoryFullSnapshotAbandoned'
    )
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function () {
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: function () {
            throw new Error('canvas reset failed')
          },
          stop: jasmine.createSpy('stop')
        }
      },
      onFullSnapshotFailure,
      $rOnMandatoryFullSnapshotStarted:
        onMandatoryFullSnapshotStarted,
      $rOnMandatoryFullSnapshotAbandoned:
        onMandatoryFullSnapshotAbandoned
    })
    emittedRecords.length = 0

    expect(() =>
      recorder.scheduleSubsequentFullSnapshot(4070, false, true)
    ).not.toThrow()
    expect(onMandatoryFullSnapshotStarted).toHaveBeenCalledTimes(1)
    expect(onMandatoryFullSnapshotAbandoned).toHaveBeenCalledTimes(1)
    expect(onFullSnapshotFailure).toHaveBeenCalledOnceWith(
      'full_snapshot_initialization_error'
    )

    const laterChild = document.createElement('div')
    container.appendChild(laterChild)
    recorder.flushMutations()
    expect(emittedRecords.length).toBe(0)
  })

  it('should stop when a non-discardable snapshot initialization throws', () => {
    const emittedRecords = []
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function () {
        return {
          snapshot: jasmine.createSpy('snapshot'),
          reset: function () {
            throw new Error('canvas reset failed')
          },
          stop: jasmine.createSpy('stop')
        }
      },
      onFullSnapshotFailure
    })

    recorder.scheduleSubsequentFullSnapshot(4071)

    expect(onFullSnapshotFailure).toHaveBeenCalledOnceWith(
      'full_snapshot_initialization_error'
    )
    emittedRecords.length = 0
    const laterChild = document.createElement('div')
    container.appendChild(laterChild)
    recorder.flushMutations()
    expect(emittedRecords).toEqual([])
  })

  it('should stop when an asynchronous full snapshot slice throws', () => {
    jasmine.clock().install()
    const child = document.createElement('div')
    container.appendChild(child)
    const emittedRecords = []
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      onFullSnapshotFailure
    })
    Object.defineProperty(child, 'attributes', {
      configurable: true,
      get: function () {
        throw new Error('attribute serialization failed')
      }
    })

    recorder.scheduleSubsequentFullSnapshot(4072)
    jasmine.clock().tick(1)

    expect(onFullSnapshotFailure).toHaveBeenCalledOnceWith(
      'full_snapshot_serialization_error'
    )
    emittedRecords.length = 0
    child.textContent = 'after failed snapshot'
    recorder.flushMutations()
    expect(emittedRecords).toEqual([])
    jasmine.clock().uninstall()
  })

  it('should replace an overflowing raw mutation batch with a full snapshot', () => {
    jasmine.clock().install()
    const emittedRecords = []
    const overflowTargets = []
    for (let index = 0; index < 11; index += 1) {
      const target = document.createElement('div')
      container.appendChild(target)
      overflowTargets.push(target)
    }
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    for (
      let index = 0;
      index < MAX_QUEUED_MUTATION_RECORDS + 1;
      index += 1
    ) {
      overflowTargets[index % overflowTargets.length].setAttribute(
        `data-overflow-${index}`,
        String(index)
      )
    }
    recorder.flushMutations()

    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
      )
    ).toBeFalse()

    jasmine.clock().tick(1)

    expect(
      emittedRecords.filter((event) => event.type === RecordType.FullSnapshot)
        .length
    ).toBe(1)
    recorder.stop()
    jasmine.clock().uninstall()
  })

  it('should keep recording after atomically admitting a structural replacement at the raw node watermark', () => {
    spyOn(performance, 'now').and.returnValue(0)
    let currentNodes = Array.from(
      { length: MAX_PENDING_MUTATION_NODES / 2 },
      () => {
        const node = document.createElement('span')
        container.appendChild(node)
        return node
      }
    )
    const emittedRecords = []
    const onMandatoryFullSnapshotStarted = jasmine.createSpy(
      'onMandatoryFullSnapshotStarted'
    )
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      $rOnMandatoryFullSnapshotStarted: onMandatoryFullSnapshotStarted
    })
    for (let generation = 0; generation < 2; generation += 1) {
      const removedNodeIds = currentNodes.map((node) =>
        recorder.getSerializedNodeIdForDebug(node)
      )
      emittedRecords.length = 0
      const addedNodes = Array.from(
        { length: MAX_PENDING_MUTATION_NODES / 2 },
        () => document.createElement('i')
      )

      container.replaceChildren(...addedNodes)
      expect(recorder.flushMutations()).toBeTrue()

      const structuralMutations = emittedRecords.filter(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
      )
      expect(structuralMutations.length).toBe(1)
      expect(structuralMutations[0].data.adds.length).toBe(addedNodes.length)
      expect(
        structuralMutations[0].data.removes.map((remove) => remove.id)
      ).toEqual(removedNodeIds)
      expect(
        emittedRecords.some((event) => event.type === RecordType.FullSnapshot)
      ).toBeFalse()
      expect(onMandatoryFullSnapshotStarted).not.toHaveBeenCalled()
      currentNodes = addedNodes
    }

    emittedRecords.length = 0
    const laterNode = document.createElement('strong')
    laterNode.setAttribute('data-after-structural-replacement', 'captured')
    container.appendChild(laterNode)
    expect(recorder.flushMutations()).toBeTrue()
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.adds.some(
            (add) =>
              add.node &&
              add.node.attributes &&
              add.node.attributes['data-after-structural-replacement'] ===
                'captured'
          )
      )
    ).toBeTrue()

    recorder.stop()
  })

  it('should treat mutation overflow metadata as mandatory recovery', () => {
    const emittedRecords = []
    let observerOptions
    const onFullSnapshotFailure = jasmine.createSpy(
      'onFullSnapshotFailure'
    )
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      initObservers: function (options) {
        observerOptions = options
        return {
          stop: function () {},
          flush: function () {
            return true
          },
          reset: function () {}
        }
      },
      onFullSnapshotFailure
    })
    emittedRecords.length = 0

    try {
      observerOptions.mutationOverflowCb({
        reason: 'raw_mutation_queue_watermark',
        mutationRecordCount: MAX_QUEUED_MUTATION_RECORDS + 1
      })

      expect(recorder.flushScheduledFullSnapshot()).toBeTrue()
      expect(onFullSnapshotFailure).not.toHaveBeenCalled()
      expect(
        emittedRecords.some(
          (event) => event.type === RecordType.FullSnapshot
        )
      ).toBeTrue()

      container.setAttribute(
        'data-after-discardable-overflow',
        'captured'
      )
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()
    } finally {
      recorder.stop()
    }
  })

  it('should synchronously flush a scheduled full snapshot without emitting it twice', () => {
    jasmine.clock().install()
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    recorder.scheduleSubsequentFullSnapshot(4100)

    expect(recorder.flushScheduledFullSnapshot()).toBeTrue()
    expect(recorder.flushScheduledFullSnapshot()).toBeFalse()
    jasmine.clock().tick(1)

    expect(
      emittedRecords.filter(
        (event) =>
          event.type === RecordType.FullSnapshot && event.timestamp === 4100
      ).length
    ).toBe(1)

    recorder.stop()
    jasmine.clock().uninstall()
  })

  it('should estimate mutation entries without JSON stringifying subtrees', () => {
    const recorder = record({
      emit: () => {},
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    const stringify = spyOn(JSON, 'stringify').and.callThrough()

    container.appendChild(document.createElement('article'))
    recorder.flushMutations()

    expect(stringify).not.toHaveBeenCalled()
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

  it('should emit batched textContent replacements as one atomic structural snapshot', () => {
    const statusElements = Array.from({ length: 12 }, (_, index) => {
      const statusElement = document.createElement('span')
      statusElement.textContent = `initial-${index}`
      container.appendChild(statusElement)
      return statusElement
    })
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    const initialTextNodeIds = statusElements.map((statusElement) =>
      recorder.getSerializedNodeIdForDebug(statusElement.firstChild)
    )
    const parentIds = statusElements.map((statusElement) =>
      recorder.getSerializedNodeIdForDebug(statusElement)
    )
    emittedRecords.length = 0

    statusElements.forEach((statusElement, index) => {
      statusElement.textContent = `updated-${index}`
    })
    recorder.flushMutations()

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    expect(
      mutationSnapshots.map((event) => ({
        adds: event.data.adds.length,
        removes: event.data.removes.length
      }))
    ).toEqual([{ adds: 12, removes: 12 }])
    expect(
      mutationSnapshots.reduce(
        (removes, event) => removes.concat(event.data.removes),
        []
      ).sort((left, right) => left.parentId - right.parentId)
    ).toEqual(
      initialTextNodeIds
        .map((id, index) => ({
          parentId: parentIds[index],
          id
        }))
        .sort((left, right) => left.parentId - right.parentId)
    )
    expect(
      mutationSnapshots.reduce(
        (adds, event) => adds.concat(event.data.adds),
        []
      )
        .map((add) => ({
          parentId: add.parentId,
          textContent: add.node.textContent
        }))
        .sort((left, right) => left.parentId - right.parentId)
    ).toEqual(
      parentIds
        .map((parentId, index) => ({
          parentId,
          textContent: `updated-${index}`
        }))
        .sort((left, right) => left.parentId - right.parentId)
    )

    recorder.stop()
  })

  it('should emit add then remove callbacks as separate structural snapshots within the merge window', () => {
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    container.appendChild(host)
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    const child = document.createElement('span')
    shadowRoot.appendChild(child)
    expect(recorder.shadowRootsController.flush()).toBeTrue()
    expect(recorder.getSerializedNodeIdForDebug(child)).toBeUndefined()
    child.remove()
    expect(recorder.shadowRootsController.flush()).toBeTrue()
    recorder.flushMutations()

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    expect(mutationSnapshots.length).toBe(2)
    expect(mutationSnapshots[0].data.adds.length).toBe(1)
    expect(mutationSnapshots[0].data.removes).toEqual([])
    expect(mutationSnapshots[1].data.adds).toEqual([])
    expect(mutationSnapshots[1].data.removes).toEqual([
      jasmine.objectContaining({
        id: mutationSnapshots[0].data.adds[0].node.id
      })
    ])
    expect(recorder.getSerializedNodeIdForDebug(child)).toBeUndefined()

    recorder.stop()
  })

  it('should emit a published remove then add as one atomic move within the merge window', () => {
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const child = document.createElement('span')
    shadowRoot.appendChild(child)
    container.appendChild(host)
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    child.remove()
    expect(recorder.shadowRootsController.flush()).toBeTrue()
    shadowRoot.appendChild(child)
    expect(recorder.shadowRootsController.flush()).toBeTrue()
    recorder.flushMutations()

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    expect(mutationSnapshots.length).toBe(1)
    expect(mutationSnapshots[0].data.removes.length).toBe(1)
    expect(mutationSnapshots[0].data.adds).toEqual([
      jasmine.objectContaining({
        node: jasmine.objectContaining({
          id: mutationSnapshots[0].data.removes[0].id
        })
      })
    ])

    recorder.stop()
  })

  it('should keep a later remove separate from an already paired cross-callback move', () => {
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const child = document.createElement('span')
    shadowRoot.appendChild(child)
    container.appendChild(host)
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    child.remove()
    expect(recorder.shadowRootsController.flush()).toBeTrue()
    shadowRoot.appendChild(child)
    expect(recorder.shadowRootsController.flush()).toBeTrue()
    child.remove()
    expect(recorder.shadowRootsController.flush()).toBeTrue()
    recorder.flushMutations()

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    expect(mutationSnapshots.length).toBe(2)
    expect(mutationSnapshots[0].data.removes.length).toBe(1)
    expect(mutationSnapshots[0].data.adds).toEqual([
      jasmine.objectContaining({
        node: jasmine.objectContaining({
          id: mutationSnapshots[0].data.removes[0].id
        })
      })
    ])
    expect(mutationSnapshots[1].data.adds).toEqual([])
    expect(mutationSnapshots[1].data.removes).toEqual([
      jasmine.objectContaining({
        id: mutationSnapshots[0].data.removes[0].id
      })
    ])
    expect(recorder.getSerializedNodeIdForDebug(child)).toBeUndefined()

    recorder.stop()
  })

  it('should atomically merge sibling moves sharing one add token across callbacks', () => {
    const sourceParentA = document.createElement('section')
    const sourceParentB = document.createElement('section')
    const destination = document.createElement('section')
    const movedA = document.createElement('span')
    const movedB = document.createElement('span')
    movedA.textContent = 'a'
    movedB.textContent = 'b'
    sourceParentA.appendChild(movedA)
    sourceParentB.appendChild(movedB)
    container.appendChild(sourceParentA)
    container.appendChild(sourceParentB)
    container.appendChild(destination)

    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const emittedRecords = []
    let observerOptions
    let mutationTasksController
    const recorder = record({
      emit: (event) => {
        emittedRecords.push(event)
        return true
      },
      configuration,
      lifeCycle: createLifeCycle(),
      initObservers: function (options) {
        observerOptions = options
        return {
          flush: function () {},
          reset: function () {
            if (mutationTasksController) {
              mutationTasksController.reset()
            }
          },
          stop: function () {}
        }
      }
    })
    emittedRecords.length = 0
    mutationTasksController = createMutationTasksController(
      observerOptions.mutationCb,
      configuration,
      observerOptions.shadowRootsController,
      observerOptions.mutationPerfCb,
      observerOptions.mutationOverflowCb,
      observerOptions.mutationNodeSerializationCb,
      observerOptions.isNodeIgnored
    )

    const wrapper = document.createElement('div')
    wrapper.appendChild(movedA)
    wrapper.appendChild(movedB)
    destination.appendChild(wrapper)
    const processChildListMutation = function (
      target,
      addedNodes,
      removedNodes
    ) {
      processMutations(
        [
          {
            type: 'childList',
            target,
            addedNodes,
            removedNodes
          }
        ],
        observerOptions.mutationCb,
        configuration,
        observerOptions.shadowRootsController,
        mutationTasksController,
        function () {
          return false
        },
        function () {
          return true
        }
      )
      expect(mutationTasksController.flush()).toBeTrue()
    }

    try {
      // One serialized add root gives both moved descendants the same
      // publication token. Its two source observers report removals later and
      // in separate callbacks.
      processChildListMutation(destination, [wrapper], [])
      processChildListMutation(sourceParentA, [], [movedA])
      processChildListMutation(sourceParentB, [], [movedB])
      recorder.flushMutations()

      const mutationSnapshots = emittedRecords.filter(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
      )
      expect(mutationSnapshots.length).toBe(1)
      expect(mutationSnapshots[0].data.adds.length).toBe(1)
      expect(mutationSnapshots[0].data.removes).toEqual([
        jasmine.objectContaining({
          parentId: recorder.getSerializedNodeIdForDebug(sourceParentA)
        }),
        jasmine.objectContaining({
          parentId: recorder.getSerializedNodeIdForDebug(sourceParentB)
        })
      ])
      expect(
        mutationSnapshots[0].data.removes.map((remove) => remove.id)
      ).toEqual([
        recorder.getSerializedNodeIdForDebug(movedA),
        recorder.getSerializedNodeIdForDebug(movedB)
      ])
    } finally {
      mutationTasksController.stop()
      recorder.stop()
    }
  })

  it('should emit a cross-shadow-root move atomically within the merge window', () => {
    const sourceHost = document.createElement('div')
    const sourceRoot = sourceHost.attachShadow({ mode: 'open' })
    const destinationHost = document.createElement('div')
    const destinationRoot = destinationHost.attachShadow({ mode: 'open' })
    const child = document.createElement('span')
    sourceRoot.appendChild(child)
    container.appendChild(sourceHost)
    container.appendChild(destinationHost)
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    destinationRoot.appendChild(child)
    expect(recorder.shadowRootsController.flush()).toBeTrue()
    recorder.flushMutations()

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    expect(mutationSnapshots.length).toBe(1)
    expect(mutationSnapshots[0].data.removes.length).toBe(1)
    expect(mutationSnapshots[0].data.adds).toEqual([
      jasmine.objectContaining({
        parentId: recorder.getSerializedNodeIdForDebug(destinationRoot),
        node: jasmine.objectContaining({
          id: mutationSnapshots[0].data.removes[0].id
        })
      })
    ])

    const movedChildId = mutationSnapshots[0].data.removes[0].id
    emittedRecords.length = 0
    child.setAttribute('data-after-move', 'captured')
    expect(recorder.shadowRootsController.flush()).toBeTrue()
    recorder.flushMutations()

    expect(recorder.getSerializedNodeIdForDebug(child)).toBe(movedChildId)
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.attributes.some(
            (attributeMutation) =>
              attributeMutation.id === movedChildId &&
              attributeMutation.attributes['data-after-move'] === 'captured'
          )
      )
    ).toBeTrue()

    recorder.stop()
  })

  it('should emit a cross-shadow-root move atomically when the destination root is registered first', () => {
    const destinationHost = document.createElement('div')
    const destinationRoot = destinationHost.attachShadow({ mode: 'open' })
    const sourceHost = document.createElement('div')
    const sourceRoot = sourceHost.attachShadow({ mode: 'open' })
    const child = document.createElement('span')
    sourceRoot.appendChild(child)
    container.appendChild(destinationHost)
    container.appendChild(sourceHost)
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0

    destinationRoot.appendChild(child)
    expect(recorder.shadowRootsController.flush()).toBeTrue()
    recorder.flushMutations()

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    expect(mutationSnapshots.length).toBe(1)
    expect(mutationSnapshots[0].data.removes.length).toBe(1)
    expect(mutationSnapshots[0].data.adds).toEqual([
      jasmine.objectContaining({
        parentId: recorder.getSerializedNodeIdForDebug(destinationRoot),
        node: jasmine.objectContaining({
          id: mutationSnapshots[0].data.removes[0].id
        })
      })
    ])

    recorder.stop()
  })

  it('should emit a light-dom move into an existing shadow root atomically', () => {
    const destinationHost = document.createElement('div')
    const destinationRoot = destinationHost.attachShadow({ mode: 'open' })
    const child = document.createElement('span')
    container.appendChild(destinationHost)
    container.appendChild(child)
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    const movedChildId = recorder.getSerializedNodeIdForDebug(child)
    const destinationRootId =
      recorder.getSerializedNodeIdForDebug(destinationRoot)
    emittedRecords.length = 0

    destinationRoot.appendChild(child)
    recorder.flushMutations()

    const moveSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    const membershipIdAfterMove =
      recorder.getSerializedNodeIdForDebug(child)
    emittedRecords.length = 0
    child.setAttribute('data-after-light-dom-move', 'captured')
    recorder.flushMutations()
    const capturedFollowUpAttribute = emittedRecords.some(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation &&
        event.data.attributes.some(
          (attributeMutation) =>
            attributeMutation.id === movedChildId &&
            attributeMutation.attributes[
              'data-after-light-dom-move'
            ] === 'captured'
        )
    )
    recorder.stop()

    expect(moveSnapshots).toEqual([
      jasmine.objectContaining({
        data: jasmine.objectContaining({
          adds: [
            jasmine.objectContaining({
              parentId: destinationRootId,
              node: jasmine.objectContaining({
                id: movedChildId
              })
            })
          ],
          removes: [
            jasmine.objectContaining({
              id: movedChildId
            })
          ]
        })
      })
    ])
    expect(membershipIdAfterMove).toBe(movedChildId)
    expect(capturedFollowUpAttribute).toBeTrue()
  })

  it('should emit an asynchronously observed light-dom move into an existing shadow root atomically', async () => {
    const destinationHost = document.createElement('div')
    const destinationRoot = destinationHost.attachShadow({ mode: 'open' })
    const child = document.createElement('span')
    container.appendChild(destinationHost)
    container.appendChild(child)
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    const movedChildId = recorder.getSerializedNodeIdForDebug(child)
    const destinationRootId =
      recorder.getSerializedNodeIdForDebug(destinationRoot)
    emittedRecords.length = 0

    destinationRoot.appendChild(child)
    await flushAsyncObservedMutations(recorder)

    const moveSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    const membershipIdAfterMove =
      recorder.getSerializedNodeIdForDebug(child)
    emittedRecords.length = 0
    child.setAttribute('data-after-async-light-dom-move', 'captured')
    await flushAsyncObservedMutations(recorder)
    const capturedFollowUpAttribute = emittedRecords.some(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation &&
        event.data.attributes.some(
          (attributeMutation) =>
            attributeMutation.id === movedChildId &&
            attributeMutation.attributes[
              'data-after-async-light-dom-move'
            ] === 'captured'
        )
    )
    recorder.stop()

    expect(moveSnapshots).toEqual([
      jasmine.objectContaining({
        data: jasmine.objectContaining({
          adds: [
            jasmine.objectContaining({
              parentId: destinationRootId,
              node: jasmine.objectContaining({
                id: movedChildId
              })
            })
          ],
          removes: [
            jasmine.objectContaining({
              id: movedChildId
            })
          ]
        })
      })
    ])
    expect(membershipIdAfterMove).toBe(movedChildId)
    expect(capturedFollowUpAttribute).toBeTrue()
  })

  it('should preserve moved descendant membership inside a newly added wrapper', () => {
    const sourceHost = document.createElement('div')
    const sourceRoot = sourceHost.attachShadow({ mode: 'open' })
    const destinationHost = document.createElement('div')
    const destinationRoot = destinationHost.attachShadow({ mode: 'open' })
    const input = document.createElement('input')
    sourceRoot.appendChild(input)
    container.appendChild(sourceHost)
    container.appendChild(destinationHost)
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    const inputId = recorder.getSerializedNodeIdForDebug(input)
    emittedRecords.length = 0

    const wrapper = document.createElement('section')
    wrapper.appendChild(input)
    destinationRoot.appendChild(wrapper)
    expect(recorder.shadowRootsController.flush()).toBeTrue()
    recorder.flushMutations()

    expect(recorder.getSerializedNodeIdForDebug(input)).toBe(inputId)
    emittedRecords.length = 0
    input.setAttribute('data-after-wrapper-move', 'captured')
    expect(recorder.shadowRootsController.flush()).toBeTrue()
    recorder.flushMutations()
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.attributes.some(
            (attributeMutation) =>
              attributeMutation.id === inputId &&
              attributeMutation.attributes[
                'data-after-wrapper-move'
              ] === 'captured'
          )
      )
    ).toBeTrue()

    recorder.stop()
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
      // Keep each indivisible add below the 200 KB serializer watermark while
      // making the combined payload large enough to require multiple records.
      child.textContent = 'x'.repeat(30000)
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

  it('should discard a structural recovery window when an oversized add follows a remove', () => {
    jasmine.clock().install()
    const emittedRecords = []
    let observerOptions
    const onMandatoryFullSnapshotStarted = jasmine.createSpy(
      'onMandatoryFullSnapshotStarted'
    )
    const recorder = record({
      emit: (event) => {
        emittedRecords.push(event)
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      initObservers: function (options) {
        observerOptions = options
        return {
          flush: function () {},
          reset: function () {},
          stop: function () {}
        }
      },
      $rOnMandatoryFullSnapshotStarted:
        onMandatoryFullSnapshotStarted
    })
    emittedRecords.length = 0
    const publicationToken = createMutationAddPublicationToken()
    publicationToken.$rQueued = true
    const oversizedAdd = {
      parentId: 1,
      nextId: null,
      node: {
        type: 2,
        id: 2,
        tagName: 'div',
        attributes: {},
        childNodes: [
          {
            type: 3,
            id: 3,
            textContent: 'x'.repeat(110000)
          }
        ]
      }
    }
    registerMutationAddPublicationToken(
      oversizedAdd,
      publicationToken
    )

    try {
      observerOptions.mutationCb({
        adds: [],
        removes: [{ parentId: 4, id: 2 }],
        texts: [],
        attributes: []
      })
      observerOptions.mutationCb({
        adds: [oversizedAdd],
        removes: [],
        texts: [],
        attributes: []
      })

      expect(
        emittedRecords.filter(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.Mutation
        )
      ).toEqual([])
      expect(publicationToken.$rQueued).toBeFalse()
      expect(publicationToken.$rCanceled).toBeTrue()
      expect(onMandatoryFullSnapshotStarted).toHaveBeenCalledTimes(1)
      expect(recorder.flushScheduledFullSnapshot()).toBeTrue()
    } finally {
      recorder.stop()
      jasmine.clock().uninstall()
    }
  })

  it('should stream more than 256 healthy split payloads without queue overflow', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const shadowRoots = []
    for (let index = 0; index < 52; index += 1) {
      const host = document.createElement('div')
      shadowRoots.push(host.attachShadow({ mode: 'open' }))
      container.appendChild(host)
    }

    let mutationSnapshotCount = 0
    let admittedAddCount = 0
    let subsequentFullSnapshotCount = 0
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (!captureEmits) {
          return true
        }
        if (
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          mutationSnapshotCount += 1
          admittedAddCount += event.data.adds.length
        } else if (event.type === RecordType.FullSnapshot) {
          subsequentFullSnapshotCount += 1
        }
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureEmits = true

    try {
      const largeText = 'x'.repeat(50000)
      let expectedAddCount = 0
      shadowRoots.forEach((shadowRoot, rootIndex) => {
        const fragment = document.createDocumentFragment()
        const childCount = rootIndex === shadowRoots.length - 1 ? 2 : 5
        for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
          const child = document.createElement('span')
          child.textContent = largeText
          fragment.appendChild(child)
          expectedAddCount += 1
        }
        shadowRoot.appendChild(fragment)
      })

      recorder.flushMutations()
      expect(mutationSnapshotCount).toBeLessThan(expectedAddCount)
      for (
        let drainCount = 0;
        drainCount < expectedAddCount &&
        admittedAddCount < expectedAddCount;
        drainCount += 1
      ) {
        recorder.flushMutations()
      }

      expect(expectedAddCount).toBe(257)
      expect(mutationSnapshotCount).toBe(expectedAddCount)
      expect(admittedAddCount).toBe(expectedAddCount)
      expect(subsequentFullSnapshotCount).toBe(0)
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()
    } finally {
      recorder.stop()
    }
  })

  it('should retain a large pure-add tail until encoder backpressure clears', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const shadowRoots = []
    for (let index = 0; index < 52; index += 1) {
      const host = document.createElement('div')
      shadowRoots.push(host.attachShadow({ mode: 'open' }))
      container.appendChild(host)
    }
    const statusElement = document.createElement('span')
    statusElement.textContent = 'before-backpressure'
    container.appendChild(statusElement)

    let admissionBlocked = true
    let attemptedMutationCount = 0
    let admittedAddCount = 0
    let subsequentFullSnapshotCount = 0
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (!captureEmits) {
          return true
        }
        if (
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          attemptedMutationCount += 1
          if (admissionBlocked) {
            return false
          }
          admittedAddCount += event.data.adds.length
        } else if (event.type === RecordType.FullSnapshot) {
          subsequentFullSnapshotCount += 1
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureEmits = true

    try {
      const largeText = 'x'.repeat(50000)
      let expectedAddCount = 0
      shadowRoots.forEach((shadowRoot, rootIndex) => {
        const fragment = document.createDocumentFragment()
        const childCount = rootIndex === shadowRoots.length - 1 ? 2 : 5
        for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
          const child = document.createElement('span')
          child.textContent = largeText
          fragment.appendChild(child)
          expectedAddCount += 1
        }
        shadowRoot.appendChild(fragment)
      })

      recorder.flushMutations()

      expect(expectedAddCount).toBe(257)
      expect(attemptedMutationCount).toBe(1)
      expect(subsequentFullSnapshotCount).toBe(0)
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()

      statusElement.setAttribute('data-status', 'after-backpressure')
      recorder.flushMutations()
      expect(subsequentFullSnapshotCount).toBe(0)
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()

      admissionBlocked = false
      for (
        let drainCount = 0;
        drainCount < expectedAddCount &&
        admittedAddCount < expectedAddCount;
        drainCount += 1
      ) {
        // Explicit drains deterministically stand in for the scheduled
        // admission slices; no wall-clock delay is needed in this coverage.
        recorder.flushMutations()
      }

      expect(admittedAddCount).toBe(expectedAddCount)
      expect(subsequentFullSnapshotCount).toBe(0)
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()

      const laterChild = document.createElement('div')
      laterChild.textContent = 'captured-after-backpressure'
      container.appendChild(laterChild)
      recorder.flushMutations()
      expect(recorder.getSerializedNodeIdForDebug(laterChild)).toEqual(
        jasmine.any(Number)
      )
    } finally {
      recorder.stop()
    }
  })

  it('should coalesce an unattempted pure-add tail beyond the admission count limit', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const attemptedMutations = []
    const admittedMutations = []
    const addedChildren = []
    let admissionBlocked = true
    let subsequentFullSnapshotCount = 0
    let captureEmits = false
    const recorder = record({
      emit: (event) => {
        if (!captureEmits) {
          return true
        }
        if (
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          attemptedMutations.push(event)
          if (admissionBlocked) {
            return false
          }
          admittedMutations.push(event)
        } else if (event.type === RecordType.FullSnapshot) {
          subsequentFullSnapshotCount += 1
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureEmits = true

    try {
      for (let index = 0; index < 600; index += 1) {
        const child = document.createElement('div')
        child.setAttribute('data-admission-index', String(index))
        container.appendChild(child)
        addedChildren.push(child)
        recorder.flushMutations()
      }

      expect(attemptedMutations.length).toBe(1)
      expect(subsequentFullSnapshotCount).toBe(0)
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()
      expect(
        recorder.getSerializedNodeIdForDebug(addedChildren[0])
      ).toBeUndefined()
      expect(
        recorder.getSerializedNodeIdForDebug(
          addedChildren[addedChildren.length - 1]
        )
      ).toBeUndefined()

      admissionBlocked = false
      recorder.flushMutations()

      expect(admittedMutations.length).toBe(2)
      expect(
        admittedMutations.reduce(
          (count, event) => count + event.data.adds.length,
          0
        )
      ).toBe(addedChildren.length)
      addedChildren.forEach((child) => {
        expect(recorder.getSerializedNodeIdForDebug(child)).toEqual(
          jasmine.any(Number)
        )
      })
      expect(subsequentFullSnapshotCount).toBe(0)
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()
    } finally {
      recorder.stop()
    }
  })

  it('should preserve a 520-root pure-add burst through serializer and encoder backpressure', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const rootCount = 520
    const chunkSize = 20
    const admittedRootIndexes = []
    let admissionBlocked = true
    let attemptedMutationCount = 0
    let subsequentFullSnapshotCount = 0
    let captureEmits = false
    const onMandatoryFullSnapshotStarted = jasmine.createSpy(
      'onMandatoryFullSnapshotStarted'
    )
    const recorder = record({
      emit: (event) => {
        if (!captureEmits) {
          return true
        }
        if (
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          attemptedMutationCount += 1
          if (admissionBlocked) {
            return false
          }
          event.data.adds.forEach((add) => {
            admittedRootIndexes.push(
              Number(add.node.attributes['data-root-index'])
            )
          })
        } else if (event.type === RecordType.FullSnapshot) {
          subsequentFullSnapshotCount += 1
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
      $rOnMandatoryFullSnapshotStarted: onMandatoryFullSnapshotStarted,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureEmits = true

    try {
      for (let offset = 0; offset < rootCount; offset += chunkSize) {
        const fragment = document.createDocumentFragment()
        for (
          let index = offset;
          index < Math.min(offset + chunkSize, rootCount);
          index += 1
        ) {
          const child = document.createElement('div')
          child.setAttribute('data-root-index', String(index))
          fragment.appendChild(child)
        }
        container.appendChild(fragment)
      }

      let flushResult
      do {
        flushResult = recorder.flushMutations()
      } while (flushResult === 'pending')

      expect(flushResult).toBeTrue()
      expect(attemptedMutationCount).toBe(1)
      expect(admittedRootIndexes).toEqual([])
      expect(onMandatoryFullSnapshotStarted).not.toHaveBeenCalled()
      expect(subsequentFullSnapshotCount).toBe(0)

      admissionBlocked = false
      for (
        let drainCount = 0;
        drainCount < rootCount && admittedRootIndexes.length < rootCount;
        drainCount += 1
      ) {
        recorder.flushMutations()
      }

      expect(admittedRootIndexes).toEqual(
        Array.from(
          { length: rootCount },
          (_, index) => rootCount - index - 1
        )
      )
      expect(onMandatoryFullSnapshotStarted).not.toHaveBeenCalled()
      expect(subsequentFullSnapshotCount).toBe(0)
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()
    } finally {
      recorder.stop()
    }
  })

  it('should time-slice one large mutation callback without prior backpressure', () => {
    jasmine.clock().install()
    spyOn(performance, 'now').and.returnValue(0)
    let captureEmits = false
    let admittedMutationCount = 0
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          admittedMutationCount += 1
        }
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    captureEmits = true

    try {
      for (let index = 0; index < 3; index += 1) {
        const child = document.createElement('div')
        child.textContent = String(index).repeat(70000)
        container.appendChild(child)
      }

      // One observer callback produces three independent ~140 KiB entries.
      // Enqueue the complete batch, then apply one shared drain budget.
      recorder.flushMutations()

      // Two ~140 KiB admissions exhaust the 256 KiB slice. The final entry
      // is left for the scheduled continuation rather than synchronously
      // draining the whole pending-raw window.
      expect(admittedMutationCount).toBe(2)

      jasmine.clock().tick(0)
      expect(admittedMutationCount).toBe(3)
      expect(recorder.flushScheduledFullSnapshot()).toBeFalse()
    } finally {
      try {
        recorder.stop()
      } finally {
        jasmine.clock().uninstall()
      }
    }
  })

  it('should split independent large replacements without separating any replacement', () => {
    const statusElements = Array.from({ length: 4 }, () => {
      const statusElement = document.createElement('span')
      statusElement.textContent = 'initial'
      container.appendChild(statusElement)
      return statusElement
    })
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    const parentIds = statusElements.map((statusElement) =>
      recorder.getSerializedNodeIdForDebug(statusElement)
    )
    const initialTextNodeIds = statusElements.map((statusElement) =>
      recorder.getSerializedNodeIdForDebug(statusElement.firstChild)
    )
    emittedRecords.length = 0

    statusElements.forEach((statusElement, index) => {
      statusElement.textContent =
        String(index) + 'x'.repeat(30000)
    })
    recorder.flushMutations()

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    expect(mutationSnapshots.length).toBeGreaterThan(1)
    expect(
      mutationSnapshots.reduce(
        (count, event) => count + event.data.adds.length,
        0
      )
    ).toBe(statusElements.length)
    expect(
      mutationSnapshots.reduce(
        (count, event) => count + event.data.removes.length,
        0
      )
    ).toBe(statusElements.length)
    parentIds.forEach((parentId, index) => {
      const replacementSnapshots = mutationSnapshots.filter(
        (event) =>
          event.data.adds.some((add) => add.parentId === parentId) ||
          event.data.removes.some((remove) => remove.parentId === parentId)
      )
      expect(replacementSnapshots.length).toBe(1)
      expect(
        replacementSnapshots[0].data.adds.filter(
          (add) => add.parentId === parentId
        )
      ).toEqual([
        jasmine.objectContaining({
          node: jasmine.objectContaining({
            textContent: String(index) + 'x'.repeat(30000)
          })
        })
      ])
      expect(
        replacementSnapshots[0].data.removes.filter(
          (remove) => remove.parentId === parentId
        )
      ).toEqual([
        {
          parentId,
          id: initialTextNodeIds[index]
        }
      ])
    })
    expect(
      emittedRecords.some(
        (event) => event.type === RecordType.FullSnapshot
      )
    ).toBeFalse()
    expect(recorder.flushScheduledFullSnapshot()).toBeFalse()

    recorder.stop()
  })

  it('should split independent large adds without separating a text replacement', () => {
    // This case asserts payload splitting and replacement atomicity, not the
    // scheduler's 4 ms wall-clock boundary. Full-suite instrumentation can
    // legitimately leave these four large serializer tasks pending, so keep
    // the serializer clock deterministic and require the explicit flush to
    // complete before inspecting the payloads.
    spyOn(performance, 'now').and.returnValue(0)
    const statusElement = document.createElement('span')
    statusElement.textContent = 'initial'
    container.appendChild(statusElement)
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0
    const largeChildren = Array.from({ length: 4 }, (_, index) => {
      const child = document.createElement('article')
      child.setAttribute('data-large-child', String(index))
      child.textContent = 'x'.repeat(30000)
      container.appendChild(child)
      return child
    })
    statusElement.textContent = 'updated'

    expect(recorder.flushMutations()).toBeTrue()

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    expect(mutationSnapshots.length).toBeGreaterThan(1)
    expect(
      mutationSnapshots.flatMap((event) => event.data.adds).filter(
        (add) =>
          add.node.attributes &&
          add.node.attributes['data-large-child'] !== undefined
      ).length
    ).toBe(largeChildren.length)
    const replacementSnapshot = mutationSnapshots.find(
      (event) => event.data.removes.length > 0
    )
    expect(replacementSnapshot.data.removes.length).toBe(1)
    expect(replacementSnapshot.data.adds).toEqual([
      jasmine.objectContaining({
        node: jasmine.objectContaining({
          textContent: 'updated'
        })
      })
    ])
    expect(recorder.flushScheduledFullSnapshot()).toBeFalse()

    emittedRecords.length = 0
    const lastChild = largeChildren[largeChildren.length - 1]
    const lastChildId = recorder.getSerializedNodeIdForDebug(lastChild)
    expect(lastChildId).toEqual(jasmine.any(Number))
    lastChild.setAttribute('data-after-large-add', 'captured')
    expect(recorder.flushMutations()).toBeTrue()
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.attributes.some(
            (attributeMutation) =>
              attributeMutation.id === lastChildId &&
              attributeMutation.attributes['data-after-large-add'] ===
                'captured'
          )
      )
    ).toBeTrue()

    recorder.stop()
  })

  it('should stop a split sibling chain after its first chunk is rejected and recover with a full snapshot', () => {
    jasmine.clock().install()
    const acceptedRecords = []
    const attemptedMutations = []
    let mutationAttemptCount = 0
    const recorder = record({
      emit: (event) => {
        if (
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          attemptedMutations.push(event)
          mutationAttemptCount += 1
          if (mutationAttemptCount === 1) {
            return false
          }
        }
        acceptedRecords.push(event)
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    acceptedRecords.length = 0

    const children = []
    for (let index = 0; index < 7; index += 1) {
      const child = document.createElement('div')
      child.textContent = String(index) + 'x'.repeat(30000)
      container.appendChild(child)
      children.push(child)
    }

    try {
      recorder.flushMutations()

      expect(attemptedMutations.length).toBe(1)
      const acceptedMutations = acceptedRecords.filter(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
      )
      expect(acceptedMutations.length).toBe(0)

      // The rejected and unattempted chunks are unpublished before recovery;
      // the scheduled baseline then makes the complete DOM authoritative.
      children.forEach((child) => {
        expect(recorder.getSerializedNodeIdForDebug(child)).toBeUndefined()
      })
      jasmine.clock().tick(10)
      expect(
        acceptedRecords.filter(
          (event) => event.type === RecordType.FullSnapshot
        ).length
      ).toBe(1)
      children.forEach((child) => {
        expect(recorder.getSerializedNodeIdForDebug(child)).toEqual(
          jasmine.any(Number)
        )
      })
    } finally {
      recorder.stop()
      jasmine.clock().uninstall()
    }
  })

  it('should abandon a mandatory split recovery on stop without blocking the main thread', () => {
    jasmine.clock().install()
    const nowSpy = spyOn(performance, 'now').and.returnValue(0)
    const acceptedRecords = []
    const attemptedMutations = []
    let mutationAttemptCount = 0
    const onMandatoryFullSnapshotStarted = jasmine.createSpy(
      'onMandatoryFullSnapshotStarted'
    )
    const onMandatoryFullSnapshotAbandoned = jasmine.createSpy(
      'onMandatoryFullSnapshotAbandoned'
    )
    const recorder = record({
      emit: (event) => {
        if (
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          attemptedMutations.push(event)
          mutationAttemptCount += 1
          if (mutationAttemptCount === 2) {
            return false
          }
        }
        acceptedRecords.push(event)
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle(),
      $rOnMandatoryFullSnapshotStarted:
        onMandatoryFullSnapshotStarted,
      $rOnMandatoryFullSnapshotAbandoned:
        onMandatoryFullSnapshotAbandoned
    })
    acceptedRecords.length = 0

    for (let index = 0; index < 7; index += 1) {
      const child = document.createElement('div')
      child.textContent = String(index) + 'x'.repeat(30000)
      container.appendChild(child)
    }

    try {
      recorder.flushMutations()

      expect(attemptedMutations.length).toBe(2)
      expect(
        acceptedRecords.filter(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.Mutation
        ).length
      ).toBe(1)

      // The segment collection holds the accepted structural prefix. Stop is
      // bounded to one serializer slice; if the replacement baseline cannot
      // finish in that slice, the held tail is finalized but not uploaded.
      let now = 0
      nowSpy.and.callFake(() => {
        now += 2
        return now
      })
      recorder.stop()

      expect(
        acceptedRecords.filter(
          (event) => event.type === RecordType.FullSnapshot
        ).length
      ).toBe(0)
      expect(onMandatoryFullSnapshotStarted).toHaveBeenCalledTimes(1)
      expect(onMandatoryFullSnapshotAbandoned).toHaveBeenCalledTimes(1)
    } finally {
      recorder.stop()
      jasmine.clock().uninstall()
    }
  })

  it('should truncate a 5 MB attribute after sanitization without replacing the baseline', () => {
    const emittedRecords = []
    const safeElement = document.createElement('div')
    const oversizedElement = document.createElement('div')
    container.appendChild(safeElement)
    container.appendChild(oversizedElement)
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0
    const stringify = spyOn(JSON, 'stringify').and.callThrough()
    const oversizedValue = 'x'.repeat(5 * 1024 * 1024)

    safeElement.setAttribute('data-safe', 'kept')
    oversizedElement.setAttribute('data-oversized', oversizedValue)
    recorder.flushMutations()

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    const attributes = [].concat.apply(
      [],
      mutationSnapshots.map((event) => event.data.attributes)
    )
    expect(
      attributes.some(
        (attributeMutation) =>
          attributeMutation.attributes['data-safe'] === 'kept'
      )
    ).toBeTrue()
    const oversizedAttribute = attributes.find(
      (attributeMutation) =>
        typeof attributeMutation.attributes['data-oversized'] === 'string'
    ).attributes['data-oversized']
    expect(oversizedAttribute.length).toBe(
      MAX_MUTATION_SERIALIZED_VALUE_CHARACTERS
    )
    expect(oversizedAttribute.endsWith('…')).toBeTrue()
    expect(oversizedAttribute).not.toBe(oversizedValue)
    expect(
      recorder
        .getDomMutationHistoryForDebug()
        .some((entry) =>
          entry.attributes.some((attribute) =>
            attribute.attributeNames.includes('data-oversized')
          )
        )
    ).toBeTrue()
    expect(stringify).not.toHaveBeenCalled()
    expect(recorder.flushScheduledFullSnapshot()).toBeFalse()

    recorder.stop()
  })

  it('should truncate a 5 MB text entry without replacing the baseline', () => {
    const emittedRecords = []
    const textNode = document.createTextNode('initial')
    container.appendChild(textNode)
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0
    const stringify = spyOn(JSON, 'stringify').and.callThrough()

    textNode.textContent = 'x'.repeat(5 * 1024 * 1024)
    recorder.flushMutations()

    const textMutation = emittedRecords
      .filter(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
      )
      .map((event) => event.data.texts)
      .reduce((texts, entries) => texts.concat(entries), [])[0]
    expect(textMutation.value.length).toBe(
      MAX_MUTATION_SERIALIZED_VALUE_CHARACTERS
    )
    expect(textMutation.value.endsWith('…')).toBeTrue()
    expect(recorder.getLastDomMutationForDebug().textsCount).toBe(1)
    expect(recorder.getDomMutationHistoryForDebug().length).toBe(1)
    expect(stringify).not.toHaveBeenCalled()
    expect(recorder.flushScheduledFullSnapshot()).toBeFalse()

    recorder.stop()
  })

  it('should split pure attribute entries into deterministic bounded mutation records', () => {
    const emittedRecords = []
    const elements = []
    for (let index = 0; index < 3; index += 1) {
      const element = document.createElement('div')
      container.appendChild(element)
      elements.push(element)
    }
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0
    const values = elements.map(
      (_element, index) => String(index) + 'x'.repeat(45000)
    )

    elements.forEach((element, index) => {
      element.setAttribute('data-split', values[index])
    })
    recorder.flushMutations()

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    expect(mutationSnapshots.length).toBeGreaterThan(1)
    expect(
      mutationSnapshots.flatMap((event) =>
        event.data.attributes.map(
          (attributeMutation) =>
            attributeMutation.attributes['data-split']
        )
      )
    ).toEqual(values)
    mutationSnapshots.forEach((event) => {
      expect(event.data.adds).toEqual([])
      expect(event.data.removes).toEqual([])
      expect(event.data.texts).toEqual([])
      expect(
        event.data.attributes.reduce(
          (approxBytes, attributeMutation) =>
            approxBytes +
            attributeMutation.attributes['data-split'].length * 2,
          64
        )
      ).toBeLessThanOrEqual(200000)
    })

    recorder.stop()
  })

  it('should split pure text entries into deterministic bounded mutation records', () => {
    const emittedRecords = []
    const textNodes = []
    for (let index = 0; index < 3; index += 1) {
      const textNode = document.createTextNode('initial-' + index)
      container.appendChild(textNode)
      textNodes.push(textNode)
    }
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })
    emittedRecords.length = 0
    const values = textNodes.map(
      (_textNode, index) => String(index) + 'x'.repeat(45000)
    )

    textNodes.forEach((textNode, index) => {
      textNode.textContent = values[index]
    })
    recorder.flushMutations()

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    expect(mutationSnapshots.length).toBeGreaterThan(1)
    expect(
      mutationSnapshots.flatMap((event) =>
        event.data.texts.map((textMutation) => textMutation.value)
      )
    ).toEqual(values)
    mutationSnapshots.forEach((event) => {
      expect(event.data.adds).toEqual([])
      expect(event.data.removes).toEqual([])
      expect(event.data.attributes).toEqual([])
      expect(
        event.data.texts.reduce(
          (approxBytes, textMutation) =>
            approxBytes + textMutation.value.length * 2,
          64
        )
      ).toBeLessThanOrEqual(200000)
    })

    recorder.stop()
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
        event.data.source === IncrementalSource.CanvasMutation &&
        typeof event.data.encodedBytesCount === 'number'
    )
    expect(canvasMutation).toBeDefined()
    expectReplayCompatibleCanvasMutation(canvasMutation, jasmine.any(Number), 20, 10)
  })

  it('should not let a bitmap overtake a backpressured dimension mutation', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 20
    canvas.height = 10
    container.appendChild(canvas)
    const emittedRecords = []
    let captureEmits = false
    let admissionBlocked = true
    const recorder = record({
      emit: (event) => {
        if (
          captureEmits &&
          admissionBlocked &&
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation
        ) {
          return false
        }
        if (captureEmits) {
          emittedRecords.push(event)
        }
        return true
      },
      $rWasLastEmitBackpressured: () => admissionBlocked,
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
    captureEmits = true
    canvas.width = 40

    try {
      expect(await recorder.snapshotCanvas(canvas)).toEqual({
        ok: false,
        reason: 'dimension_mutation_flush_failed'
      })
      expect(
        emittedRecords.some(
          (event) =>
            event.type === RecordType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.CanvasMutation
        )
      ).toBeFalse()

      admissionBlocked = false
      recorder.flushMutations()
      expect(await recorder.snapshotCanvas(canvas)).toEqual({ ok: true })

      const dimensionMutationIndex = emittedRecords.findIndex(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.attributes.some(
            (attribute) => attribute.attributes.width === '40'
          )
      )
      const bitmapIndex = emittedRecords.findIndex(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.CanvasMutation
      )
      expect(dimensionMutationIndex).toBeGreaterThanOrEqual(0)
      expect(bitmapIndex).toBeGreaterThan(dimensionMutationIndex)
    } finally {
      recorder.stop()
    }
  })

  it('should keep a public manual snapshot outside the authoritative command baseline', async () => {
    const canvas = document.createElement('canvas')
    container.appendChild(canvas)
    const snapshot = jasmine
      .createSpy('snapshot')
      .and.returnValue(Promise.resolve({ ok: true }))
    const createCanvasSnapshotBaselineToken = jasmine.createSpy(
      'createCanvasSnapshotBaselineToken'
    )
    const markCanvasSnapshotBaseline = jasmine.createSpy(
      'markCanvasSnapshotBaseline'
    )
    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function () {
        return {
          snapshot: snapshot,
          reset: jasmine.createSpy('resetCanvasObserver'),
          stop: jasmine.createSpy('stopCanvasObserver')
        }
      },
      startCanvasCommandCapture: function () {
        return {
          reset: jasmine.createSpy('resetCanvasCommandCapture'),
          scanExistingCanvases: jasmine.createSpy('scanExistingCanvases'),
          stop: jasmine.createSpy('stopCanvasCommandCapture'),
          createCanvasSnapshotBaselineToken:
            createCanvasSnapshotBaselineToken,
          markCanvasSnapshotBaseline: markCanvasSnapshotBaseline
        }
      }
    })
    await flushPromises()
    snapshot.calls.reset()
    createCanvasSnapshotBaselineToken.calls.reset()
    markCanvasSnapshotBaseline.calls.reset()

    expect(await recorder.snapshotCanvas(canvas)).toEqual({ ok: true })
    expect(snapshot).toHaveBeenCalledOnceWith(
      canvas,
      jasmine.objectContaining({ trigger: 'manual' })
    )
    expect(snapshot.calls.mostRecent().args[1].scheduler).toBeUndefined()
    expect(createCanvasSnapshotBaselineToken).toHaveBeenCalledOnceWith(canvas)
    expect(markCanvasSnapshotBaseline).not.toHaveBeenCalled()
    recorder.stop()
  })

  it('should keep recording 2d commands after a public manual snapshot', async () => {
    const emittedRecords = []
    let scheduledFrameCallback
    const recorder = record({
      emit: (event) => {
        emittedRecords.push(event)
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function () {
        return {
          snapshot: jasmine
            .createSpy('snapshot')
            .and.resolveTo({ ok: true }),
          reset: jasmine.createSpy('resetCanvasObserver'),
          stop: jasmine.createSpy('stopCanvasObserver')
        }
      },
      startCanvasCommandCapture: function (options) {
        return startRealCanvasCommandCapture(
          Object.assign({}, options, {
            requestAnimationFrameImpl: function (callback) {
              scheduledFrameCallback = callback
              return 1
            },
            cancelAnimationFrameImpl: function () {}
          })
        )
      }
    })
    const canvas = document.createElement('canvas')
    container.appendChild(canvas)
    recorder.flushMutations()
    const context = canvas.getContext('2d')
    emittedRecords.length = 0

    expect(await recorder.snapshotCanvas(canvas)).toEqual({ ok: true })
    context.fillRect(1, 2, 3, 4)
    expect(scheduledFrameCallback).toEqual(jasmine.any(Function))
    scheduledFrameCallback()

    const commandMutation = emittedRecords.find(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.CanvasMutation &&
        event.data.commands &&
        event.data.commands.some(
          (command) => command.property === 'fillRect'
        )
    )
    expect(commandMutation).toBeDefined()

    recorder.stop()
  })

  it('should publish a queued canvas add before emitting its retained commands', () => {
    const emittedRecords = []
    const scheduledMicrotasks = []
    const scheduledTimers = []
    let scheduledFrameCallback
    let currentTime = 0
    let recorder
    const canvasSnapshot = jasmine.createSpy('canvasSnapshot')
    recorder = record({
      emit: (event) => {
        emittedRecords.push(event)
        return true
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all',
        replayCanvasAutoFailureBackoff: 1000,
        replayCanvasMaxConcurrentEncodes: 1,
        replayCanvasAutoMaxPerRun: 1
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        return {
          snapshot: function (canvas) {
            canvasSnapshot(canvas)
            const accepted = options.emit({
              type: RecordType.IncrementalSnapshot,
              timestamp: 3001,
              data: {
                source: IncrementalSource.CanvasMutation,
                id: recorder.getSerializedNodeIdForDebug(canvas),
                type: '2D',
                commands: [
                  {
                    property: 'clearRect',
                    args: [0, 0, canvas.width, canvas.height]
                  }
                ]
              }
            })
            return Promise.resolve(
              accepted === false
                ? { ok: false, reason: 'record_rejected' }
                : { ok: true }
            )
          },
          reset: jasmine.createSpy('resetCanvasObserver'),
          stop: jasmine.createSpy('stopCanvasObserver')
        }
      },
      startCanvasCommandCapture: function (options) {
        return startRealCanvasCommandCapture(
          Object.assign({}, options, {
            now: function () {
              return currentTime
            },
            requestAnimationFrameImpl: function (callback) {
              scheduledFrameCallback = callback
              return 1
            },
            cancelAnimationFrameImpl: function () {},
            scheduleMicrotask: function (callback) {
              scheduledMicrotasks.push(callback)
            },
            setTimeoutImpl: function (callback, delay) {
              scheduledTimers.push({
                callback: callback,
                delay: delay
              })
              return scheduledTimers.length
            },
            clearTimeoutImpl: function () {}
          })
        )
      }
    })
    emittedRecords.length = 0
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    container.appendChild(canvas)
    context.fillRect(0, 0, 5, 5)

    scheduledFrameCallback()

    expect(canvasSnapshot).not.toHaveBeenCalled()
    expect(scheduledMicrotasks).toEqual([])
    expect(scheduledTimers).toEqual([])
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.CanvasMutation
      )
    ).toBe(false)

    recorder.flushMutations()

    expect(canvasSnapshot).not.toHaveBeenCalled()
    const addIndex = emittedRecords.findIndex(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation &&
        event.data.adds.some(
          (add) => add.node && add.node.tagName === 'canvas'
        )
    )
    const canvasMutationIndex = emittedRecords.findIndex(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.CanvasMutation
    )
    expect(addIndex).toBeGreaterThanOrEqual(0)
    expect(canvasMutationIndex).toBeGreaterThan(addIndex)
    expect(emittedRecords[canvasMutationIndex].data.encodedBytesCount).toBeUndefined()
    expect(emittedRecords[canvasMutationIndex].data.commands).toEqual([
      jasmine.objectContaining({
        property: 'fillRect',
        args: [0, 0, 5, 5]
      })
    ])
    recorder.stop()
  })

  it('should emit a reflected canvas resize mutation before later commands', () => {
    const emittedRecords = []
    const scheduledFrameCallbacks = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      startCanvasCommandCapture: function (options) {
        return startRealCanvasCommandCapture(
          Object.assign({}, options, {
            requestAnimationFrameImpl: function (callback) {
              scheduledFrameCallbacks.push(callback)
              return scheduledFrameCallbacks.length
            },
            cancelAnimationFrameImpl: function () {}
          })
        )
      }
    })
    const canvas = document.createElement('canvas')
    container.appendChild(canvas)
    recorder.flushMutations()
    const context = canvas.getContext('2d')
    const fullShadowRootFlush = spyOn(
      recorder.shadowRootsController,
      'flush'
    ).and.callThrough()
    emittedRecords.length = 0

    context.fillRect(0, 0, 5, 5)
    canvas.width = 640
    context.fillRect(0, 0, 10, 10)
    expect(scheduledFrameCallbacks.length).toBe(1)
    scheduledFrameCallbacks.shift()()

    const resizeMutationIndex = emittedRecords.findIndex(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation &&
        event.data.attributes.some(
          (attributeMutation) =>
            attributeMutation.attributes.width === '640'
        )
    )
    const preResizeCommandIndex = emittedRecords.findIndex(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.CanvasMutation &&
        event.data.commands.some(
          (command) =>
            command.property === 'fillRect' &&
            command.args[2] === 5
        )
    )
    const postResizeCommandIndex = emittedRecords.findIndex(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.CanvasMutation &&
        event.data.commands.some(
          (command) =>
            command.property === 'fillRect' &&
            command.args[2] === 10
        )
    )

    expect(preResizeCommandIndex).toBeGreaterThanOrEqual(0)
    expect(resizeMutationIndex).toBeGreaterThanOrEqual(0)
    expect(resizeMutationIndex).toBeGreaterThan(preResizeCommandIndex)
    expect(postResizeCommandIndex).toBeGreaterThan(resizeMutationIndex)
    expect(fullShadowRootFlush).not.toHaveBeenCalled()
    recorder.stop()
  })

  it('should preserve an active 2d same-dimension reset with an authoritative bitmap', async () => {
    const emittedRecords = []
    const scheduledFrameCallbacks = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        return createRealCanvasObserver(
          Object.assign({}, options, {
            encodeBridge: {
              encode: function (targetCanvas) {
                return Promise.resolve({
                  dataUrl: 'data:image/webp;base64,QUJD',
                  width: targetCanvas.width,
                  height: targetCanvas.height
                })
              },
              reset: function () {},
              stop: function () {}
            }
          })
        )
      },
      startCanvasCommandCapture: function (options) {
        return startRealCanvasCommandCapture(
          Object.assign({}, options, {
            requestAnimationFrameImpl: function (callback) {
              scheduledFrameCallbacks.push(callback)
              return scheduledFrameCallbacks.length
            },
            cancelAnimationFrameImpl: function () {}
          })
        )
      }
    })
    const canvas = document.createElement('canvas')
    canvas.width = 320
    container.appendChild(canvas)
    recorder.flushMutations()
    const context = canvas.getContext('2d')
    emittedRecords.length = 0

    context.fillRect(0, 0, 4, 4)
    canvas.width = canvas.width
    context.fillRect(0, 0, 9, 9)
    expect(scheduledFrameCallbacks.length).toBe(1)
    scheduledFrameCallbacks.shift()()
    await flushPromises()
    await flushPromises()

    const preResetCommandIndex = emittedRecords.findIndex(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.CanvasMutation &&
        event.data.commands.some(
          (command) =>
            command.property === 'fillRect' &&
            command.args[2] === 4
        )
    )
    const resetBitmapIndex = emittedRecords.findIndex(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.CanvasMutation &&
        typeof event.data.encodedBytesCount === 'number'
    )
    const postResetCommandIndex = emittedRecords.findIndex(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.CanvasMutation &&
        event.data.commands.some(
          (command) =>
            command.property === 'fillRect' &&
            command.args[2] === 9
        )
    )

    expect(preResetCommandIndex).toBeGreaterThanOrEqual(0)
    expect(resetBitmapIndex).toBeGreaterThan(preResetCommandIndex)
    expect(postResetCommandIndex).toBe(-1)
    expect(emittedRecords[resetBitmapIndex].data.commands).toEqual(
      jasmine.arrayContaining([
        jasmine.objectContaining({ property: 'reset' }),
        jasmine.objectContaining({
          property: 'clearRect',
          args: [0, 0, canvas.width, canvas.height]
        }),
        jasmine.objectContaining({
          property: 'drawImage'
        })
      ])
    )
    recorder.stop()
  })

  it('should not globally flush dimension mutations for unpublished 2d or active WebGL canvases', () => {
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle()
    })
    const unpublishedCanvas = document.createElement('canvas')
    container.appendChild(unpublishedCanvas)
    unpublishedCanvas.getContext('2d')
    emittedRecords.length = 0

    unpublishedCanvas.width = 640

    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.adds.some(
            (add) =>
              add.node &&
              add.node.tagName === 'canvas'
          )
      )
    ).toBe(false)

    recorder.flushMutations()
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.adds.some(
            (add) =>
              add.node &&
              add.node.tagName === 'canvas'
          )
      )
    ).toBe(true)

    const webglCanvas = document.createElement('canvas')
    setReplayCanvasContextType(
      webglCanvas,
      'webgl'
    )
    container.appendChild(webglCanvas)
    recorder.flushMutations()
    const pendingNode = document.createElement('div')
    pendingNode.setAttribute('data-pending-after-webgl-resize', 'true')
    container.appendChild(pendingNode)
    emittedRecords.length = 0

    webglCanvas.width = 640

    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.adds.some(
            (add) =>
              add.node &&
              add.node.attributes &&
              add.node.attributes[
                'data-pending-after-webgl-resize'
              ] === 'true'
          )
      )
    ).toBe(false)

    recorder.flushMutations()
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.adds.some(
            (add) =>
              add.node &&
              add.node.attributes &&
              add.node.attributes[
                'data-pending-after-webgl-resize'
              ] === 'true'
          )
      )
    ).toBe(true)
    recorder.stop()
  })

  it('should cancel a deferred bitmap when the canvas is drawn before encode completes', async () => {
    const emittedRecords = []
    let releaseEncode
    const encodePromise = new Promise((resolve) => {
      releaseEncode = resolve
    })
    let scheduledFrameCallback
    const originalIsCancelled = jasmine
      .createSpy('originalIsCancelled')
      .and.returnValue(false)
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all',
        replayCanvasMaxEncodedBytes: 40000
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function (options) {
        return createRealCanvasObserver(
          Object.assign({}, options, {
            encodeBridge: {
              encode: function () {
                return encodePromise
              },
              reset: function () {},
              stop: function () {}
            }
          })
        )
      },
      startCanvasCommandCapture: function (options) {
        const commandCapture = startRealCanvasCommandCapture(
          Object.assign({}, options, {
            requestAnimationFrameImpl: function (callback) {
              scheduledFrameCallback = callback
              return 1
            },
            cancelAnimationFrameImpl: function () {}
          })
        )
        const isSnapshotBaselineCurrent =
          commandCapture.$rIsSnapshotBaselineCurrent
        commandCapture.$rIsSnapshotBaselineCurrent = function (canvas, token) {
          if (!isSnapshotBaselineCurrent(canvas, token)) {
            throw new Error('stale canvas baseline')
          }
          return true
        }
        return commandCapture
      }
    })
    const canvas = document.createElement('canvas')
    container.appendChild(canvas)
    recorder.flushMutations()
    const context = canvas.getContext('2d')
    emittedRecords.length = 0

    const snapshotPromise = recorder.snapshotCanvas(canvas, {
      $rIsCancelled: originalIsCancelled
    })
    context.fillRect(0, 0, 10, 10)
    expect(scheduledFrameCallback).toEqual(jasmine.any(Function))
    releaseEncode({
      dataUrl: 'data:image/webp;base64,AAAA',
      width: canvas.width,
      height: canvas.height
    })

    expect(await snapshotPromise).toEqual({
      ok: false,
      reason: 'baseline_timeout'
    })
    expect(originalIsCancelled).toHaveBeenCalled()
    expect(
      emittedRecords.some(
        (event) =>
          event.type === RecordType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.CanvasMutation &&
          typeof event.data.encodedBytesCount === 'number'
      )
    ).toBeFalse()
    recorder.stop()
  })

  it('should snapshot a static pre-init 2d canvas after the full snapshot without probing its context', async () => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    context.fillRect(0, 0, 4, 4)
    container.appendChild(canvas)
    const getContext = spyOn(canvas, 'getContext').and.callThrough()
    const snapshot = jasmine
      .createSpy('snapshot')
      .and.returnValue(Promise.resolve({ ok: true }))
    const scanExistingCanvases = jasmine.createSpy('scanExistingCanvases')
    const baselineToken = {}
    const createCanvasSnapshotBaselineToken = jasmine
      .createSpy('createCanvasSnapshotBaselineToken')
      .and.returnValue(baselineToken)
    const markCanvasSnapshotBaseline = jasmine.createSpy(
      'markCanvasSnapshotBaseline'
    )

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function () {
        return {
          snapshot: snapshot,
          stop: jasmine.createSpy('stopCanvasObserver'),
          reset: jasmine.createSpy('resetCanvasObserver')
        }
      },
      startCanvasCommandCapture: function () {
        return {
          stop: jasmine.createSpy('stopCanvasCommandCapture'),
          reset: jasmine.createSpy('resetCanvasCommandCapture'),
          scanExistingCanvases: scanExistingCanvases,
          createCanvasSnapshotBaselineToken:
            createCanvasSnapshotBaselineToken,
          markCanvasSnapshotBaseline: markCanvasSnapshotBaseline
        }
      },
      startCanvasWebGLSnapshotObserver: function () {
        return {
          stop: jasmine.createSpy('stopCanvasWebGLSnapshotObserver'),
          reset: jasmine.createSpy('resetCanvasWebGLSnapshotObserver')
        }
      }
    })

    expect(snapshot).toHaveBeenCalledOnceWith(
      canvas,
      jasmine.objectContaining({
        trigger: 'auto',
        scheduler: 'full_snapshot_baseline',
        $rIsCancelled: jasmine.any(Function)
      })
    )
    expect(getContext).not.toHaveBeenCalled()
    await flushPromises()
    expect(createCanvasSnapshotBaselineToken).toHaveBeenCalledWith(canvas)
    expect(markCanvasSnapshotBaseline).toHaveBeenCalledWith(
      canvas,
      baselineToken,
      'full_snapshot_baseline'
    )
    expect(scanExistingCanvases).toHaveBeenCalledTimes(1)
    recorder.stop()
  })

  it('should not encode a static pre-init 2d canvas again after its full snapshot baseline', async () => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    context.fillRect(0, 0, 4, 4)
    container.appendChild(canvas)
    const snapshot = jasmine
      .createSpy('snapshot')
      .and.returnValue(Promise.resolve({ ok: true }))

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function () {
        return {
          snapshot: snapshot,
          stop: jasmine.createSpy('stopCanvasObserver'),
          reset: jasmine.createSpy('resetCanvasObserver')
        }
      },
      startCanvasWebGLSnapshotObserver: function () {
        return {
          stop: jasmine.createSpy('stopCanvasWebGLSnapshotObserver'),
          reset: jasmine.createSpy('resetCanvasWebGLSnapshotObserver')
        }
      }
    })

    await flushPromises()
    await flushPromises()

    expect(snapshot).toHaveBeenCalledOnceWith(
      canvas,
      jasmine.objectContaining({
        trigger: 'auto',
        scheduler: 'full_snapshot_baseline',
        $rIsCancelled: jasmine.any(Function)
      })
    )
    recorder.stop()
  })

  it('should skip known WebGL canvases in the asynchronous full snapshot baseline', async () => {
    const webglCanvas = document.createElement('canvas')
    const bootstrapWebGLCanvas = document.createElement('canvas')
    const unknownCanvas = document.createElement('canvas')
    setReplayCanvasContextType(webglCanvas, 'webgl')
    container.appendChild(webglCanvas)
    container.appendChild(bootstrapWebGLCanvas)
    container.appendChild(unknownCanvas)
    const webglGetContext = spyOn(webglCanvas, 'getContext').and.callThrough()
    const bootstrapWebGLGetContext = spyOn(
      bootstrapWebGLCanvas,
      'getContext'
    ).and.callThrough()
    const unknownGetContext = spyOn(unknownCanvas, 'getContext').and.callThrough()
    const snapshot = jasmine
      .createSpy('snapshot')
      .and.resolveTo({ ok: true })
    let loopOptions

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
        return {
          snapshot: snapshot,
          stop: jasmine.createSpy('stopCanvasObserver'),
          reset: jasmine.createSpy('resetCanvasObserver')
        }
      },
      startContinuousCanvasSnapshotLoop: function (options) {
        loopOptions = options
        return {
          stop: jasmine.createSpy('stopContinuousCanvasSnapshots'),
          reset: jasmine.createSpy('resetContinuousCanvasSnapshots')
        }
      },
      startCanvasWebGLSnapshotObserver: function () {
        return {
          isWebGLCanvas: function (canvas) {
            return canvas === bootstrapWebGLCanvas
          },
          stop: jasmine.createSpy('stopCanvasWebGLSnapshotObserver'),
          reset: jasmine.createSpy('resetCanvasWebGLSnapshotObserver')
        }
      }
    })

    expect(snapshot.calls.count()).toBe(1)
    expect(snapshot.calls.argsFor(0)[0]).toBe(unknownCanvas)
    expect(loopOptions.getCanvases()).toEqual([unknownCanvas])
    expect(webglGetContext).not.toHaveBeenCalled()
    expect(bootstrapWebGLGetContext).not.toHaveBeenCalled()
    expect(unknownGetContext).not.toHaveBeenCalled()
    await flushPromises()
    recorder.stop()
  })

  it('should continue the canvas baseline queue after a hung canvas times out', async () => {
    jasmine.clock().install()
    try {
      const firstCanvas = document.createElement('canvas')
      const secondCanvas = document.createElement('canvas')
      container.appendChild(firstCanvas)
      container.appendChild(secondCanvas)
      let firstSnapshotOptions
      const snapshot = jasmine
        .createSpy('snapshot')
        .and.callFake(function (canvas, snapshotOptions) {
          if (canvas === firstCanvas) {
            firstSnapshotOptions = snapshotOptions
            return new Promise(function () {})
          }
          return Promise.resolve({ ok: true })
        })
      let resolveCanvasScan
      const canvasScanCompleted = new Promise(function (resolve) {
        resolveCanvasScan = resolve
      })
      const scanExistingCanvases = jasmine
        .createSpy('scanExistingCanvases')
        .and.callFake(resolveCanvasScan)

      const recorder = record({
        emit: jasmine.createSpy('emit'),
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
          replayCanvasEnabled: true,
          replayCanvasMode: 'auto',
          replayCanvasSampling: 'all'
        },
        lifeCycle: createLifeCycle(),
        createCanvasObserver: function () {
          return {
            snapshot: snapshot,
            stop: jasmine.createSpy('stopCanvasObserver'),
            reset: jasmine.createSpy('resetCanvasObserver')
          }
        },
        startCanvasCommandCapture: function () {
          return {
            stop: jasmine.createSpy('stopCanvasCommandCapture'),
            reset: jasmine.createSpy('resetCanvasCommandCapture'),
            scanExistingCanvases: scanExistingCanvases
          }
        },
        startCanvasWebGLSnapshotObserver: function () {
          return {
            stop: jasmine.createSpy('stopCanvasWebGLSnapshotObserver'),
            reset: jasmine.createSpy('resetCanvasWebGLSnapshotObserver')
          }
        }
      })

      expect(snapshot).toHaveBeenCalledTimes(1)
      expect(snapshot.calls.argsFor(0)[0]).toBe(firstCanvas)

      jasmine.clock().tick(1000)
      await Promise.resolve()
      await Promise.resolve()
      expect(firstSnapshotOptions.$rIsCancelled()).toBeTrue()
      expect(snapshot).toHaveBeenCalledTimes(2)
      expect(snapshot.calls.argsFor(1)[0]).toBe(secondCanvas)

      await canvasScanCompleted
      expect(scanExistingCanvases).toHaveBeenCalledTimes(1)
      recorder.stop()
    } finally {
      jasmine.clock().uninstall()
    }
  })

  it('should cancel an old serial baseline queue and start one clean baseline after a subsequent full snapshot reset', async () => {
    const firstCanvas = document.createElement('canvas')
    const secondCanvas = document.createElement('canvas')
    container.appendChild(firstCanvas)
    container.appendChild(secondCanvas)
    const pendingSnapshots = []
    const snapshot = jasmine
      .createSpy('snapshot')
      .and.callFake(function (canvas) {
        return new Promise(function (resolve) {
          pendingSnapshots.push({ canvas: canvas, resolve: resolve })
        })
      })
    const resetCanvasObserver = jasmine.createSpy('resetCanvasObserver')
    const scanExistingCanvases = jasmine.createSpy('scanExistingCanvases')

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      createCanvasObserver: function () {
        return {
          snapshot: snapshot,
          stop: jasmine.createSpy('stopCanvasObserver'),
          reset: resetCanvasObserver
        }
      },
      startCanvasCommandCapture: function () {
        return {
          stop: jasmine.createSpy('stopCanvasCommandCapture'),
          reset: jasmine.createSpy('resetCanvasCommandCapture'),
          scanExistingCanvases: scanExistingCanvases
        }
      },
      startCanvasWebGLSnapshotObserver: function () {
        return {
          stop: jasmine.createSpy('stopCanvasWebGLSnapshotObserver'),
          reset: jasmine.createSpy('resetCanvasWebGLSnapshotObserver')
        }
      }
    })

    expect(pendingSnapshots.length).toBe(1)
    expect(pendingSnapshots[0].canvas).toBe(firstCanvas)

    recorder.takeSubsequentFullSnapshot(9123)
    expect(resetCanvasObserver).toHaveBeenCalledTimes(1)
    expect(pendingSnapshots.length).toBe(2)
    expect(pendingSnapshots[1].canvas).toBe(firstCanvas)

    pendingSnapshots[0].resolve({ ok: false, reason: 'reset_during_snapshot' })
    await flushPromises()
    expect(pendingSnapshots.length).toBe(2)
    expect(scanExistingCanvases).not.toHaveBeenCalled()

    pendingSnapshots[1].resolve({ ok: true })
    await flushPromises()
    expect(pendingSnapshots.length).toBe(3)
    expect(pendingSnapshots[2].canvas).toBe(secondCanvas)

    pendingSnapshots[2].resolve({ ok: true })
    await flushPromises()
    expect(scanExistingCanvases).toHaveBeenCalledTimes(1)
    recorder.stop()
  })

  it('should cap each full-snapshot canvas baseline queue', async () => {
    const canvases = []
    for (
      let index = 0;
      index < MAX_FULL_SNAPSHOT_CANVAS_BASELINE_COUNT + 1;
      index += 1
    ) {
      const canvas = document.createElement('canvas')
      container.appendChild(canvas)
      canvases.push(canvas)
    }
    const snapshot = jasmine
      .createSpy('snapshot')
      .and.returnValue(Promise.resolve({ ok: true }))

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
        return {
          snapshot: snapshot,
          stop: jasmine.createSpy('stopCanvasObserver'),
          reset: jasmine.createSpy('resetCanvasObserver')
        }
      },
      startContinuousCanvasSnapshotLoop: function () {
        return {
          stop: jasmine.createSpy('stopContinuousCanvasSnapshots'),
          reset: jasmine.createSpy('resetContinuousCanvasSnapshots')
        }
      },
      startCanvasWebGLSnapshotObserver: function () {
        return {
          stop: jasmine.createSpy('stopCanvasWebGLSnapshotObserver'),
          reset: jasmine.createSpy('resetCanvasWebGLSnapshotObserver')
        }
      }
    })

    await flushPromises()
    expect(snapshot).toHaveBeenCalledTimes(
      MAX_FULL_SNAPSHOT_CANVAS_BASELINE_COUNT
    )
    expect(snapshot.calls.argsFor(0)[0]).toBe(canvases[0])
    expect(
      snapshot.calls.allArgs().some(function (args) {
        return (
          args[0] === canvases[MAX_FULL_SNAPSHOT_CANVAS_BASELINE_COUNT]
        )
      })
    ).toBeFalse()
    recorder.stop()
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

    await flushPromises()
    canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height)
    emittedRecords.length = 0
    expect(loopOptions.getCanvases(1)).toEqual([canvas])
    expect(loopOptions.getCanvases()).toContain(canvas)
    expect(await loopOptions.snapshotCanvas(canvas)).toEqual({ ok: true })

    const canvasMutation = emittedRecords.find(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.CanvasMutation &&
        typeof event.data.encodedBytesCount === 'number'
    )
    expect(canvasMutation).toBeDefined()
    expectReplayCompatibleCanvasMutation(canvasMutation, jasmine.any(Number), 20, 10)

    emittedRecords.length = 0
    canvas.width = 40
    canvas.getContext('2d').fillRect(0, 0, 40, canvas.height)
    expect(await loopOptions.snapshotCanvas(canvas)).toEqual({ ok: true })
    const resizeMutationIndex = emittedRecords.findIndex(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation &&
        event.data.attributes.some(
          (attributeMutation) =>
            attributeMutation.attributes.width === '40'
        )
    )
    const resizedBitmapIndex = emittedRecords.findIndex(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.CanvasMutation &&
        typeof event.data.encodedBytesCount === 'number'
    )
    expect(resizeMutationIndex).toBeGreaterThanOrEqual(0)
    expect(resizedBitmapIndex).toBeGreaterThan(resizeMutationIndex)

    recorder.stop()
    expect(loopOptions.getCanvases()).not.toContain(canvas)
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

    await flushPromises()
    canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height)
    emittedRecords.length = 0
    expect(
      await commandCaptureOptions.snapshotCanvas(canvas, {
        trigger: 'auto',
        scheduler: 'command_capture'
      })
    ).toEqual({ ok: true })

    const canvasMutations = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.CanvasMutation
    )
    const stateResetMutation = canvasMutations.find(
      (event) =>
        event.data.commands &&
        event.data.commands[0] &&
        event.data.commands[0].property === 'reset'
    )
    expect(stateResetMutation).toBeUndefined()
    const canvasMutation = canvasMutations
      .filter((event) => typeof event.data.encodedBytesCount === 'number')
      .pop()
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
      .and.returnValues(
        firstSnapshotPromise,
        Promise.resolve({ ok: true }),
        Promise.resolve({ ok: true })
      )
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
    recorder.flushMutations()

    const staleSnapshotPromise = loopOptions.snapshotCanvas(canvas)
    recorder.takeSubsequentFullSnapshot(1234)

    releaseFirstSnapshot({ ok: false, reason: 'reset_during_snapshot' })
    expect(await staleSnapshotPromise).toEqual({
      ok: false,
      reason: 'reset_during_snapshot'
    })
    expect(await loopOptions.snapshotCanvas(canvas)).toEqual({ ok: true })
    expect(reset).toHaveBeenCalledTimes(1)
    expect(snapshot.calls.count()).toBe(3)

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
        expect(() => options.flushMutations()).not.toThrow()
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
        getCanvases: jasmine.any(Function),
        flushMutations: jasmine.any(Function)
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

  it('should flush canvas commands without stopping command capture', () => {
    const flushCanvasCommandCapture = jasmine.createSpy(
      'flushCanvasCommandCapture'
    )
    const stopCanvasCommandCapture = jasmine.createSpy(
      'stopCanvasCommandCapture'
    )
    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      startCanvasCommandCapture: function () {
        return {
          flush: flushCanvasCommandCapture,
          stop: stopCanvasCommandCapture,
          reset: jasmine.createSpy('resetCanvasCommandCapture'),
          scanExistingCanvases: jasmine.createSpy('scanExistingCanvases')
        }
      }
    })

    recorder.$rFlushCanvasCommands()

    expect(flushCanvasCommandCapture).toHaveBeenCalledTimes(1)
    expect(stopCanvasCommandCapture).not.toHaveBeenCalled()

    recorder.stop()
    expect(stopCanvasCommandCapture).toHaveBeenCalledTimes(1)
  })

  it('should retry a backpressured canvas boundary before flushing newer commands', () => {
    let commandCaptureOptions
    let commandWasCaptured = false
    let backpressured = false
    const canvasRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 10,
      data: {
        source: IncrementalSource.CanvasMutation,
        id: 1,
        type: '2D',
        commands: [{ property: 'fillRect', args: [1, 2, 3, 4] }]
      }
    }
    const canvasAttempts = []
    const emit = jasmine.createSpy('emit').and.callFake((event) => {
      if (
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.CanvasMutation
      ) {
        canvasAttempts.push(event)
        return !backpressured
      }
      return true
    })
    const recorder = record({
      emit,
      $rWasLastEmitBackpressured: () => backpressured,
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      lifeCycle: createLifeCycle(),
      startCanvasCommandCapture: function (options) {
        commandCaptureOptions = options
        return {
          flush: function () {
            if (!commandWasCaptured) {
              commandWasCaptured = true
              expect(commandCaptureOptions.emit(canvasRecord)).toBeTrue()
            }
          },
          stop: function () {},
          reset: function () {},
          scanExistingCanvases: function () {}
        }
      }
    })

    backpressured = true
    recorder.$rFlushCanvasCommands()
    expect(canvasAttempts).toEqual([canvasRecord])

    backpressured = false
    recorder.$rFlushCanvasCommands()
    expect(canvasAttempts).toEqual([canvasRecord, canvasRecord])

    recorder.stop()
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

  it('should preserve flushed mutation work before a subsequent full snapshot', () => {
    const emittedRecords = []
    const recorder = record({
      emit: (event) => emittedRecords.push(event),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: createLifeCycle()
    })

    container.appendChild(document.createElement('div'))
    recorder.flushMutations()
    recorder.takeSubsequentFullSnapshot(5678)

    const mutationSnapshots = emittedRecords.filter(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation
    )
    expect(mutationSnapshots.length).toBeGreaterThan(0)
  })

  it('should continue recorder cleanup after one canvas observer throws', () => {
    const canvas = document.createElement('canvas')
    container.appendChild(canvas)
    const stopCanvasObserver = jasmine.createSpy('stopCanvasObserver')
    const stopContinuousCanvasSnapshots = jasmine.createSpy(
      'stopContinuousCanvasSnapshots'
    )
    let loopOptions
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
        return {
          snapshot: jasmine.createSpy('snapshot'),
          stop: stopCanvasObserver,
          reset: jasmine.createSpy('resetCanvasObserver')
        }
      },
      startContinuousCanvasSnapshotLoop: function (options) {
        loopOptions = options
        return {
          stop: stopContinuousCanvasSnapshots,
          reset: jasmine.createSpy('resetContinuousCanvasSnapshots')
        }
      },
      startCanvasWebGLSnapshotObserver: function () {
        return {
          stop: function () {
            throw new Error('webgl cleanup failed')
          },
          reset: jasmine.createSpy('resetCanvasWebGLSnapshotObserver')
        }
      }
    })

    expect(loopOptions.getCanvases()).toContain(canvas)
    expect(() => recorder.stop('test')).not.toThrow()
    expect(stopCanvasObserver).toHaveBeenCalledTimes(1)
    expect(stopContinuousCanvasSnapshots).toHaveBeenCalledTimes(1)
    expect(loopOptions.getCanvases()).not.toContain(canvas)
  })

  it('should unwind canvas command capture before the WebGL bootstrap wrapper', () => {
    const canvasPrototype = window.HTMLCanvasElement.prototype
    const nativeGetContext = canvasPrototype.getContext
    const webGLBootstrapGetContext = function () {
      return nativeGetContext.apply(this, arguments)
    }
    canvasPrototype.getContext = webGLBootstrapGetContext
    let recorder

    try {
      recorder = record({
        emit: jasmine.createSpy('emit'),
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
          replayCanvasEnabled: true,
          replayCanvasMode: 'auto',
          replayCanvasSampling: 'all'
        },
        lifeCycle: createLifeCycle(),
        startCanvasCommandCapture: function () {
          const commandOriginalGetContext = canvasPrototype.getContext
          const commandGetContext = function () {
            return commandOriginalGetContext.apply(this, arguments)
          }
          canvasPrototype.getContext = commandGetContext
          return {
            stop: function () {
              if (canvasPrototype.getContext === commandGetContext) {
                canvasPrototype.getContext = commandOriginalGetContext
              }
            },
            reset: jasmine.createSpy('resetCanvasCommandCapture')
          }
        },
        startCanvasWebGLSnapshotObserver: function () {
          return {
            stop: function () {
              if (canvasPrototype.getContext === webGLBootstrapGetContext) {
                canvasPrototype.getContext = nativeGetContext
              }
            },
            reset: jasmine.createSpy('resetCanvasWebGLSnapshotObserver')
          }
        }
      })

      recorder.stop()
      expect(canvasPrototype.getContext).toBe(nativeGetContext)
    } finally {
      canvasPrototype.getContext = nativeGetContext
    }
  })

  it('should roll back initialized resources when observer initialization fails', () => {
    const canvas = document.createElement('canvas')
    container.appendChild(canvas)
    const stopCanvasObserver = jasmine.createSpy('stopCanvasObserver')
    const stopContinuousCanvasSnapshots = jasmine.createSpy(
      'stopContinuousCanvasSnapshots'
    )
    const canvasCleanupOrder = []
    const stopCanvasCommandCapture = jasmine
      .createSpy('stopCanvasCommandCapture')
      .and.callFake(function () {
        canvasCleanupOrder.push('command')
      })
    const stopCanvasWebGLSnapshotObserver = jasmine
      .createSpy('stopCanvasWebGLSnapshotObserver')
      .and.callFake(function () {
        canvasCleanupOrder.push('webgl')
      })
    const onFullSnapshotFailure = jasmine.createSpy('onFullSnapshotFailure')
    let loopOptions

    const recorder = record({
      emit: jasmine.createSpy('emit'),
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW,
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 2
      },
      lifeCycle: createLifeCycle(),
      onFullSnapshotFailure,
      createCanvasObserver: function () {
        return {
          snapshot: jasmine.createSpy('snapshot'),
          stop: stopCanvasObserver,
          reset: jasmine.createSpy('resetCanvasObserver')
        }
      },
      startContinuousCanvasSnapshotLoop: function (options) {
        loopOptions = options
        return {
          stop: stopContinuousCanvasSnapshots,
          reset: jasmine.createSpy('resetContinuousCanvasSnapshots')
        }
      },
      startCanvasCommandCapture: function () {
        return {
          stop: stopCanvasCommandCapture,
          reset: jasmine.createSpy('resetCanvasCommandCapture')
        }
      },
      startCanvasWebGLSnapshotObserver: function () {
        return {
          stop: stopCanvasWebGLSnapshotObserver,
          reset: jasmine.createSpy('resetCanvasWebGLSnapshotObserver')
        }
      },
      initObservers: function () {
        throw new Error('observer initialization failed')
      }
    })

    expect(onFullSnapshotFailure).toHaveBeenCalledOnceWith(
      'recorder_initialization_error'
    )
    expect(stopCanvasObserver).toHaveBeenCalledTimes(1)
    expect(stopContinuousCanvasSnapshots).toHaveBeenCalledTimes(1)
    expect(stopCanvasCommandCapture).toHaveBeenCalledTimes(1)
    expect(stopCanvasWebGLSnapshotObserver).toHaveBeenCalledTimes(1)
    expect(canvasCleanupOrder).toEqual(['command', 'webgl'])
    expect(loopOptions.getCanvases()).not.toContain(canvas)
    expect(recorder.flushScheduledFullSnapshot()).toBeFalse()

    recorder.stop()
    expect(stopCanvasObserver).toHaveBeenCalledTimes(1)
    expect(stopContinuousCanvasSnapshots).toHaveBeenCalledTimes(1)
    expect(stopCanvasCommandCapture).toHaveBeenCalledTimes(1)
    expect(stopCanvasWebGLSnapshotObserver).toHaveBeenCalledTimes(1)
  })
})
