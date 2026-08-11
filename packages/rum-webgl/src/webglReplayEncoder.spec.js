import { createWebGLReplayEncoder } from './webglReplayEncoder'

describe('WebGL replay encoder addon', () => {
  function createDeferred() {
    var resolve
    var reject
    var promise = new Promise(function (resolvePromise, rejectPromise) {
      resolve = resolvePromise
      reject = rejectPromise
    })
    return { promise: promise, resolve: resolve, reject: reject }
  }

  function createEncodeLifecycle(result, physicalSettled) {
    var resultPromise = Promise.resolve(result)
    return {
      result: resultPromise,
      physicalSettled:
        physicalSettled ||
        resultPromise.then(
          function () {},
          function () {}
        )
    }
  }

  function createStagingCanvas(options) {
    options = options || {}
    var context = {
      clearRect: jasmine.createSpy('clearRect'),
      drawImage:
        options.drawImage || jasmine.createSpy('drawImage'),
      putImageData: jasmine.createSpy('putImageData')
    }
    return {
      width: 0,
      height: 0,
      $rContext: context,
      getContext: function (type) {
        return type === '2d' ? context : undefined
      }
    }
  }

  function createWebGLContext(width, height, readPixels) {
    return {
      drawingBufferWidth: width,
      drawingBufferHeight: height,
      FRAMEBUFFER: 1,
      FRAMEBUFFER_BINDING: 2,
      RGBA: 3,
      UNSIGNED_BYTE: 4,
      PACK_ALIGNMENT: 5,
      PACK_ROW_LENGTH: 6,
      PACK_SKIP_ROWS: 7,
      PACK_SKIP_PIXELS: 8,
      isContextLost: function () {
        return false
      },
      getParameter: jasmine.createSpy('getParameter').and.returnValue('old'),
      bindFramebuffer: jasmine.createSpy('bindFramebuffer'),
      pixelStorei: jasmine.createSpy('pixelStorei'),
      readPixels: readPixels || jasmine.createSpy('readPixels')
    }
  }

  function createCanvas(width, height, context) {
    return {
      width: width,
      height: height,
      getContext: function (type) {
        return type === 'webgl' ? context : undefined
      }
    }
  }

  function createHost(overrides) {
    var stagingCanvases = []
    var host = {
      configuration: {
        replayCanvasMaxConcurrentEncodes: 1,
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.8,
        replayCanvasMaxCanvasSize: 1024,
        replayCanvasMaxEncodedBytes: 1024 * 1024
      },
      hostEncodeCanvas: jasmine
        .createSpy('hostEncodeCanvas')
        .and.callFake(function (canvas) {
          return createEncodeLifecycle(
            {
              dataUrl: 'data:image/webp;base64,ok',
              width: canvas.width,
              height: canvas.height
            }
          )
        }),
      hostGetCanvasContextType: function () {
        return 'webgl'
      },
      hostMarkInternalCanvas: function (canvas) {
        canvas.$rInternal = true
        return canvas
      },
      createCanvas: function () {
        var canvas = createStagingCanvas()
        stagingCanvases.push(canvas)
        return canvas
      },
      createImageData: function (pixels, width, height) {
        return { data: pixels, width: width, height: height }
      }
    }
    Object.assign(host, overrides)
    return { host: host, stagingCanvases: stagingCanvases }
  }

  it('stages the original WebGL frame synchronously and delegates encoding', async () => {
    var context = createWebGLContext(200, 100)
    var source = createCanvas(200, 100, context)
    var fixture = createHost()
    var encoder = createWebGLReplayEncoder(fixture.host)

    var resultPromise = encoder.encode(source)

    expect(fixture.stagingCanvases.length).toBe(1)
    expect(
      fixture.stagingCanvases[0].$rContext.drawImage
    ).toHaveBeenCalledOnceWith(source, 0, 0, 200, 100)
    expect(fixture.host.hostEncodeCanvas).toHaveBeenCalledTimes(1)

    expect(await resultPromise).toEqual({
      dataUrl: 'data:image/webp;base64,ok',
      width: 200,
      height: 100
    })
    encoder.stop()
  })

  it('falls back to readPixels and vertically flips the framebuffer', async () => {
    var context = createWebGLContext(2, 2, function (
      x,
      y,
      width,
      height,
      format,
      type,
      pixels
    ) {
      // WebGL origin is bottom-left: bottom row first, then top row.
      pixels.set([
        1, 0, 0, 255,
        2, 0, 0, 255,
        3, 0, 0, 255,
        4, 0, 0, 255
      ])
    })
    var source = createCanvas(2, 2, context)
    var fixture = createHost({
      createCanvas: function () {
        var canvas = createStagingCanvas({
          drawImage: jasmine
            .createSpy('drawImage')
            .and.throwError('copy unavailable')
        })
        fixture.stagingCanvases.push(canvas)
        return canvas
      }
    })
    var encoder = createWebGLReplayEncoder(fixture.host)

    await encoder.encode(source)

    var imageData =
      fixture.stagingCanvases[0].$rContext.putImageData.calls.argsFor(0)[0]
    expect([
      imageData.data[0],
      imageData.data[4],
      imageData.data[8],
      imageData.data[12]
    ]).toEqual([3, 4, 1, 2])
    expect(context.bindFramebuffer.calls.first().args).toEqual([1, null])
    expect(context.bindFramebuffer.calls.mostRecent().args).toEqual([
      1,
      'old'
    ])
    expect(context.pixelStorei).toHaveBeenCalledWith(5, 1)
    expect(context.pixelStorei).toHaveBeenCalledWith(6, 0)
    encoder.stop()
  })

  it('restores WebGL2 read framebuffer and read buffer state after readPixels fallback', async () => {
    var context = createWebGLContext(2, 2)
    context.READ_FRAMEBUFFER = 9
    context.READ_FRAMEBUFFER_BINDING = 10
    context.READ_BUFFER = 11
    context.BACK = 12
    context.readBuffer = jasmine.createSpy('readBuffer')
    context.getParameter.and.callFake(function (parameter) {
      if (parameter === context.READ_FRAMEBUFFER_BINDING) {
        return 'application-framebuffer'
      }
      if (parameter === context.READ_BUFFER) {
        return 'application-read-buffer'
      }
      return 'old'
    })
    var source = createCanvas(2, 2, context)
    var fixture = createHost({
      createCanvas: function () {
        var canvas = createStagingCanvas({
          drawImage: jasmine
            .createSpy('drawImage')
            .and.throwError('copy unavailable')
        })
        fixture.stagingCanvases.push(canvas)
        return canvas
      }
    })
    var encoder = createWebGLReplayEncoder(fixture.host)

    await encoder.encode(source)

    expect(context.bindFramebuffer.calls.allArgs()).toEqual([
      [context.READ_FRAMEBUFFER, null],
      [context.READ_FRAMEBUFFER, 'application-framebuffer']
    ])
    expect(context.readBuffer.calls.allArgs()).toEqual([
      [context.BACK],
      ['application-read-buffer']
    ])
    encoder.stop()
  })

  it('retries oversized output at reduced dimensions and quality', async () => {
    var context = createWebGLContext(100, 50)
    var source = createCanvas(100, 50, context)
    var fixture = createHost()
    fixture.host.hostEncodeCanvas.and.callFake(function (canvas) {
      if (fixture.host.hostEncodeCanvas.calls.count() === 1) {
        return createEncodeLifecycle({
          ok: false,
          reason: 'encode_too_large',
          encodedBytesCount: 2000000
        })
      }
      return createEncodeLifecycle({
        dataUrl: 'data:image/webp;base64,fallback',
        width: canvas.width,
        height: canvas.height
      })
    })
    var encoder = createWebGLReplayEncoder(fixture.host)

    var result = await encoder.encode(source)

    expect(fixture.host.hostEncodeCanvas).toHaveBeenCalledTimes(2)
    var fallbackCall = fixture.host.hostEncodeCanvas.calls.argsFor(1)
    expect(fallbackCall[0].width).toBe(40)
    expect(fallbackCall[0].height).toBe(20)
    expect(fallbackCall[1].quality).toBe(0.4)
    expect(result.width).toBe(40)
    expect(result.height).toBe(20)
    encoder.stop()
  })

  it('does not retry failures that cannot be fixed by reducing image size', async () => {
    var context = createWebGLContext(100, 50)
    var source = createCanvas(100, 50, context)
    var fixture = createHost()
    fixture.host.hostEncodeCanvas.and.returnValue(
      createEncodeLifecycle({
        ok: false,
        reason: 'worker_unavailable'
      })
    )
    var encoder = createWebGLReplayEncoder(fixture.host)

    expect(await encoder.encode(source)).toEqual({
      ok: false,
      reason: 'worker_unavailable'
    })
    expect(fixture.host.hostEncodeCanvas).toHaveBeenCalledTimes(1)
    expect(fixture.stagingCanvases.length).toBe(1)
    encoder.stop()
  })

  it('bounds staged frames and keeps physical work admitted across reset', async () => {
    var firstEncode = createDeferred()
    var fixture = createHost({
      hostEncodeCanvas: jasmine
        .createSpy('hostEncodeCanvas')
        .and.callFake(function (canvas) {
          if (fixture.host.hostEncodeCanvas.calls.count() === 1) {
            return createEncodeLifecycle(firstEncode.promise)
          }
          return createEncodeLifecycle({
            dataUrl: 'data:image/webp;base64,next',
            width: canvas.width,
            height: canvas.height
          })
        })
    })
    var context = createWebGLContext(20, 20)
    var source = createCanvas(20, 20, context)
    var encoder = createWebGLReplayEncoder(fixture.host)
    var firstError
    var secondError
    var first = encoder.encode(source).catch(function (error) {
      firstError = error
    })
    var second = encoder.encode(source).catch(function (error) {
      secondError = error
    })

    await expectAsync(encoder.encode(source)).toBeRejectedWithError(
      Error,
      'WebGL replay staging queue full'
    )
    expect(fixture.host.hostEncodeCanvas).toHaveBeenCalledTimes(1)

    encoder.reset()
    await Promise.all([first, second])
    expect(firstError.message).toBe('WebGL replay encoder reset')
    expect(secondError.message).toBe('WebGL replay encoder reset')

    firstEncode.resolve({
      dataUrl: 'data:image/webp;base64,late',
      width: 20,
      height: 20
    })
    await firstEncode.promise
    await Promise.resolve()
    expect(await encoder.encode(source)).toEqual({
      dataUrl: 'data:image/webp;base64,next',
      width: 20,
      height: 20
    })
    encoder.stop()
  })

  it('returns the logical result but holds its slot until physical settlement', async () => {
    var firstPhysical = createDeferred()
    var fixture = createHost()
    fixture.host.hostEncodeCanvas.and.callFake(function (canvas) {
      if (fixture.host.hostEncodeCanvas.calls.count() === 1) {
        return createEncodeLifecycle(
          {
            dataUrl: 'data:image/webp;base64,logical',
            width: canvas.width,
            height: canvas.height
          },
          firstPhysical.promise
        )
      }
      return createEncodeLifecycle({
        dataUrl: 'data:image/webp;base64,next',
        width: canvas.width,
        height: canvas.height
      })
    })
    var source = createCanvas(20, 20, createWebGLContext(20, 20))
    var encoder = createWebGLReplayEncoder(fixture.host)

    expect((await encoder.encode(source)).dataUrl).toContain('logical')
    var next = encoder.encode(source)
    expect(fixture.host.hostEncodeCanvas).toHaveBeenCalledTimes(1)

    firstPhysical.resolve()
    await firstPhysical.promise
    await Promise.resolve()
    await Promise.resolve()
    expect(fixture.host.hostEncodeCanvas).toHaveBeenCalledTimes(2)
    await next
    encoder.stop()
  })

  it('waits for the first physical encode before drawing a size fallback', async () => {
    var firstPhysical = createDeferred()
    var fixture = createHost()
    fixture.host.hostEncodeCanvas.and.callFake(function (canvas) {
      if (fixture.host.hostEncodeCanvas.calls.count() === 1) {
        return createEncodeLifecycle(
          { ok: false, reason: 'encode_too_large' },
          firstPhysical.promise
        )
      }
      return createEncodeLifecycle({
        dataUrl: 'data:image/webp;base64,fallback',
        width: canvas.width,
        height: canvas.height
      })
    })
    var encoder = createWebGLReplayEncoder(fixture.host)
    var result = encoder.encode(
      createCanvas(100, 50, createWebGLContext(100, 50))
    )

    await Promise.resolve()
    expect(fixture.host.hostEncodeCanvas).toHaveBeenCalledTimes(1)
    firstPhysical.resolve()
    await firstPhysical.promise
    await Promise.resolve()
    await Promise.resolve()
    expect(fixture.host.hostEncodeCanvas).toHaveBeenCalledTimes(2)
    expect((await result).width).toBe(40)
    encoder.stop()
  })

  it('does not let an older fallback result overwrite a newer profile', async () => {
    var first = createDeferred()
    var second = createDeferred()
    var fixture = createHost()
    fixture.host.configuration.replayCanvasMaxConcurrentEncodes = 2
    fixture.host.hostEncodeCanvas.and.callFake(function (canvas) {
      var callCount = fixture.host.hostEncodeCanvas.calls.count()
      if (callCount === 1) {
        return createEncodeLifecycle(first.promise)
      }
      if (callCount === 2) {
        return createEncodeLifecycle(second.promise)
      }
      return createEncodeLifecycle({
        dataUrl: 'data:image/webp;base64,ok',
        width: canvas.width,
        height: canvas.height
      })
    })
    var source = createCanvas(100, 100, createWebGLContext(100, 100))
    var encoder = createWebGLReplayEncoder(fixture.host)
    var firstResult = encoder.encode(source)
    var secondResult = encoder.encode(source)

    second.resolve({
      dataUrl: 'data:image/webp;base64,newer',
      width: 100,
      height: 100
    })
    await secondResult
    first.resolve({ ok: false, reason: 'encode_too_large' })
    await firstResult

    await encoder.encode(source)
    var latestCanvas =
      fixture.host.hostEncodeCanvas.calls.mostRecent().args[0]
    expect(latestCanvas.width).toBe(100)
    expect(latestCanvas.height).toBe(100)
    encoder.stop()
  })

  it('caches the reduced fallback profile and later probes full size', async () => {
    var currentTime = 100
    var fixture = createHost({
      now: function () {
        return currentTime
      }
    })
    fixture.host.hostEncodeCanvas.and.callFake(function (canvas) {
      if (fixture.host.hostEncodeCanvas.calls.count() === 1) {
        return createEncodeLifecycle({
          ok: false,
          reason: 'encode_too_large'
        })
      }
      return createEncodeLifecycle({
        dataUrl: 'data:image/webp;base64,ok',
        width: canvas.width,
        height: canvas.height
      })
    })
    var source = createCanvas(100, 50, createWebGLContext(100, 50))
    var encoder = createWebGLReplayEncoder(fixture.host)

    await encoder.encode(source)
    expect(fixture.host.hostEncodeCanvas.calls.argsFor(1)[0].width).toBe(40)

    await encoder.encode(source)
    expect(fixture.host.hostEncodeCanvas.calls.argsFor(2)[0].width).toBe(40)
    expect(fixture.host.hostEncodeCanvas.calls.argsFor(2)[1].quality).toBe(0.4)

    currentTime += 10001
    await encoder.encode(source)
    expect(
      fixture.host.hostEncodeCanvas.calls.mostRecent().args[0].width
    ).toBe(100)
    encoder.stop()
  })

  it('does not reread the source after the host encoder rejects', async () => {
    var context = createWebGLContext(30, 20)
    var source = createCanvas(30, 20, context)
    spyOn(source, 'getContext').and.callThrough()
    var fixture = createHost({
      hostEncodeCanvas: jasmine
        .createSpy('hostEncodeCanvas')
        .and.returnValue(
          createEncodeLifecycle(Promise.reject(new Error('worker failed')))
        )
    })
    var encoder = createWebGLReplayEncoder(fixture.host)

    await expectAsync(encoder.encode(source)).toBeRejectedWithError(
      Error,
      'worker failed'
    )
    expect(source.getContext).toHaveBeenCalledTimes(1)
    expect(
      fixture.stagingCanvases[0].$rContext.drawImage
    ).toHaveBeenCalledTimes(1)
    encoder.stop()
  })

  it('caps aggregate staging backing stores by bytes', async () => {
    var held = createDeferred()
    var fixture = createHost({
      configuration: {
        replayCanvasMaxConcurrentEncodes: 4,
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.8,
        replayCanvasMaxCanvasSize: 2048,
        replayCanvasMaxEncodedBytes: 1024 * 1024
      },
      hostEncodeCanvas: jasmine
        .createSpy('hostEncodeCanvas')
        .and.returnValue(createEncodeLifecycle(held.promise))
    })
    var source = createCanvas(
      2048,
      2048,
      createWebGLContext(2048, 2048)
    )
    var encoder = createWebGLReplayEncoder(fixture.host)
    var first = encoder.encode(source)

    await expectAsync(encoder.encode(source)).toBeRejectedWithError(
      Error,
      'WebGL replay staging memory budget exceeded'
    )
    held.resolve({
      dataUrl: 'data:image/webp;base64,ok',
      width: 2048,
      height: 2048
    })
    await first
    encoder.stop()
  })

  it('limits host encode concurrency while staging queued frames immediately', async () => {
    var deferred = [createDeferred(), createDeferred(), createDeferred()]
    var thirdStarted = createDeferred()
    var fixture = createHost()
    fixture.host.configuration.replayCanvasMaxConcurrentEncodes = 2
    fixture.host.hostEncodeCanvas.and.callFake(function () {
      var callIndex = fixture.host.hostEncodeCanvas.calls.count() - 1
      if (callIndex === 2) {
        thirdStarted.resolve()
      }
      return createEncodeLifecycle(deferred[callIndex].promise)
    })
    var source = createCanvas(20, 20, createWebGLContext(20, 20))
    var encoder = createWebGLReplayEncoder(fixture.host)
    var encodes = [
      encoder.encode(source),
      encoder.encode(source),
      encoder.encode(source)
    ]

    expect(fixture.stagingCanvases.length).toBe(3)
    expect(fixture.host.hostEncodeCanvas).toHaveBeenCalledTimes(2)
    deferred[0].resolve({ dataUrl: 'first', width: 20, height: 20 })
    await thirdStarted.promise
    expect(fixture.host.hostEncodeCanvas).toHaveBeenCalledTimes(3)
    deferred[1].resolve({ dataUrl: 'second', width: 20, height: 20 })
    deferred[2].resolve({ dataUrl: 'third', width: 20, height: 20 })
    await Promise.all(encodes)
    encoder.stop()
  })

  it('rejects active callers on stop and does not admit later work', async () => {
    var held = createDeferred()
    var fixture = createHost({
      hostEncodeCanvas: jasmine
        .createSpy('hostEncodeCanvas')
        .and.returnValue(createEncodeLifecycle(held.promise))
    })
    var source = createCanvas(10, 10, createWebGLContext(10, 10))
    var encoder = createWebGLReplayEncoder(fixture.host)
    var activeError
    var active = encoder.encode(source).catch(function (error) {
      activeError = error
    })

    encoder.stop()
    await active
    expect(activeError.message).toBe('WebGL replay encoder stopped')
    await expectAsync(encoder.encode(source)).toBeRejectedWithError(
      Error,
      'WebGL replay encoder stopped'
    )
    held.resolve({ dataUrl: 'late', width: 10, height: 10 })
    await held.promise
  })

  it('requires the stable base host callbacks', () => {
    expect(function () {
      createWebGLReplayEncoder({})
    }).toThrowError(Error, 'WebGL replay encoder requires hostEncodeCanvas')
  })

  it('rejects an invalid host lifecycle without retrying the source', async () => {
    var fixture = createHost({
      hostEncodeCanvas: jasmine
        .createSpy('hostEncodeCanvas')
        .and.returnValue(Promise.resolve({ dataUrl: 'legacy' }))
    })
    var encoder = createWebGLReplayEncoder(fixture.host)

    await expectAsync(
      encoder.encode(
        createCanvas(10, 10, createWebGLContext(10, 10))
      )
    ).toBeRejectedWithError(
      Error,
      'WebGL replay host returned an invalid encode lifecycle'
    )
    expect(fixture.host.hostEncodeCanvas).toHaveBeenCalledTimes(1)
    encoder.stop()
  })

  it('rejects lost, empty, and over-budget readback frames', async () => {
    var fixture = createHost()
    var lost = createWebGLContext(10, 10)
    lost.isContextLost = function () {
      return true
    }
    var encoder = createWebGLReplayEncoder(fixture.host)
    await expectAsync(
      encoder.encode(createCanvas(10, 10, lost))
    ).toBeRejectedWithError(Error, 'WebGL context is lost')

    var empty = createWebGLContext(0, 0)
    await expectAsync(
      encoder.encode(createCanvas(10, 10, empty))
    ).toBeRejectedWithError(Error, 'WebGL drawing buffer is empty')
    encoder.stop()

    fixture = createHost({
      createCanvas: function () {
        var canvas = createStagingCanvas({
          drawImage: jasmine
            .createSpy('drawImage')
            .and.throwError('force readback')
        })
        fixture.stagingCanvases.push(canvas)
        return canvas
      }
    })
    encoder = createWebGLReplayEncoder(fixture.host)
    var large = createWebGLContext(3840, 2160)
    await expectAsync(
      encoder.encode(createCanvas(1024, 576, large))
    ).toBeRejectedWithError(
      Error,
      'WebGL replay readback exceeds the peak memory limit'
    )
    expect(fixture.host.hostEncodeCanvas).not.toHaveBeenCalled()
    encoder.stop()
  })

  it('rejects new work after stop', async () => {
    var fixture = createHost()
    var encoder = createWebGLReplayEncoder(fixture.host)
    encoder.stop()

    await expectAsync(
      encoder.encode(
        createCanvas(10, 10, createWebGLContext(10, 10))
      )
    ).toBeRejectedWithError(Error, 'WebGL replay encoder stopped')
  })
})
