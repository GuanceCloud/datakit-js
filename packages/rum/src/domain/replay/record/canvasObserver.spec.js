import { IncrementalSource, RecordType } from '../../../types'
import { createCanvasObserver } from './canvasObserver'
import { setReplayCanvasContextType } from './canvasContext'
import { setSerializedNodeId } from './serializationUtils'

describe('replay/record/canvasObserver', () => {
  let canvas
  let emit

  beforeEach(() => {
    canvas = document.createElement('canvas')
    canvas.width = 20
    canvas.height = 10
    document.body.appendChild(canvas)
    setSerializedNodeId(canvas, 42)
    emit = jasmine.createSpy('emit')
  })

  afterEach(() => {
    canvas.remove()
  })

  function getCommand(commands, property) {
    return commands.find((command) => command.property === property)
  }

  it('should emit a canvas mutation when snapshot succeeds', async () => {
    const onMutationDebug = jasmine.createSpy('onMutationDebug')
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      onMutationDebug,
      encodeBridge: {
        encode: () =>
          Promise.resolve({
            dataUrl: 'data:image/webp;base64,QUJD',
            width: 20,
            height: 10
          }),
        stop: jasmine.createSpy('stop')
      }
    })

    const result = await observer.snapshot(canvas)

    expect(result).toEqual({ ok: true })
    expect(emit).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: RecordType.IncrementalSnapshot,
        data: jasmine.objectContaining({
          source: IncrementalSource.CanvasMutation,
          id: 42,
          type: '2D',
          commands: jasmine.any(Array)
        })
      })
    )
    expect(onMutationDebug).toHaveBeenCalledWith({
      timestamp: jasmine.any(Number),
      canvasId: 42,
      trigger: 'manual',
      encodedBytesCount: 3,
      width: 20,
      height: 10
    })
  })

  it('should snapshot a canvas created by an iframe realm', async () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const foreignCanvas = iframe.contentWindow.document.createElement('canvas')
    foreignCanvas.width = 20
    foreignCanvas.height = 10
    document.body.appendChild(foreignCanvas)
    setSerializedNodeId(foreignCanvas, 43)
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: () =>
          Promise.resolve({
            dataUrl: 'data:image/webp;base64,QUJD',
            width: 20,
            height: 10
          }),
        stop: jasmine.createSpy('stop')
      }
    })

    try {
      expect(foreignCanvas instanceof HTMLCanvasElement).toBeFalse()
      expect(await observer.snapshot(foreignCanvas)).toEqual({ ok: true })
      expect(emit).toHaveBeenCalledWith(
        jasmine.objectContaining({
          data: jasmine.objectContaining({ id: 43 })
        })
      )
    } finally {
      observer.stop()
      foreignCanvas.remove()
      iframe.remove()
    }
  })

  it('should not emit when publication membership changes during encoding', async () => {
    let releaseEncode
    let isNodeActive = true
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      isNodeActive: () => isNodeActive,
      encodeBridge: {
        encode: () =>
          new Promise((resolve) => {
            releaseEncode = resolve
          }),
        stop: jasmine.createSpy('stop')
      }
    })

    const snapshotPromise = observer.snapshot(canvas)
    isNodeActive = false
    releaseEncode({
      dataUrl: 'data:image/webp;base64,QUJD',
      width: 20,
      height: 10
    })

    expect(await snapshotPromise).toEqual({
      ok: false,
      reason: 'not_serialized'
    })
    expect(emit).not.toHaveBeenCalled()
  })

  it('should not emit when canvas replay is disabled', async () => {
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: false,
        replayCanvasMode: 'manual'
      },
      emit
    })

    expect(await observer.snapshot(canvas)).toEqual({
      ok: false,
      reason: 'replay_disabled'
    })
    expect(emit).not.toHaveBeenCalled()
  })

  it('should return a reason when the canvas node was not serialized', async () => {
    const otherCanvas = document.createElement('canvas')
    document.body.appendChild(otherCanvas)

    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual'
      },
      emit
    })

    expect(await observer.snapshot(otherCanvas)).toEqual({
      ok: false,
      reason: 'not_serialized'
    })

    otherCanvas.remove()
  })

  it('should return a reason when the encoded payload is too large', async () => {
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 2
      },
      emit,
      encodeBridge: {
        encode: () =>
          Promise.resolve({
            dataUrl: 'data:image/webp;base64,QUJD',
            width: 20,
            height: 10
          }),
        stop: jasmine.createSpy('stop')
      }
    })

    expect(await observer.snapshot(canvas)).toEqual({
      ok: false,
      reason: 'encode_too_large'
    })
    expect(emit).not.toHaveBeenCalled()
  })

  it('should preserve a typed oversize result returned by the encode layer', async () => {
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 2
      },
      emit,
      encodeBridge: {
        encode: () =>
          Promise.resolve({
            ok: false,
            reason: 'encode_too_large',
            encodedBytesCount: 3
          }),
        stop: jasmine.createSpy('stop')
      }
    })

    expect(await observer.snapshot(canvas)).toEqual({
      ok: false,
      reason: 'encode_too_large'
    })
    expect(emit).not.toHaveBeenCalled()
  })

  it('should reject malformed encoded payloads before emitting a canvas mutation', async () => {
    const onMutationDebug = jasmine.createSpy('onMutationDebug')
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      onMutationDebug,
      encodeBridge: {
        encode: () =>
          Promise.resolve({
            dataUrl: 'data:image/webp;base64,QUJD=REVG',
            width: 20,
            height: 10
          }),
        stop: jasmine.createSpy('stop')
      }
    })

    expect(await observer.snapshot(canvas)).toEqual({
      ok: false,
      reason: 'invalid_encoded_payload'
    })
    expect(emit).not.toHaveBeenCalled()
    expect(onMutationDebug).toHaveBeenCalledWith({
      timestamp: jasmine.any(Number),
      canvasId: 42,
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
  })

  it('should include encoded byte count in the emitted canvas mutation', async () => {
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: () =>
          Promise.resolve({
            dataUrl: 'data:image/webp;base64,QUJD',
            width: 20,
            height: 10
          }),
        stop: jasmine.createSpy('stop')
      }
    })

    await observer.snapshot(canvas)

    expect(emit).toHaveBeenCalledWith(
      jasmine.objectContaining({
        data: jasmine.objectContaining({
          id: 42,
          encodedBytesCount: 3,
          commands: jasmine.arrayContaining([
            {
              property: 'clearRect',
              args: [0, 0, 20, 10]
            },
            jasmine.objectContaining({
              property: 'drawImage'
            })
          ])
        })
      })
    )
  })

  it('should replay a bitmap after a legacy player skips the reset command', async () => {
    const sourceContext = canvas.getContext('2d')
    sourceContext.fillStyle = 'rgb(255, 0, 0)'
    sourceContext.fillRect(0, 0, 10, 10)
    sourceContext.fillStyle = 'rgb(0, 0, 255)'
    sourceContext.fillRect(10, 0, 10, 10)
    const dataUrl = canvas.toDataURL('image/png')
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/png',
        replayCanvasMaxEncodedBytes: 10000
      },
      emit,
      encodeBridge: {
        encode: () =>
          Promise.resolve({
            dataUrl,
            width: 20,
            height: 10
          }),
        stop: jasmine.createSpy('stop')
      }
    })

    expect(
      await observer.snapshot(canvas, {
        trigger: 'auto',
        scheduler: 'command_capture'
      })
    ).toEqual({ ok: true })
    expect(emit.calls.count()).toBe(1)
    const commands = emit.calls.mostRecent().args[0].data.commands
    const stateResetCommands = commands.slice(0, -2)
    const bitmapCommands = commands.slice(-2)
    const replayCanvas = document.createElement('canvas')
    replayCanvas.width = 20
    replayCanvas.height = 10
    const replayContext = replayCanvas.getContext('2d')
    replayContext.fillStyle = 'rgb(0, 255, 0)'
    replayContext.fillRect(0, 0, 20, 10)
    replayContext.setTransform(1, 0, 0, 1, 7, 0)
    replayContext.globalAlpha = 0
    replayContext.globalCompositeOperation = 'destination-out'
    replayContext.filter = 'blur(2px)'
    replayContext.shadowColor = 'rgb(255, 0, 0)'
    replayContext.shadowBlur = 10
    replayContext.shadowOffsetX = 4
    replayContext.shadowOffsetY = 4
    replayContext.imageSmoothingEnabled = false

    const snapshotImage = new Image()
    await new Promise((resolve, reject) => {
      snapshotImage.onload = resolve
      snapshotImage.onerror = reject
      snapshotImage.src = dataUrl
    })

    function applyCommands(context) {
      commands.forEach((command) => {
        try {
          if (command.property === 'reset') {
            throw new Error('legacy player context does not expose reset()')
          }
          if (command.setter) {
            context[command.property] = command.args[0]
            return
          }
          const args = command.args.slice()
          if (command.property === 'drawImage') {
            args[0] = snapshotImage
          }
          context[command.property].apply(context, args)
        } catch (_) {
          // rrweb isolates unsupported canvas commands and continues the batch.
        }
      })
    }

    expect(stateResetCommands.map((command) => command.property)).toEqual([
      'reset',
      'setTransform',
      'globalAlpha',
      'globalCompositeOperation',
      'filter',
      'shadowColor',
      'shadowBlur',
      'shadowOffsetX',
      'shadowOffsetY',
      'imageSmoothingEnabled'
    ])
    expect(bitmapCommands.map((command) => command.property)).toEqual([
      'clearRect',
      'drawImage'
    ])
    expect(getCommand(commands, 'clearRect').args).toEqual([0, 0, 20, 10])

    applyCommands(replayContext)

    expect(
      Array.from(replayContext.getImageData(1, 1, 1, 1).data)
    ).toEqual([255, 0, 0, 255])
    expect(
      Array.from(replayContext.getImageData(18, 8, 1, 1).data)
    ).toEqual([0, 0, 255, 255])

  })

  it('should emit a player-compatible state reset and bitmap atomically', async () => {
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: () =>
          Promise.resolve({
            dataUrl: 'data:image/webp;base64,QUJD',
            width: 20,
            height: 10
          }),
        stop: jasmine.createSpy('stop')
      }
    })

    expect(
      await observer.snapshot(canvas, {
        trigger: 'auto',
        scheduler: 'command_capture'
      })
    ).toEqual({ ok: true })
    expect(emit.calls.count()).toBe(1)
    const commands = emit.calls.argsFor(0)[0].data.commands
    const stateResetCommands = commands.slice(0, -2)
    const bitmapCommands = commands.slice(-2)

    expect(stateResetCommands[0]).toEqual({
      property: 'reset',
      args: []
    })
    expect(getCommand(stateResetCommands, 'setTransform')).toEqual({
      property: 'setTransform',
      args: [1, 0, 0, 1, 0, 0]
    })
    expect(getCommand(stateResetCommands, 'globalAlpha')).toEqual({
      property: 'globalAlpha',
      args: [1],
      setter: true
    })
    expect(getCommand(stateResetCommands, 'globalCompositeOperation')).toEqual({
      property: 'globalCompositeOperation',
      args: ['source-over'],
      setter: true
    })
    expect(bitmapCommands).toEqual([
      {
        property: 'clearRect',
        args: [0, 0, 20, 10]
      },
      jasmine.objectContaining({
        property: 'drawImage'
      })
    ])
    expect(getCommand(bitmapCommands, 'clearRect')).toEqual({
      property: 'clearRect',
      args: [0, 0, 20, 10]
    })
    expect(getCommand(bitmapCommands, 'drawImage')).toEqual(
      jasmine.objectContaining({
        property: 'drawImage'
      })
    )
    commands.forEach((command) => {
      expect(command).toEqual(
        jasmine.objectContaining({
          property: jasmine.any(String),
          args: jasmine.any(Array)
        })
      )
    })
  })

  const replaceableSnapshotSchedulers = [
    'continuous_snapshot',
    'webgl_snapshot'
  ]
  replaceableSnapshotSchedulers.forEach((scheduler) => {
    it('should keep the first ' + scheduler + ' bitmap frame replaceable', async () => {
      const observer = createCanvasObserver({
        configuration: {
          replayCanvasEnabled: true,
          replayCanvasMode: 'auto',
          replayCanvasMimeType: 'image/webp',
          replayCanvasMaxEncodedBytes: 1000
        },
        emit,
        encodeBridge: {
          encode: () =>
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,QUJD',
              width: 20,
              height: 10
            }),
          stop: jasmine.createSpy('stop')
        }
      })

      expect(
        await observer.snapshot(canvas, {
          trigger: 'auto',
          scheduler: scheduler
        })
      ).toEqual({ ok: true })
      expect(emit.calls.count()).toBe(1)
      expect(
        emit.calls.mostRecent().args[0].data.commands.map(
          (command) => command.property
        )
      ).toEqual(['clearRect', 'drawImage'])
    })
  })

  it('should not emit a standalone reset after an admitted full snapshot bitmap baseline', async () => {
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: jasmine
          .createSpy('encode')
          .and.returnValues(
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,QUJD',
              width: 20,
              height: 10
            }),
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,REVG',
              width: 20,
              height: 10
            })
          ),
        stop: jasmine.createSpy('stop')
      }
    })

    expect(
      await observer.snapshot(canvas, {
        trigger: 'auto',
        scheduler: 'full_snapshot_baseline'
      })
    ).toEqual({ ok: true })
    expect(
      await observer.snapshot(canvas, {
        trigger: 'auto',
        scheduler: 'command_capture',
        force: true
      })
    ).toEqual({ ok: true })

    expect(emit.calls.count()).toBe(2)
    emit.calls.allArgs().forEach((args) => {
      expect(
        args[0].data.commands.map((command) => command.property)
      ).toEqual(['clearRect', 'drawImage'])
    })
  })

  it('should still reset command-capture state after a rejected full snapshot bitmap baseline', async () => {
    emit.and.returnValues(false, true)
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: jasmine
          .createSpy('encode')
          .and.returnValues(
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,QUJD',
              width: 20,
              height: 10
            }),
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,REVG',
              width: 20,
              height: 10
            })
          ),
        stop: jasmine.createSpy('stop')
      }
    })

    expect(
      await observer.snapshot(canvas, {
        trigger: 'auto',
        scheduler: 'full_snapshot_baseline'
      })
    ).toEqual({ ok: false, reason: 'record_rejected' })
    expect(
      await observer.snapshot(canvas, {
        trigger: 'auto',
        scheduler: 'command_capture',
        force: true
      })
    ).toEqual({ ok: true })

    expect(emit.calls.count()).toBe(2)
    expect(emit.calls.argsFor(1)[0].data.commands[0].property).toBe('reset')
    expect(
      emit.calls
        .argsFor(1)[0]
        .data.commands.slice(-2)
        .map((command) => command.property)
    ).toEqual(['clearRect', 'drawImage'])
  })

  it('should retry the atomic state reset after bitmap admission is rejected', async () => {
    emit.and.returnValues(false, true)
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: jasmine
          .createSpy('encode')
          .and.returnValues(
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,QUJD',
              width: 20,
              height: 10
            }),
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,REVG',
              width: 20,
              height: 10
            })
          ),
        stop: jasmine.createSpy('stop')
      }
    })

    expect(
      await observer.snapshot(canvas, {
        trigger: 'auto',
        scheduler: 'command_capture',
        force: true
      })
    ).toEqual({ ok: false, reason: 'record_rejected' })
    expect(
      await observer.snapshot(canvas, {
        trigger: 'auto',
        scheduler: 'command_capture',
        force: true
      })
    ).toEqual({ ok: true })

    expect(emit.calls.count()).toBe(2)
    emit.calls.allArgs().forEach((args) => {
      expect(args[0].data.commands[0].property).toBe('reset')
      expect(
        args[0].data.commands.slice(-2).map((command) => command.property)
      ).toEqual(['clearRect', 'drawImage'])
    })
  })

  it('should scale a downsampled snapshot back to the canvas backing size', async () => {
    canvas.style.width = '100px'
    canvas.style.height = '50px'
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: () =>
          Promise.resolve({
            dataUrl: 'data:image/webp;base64,QUJD',
            width: 10,
            height: 5
          }),
        stop: jasmine.createSpy('stop')
      }
    })

    await observer.snapshot(canvas)

    expect(emit.calls.mostRecent().args[0].data.commands).toEqual(
      jasmine.arrayContaining([
        jasmine.objectContaining({
          property: 'drawImage',
          args: [jasmine.any(Object), 0, 0, 20, 10]
        })
      ])
    )
  })

  it('should discard a stale async snapshot after the canvas backing size changes', async () => {
    let resolveEncode
    const encode = jasmine
      .createSpy('encode')
      .and.returnValues(
        new Promise(function (resolve) {
          resolveEncode = resolve
        }),
        Promise.resolve({
          dataUrl: 'data:image/webp;base64,QUJD',
          width: 20,
          height: 10
        })
      )
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: encode,
        stop: jasmine.createSpy('stop')
      }
    })

    const snapshotPromise = observer.snapshot(canvas)
    canvas.width = 40
    canvas.height = 20
    resolveEncode({
      dataUrl: 'data:image/webp;base64,QUJD',
      width: 10,
      height: 5
    })

    expect(await snapshotPromise).toEqual({
      ok: false,
      reason: 'resized_during_snapshot'
    })
    expect(emit).not.toHaveBeenCalled()

    expect(await observer.snapshot(canvas)).toEqual({ ok: true })
    expect(
      getCommand(
        emit.calls.mostRecent().args[0].data.commands,
        'drawImage'
      )
    ).toEqual(
      jasmine.objectContaining({
        property: 'drawImage',
        args: [jasmine.any(Object), 0, 0, 40, 20]
      })
    )
  })

  it('should flush a pending dimension mutation before the first bitmap', async () => {
    const calls = []
    const flushMutations = jasmine
      .createSpy('flushMutations')
      .and.callFake((targetCanvas) => {
        expect(targetCanvas).toBe(canvas)
        calls.push('mutations')
      })
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      flushMutations,
      encodeBridge: {
        encode: () => {
          calls.push('encode')
          return Promise.resolve({
            dataUrl: 'data:image/webp;base64,QUJD',
            width: canvas.width,
            height: canvas.height
          })
        },
        stop: jasmine.createSpy('stop')
      }
    })
    canvas.width = 40

    expect(await observer.snapshot(canvas)).toEqual({ ok: true })
    expect(calls).toEqual(['mutations', 'encode'])
    expect(flushMutations).toHaveBeenCalledTimes(1)
  })

  it('should flush a WebGL dimension mutation before encoding its next bitmap', async () => {
    const calls = []
    let encodeCount = 0
    setReplayCanvasContextType(canvas, 'webgl')
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      flushMutations: () => {
        calls.push('mutations')
      },
      encodeBridge: {
        encode: () => {
          calls.push('encode')
          encodeCount += 1
          return Promise.resolve({
            dataUrl:
              encodeCount === 1
                ? 'data:image/webp;base64,QUJD'
                : 'data:image/webp;base64,REVG',
            width: canvas.width,
            height: canvas.height
          })
        },
        stop: jasmine.createSpy('stop')
      },
      frameSignatureExtractor: () => undefined
    })

    expect(
      await observer.snapshot(canvas, {
        trigger: 'auto',
        scheduler: 'full_snapshot_baseline'
      })
    ).toEqual({ ok: true })
    calls.length = 0
    canvas.setAttribute('width', String(canvas.width))

    expect(
      await observer.snapshot(canvas, {
        trigger: 'auto',
        scheduler: 'webgl_snapshot'
      })
    ).toEqual({ ok: true })
    expect(calls).toEqual(['mutations', 'encode'])
  })

  it('should not emit an older canvas snapshot after a newer one resolves first', async () => {
    var pendingEncodes = []
    var observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: jasmine.createSpy('encode').and.callFake(function () {
          return new Promise(function (resolve) {
            pendingEncodes.push(resolve)
          })
        }),
        stop: jasmine.createSpy('stop')
      }
    })

    var firstSnapshotPromise = observer.snapshot(canvas)
    var secondSnapshotPromise = observer.snapshot(canvas)

    pendingEncodes[1]({
      dataUrl: 'data:image/webp;base64,REVG',
      width: 20,
      height: 10
    })
    expect(await secondSnapshotPromise).toEqual({ ok: true })

    pendingEncodes[0]({
      dataUrl: 'data:image/webp;base64,QUJD',
      width: 20,
      height: 10
    })
    expect(await firstSnapshotPromise).toEqual({
      ok: false,
      reason: 'superseded'
    })

    expect(emit).toHaveBeenCalledTimes(1)
    expect(
      getCommand(
        emit.calls.mostRecent().args[0].data.commands,
        'drawImage'
      ).args[0]
    ).toEqual(
      jasmine.objectContaining({
        rr_type: 'ImageBitmap',
        args: [
          jasmine.objectContaining({
            rr_type: 'Blob',
            data: [
              {
                rr_type: 'ArrayBuffer',
                base64: 'REVG'
              }
            ]
          })
        ]
      })
    )
  })

  it('should suppress an older frame when a newer completion matches the replay baseline', async () => {
    var pendingEncodes = []
    var observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: jasmine.createSpy('encode').and.callFake(function () {
          return new Promise(function (resolve) {
            pendingEncodes.push(resolve)
          })
        }),
        stop: jasmine.createSpy('stop')
      },
      frameSignatureExtractor: function () {}
    })

    var baselinePromise = observer.snapshot(canvas, {
      trigger: 'auto'
    })
    pendingEncodes[0]({
      dataUrl: 'data:image/webp;base64,QUJD',
      width: 20,
      height: 10
    })
    expect(await baselinePromise).toEqual({ ok: true })

    var olderSnapshotPromise = observer.snapshot(canvas, {
      trigger: 'auto'
    })
    var newerSnapshotPromise = observer.snapshot(canvas, {
      trigger: 'auto'
    })
    pendingEncodes[2]({
      dataUrl: 'data:image/webp;base64,QUJD',
      width: 20,
      height: 10
    })
    expect(await newerSnapshotPromise).toEqual({
      ok: false,
      reason: 'unchanged'
    })

    pendingEncodes[1]({
      dataUrl: 'data:image/webp;base64,REVG',
      width: 20,
      height: 10
    })
    expect(await olderSnapshotPromise).toEqual({
      ok: false,
      reason: 'superseded'
    })
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('should admit an older valid snapshot when a newer completion is rejected', async () => {
    var pendingEncodes = []
    emit.and.returnValues(false, true)
    var observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: jasmine.createSpy('encode').and.callFake(function () {
          return new Promise(function (resolve) {
            pendingEncodes.push(resolve)
          })
        }),
        stop: jasmine.createSpy('stop')
      }
    })

    var firstSnapshotPromise = observer.snapshot(canvas)
    var secondSnapshotPromise = observer.snapshot(canvas)

    pendingEncodes[1]({
      dataUrl: 'data:image/webp;base64,REVG',
      width: 20,
      height: 10
    })
    expect(await secondSnapshotPromise).toEqual({
      ok: false,
      reason: 'record_rejected'
    })

    pendingEncodes[0]({
      dataUrl: 'data:image/webp;base64,QUJD',
      width: 20,
      height: 10
    })
    expect(await firstSnapshotPromise).toEqual({ ok: true })

    expect(emit).toHaveBeenCalledTimes(2)
    expect(
      getCommand(
        emit.calls.mostRecent().args[0].data.commands,
        'drawImage'
      ).args[0]
    ).toEqual(
      jasmine.objectContaining({
        rr_type: 'ImageBitmap',
        args: [
          jasmine.objectContaining({
            rr_type: 'Blob',
            data: [
              {
                rr_type: 'ArrayBuffer',
                base64: 'QUJD'
              }
            ]
          })
        ]
      })
    )
  })

  it('should use the actual data url mime type for the emitted snapshot image blob', async () => {
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: () =>
          Promise.resolve({
            dataUrl: 'data:image/png;base64,QUJD',
            width: 20,
            height: 10
          }),
        stop: jasmine.createSpy('stop')
      }
    })

    await observer.snapshot(canvas)

    var mutation = emit.calls.mostRecent().args[0]
    expect(getCommand(mutation.data.commands, 'drawImage').args[0]).toEqual({
      rr_type: 'ImageBitmap',
      args: [
        {
          rr_type: 'Blob',
          data: [{ rr_type: 'ArrayBuffer', base64: 'QUJD' }],
          type: 'image/png'
        }
      ]
    })
  })

  it('should return rejected_by_should_record_canvas when the hook blocks recording', async () => {
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        shouldRecordCanvas: () => false
      },
      emit
    })

    expect(await observer.snapshot(canvas)).toEqual({
      ok: false,
      reason: 'rejected_by_should_record_canvas'
    })
    expect(emit).not.toHaveBeenCalled()
  })

  it('should fail closed when shouldRecordCanvas throws', async () => {
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        shouldRecordCanvas: () => {
          throw new Error('customer hook failed')
        }
      },
      emit
    })

    expect(await observer.snapshot(canvas)).toEqual({
      ok: false,
      reason: 'rejected_by_should_record_canvas'
    })
    expect(emit).not.toHaveBeenCalled()
  })

  it('should return detached when the canvas is no longer in the document', async () => {
    canvas.remove()

    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual'
      },
      emit
    })

    expect(await observer.snapshot(canvas)).toEqual({
      ok: false,
      reason: 'detached'
    })
    expect(emit).not.toHaveBeenCalled()
  })

  it('should return invalid_mode when replay canvas mode is not supported', async () => {
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'invalid'
      },
      emit
    })

    expect(await observer.snapshot(canvas)).toEqual({
      ok: false,
      reason: 'invalid_mode'
    })
    expect(emit).not.toHaveBeenCalled()
  })

  it('should still allow manual snapshot calls when auto mode is enabled', async () => {
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: () =>
          Promise.resolve({
            dataUrl: 'data:image/webp;base64,QUJD',
            width: 20,
            height: 10
          }),
        stop: jasmine.createSpy('stop')
      }
    })

    expect(await observer.snapshot(canvas)).toEqual({ ok: true })
    expect(emit).toHaveBeenCalled()
  })

  it('should avoid a synchronous frame-signature readback for WebGL snapshots', async () => {
    const frameSignatureExtractor = jasmine.createSpy('frameSignatureExtractor')
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: () =>
          Promise.resolve({
            dataUrl: 'data:image/webp;base64,QUJD',
            width: 20,
            height: 10
          }),
        stop: jasmine.createSpy('stop')
      },
      frameSignatureExtractor: frameSignatureExtractor
    })

    expect(
      await observer.snapshot(canvas, {
        trigger: 'auto',
        scheduler: 'webgl_snapshot'
      })
    ).toEqual({ ok: true })
    expect(frameSignatureExtractor).not.toHaveBeenCalled()
  })

  it('should avoid a second readback for unknown full snapshot canvas baselines', async () => {
    const frameSignatureExtractor = jasmine.createSpy('frameSignatureExtractor')
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: () =>
          Promise.resolve({
            dataUrl: 'data:image/webp;base64,QUJD',
            width: 20,
            height: 10
          }),
        stop: jasmine.createSpy('stop')
      },
      frameSignatureExtractor: frameSignatureExtractor
    })

    expect(
      await observer.snapshot(canvas, {
        trigger: 'auto',
        scheduler: 'full_snapshot_baseline'
      })
    ).toEqual({ ok: true })
    expect(frameSignatureExtractor).not.toHaveBeenCalled()
  })

  it('should keep allowing duplicate manual snapshots when auto mode is enabled', async () => {
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000,
        replayCanvasAutoUnchangedBackoff: 3000
      },
      emit,
      encodeBridge: {
        encode: jasmine
          .createSpy('encode')
          .and.returnValues(
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,QUJD',
              width: 20,
              height: 10
            }),
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,QUJD',
              width: 20,
              height: 10
            })
          ),
        stop: jasmine.createSpy('stop')
      },
      frameSignatureExtractor: jasmine
        .createSpy('frameSignatureExtractor')
        .and.returnValues([0, 0, 0], [0, 0, 0])
    })

    expect(await observer.snapshot(canvas, { trigger: 'manual' })).toEqual({
      ok: true
    })
    expect(await observer.snapshot(canvas, { trigger: 'manual' })).toEqual({
      ok: true
    })
    expect(emit.calls.count()).toBe(2)
  })

  it('should reuse the manual success baseline for the next auto snapshot in auto mode', async () => {
    let nowTime = 1000
    const encode = jasmine
      .createSpy('encode')
      .and.returnValue(
        Promise.resolve({
          dataUrl: 'data:image/webp;base64,QUJD',
          width: 20,
          height: 10
        })
      )
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000,
        replayCanvasAutoUnchangedBackoff: 3000
      },
      now: () => nowTime,
      emit,
      encodeBridge: {
        encode: encode,
        stop: jasmine.createSpy('stop')
      },
      frameSignatureExtractor: jasmine
        .createSpy('frameSignatureExtractor')
        .and.returnValues([1, 1, 1], [1, 1, 1])
    })

    expect(await observer.snapshot(canvas, { trigger: 'manual' })).toEqual({
      ok: true
    })
    nowTime = 1200
    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: false,
      reason: 'below_threshold'
    })
    expect(encode.calls.count()).toBe(1)
  })

  it('should skip unchanged frames in auto mode', async () => {
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: jasmine
          .createSpy('encode')
          .and.returnValues(
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,QUJD',
              width: 20,
              height: 10
            }),
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,QUJD',
              width: 20,
              height: 10
            })
          ),
        stop: jasmine.createSpy('stop')
      },
      frameSignatureExtractor: jasmine
        .createSpy('frameSignatureExtractor')
        .and.returnValues([0, 0, 0], [255, 255, 255])
    })

    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: true
    })
    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: false,
      reason: 'unchanged'
    })
    expect(emit.calls.count()).toBe(1)
  })

  it('should bound the exact encoded-frame cache with LRU eviction', async () => {
    const secondCanvas = document.createElement('canvas')
    const thirdCanvas = document.createElement('canvas')
    secondCanvas.width = canvas.width
    secondCanvas.height = canvas.height
    thirdCanvas.width = canvas.width
    thirdCanvas.height = canvas.height
    document.body.appendChild(secondCanvas)
    document.body.appendChild(thirdCanvas)
    setSerializedNodeId(secondCanvas, 43)
    setSerializedNodeId(thirdCanvas, 44)
    const dataUrls = new Map([
      [canvas, 'data:image/webp;base64,QUJD'],
      [secondCanvas, 'data:image/webp;base64,REVG'],
      [thirdCanvas, 'data:image/webp;base64,R0hJ']
    ])
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodedDataUrlCacheMaxCharacters: dataUrls.get(canvas).length * 2,
      encodeBridge: {
        encode: (targetCanvas) =>
          Promise.resolve({
            dataUrl: dataUrls.get(targetCanvas),
            width: targetCanvas.width,
            height: targetCanvas.height
          }),
        stop: jasmine.createSpy('stop')
      },
      frameSignatureExtractor: () => undefined
    })

    expect(
      await observer.snapshot(canvas, { trigger: 'auto' })
    ).toEqual({ ok: true })
    expect(
      await observer.snapshot(secondCanvas, { trigger: 'auto' })
    ).toEqual({ ok: true })
    expect(
      await observer.snapshot(canvas, { trigger: 'auto' })
    ).toEqual({ ok: false, reason: 'unchanged' })

    expect(
      await observer.snapshot(thirdCanvas, { trigger: 'auto' })
    ).toEqual({ ok: true })
    expect(
      await observer.snapshot(canvas, { trigger: 'auto' })
    ).toEqual({ ok: false, reason: 'unchanged' })
    expect(
      await observer.snapshot(secondCanvas, { trigger: 'auto' })
    ).toEqual({ ok: true })
    expect(emit).toHaveBeenCalledTimes(4)

    secondCanvas.remove()
    thirdCanvas.remove()
  })

  it('should force an authoritative auto snapshot past signature and encoded-frame deduplication', async () => {
    let nowTime = 1000
    const encode = jasmine
      .createSpy('encode')
      .and.returnValue(
        Promise.resolve({
          dataUrl: 'data:image/webp;base64,QUJD',
          width: 20,
          height: 10
        })
      )
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000,
        replayCanvasAutoUnchangedBackoff: 3000
      },
      now: () => nowTime,
      emit,
      encodeBridge: {
        encode,
        stop: jasmine.createSpy('stop')
      },
      frameSignatureExtractor: jasmine
        .createSpy('frameSignatureExtractor')
        .and.returnValues([1, 1, 1], [1, 1, 1], [1, 1, 1])
    })

    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: true
    })
    nowTime = 1100
    expect(
      await observer.snapshot(canvas, { trigger: 'auto', force: true })
    ).toEqual({
      ok: true
    })
    nowTime = 1200
    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: false,
      reason: 'below_threshold'
    })
    expect(encode).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('should skip below-threshold frames before encoding in auto mode', async () => {
    let nowTime = 1000
    const encode = jasmine
      .createSpy('encode')
      .and.returnValues(
        Promise.resolve({
          dataUrl: 'data:image/webp;base64,QUJD',
          width: 20,
          height: 10
        }),
        Promise.resolve({
          dataUrl: 'data:image/webp;base64,REVG',
          width: 20,
          height: 10
        })
      )
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000,
        replayCanvasAutoUnchangedBackoff: 3000
      },
      now: () => nowTime,
      emit,
      frameSignatureExtractor: jasmine
        .createSpy('frameSignatureExtractor')
        .and.returnValues([0, 0, 0], [2, 2, 2], [2, 2, 2]),
      encodeBridge: {
        encode: encode,
        stop: jasmine.createSpy('stop')
      }
    })

    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: true
    })
    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: false,
      reason: 'below_threshold'
    })
    nowTime = 5000
    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: true
    })
    expect(encode.calls.count()).toBe(2)
    expect(emit.calls.count()).toBe(2)
  })

  it('should return to cheap probes after an exact unchanged validation', async () => {
    let nowTime = 1000
    const encode = jasmine
      .createSpy('encode')
      .and.returnValues(
        Promise.resolve({
          dataUrl: 'data:image/webp;base64,QUJD',
          width: 20,
          height: 10
        }),
        Promise.resolve({
          dataUrl: 'data:image/webp;base64,QUJD',
          width: 20,
          height: 10
        })
      )
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000,
        replayCanvasAutoUnchangedBackoff: 3000
      },
      now: () => nowTime,
      emit,
      frameSignatureExtractor: jasmine
        .createSpy('frameSignatureExtractor')
        .and.returnValue(new Uint8Array([0, 255])),
      encodeBridge: {
        encode,
        stop: jasmine.createSpy('stop')
      }
    })

    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: true
    })
    nowTime = 5000
    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: false,
      reason: 'unchanged'
    })
    nowTime = 5250
    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: false,
      reason: 'below_threshold'
    })
    expect(encode).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('should encode a localized signature change before the unchanged backoff expires', async () => {
    let nowTime = 1000
    const firstSignature = new Array(128).fill(0)
    const localizedChangeSignature = firstSignature.slice()
    localizedChangeSignature[0] = 255
    const encode = jasmine
      .createSpy('encode')
      .and.returnValues(
        Promise.resolve({
          dataUrl: 'data:image/webp;base64,QUJD',
          width: 20,
          height: 10
        }),
        Promise.resolve({
          dataUrl: 'data:image/webp;base64,REVG',
          width: 20,
          height: 10
        })
      )
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000,
        replayCanvasAutoUnchangedBackoff: 3000
      },
      now: () => nowTime,
      emit,
      frameSignatureExtractor: jasmine
        .createSpy('frameSignatureExtractor')
        .and.returnValues(firstSignature, localizedChangeSignature),
      encodeBridge: {
        encode,
        stop: jasmine.createSpy('stop')
      }
    })

    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: true
    })
    nowTime = 1250
    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: true
    })
    expect(encode).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('should encode an alpha-only clear instead of treating it as unchanged', async () => {
    let nowTime = 1000
    const context = canvas.getContext('2d')
    context.fillStyle = '#000'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const encode = jasmine
      .createSpy('encode')
      .and.returnValues(
        Promise.resolve({
          dataUrl: 'data:image/webp;base64,QUJD',
          width: 20,
          height: 10
        }),
        Promise.resolve({
          dataUrl: 'data:image/webp;base64,REVG',
          width: 20,
          height: 10
        })
      )
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000,
        replayCanvasAutoUnchangedBackoff: 3000
      },
      now: () => nowTime,
      emit,
      encodeBridge: {
        encode,
        stop: jasmine.createSpy('stop')
      }
    })

    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: true
    })

    context.clearRect(0, 0, canvas.width, canvas.height)
    nowTime = 1100
    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: true
    })
    expect(encode).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('should not advance the auto signature baseline when encoding fails', async () => {
    let nowTime = 1000
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000,
        replayCanvasAutoUnchangedBackoff: 3000
      },
      now: () => nowTime,
      emit,
      frameSignatureExtractor: jasmine
        .createSpy('frameSignatureExtractor')
        .and.returnValues([0, 0, 0], [50, 50, 50], [50, 50, 50]),
      encodeBridge: {
        encode: jasmine
          .createSpy('encode')
          .and.returnValues(
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,QUJD',
              width: 20,
              height: 10
            }),
            Promise.reject(new Error('encode failed')),
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,REVG',
              width: 20,
              height: 10
            })
          ),
        stop: jasmine.createSpy('stop')
      }
    })

    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: true
    })
    nowTime = 5000
    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: false,
      reason: 'encode_failed'
    })
    nowTime = 6000
    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: true
    })
    expect(emit.calls.count()).toBe(2)
  })

  it('should retry an unchanged auto frame when the previous record was rejected', async () => {
    emit.and.returnValues(false, true)
    const encode = jasmine
      .createSpy('encode')
      .and.returnValues(
        Promise.resolve({
          dataUrl: 'data:image/webp;base64,QUJD',
          width: 20,
          height: 10
        }),
        Promise.resolve({
          dataUrl: 'data:image/webp;base64,QUJD',
          width: 20,
          height: 10
        })
      )
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000,
        replayCanvasAutoUnchangedBackoff: 3000
      },
      emit,
      encodeBridge: {
        encode,
        stop: jasmine.createSpy('stop')
      },
      frameSignatureExtractor: jasmine
        .createSpy('frameSignatureExtractor')
        .and.returnValues([0, 0, 0], [0, 0, 0])
    })

    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: false,
      reason: 'record_rejected'
    })
    expect(await observer.snapshot(canvas, { trigger: 'auto' })).toEqual({
      ok: true
    })
    expect(encode).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('should apply adaptive encode overrides for large continuous auto snapshots only', async () => {
    canvas.width = 600
    canvas.height = 300
    const encode = jasmine
      .createSpy('encode')
      .and.returnValue(
        Promise.resolve({
          dataUrl: 'data:image/webp;base64,QUJD',
          width: 510,
          height: 255
        })
      )
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: encode,
        stop: jasmine.createSpy('stop')
      }
    })

    await observer.snapshot(canvas, {
      trigger: 'auto',
      scheduler: 'continuous_snapshot'
    })

    expect(encode).toHaveBeenCalledWith(
      canvas,
      jasmine.objectContaining({
        quality: 0.30000000000000004,
        maxSize: 1088
      })
    )
  })

  it('should apply adaptive encode overrides on numeric auto snapshots', async () => {
    canvas.width = 600
    canvas.height = 300
    const encode = jasmine
      .createSpy('encode')
      .and.returnValue(
        Promise.resolve({
          dataUrl: 'data:image/webp;base64,QUJD',
          width: 600,
          height: 300
        })
      )
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: encode,
        stop: jasmine.createSpy('stop')
      }
    })

    await observer.snapshot(canvas, {
      trigger: 'auto',
      scheduler: 'continuous_snapshot'
    })

    expect(encode).toHaveBeenCalledWith(
      canvas,
      jasmine.objectContaining({
        quality: 0.30000000000000004,
        maxSize: 1088
      })
    )
  })

  it('should keep allowing duplicate manual snapshots', async () => {
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: jasmine
          .createSpy('encode')
          .and.returnValues(
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,QUJD',
              width: 20,
              height: 10
            }),
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,QUJD',
              width: 20,
              height: 10
            })
          ),
        stop: jasmine.createSpy('stop')
      }
    })

    expect(await observer.snapshot(canvas)).toEqual({ ok: true })
    expect(await observer.snapshot(canvas)).toEqual({ ok: true })
    expect(emit.calls.count()).toBe(2)
  })

  it('should emit again after reset even when the auto frame stays unchanged', async () => {
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000,
        replayCanvasAutoUnchangedBackoff: 3000
      },
      emit,
      encodeBridge: {
        encode: jasmine
          .createSpy('encode')
          .and.returnValues(
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,QUJD',
              width: 20,
              height: 10
            }),
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,QUJD',
              width: 20,
              height: 10
            })
          ),
        stop: jasmine.createSpy('stop')
      },
      frameSignatureExtractor: jasmine
        .createSpy('frameSignatureExtractor')
        .and.returnValues([0, 0, 0], [0, 0, 0])
    })

    expect(await observer.snapshot(canvas)).toEqual({ ok: true })

    observer.reset()

    expect(await observer.snapshot(canvas)).toEqual({ ok: true })
    expect(emit.calls.count()).toBe(2)
  })

  it('should ignore stale async snapshots that resolve after reset', async () => {
    let releaseFirstEncode
    const firstEncode = new Promise((resolve) => {
      releaseFirstEncode = resolve
    })
    const resetEncodeBridge = jasmine.createSpy('reset')
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000,
        replayCanvasAutoUnchangedBackoff: 3000
      },
      emit,
      encodeBridge: {
        encode: jasmine
          .createSpy('encode')
          .and.returnValues(
            firstEncode,
            Promise.resolve({
              dataUrl: 'data:image/webp;base64,QUJD',
              width: 20,
              height: 10
            })
          ),
        reset: resetEncodeBridge,
        stop: jasmine.createSpy('stop')
      },
      frameSignatureExtractor: jasmine
        .createSpy('frameSignatureExtractor')
        .and.returnValues([0, 0, 0], [255, 255, 255])
    })

    const firstSnapshotPromise = observer.snapshot(canvas)
    observer.reset()
    releaseFirstEncode({
      dataUrl: 'data:image/webp;base64,QUJD',
      width: 20,
      height: 10
    })

    expect(await firstSnapshotPromise).toEqual({
      ok: false,
      reason: 'reset_during_snapshot'
    })
    expect(await observer.snapshot(canvas)).toEqual({ ok: true })
    expect(emit.calls.count()).toBe(1)
    expect(resetEncodeBridge).toHaveBeenCalledTimes(1)
  })

  it('should return encode_failed when the encode bridge rejects', async () => {
    const observer = createCanvasObserver({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasMaxEncodedBytes: 1000
      },
      emit,
      encodeBridge: {
        encode: () => Promise.reject(new Error('boom')),
        stop: jasmine.createSpy('stop')
      }
    })

    expect(await observer.snapshot(canvas)).toEqual({
      ok: false,
      reason: 'encode_failed'
    })
    expect(emit).not.toHaveBeenCalled()
  })
})
