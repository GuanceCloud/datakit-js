import { IncrementalSource, RecordType } from '../../../types'
import { createCanvasObserver } from './canvasObserver'
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

  it('should emit a canvas mutation when snapshot succeeds', async () => {
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
          commands: [
            jasmine.objectContaining({
              property: 'clearRect',
              args: [0, 0, 20, 10]
            }),
            jasmine.objectContaining({
              property: 'drawImage'
            })
          ]
        })
      })
    )
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
