import { IncrementalSource, RecordType } from '../../../types'
import { createCanvas2DCommandRecorder } from './canvasCommandCapture'

describe('replay/record/canvasCommandCapture', () => {
  function createFakeContext() {
    var canvas = document.createElement('canvas')
    canvas.__sn = { id: 42 }
    return {
      canvas: canvas,
      fillStyle: '#000',
      strokeStyle: '#111',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 10,
      shadowColor: '#000',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      filter: 'none',
      save: jasmine.createSpy('save'),
      restore: jasmine.createSpy('restore'),
      translate: jasmine.createSpy('translate'),
      scale: jasmine.createSpy('scale'),
      rotate: jasmine.createSpy('rotate'),
      transform: jasmine.createSpy('transform'),
      setTransform: jasmine.createSpy('setTransform'),
      createLinearGradient: jasmine.createSpy('createLinearGradient'),
      createRadialGradient: jasmine.createSpy('createRadialGradient'),
      createPattern: jasmine.createSpy('createPattern'),
      createConicGradient: jasmine.createSpy('createConicGradient'),
      clearRect: jasmine.createSpy('clearRect'),
      fillRect: jasmine.createSpy('fillRect'),
      strokeRect: jasmine.createSpy('strokeRect'),
      rect: jasmine.createSpy('rect'),
      beginPath: jasmine.createSpy('beginPath'),
      moveTo: jasmine.createSpy('moveTo'),
      lineTo: jasmine.createSpy('lineTo'),
      bezierCurveTo: jasmine.createSpy('bezierCurveTo'),
      quadraticCurveTo: jasmine.createSpy('quadraticCurveTo'),
      closePath: jasmine.createSpy('closePath'),
      fill: jasmine.createSpy('fill'),
      stroke: jasmine.createSpy('stroke'),
      ellipse: jasmine.createSpy('ellipse'),
      roundRect: jasmine.createSpy('roundRect'),
      clip: jasmine.createSpy('clip'),
      setLineDash: jasmine.createSpy('setLineDash'),
      fillText: jasmine.createSpy('fillText'),
      strokeText: jasmine.createSpy('strokeText'),
      drawImage: jasmine.createSpy('drawImage')
    }
  }

  it('should capture 2d method calls in order and flush them together on animation frame', () => {
    var events = []
    var context = createFakeContext()
    var recordedFrameCallback
    var recorder = createCanvas2DCommandRecorder({
      now: function () {
        return 100
      },
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)

    context.beginPath()
    context.moveTo(0, 1)
    context.lineTo(2, 3)
    context.stroke()

    expect(events).toEqual([])
    recordedFrameCallback()

    expect(events[0].type).toBe(RecordType.IncrementalSnapshot)
    expect(events[0].data.source).toBe(IncrementalSource.CanvasMutation)
    expect(events[0].data.commands.map(function (command) {
      return command.property
    })).toEqual(['beginPath', 'moveTo', 'lineTo', 'stroke'])
    expect(events[0].data.id).toBe(42)
    expect(events[0].data.commands.map(function (command) {
      return command.setter === true
    })).toEqual([false, false, false, false])
  })

  it('should capture property updates', () => {
    var events = []
    var context = createFakeContext()
    var recordedFrameCallback
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)

    context.fillStyle = '#f00'
    context.lineWidth = 4

    recordedFrameCallback()

    expect(events[0].data.commands).toEqual([
      jasmine.objectContaining({
        property: 'fillStyle',
        args: ['#f00'],
        setter: true
      }),
      jasmine.objectContaining({
        property: 'lineWidth',
        args: [4],
        setter: true
      })
    ])
  })

  it('should preserve native property behavior when patching setters', () => {
    var events = []
    var context = createFakeContext()
    var storedFillStyle = '#000'
    Object.defineProperty(context, 'fillStyle', {
      configurable: true,
      enumerable: true,
      get: function () {
        return storedFillStyle
      },
      set: function (value) {
        storedFillStyle = value
      }
    })
    var recordedFrameCallback
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.fillStyle = '#0ea5e9'

    expect(storedFillStyle).toBe('#0ea5e9')
    expect(context.fillStyle).toBe('#0ea5e9')

    recordedFrameCallback()

    expect(events[0].data.commands[0]).toEqual(
      jasmine.objectContaining({
        property: 'fillStyle',
        args: ['#0ea5e9'],
        setter: true
      })
    )
  })

  it('should request snapshot fallback when gradient is assigned to style', () => {
    var recordedFrameCallback
    var fallbackContexts = []
    var context = createFakeContext()
    var gradient = { constructor: { name: 'CanvasGradient' } }
    context.createLinearGradient.and.returnValue(gradient)
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      requestSnapshotFallback: function (fallbackContext) {
        fallbackContexts.push(fallbackContext)
      },
      emit: function (event) {
        fail('should not emit command batch for gradient style assignment')
      }
    })

    recorder.patchContext(context)
    var createdGradient = context.createLinearGradient(0, 0, 100, 0)
    context.fillStyle = createdGradient
    recordedFrameCallback()

    expect(fallbackContexts).toEqual([context])
  })

  it('should request snapshot fallback when gradient color stops are used', () => {
    var events = []
    var fallbackRequests = []
    var recordedFrameCallback
    var context = createFakeContext()
    var originalAddColorStop = jasmine.createSpy('addColorStop')
    var gradient = {
      constructor: { name: 'CanvasGradient' },
      addColorStop: originalAddColorStop
    }
    context.createLinearGradient.and.returnValue(gradient)
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    var createdGradient = context.createLinearGradient(0, 0, 100, 0)
    createdGradient.addColorStop(0, '#111')
    context.fillStyle = createdGradient
    recordedFrameCallback()

    expect(originalAddColorStop).toHaveBeenCalledWith(0, '#111')
    expect(fallbackRequests).toEqual([
      { context: context, reason: 'gradient_color_stop' },
      { context: context, reason: 'gradient_color_stop' }
    ])
    expect(events).toEqual([])
  })

  it('should keep patched gradient methods callable after stop without preserving capture state', () => {
    var context = createFakeContext()
    var originalAddColorStop = jasmine.createSpy('addColorStop')
    var gradient = {
      constructor: { name: 'CanvasGradient' },
      addColorStop: originalAddColorStop
    }
    context.createLinearGradient.and.returnValue(gradient)
    var fallbackRequests = []
    var recorder = createCanvas2DCommandRecorder({
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function () {}
    })

    recorder.patchContext(context)
    var createdGradient = context.createLinearGradient(0, 0, 100, 0)

    expect(createdGradient.addColorStop).not.toBe(originalAddColorStop)

    recorder.stop()

    expect(createdGradient.addColorStop).toBe(originalAddColorStop)

    createdGradient.addColorStop(0.5, '#222')

    expect(originalAddColorStop).toHaveBeenCalledWith(0.5, '#222')
    expect(fallbackRequests).toEqual([])
  })

  it('should restore patched gradient methods on stop even when WeakRef is unavailable', () => {
    var context = createFakeContext()
    var originalAddColorStop = jasmine.createSpy('addColorStop')
    var gradient = {
      constructor: { name: 'CanvasGradient' },
      addColorStop: originalAddColorStop
    }
    context.createLinearGradient.and.returnValue(gradient)
    var recorder = createCanvas2DCommandRecorder({
      weakRefFactory: null,
      emit: function () {}
    })

    recorder.patchContext(context)
    var createdGradient = context.createLinearGradient(0, 0, 100, 0)

    expect(createdGradient.addColorStop).not.toBe(originalAddColorStop)

    recorder.stop()

    expect(createdGradient.addColorStop).toBe(originalAddColorStop)
  })

  it('should request snapshot fallback when canvas pattern is assigned to style', () => {
    var events = []
    var fallbackContexts = []
    var recordedFrameCallback
    var context = createFakeContext()
    var pattern = { constructor: { name: 'CanvasPattern' } }
    context.createPattern.and.returnValue(pattern)
    var sourceCanvas = document.createElement('canvas')
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      requestSnapshotFallback: function (fallbackContext) {
        fallbackContexts.push(fallbackContext)
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    var createdPattern = context.createPattern(sourceCanvas, 'repeat')
    context.fillStyle = createdPattern
    recordedFrameCallback()

    expect(fallbackContexts).toEqual([context])
    expect(events).toEqual([])
  })

  it('should request snapshot fallback when canvas pattern is assigned to strokeStyle', () => {
    var events = []
    var fallbackRequests = []
    var recordedFrameCallback
    var context = createFakeContext()
    var pattern = { constructor: { name: 'CanvasPattern' } }
    context.createPattern.and.returnValue(pattern)
    var sourceCanvas = document.createElement('canvas')
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.beginPath()
    context.moveTo(0, 0)
    var createdPattern = context.createPattern(sourceCanvas, 'repeat')
    context.strokeStyle = createdPattern
    recordedFrameCallback()

    expect(fallbackRequests).toEqual([
      { context: context, reason: 'canvas_pattern' }
    ])
    expect(events).toEqual([])
  })

  it('should request snapshot fallback when path2d is used in method arguments', () => {
    var events = []
    var fallbackContexts = []
    var recordedFrameCallback
    var context = createFakeContext()
    var path2d = { constructor: { name: 'Path2D' } }
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      requestSnapshotFallback: function (fallbackContext) {
        fallbackContexts.push(fallbackContext)
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.fill(path2d)

    expect(fallbackContexts).toEqual([context])
    expect(events).toEqual([])
  })

  it('should fallback drawImage canvas sources without synchronously exporting them', () => {
    var events = []
    var fallbackRequests = []
    var context = createFakeContext()
    var originalDrawImage = context.drawImage
    var sourceCanvas = document.createElement('canvas')
    spyOn(sourceCanvas, 'toDataURL')
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function () {
        return 1
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.drawImage(sourceCanvas, 0, 0)

    expect(sourceCanvas.toDataURL).not.toHaveBeenCalled()
    expect(fallbackRequests).toEqual([
      { context: context, reason: 'draw_image_canvas' }
    ])

    expect(events).toEqual([])
    expect(originalDrawImage).toHaveBeenCalledWith(sourceCanvas, 0, 0)
  })

  it('should drop already queued commands after a context switches to snapshot fallback', () => {
    var events = []
    var fallbackRequests = []
    var recordedFrameCallback
    var context = createFakeContext()
    var path2d = { constructor: { name: 'Path2D' } }
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.beginPath()
    context.moveTo(1, 2)
    context.fill(path2d)
    recordedFrameCallback()

    expect(fallbackRequests).toEqual([
      { context: context, reason: 'path2d_argument' }
    ])
    expect(events).toEqual([])
  })

  it('should keep the original fallback reason during a later flush cycle', () => {
    var events = []
    var fallbackRequests = []
    var recordedFrameCallback
    var context = createFakeContext()
    var path2d = { constructor: { name: 'Path2D' } }
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.beginPath()
    context.moveTo(1, 2)
    context.fill(path2d)
    context.fillRect(3, 4, 5, 6)
    recordedFrameCallback()

    expect(fallbackRequests).toEqual([
      { context: context, reason: 'path2d_argument' },
      { context: context, reason: 'path2d_argument' }
    ])
    expect(events).toEqual([])
  })

  it('should keep other contexts on command path when one context falls back', () => {
    var events = []
    var fallbackRequests = []
    var recordedFrameCallback
    var firstContext = createFakeContext()
    var secondContext = createFakeContext()
    secondContext.canvas.__sn.id = 84
    var path2d = { constructor: { name: 'Path2D' } }
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(firstContext)
    recorder.patchContext(secondContext)

    firstContext.fill(path2d)
    secondContext.fillRect(3, 4, 5, 6)
    recordedFrameCallback()

    expect(fallbackRequests).toEqual([
      { context: firstContext, reason: 'path2d_argument' }
    ])
    expect(events.length).toBe(1)
    expect(events[0].data.id).toBe(84)
    expect(events[0].data.commands).toEqual([
      jasmine.objectContaining({
        property: 'fillRect'
      })
    ])
  })

  it('should let a previously-fallback context rejoin command capture after pause and resume', () => {
    var events = []
    var fallbackRequests = []
    var recordedFrameCallback
    var firstContext = createFakeContext()
    var secondContext = createFakeContext()
    secondContext.canvas.__sn.id = 84
    var path2d = { constructor: { name: 'Path2D' } }
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(firstContext)
    recorder.patchContext(secondContext)

    firstContext.fill(path2d)
    secondContext.fillRect(3, 4, 5, 6)
    recordedFrameCallback()

    recorder.pause()
    recorder.resume()

    firstContext.beginPath()
    firstContext.moveTo(1, 2)
    firstContext.lineTo(3, 4)
    firstContext.stroke()
    secondContext.clearRect(0, 0, 10, 10)
    recordedFrameCallback()

    expect(fallbackRequests).toEqual([
      { context: firstContext, reason: 'path2d_argument' }
    ])
    expect(events.length).toBe(3)
    expect(events[0].data.id).toBe(84)
    expect(events[0].data.commands[0]).toEqual(
      jasmine.objectContaining({
        property: 'fillRect'
      })
    )
    expect(events[1].data.id).toBe(42)
    expect(events[1].data.commands.map(function (command) {
      return command.property
    })).toEqual(['beginPath', 'moveTo', 'lineTo', 'stroke'])
    expect(events[2].data.id).toBe(84)
    expect(events[2].data.commands[0]).toEqual(
      jasmine.objectContaining({
        property: 'clearRect'
      })
    )
  })

  it('should keep the first path2d fallback reason when gradient work follows in the same frame', () => {
    var events = []
    var fallbackRequests = []
    var recordedFrameCallback
    var context = createFakeContext()
    var path2d = { constructor: { name: 'Path2D' } }
    var gradient = { constructor: { name: 'CanvasGradient' } }
    context.createLinearGradient.and.returnValue(gradient)
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.beginPath()
    context.fill(path2d)
    context.fillStyle = context.createLinearGradient(0, 0, 100, 0)
    recordedFrameCallback()

    expect(fallbackRequests).toEqual([
      { context: context, reason: 'path2d_argument' },
      { context: context, reason: 'path2d_argument' }
    ])
    expect(events).toEqual([])
  })

  it('should keep the first path2d fallback reason when pattern work follows in the same frame', () => {
    var events = []
    var fallbackRequests = []
    var recordedFrameCallback
    var context = createFakeContext()
    var path2d = { constructor: { name: 'Path2D' } }
    var pattern = { constructor: { name: 'CanvasPattern' } }
    var sourceCanvas = document.createElement('canvas')
    context.createPattern.and.returnValue(pattern)
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.beginPath()
    context.fill(path2d)
    context.strokeStyle = context.createPattern(sourceCanvas, 'repeat')
    recordedFrameCallback()

    expect(fallbackRequests).toEqual([
      { context: context, reason: 'path2d_argument' },
      { context: context, reason: 'path2d_argument' }
    ])
    expect(events).toEqual([])
  })

  it('should keep the first path2d fallback reason when drawImage follows in the same frame', () => {
    var events = []
    var fallbackRequests = []
    var recordedFrameCallback
    var context = createFakeContext()
    var path2d = { constructor: { name: 'Path2D' } }
    var image = document.createElement('img')
    image.src = 'https://cdn.example.com/chart.png'
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.beginPath()
    context.fill(path2d)
    context.drawImage(image, 0, 1, 200, 100)
    recordedFrameCallback()

    expect(fallbackRequests).toEqual([
      { context: context, reason: 'path2d_argument' },
      { context: context, reason: 'path2d_argument' }
    ])
    expect(events).toEqual([])
  })

  it('should clear path2d fallback state after pause and allow later command batches', () => {
    var events = []
    var fallbackRequests = []
    var recordedFrameCallback
    var context = createFakeContext()
    var path2d = { constructor: { name: 'Path2D' } }
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)

    context.fill(path2d)

    recorder.pause()
    recorder.resume()

    context.beginPath()
    context.moveTo(0, 0)
    context.lineTo(5, 6)
    context.stroke()
    recordedFrameCallback()

    expect(fallbackRequests).toEqual([
      { context: context, reason: 'path2d_argument' }
    ])
    expect(typeof recordedFrameCallback).toBe('function')
    expect(events.length).toBe(1)
    expect(events[0].data.id).toBe(42)
    expect(events[0].data.commands.map(function (command) {
      return command.property
    })).toEqual(['beginPath', 'moveTo', 'lineTo', 'stroke'])
  })

  it('should clear path2d fallback state after reset and allow later command batches', () => {
    var events = []
    var fallbackRequests = []
    var recordedFrameCallback
    var context = createFakeContext()
    var path2d = { constructor: { name: 'Path2D' } }
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.fill(path2d)

    recorder.reset()

    context.beginPath()
    context.moveTo(0, 0)
    context.lineTo(5, 6)
    context.stroke()
    recordedFrameCallback()

    expect(fallbackRequests).toEqual([
      { context: context, reason: 'path2d_argument' }
    ])
    expect(events.length).toBe(1)
    expect(events[0].data.id).toBe(42)
    expect(events[0].data.commands.map(function (command) {
      return command.property
    })).toEqual(['beginPath', 'moveTo', 'lineTo', 'stroke'])
  })

  it('should serialize drawImage sources before emitting method commands', () => {
    var events = []
    var context = createFakeContext()
    var image = document.createElement('img')
    image.src = 'data:image/png;base64,QUJD'
    var recordedFrameCallback
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)

    context.drawImage(image, 0, 1, 200, 100)
    recordedFrameCallback()

    expect(events[0].data.commands[0]).toEqual(
      jasmine.objectContaining({
        property: 'drawImage',
        args: [
          {
            rr_type: 'HTMLImageElement',
            src: 'data:image/png;base64,QUJD'
          },
          0,
          1,
          200,
          100
        ]
      })
    )
  })

  it('should request snapshot fallback when drawImage uses html video element', () => {
    var events = []
    var fallbackRequests = []
    var context = createFakeContext()
    var video = document.createElement('video')
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function () {
        fail('should not schedule command flush for unsupported drawImage source')
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.drawImage(video, 0, 1, 200, 100)

    expect(fallbackRequests).toEqual([
      { context: context, reason: 'draw_image_video' }
    ])
    expect(events).toEqual([])
  })

  it('should request snapshot fallback when drawImage uses cross-origin image element', () => {
    var events = []
    var fallbackRequests = []
    var context = createFakeContext()
    var image = document.createElement('img')
    image.src = 'https://cdn.example.com/chart.png'
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function () {
        fail('should not schedule command flush for unsupported drawImage source')
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.drawImage(image, 0, 1, 200, 100)

    expect(fallbackRequests).toEqual([
      { context: context, reason: 'draw_image_cross_origin' }
    ])
    expect(events).toEqual([])
  })

  it('should request snapshot fallback when drawImage uses a tainted canvas source', () => {
    var events = []
    var fallbackRequests = []
    var context = createFakeContext()
    var sourceCanvas = document.createElement('canvas')
    spyOn(sourceCanvas, 'toDataURL')
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function () {
        fail('should not schedule command flush for unsupported drawImage source')
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.drawImage(sourceCanvas, 0, 1, 200, 100)

    expect(sourceCanvas.toDataURL).not.toHaveBeenCalled()
    expect(fallbackRequests).toEqual([
      { context: context, reason: 'draw_image_canvas' }
    ])
    expect(events).toEqual([])
  })

  it('should batch commands per context without mixing multiple contexts', () => {
    var events = []
    var firstFrameCallback
    var secondFrameCallback
    var rafCount = 0
    var firstContext = createFakeContext()
    var secondContext = createFakeContext()
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        rafCount += 1
        if (rafCount === 1) {
          firstFrameCallback = callback
        } else {
          secondFrameCallback = callback
        }
        return rafCount
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(firstContext)
    recorder.patchContext(secondContext)

    firstContext.fillRect(1, 2, 3, 4)
    secondContext.clearRect(0, 0, 10, 10)
    firstFrameCallback()

    expect(events.length).toBe(2)
    expect(events[0].data.id).toBe(42)
    expect(events[0].data.commands[0]).toEqual(
      jasmine.objectContaining({
        property: 'fillRect'
      })
    )
    expect(events[1].data.id).toBe(42)
    expect(events[1].data.commands[0]).toEqual(
      jasmine.objectContaining({
        property: 'clearRect'
      })
    )

    firstContext.stroke()
    secondFrameCallback()

    expect(events.length).toBe(3)
    expect(events[2].data.id).toBe(42)
    expect(events[2].data.commands[0]).toEqual(
      jasmine.objectContaining({
        property: 'stroke'
      })
    )
  })

  it('should fallback when drawImage uses another canvas as the source', () => {
    var events = []
    var fallbackRequests = []
    var context = createFakeContext()
    var sourceCanvas = document.createElement('canvas')
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function () {
        fail('should not schedule command flush for canvas drawImage fallback')
        return 1
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.drawImage(sourceCanvas, 5, 6)

    expect(fallbackRequests).toEqual([
      { context: context, reason: 'draw_image_canvas' }
    ])
    expect(events).toEqual([])
  })

  it('should capture chart path helpers used by dashboard rendering', () => {
    var events = []
    var recordedFrameCallback
    var context = createFakeContext()
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.beginPath()
    context.moveTo(10, 10)
    context.quadraticCurveTo(20, 20, 30, 30)
    context.closePath()
    context.roundRect(4, 5, 60, 20, 8)
    context.setLineDash([4, 6])
    recordedFrameCallback()

    expect(events[0].data.commands).toEqual([
      jasmine.objectContaining({
        property: 'beginPath',
        args: []
      }),
      jasmine.objectContaining({
        property: 'moveTo',
        args: [10, 10]
      }),
      jasmine.objectContaining({
        property: 'quadraticCurveTo',
        args: [20, 20, 30, 30]
      }),
      jasmine.objectContaining({
        property: 'closePath',
        args: []
      }),
      jasmine.objectContaining({
        property: 'roundRect',
        args: [4, 5, 60, 20, 8]
      }),
      jasmine.objectContaining({
        property: 'setLineDash',
        args: [[4, 6]]
      })
    ])
  })

  it('should capture transform and state commands in order', () => {
    var events = []
    var recordedFrameCallback
    var context = createFakeContext()
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.save()
    context.translate(8, 12)
    context.scale(2, 0.5)
    context.rotate(Math.PI / 4)
    context.transform(1, 0, 0, 1, 3, 4)
    context.setTransform(1, 0, 0, 1, 5, 6)
    context.restore()
    recordedFrameCallback()

    expect(events[0].data.commands).toEqual([
      jasmine.objectContaining({ property: 'save', args: [] }),
      jasmine.objectContaining({ property: 'translate', args: [8, 12] }),
      jasmine.objectContaining({ property: 'scale', args: [2, 0.5] }),
      jasmine.objectContaining({ property: 'rotate', args: [Math.PI / 4] }),
      jasmine.objectContaining({ property: 'transform', args: [1, 0, 0, 1, 3, 4] }),
      jasmine.objectContaining({ property: 'setTransform', args: [1, 0, 0, 1, 5, 6] }),
      jasmine.objectContaining({ property: 'restore', args: [] })
    ])
  })

  it('should capture additional style properties used by richer charts', () => {
    var events = []
    var recordedFrameCallback
    var context = createFakeContext()
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.miterLimit = 4
    context.shadowColor = 'rgba(15,23,42,0.2)'
    context.shadowBlur = 12
    context.shadowOffsetX = 2
    context.shadowOffsetY = 3
    context.filter = 'blur(2px)'
    recordedFrameCallback()

    expect(events[0].data.commands).toEqual([
      jasmine.objectContaining({ property: 'lineCap', args: ['round'], setter: true }),
      jasmine.objectContaining({ property: 'lineJoin', args: ['round'], setter: true }),
      jasmine.objectContaining({ property: 'miterLimit', args: [4], setter: true }),
      jasmine.objectContaining({
        property: 'shadowColor',
        args: ['rgba(15,23,42,0.2)'],
        setter: true
      }),
      jasmine.objectContaining({ property: 'shadowBlur', args: [12], setter: true }),
      jasmine.objectContaining({ property: 'shadowOffsetX', args: [2], setter: true }),
      jasmine.objectContaining({ property: 'shadowOffsetY', args: [3], setter: true }),
      jasmine.objectContaining({ property: 'filter', args: ['blur(2px)'], setter: true })
    ])
  })

  it('should restore patched contexts on stop', () => {
    var context = createFakeContext()
    var originalFillRect = context.fillRect
    var cancelAnimationFrameImpl = jasmine.createSpy('cancelAnimationFrame')
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function () {
        return 9
      },
      cancelAnimationFrameImpl: cancelAnimationFrameImpl
    })

    recorder.patchContext(context)
    context.fillRect(1, 2, 3, 4)
    recorder.stop()

    expect(cancelAnimationFrameImpl).toHaveBeenCalledWith(9)
    expect(context.fillRect).toBe(originalFillRect)
    expect(context.__dd_command_capture__).toBeUndefined()
  })

  it('should ignore double patch on the same context', () => {
    var events = []
    var recordedFrameCallback
    var context = createFakeContext()
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    recorder.patchContext(context)

    context.fillRect(1, 2, 3, 4)
    recordedFrameCallback()

    expect(events.length).toBe(1)
    expect(events[0].data.commands[0]).toEqual(
      jasmine.objectContaining({
        property: 'fillRect',
        args: [1, 2, 3, 4]
      })
    )
  })

  it('should allow manual flush without waiting for animation frame', () => {
    var events = []
    var context = createFakeContext()
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: jasmine.createSpy('requestAnimationFrame').and.returnValue(1),
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.fillText('value', 10, 20)
    recorder.flush()

    expect(events.length).toBe(1)
    expect(events[0].data.commands[0]).toEqual(
      jasmine.objectContaining({
        property: 'fillText',
        args: ['value', 10, 20]
      })
    )
  })

  it('should skip emitting pending commands when no valid canvas id is available', () => {
    var events = []
    var context = createFakeContext()
    delete context.canvas.__sn
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: jasmine.createSpy('requestAnimationFrame').and.returnValue(1),
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.fillRect(1, 2, 3, 4)
    recorder.flush()

    expect(events).toEqual([])
  })

  it('should drop pending commands and stop capturing while paused', () => {
    var events = []
    var context = createFakeContext()
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: jasmine.createSpy('requestAnimationFrame').and.returnValue(1),
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.fillRect(1, 2, 3, 4)
    recorder.pause()
    recorder.flush()
    context.fillRect(5, 6, 7, 8)
    recorder.flush()

    expect(events).toEqual([])

    recorder.resume()
    context.fillRect(9, 10, 11, 12)
    recorder.flush()

    expect(events.length).toBe(1)
    expect(events[0].data.commands).toEqual([
      jasmine.objectContaining({
        property: 'fillRect',
        args: [9, 10, 11, 12]
      })
    ])
  })

  it('should capture commands from a real browser 2d context', () => {
    var events = []
    var recordedFrameCallback
    var canvas = document.createElement('canvas')
    canvas.width = 120
    canvas.height = 60
    canvas.__sn = { id: 77 }
    var context = canvas.getContext('2d')
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.fillStyle = '#0ea5e9'
    context.fillRect(0, 0, 20, 10)
    recordedFrameCallback()

    expect(events.length).toBe(1)
    expect(events[0].data.id).toBe(77)
    expect(events[0].data.commands).toEqual([
      jasmine.objectContaining({
        property: 'fillStyle',
        args: ['#0ea5e9'],
        setter: true
      }),
      jasmine.objectContaining({
        property: 'fillRect',
        args: [0, 0, 20, 10]
      })
    ])
  })

  it('should preserve batch startedAt separately from flush completion time', () => {
    var events = []
    var context = createFakeContext()
    var recordedFrameCallback
    var currentTime = 100
    var recorder = createCanvas2DCommandRecorder({
      now: function () {
        return currentTime
      },
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)

    context.fillRect(1, 2, 3, 4)
    currentTime = 145
    recordedFrameCallback()

    expect(events.length).toBe(1)
    expect(events[0].startedAt).toBe(100)
    expect(events[0].completedAt).toBe(145)
    expect(events[0].timestamp).toBe(145)
  })
})
