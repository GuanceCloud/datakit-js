import { IncrementalSource, RecordType } from '../../../types'
import {
  createCanvas2DCommandRecorder,
  MAX_CANVAS_OPAQUE_OBJECT_RESTORE_RECORDS,
  MAX_CANVAS_COMMAND_BATCH_BYTES,
  MAX_CANVAS_COMMANDS_PER_BATCH,
  MAX_PENDING_CANVAS_COMMAND_BYTES,
  MAX_PENDING_CANVAS_COMMAND_CONTEXTS,
  MAX_UNPUBLISHED_CANVAS_COMMAND_RETENTION_MS,
  MAX_STRONG_CANVAS_CONTEXT_RESTORE_RECORDS
} from './canvasCommandCapture'

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
      lineDashOffset: 0,
      globalCompositeOperation: 'source-over',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'low',
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
      resetTransform: jasmine.createSpy('resetTransform'),
      reset: jasmine.createSpy('reset'),
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
      arcTo: jasmine.createSpy('arcTo'),
      closePath: jasmine.createSpy('closePath'),
      fill: jasmine.createSpy('fill'),
      stroke: jasmine.createSpy('stroke'),
      ellipse: jasmine.createSpy('ellipse'),
      roundRect: jasmine.createSpy('roundRect'),
      clip: jasmine.createSpy('clip'),
      setLineDash: jasmine.createSpy('setLineDash'),
      fillText: jasmine.createSpy('fillText'),
      strokeText: jasmine.createSpy('strokeText'),
      putImageData: jasmine.createSpy('putImageData'),
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

  it('should flush only the requested context before the shared animation frame', () => {
    var events = []
    var firstContext = createFakeContext()
    var secondContext = createFakeContext()
    secondContext.canvas.__sn = { id: 43 }
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

    recorder.patchContext(firstContext)
    recorder.patchContext(secondContext)
    firstContext.fillRect(0, 0, 1, 1)
    secondContext.fillRect(0, 0, 2, 2)

    recorder.flushContext(firstContext)

    expect(events.length).toBe(1)
    expect(events[0].data.id).toBe(42)
    expect(events[0].data.commands).toEqual([
      jasmine.objectContaining({
        property: 'fillRect',
        args: [0, 0, 1, 1]
      })
    ])

    recordedFrameCallback()
    expect(events.length).toBe(2)
    expect(events[1].data.id).toBe(43)
    expect(events[1].data.commands).toEqual([
      jasmine.objectContaining({
        property: 'fillRect',
        args: [0, 0, 2, 2]
      })
    ])
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

  it('should capture common pixel, path, reset and compositing APIs', () => {
    var events = []
    var context = createFakeContext()
    var recordedFrameCallback
    var imageData = new ImageData(new Uint8ClampedArray(16), 2, 2)
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
    context.arcTo(1, 2, 3, 4, 5)
    context.resetTransform()
    context.reset()
    context.putImageData(imageData, 6, 7)
    context.globalCompositeOperation = 'multiply'
    context.lineDashOffset = 2
    context.imageSmoothingEnabled = false
    context.imageSmoothingQuality = 'high'
    recordedFrameCallback()

    expect(events[0].data.commands.map(function (command) {
      return command.property
    })).toEqual([
      'arcTo',
      'resetTransform',
      'reset',
      'putImageData',
      'globalCompositeOperation',
      'lineDashOffset',
      'imageSmoothingEnabled',
      'imageSmoothingQuality'
    ])
    expect(events[0].data.commands[3].args[0]).toEqual({
      rr_type: 'ImageData',
      args: [
        {
          rr_type: 'Uint8ClampedArray',
          args: [jasmine.any(Array)]
        },
        2,
        2
      ]
    })
  })

  it('should force a pre-existing shared-prototype context onto snapshot fallback', () => {
    var fallbackRequests = []
    var frameCallbacks = []
    var originalFillRect = jasmine.createSpy('fillRect')
    var sharedPrototype = {
      fillRect: originalFillRect
    }
    var context = Object.create(sharedPrototype)
    context.canvas = document.createElement('canvas')
    context.canvas.__sn = { id: 43 }
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function () {
        frameCallbacks.push(arguments[0])
        return frameCallbacks.length
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({
          context: fallbackContext,
          reason: reason
        })
      },
      emit: function () {
        fail('pre-existing contexts must not emit commands without a baseline')
      }
    })

    recorder.patchSharedPrototype(sharedPrototype)
    context.fillRect(1, 2, 3, 4)

    expect(originalFillRect).toHaveBeenCalledWith(1, 2, 3, 4)
    expect(fallbackRequests).toEqual([
      {
        context: context,
        reason: 'existing_canvas_context'
      }
    ])

    frameCallbacks.shift()()
    recorder.reset()
    context.fillRect(5, 6, 7, 8)
    frameCallbacks.shift()()

    expect(fallbackRequests).toEqual([
      {
        context: context,
        reason: 'existing_canvas_context'
      },
      {
        context: context,
        reason: 'existing_canvas_context'
      }
    ])
    recorder.stop()
  })

  it('should snapshot-fallback unknown mutating methods instead of dropping them', () => {
    var fallbackRequests = []
    var context = createFakeContext()
    var originalFutureDraw = jasmine
      .createSpy('futureDraw')
      .and.returnValue('future-result')
    context.futureDraw = originalFutureDraw
    var recorder = createCanvas2DCommandRecorder({
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({
          context: fallbackContext,
          reason: reason
        })
      },
      emit: function () {
        fail('unknown mutations must not be emitted as replay commands')
      }
    })

    recorder.patchContext(context)

    expect(context.futureDraw(1, 2)).toBe('future-result')
    expect(originalFutureDraw).toHaveBeenCalledWith(1, 2)
    expect(fallbackRequests).toEqual([
      {
        context: context,
        reason: 'unsupported_canvas_method'
      }
    ])
    recorder.stop()
    expect(context.futureDraw).toBe(originalFutureDraw)
  })

  it('should force snapshot fallback when a mutating API cannot be patched', () => {
    var fallbackRequests = []
    var context = createFakeContext()
    var unpatchableDraw = jasmine.createSpy('unpatchableDraw')
    Object.defineProperty(context, 'unpatchableDraw', {
      configurable: false,
      enumerable: true,
      value: unpatchableDraw,
      writable: false
    })
    var recorder = createCanvas2DCommandRecorder({
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({
          context: fallbackContext,
          reason: reason
        })
      }
    })

    recorder.patchContext(context)

    expect(fallbackRequests).toEqual([
      {
        context: context,
        reason: 'unpatchable_canvas_api'
      }
    ])
    context.unpatchableDraw()
    expect(unpatchableDraw).toHaveBeenCalled()
    recorder.stop()
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

  it('should only patch gradients that retain a bounded stop restore record', () => {
    var context = createFakeContext()
    var gradients = []
    var originalAddColorStops = []
    context.createLinearGradient.and.callFake(function () {
      var originalAddColorStop = jasmine.createSpy('addColorStop')
      var gradient = {
        constructor: { name: 'CanvasGradient' },
        addColorStop: originalAddColorStop
      }
      gradients.push(gradient)
      originalAddColorStops.push(originalAddColorStop)
      return gradient
    })
    var recorder = createCanvas2DCommandRecorder({
      weakRefFactory: function (value) {
        return {
          deref: function () {
            return value
          }
        }
      },
      requestAnimationFrameImpl: function () {
        return 1
      }
    })

    recorder.patchContext(context)
    for (
      var index = 0;
      index < MAX_CANVAS_OPAQUE_OBJECT_RESTORE_RECORDS + 8;
      index += 1
    ) {
      context.createLinearGradient(0, 0, index + 1, 0)
    }

    expect(gradients[0].addColorStop).not.toBe(originalAddColorStops[0])
    expect(gradients[gradients.length - 1].addColorStop).toBe(
      originalAddColorStops[originalAddColorStops.length - 1]
    )
    recorder.stop()

    gradients.forEach(function (gradient, index) {
      expect(gradient.addColorStop).toBe(originalAddColorStops[index])
    })
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

  it('should preflight canvas sources passed to createPattern', () => {
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
      { context: context, reason: 'canvas_element_argument' }
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

  it('should coalesce same-frame fallback dirtiness without serializing commands', () => {
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
      { context: context, reason: 'path2d_argument' }
    ])
    expect(events).toEqual([])
  })

  it('should request one latest fallback snapshot on a later dirty frame', () => {
    var events = []
    var fallbackRequests = []
    var frameCallbacks = []
    var context = createFakeContext()
    var path2d = { constructor: { name: 'Path2D' } }
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
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
    context.fillRect(1, 2, 3, 4)

    expect(fallbackRequests).toEqual([
      { context: context, reason: 'path2d_argument' }
    ])
    frameCallbacks.shift()()

    context.fillRect(5, 6, 7, 8)
    context.stroke()
    expect(fallbackRequests.length).toBe(1)
    frameCallbacks.shift()()

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

  it('should not synthesize unsupported properties on a shared prototype', () => {
    var sharedPrototype = {
      fillRect: jasmine.createSpy('fillRect')
    }
    var context = Object.create(sharedPrototype)
    context.canvas = document.createElement('canvas')
    context.canvas.__sn = { id: 44 }
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function () {
        return 1
      }
    })

    expect('letterSpacing' in context).toBeFalse()
    recorder.patchSharedPrototype(sharedPrototype)
    expect('letterSpacing' in context).toBeFalse()

    recorder.stop()
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

  it('should keep an existing context on bitmap fallback after reset', () => {
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
      { context: context, reason: 'path2d_argument' },
      { context: context, reason: 'canvas_state_reset' }
    ])
    expect(events).toEqual([])
  })

  it('should mark an admitted bitmap as persistent without encoding it twice', () => {
    var fallbackRequests = []
    var context = createFakeContext()
    var recorder = createCanvas2DCommandRecorder({
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      requestAnimationFrameImpl: function () {
        return 1
      },
      emit: jasmine.createSpy('emit')
    })

    recorder.patchContext(context)
    recorder.markPersistentSnapshotFallback(
      context,
      'manual_snapshot'
    )
    expect(fallbackRequests).toEqual([])

    context.fillRect(0, 0, 2, 2)
    recorder.flush()

    expect(fallbackRequests).toEqual([
      { context: context, reason: 'manual_snapshot' }
    ])
  })

  it('should report context mutations and honor an existing bitmap baseline', () => {
    var fallbackRequests = []
    var recordedFrameCallback
    var canvas = document.createElement('canvas')
    var context = canvas.getContext('2d')
    var onContextMutation = jasmine.createSpy('onContextMutation')
    var recorder = createCanvas2DCommandRecorder({
      onContextDiscovered: function () {
        return true
      },
      onContextMutation: onContextMutation,
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      emit: jasmine.createSpy('emit')
    })

    recorder.patchSharedPrototype(
      window.CanvasRenderingContext2D.prototype
    )
    context.fillRect(0, 0, 2, 2)

    expect(onContextMutation).toHaveBeenCalledWith(context)
    expect(fallbackRequests).toEqual([])

    recordedFrameCallback()
    expect(fallbackRequests).toEqual([
      { context: context, reason: 'existing_bitmap_state' }
    ])
    recorder.stop()
  })

  it('should use bitmap fallback for DOMMatrix command arguments', () => {
    var events = []
    var fallbackRequests = []
    var context = createFakeContext()
    var matrix =
      typeof DOMMatrix === 'function'
        ? new DOMMatrix([1, 0, 0, 1, 5, 0])
        : { constructor: { name: 'DOMMatrix' } }
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
    context.setTransform(matrix)

    expect(fallbackRequests).toEqual([
      {
        context: context,
        reason: 'unsupported_canvas_object'
      }
    ])
    expect(events).toEqual([])
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
    context.drawImage(video, 0, 1, 200, 100)

    expect(fallbackRequests).toEqual([
      { context: context, reason: 'draw_image_video' }
    ])
    expect(events).toEqual([])
  })

  it('should request snapshot fallback when drawImage uses an ImageBitmap', async () => {
    if (typeof createImageBitmap !== 'function') {
      return
    }
    var events = []
    var fallbackRequests = []
    var context = createFakeContext()
    var bitmap = await createImageBitmap(document.createElement('canvas'))
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

    try {
      recorder.patchContext(context)
      context.drawImage(bitmap, 0, 1, 200, 100)

      expect(fallbackRequests).toEqual([
        {
          context: context,
          reason: 'draw_image_unsupported_source'
        }
      ])
      expect(events).toEqual([])
    } finally {
      bitmap.close()
      recorder.stop()
    }
  })

  it('should request snapshot fallback for blob image sources', () => {
    var events = []
    var fallbackRequests = []
    var context = createFakeContext()
    var image = document.createElement('img')
    image.src = 'blob:http://localhost/replay-local-image'
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
    context.drawImage(image, 0, 1, 200, 100)

    expect(fallbackRequests).toEqual([
      {
        context: context,
        reason: 'draw_image_unsupported_source'
      }
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

  it('should not overwrite method or property patches installed after the recorder', () => {
    var context = createFakeContext()
    var recorder = createCanvas2DCommandRecorder()
    var replacementFillRect = jasmine.createSpy('replacementFillRect')
    var replacementFillStyle = '#replacement'
    var replacementDescriptor = {
      configurable: true,
      enumerable: true,
      get: function () {
        return replacementFillStyle
      },
      set: function (value) {
        replacementFillStyle = value
      }
    }

    recorder.patchContext(context)
    context.fillRect = replacementFillRect
    Object.defineProperty(
      context,
      'fillStyle',
      replacementDescriptor
    )

    recorder.stop()

    expect(context.fillRect).toBe(replacementFillRect)
    var currentDescriptor = Object.getOwnPropertyDescriptor(
      context,
      'fillStyle'
    )
    expect(currentDescriptor.get).toBe(replacementDescriptor.get)
    expect(currentDescriptor.set).toBe(replacementDescriptor.set)
  })

  it('should bound strong restore records for instance-patched contexts', () => {
    var recorder = createCanvas2DCommandRecorder()
    var contexts = []
    for (
      var index = 0;
      index < MAX_STRONG_CANVAS_CONTEXT_RESTORE_RECORDS + 1;
      index += 1
    ) {
      var context = createFakeContext()
      contexts.push({
        context: context,
        originalFillRect: context.fillRect
      })
      recorder.patchContext(context)
    }

    expect(
      contexts[MAX_STRONG_CANVAS_CONTEXT_RESTORE_RECORDS - 1]
        .context.fillRect
    ).not.toBe(
      contexts[MAX_STRONG_CANVAS_CONTEXT_RESTORE_RECORDS - 1]
        .originalFillRect
    )
    expect(
      contexts[MAX_STRONG_CANVAS_CONTEXT_RESTORE_RECORDS]
        .context.fillRect
    ).toBe(
      contexts[MAX_STRONG_CANVAS_CONTEXT_RESTORE_RECORDS]
        .originalFillRect
    )

    recorder.stop()
  })

  it('should reset recorder-scoped object reference indexes on reset and stop', () => {
    var objectRefRegistry = {
      serializeArgs: jasmine
        .createSpy('serializeArgs')
        .and.callFake(function (args) {
          return Array.prototype.slice.call(args)
        }),
      reset: jasmine.createSpy('reset')
    }
    var context = createFakeContext()
    var recorder = createCanvas2DCommandRecorder({
      objectRefRegistry: objectRefRegistry,
      requestAnimationFrameImpl: function () {
        return 1
      }
    })

    recorder.patchContext(context)
    context.fillRect(1, 2, 3, 4)
    recorder.reset()
    recorder.stop()

    expect(objectRefRegistry.reset).toHaveBeenCalledTimes(2)
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

  it('should request a bitmap rebaseline when a command record is rejected', () => {
    var context = createFakeContext()
    var recordedFrameCallback
    var requestSnapshotFallback = jasmine.createSpy(
      'requestSnapshotFallback'
    )
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      emit: jasmine.createSpy('emit').and.returnValue(false),
      requestSnapshotFallback: requestSnapshotFallback
    })

    recorder.patchContext(context)
    context.fillRect(1, 2, 3, 4)
    recordedFrameCallback()

    expect(requestSnapshotFallback).toHaveBeenCalledOnceWith(
      context,
      'command_record_rejected'
    )

    recorder.stop()
  })

  it('should emit batch estimates as side-channel metadata only', () => {
    var emit = jasmine.createSpy('emit')
    var context = createFakeContext()
    var recordedFrameCallback
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      emit: emit
    })

    recorder.patchContext(context)
    context.fillRect(1, 2, 3, 4)
    recordedFrameCallback()

    var record = emit.calls.mostRecent().args[0]
    var metadata = emit.calls.mostRecent().args[1]
    expect(metadata).toEqual({
      approxBytesCount: jasmine.any(Number),
      commandCount: 1
    })
    expect(metadata.approxBytesCount).toBeGreaterThan(0)
    expect(metadata.approxBytesCount).toBeLessThanOrEqual(
      MAX_CANVAS_COMMAND_BATCH_BYTES
    )
    expect(record.approxBytesCount).toBeUndefined()
    expect(record.commandCount).toBeUndefined()
    expect(record.data.approxBytesCount).toBeUndefined()
    expect(record.data.commandCount).toBeUndefined()
  })

  it('should cap globally pending command contexts and report overflow', () => {
    var events = []
    var fallbackRequests = []
    var overflows = []
    var originalFillRect = jasmine.createSpy('fillRect')
    var sharedPrototype = {
      fillRect: originalFillRect
    }
    var overflowContext
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function () {
        return 1
      },
      requestSnapshotFallback: function (context, reason) {
        fallbackRequests.push({
          context: context,
          reason: reason
        })
      },
      onCommandOverflow: function (overflow) {
        overflows.push(overflow)
      },
      emit: function (event) {
        events.push(event)
      }
    })

    for (
      var index = 0;
      index < MAX_PENDING_CANVAS_COMMAND_CONTEXTS + 1;
      index += 1
    ) {
      var context = Object.create(sharedPrototype)
      var canvas = document.createElement('canvas')
      canvas.__sn = { id: index + 1 }
      context.canvas = canvas
      recorder.patchContext(context)
      context.fillRect(0, 0, 1, 1)
      if (index === MAX_PENDING_CANVAS_COMMAND_CONTEXTS) {
        overflowContext = context
      }
    }

    expect(originalFillRect).toHaveBeenCalledTimes(
      MAX_PENDING_CANVAS_COMMAND_CONTEXTS + 1
    )
    expect(fallbackRequests).toEqual([
      {
        context: overflowContext,
        reason: 'command_global_context_watermark'
      }
    ])
    expect(overflows.length).toBe(1)
    expect(overflows[0]).toEqual(
      jasmine.objectContaining({
        context: overflowContext,
        reason: 'command_global_context_watermark',
        pendingContextCount: MAX_PENDING_CANVAS_COMMAND_CONTEXTS
      })
    )

    recorder.flush()

    expect(events.length).toBe(
      MAX_PENDING_CANVAS_COMMAND_CONTEXTS
    )
    recorder.stop()
  })

  it('should preflight the global pending byte watermark before serialization', () => {
    var events = []
    var fallbackRequests = []
    var overflows = []
    var sharedPrototype = {
      fillText: jasmine.createSpy('fillText')
    }
    var text = new Array(108 * 1024 + 1).join('x')
    var contexts = []
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function () {
        return 1
      },
      requestSnapshotFallback: function (context, reason) {
        fallbackRequests.push({
          context: context,
          reason: reason
        })
      },
      onCommandOverflow: function (overflow) {
        overflows.push(overflow)
      },
      emit: function (event) {
        events.push(event)
      }
    })

    for (var index = 0; index < 5; index += 1) {
      var context = Object.create(sharedPrototype)
      var canvas = document.createElement('canvas')
      canvas.__sn = { id: index + 100 }
      context.canvas = canvas
      contexts.push(context)
      recorder.patchContext(context)
      context.fillText(text, 0, 0)
    }

    expect(fallbackRequests).toEqual([
      {
        context: contexts[4],
        reason: 'command_global_bytes_watermark'
      }
    ])
    expect(overflows.length).toBe(1)
    expect(overflows[0]).toEqual(
      jasmine.objectContaining({
        context: contexts[4],
        reason: 'command_global_bytes_watermark',
        pendingApproxBytes: jasmine.any(Number)
      })
    )
    expect(overflows[0].pendingApproxBytes).toBeLessThanOrEqual(
      MAX_PENDING_CANVAS_COMMAND_BYTES
    )

    recorder.flush()

    expect(events.length).toBe(4)
    recorder.stop()
  })

  it('should switch the whole context to snapshot fallback when command count overflows', () => {
    var events = []
    var fallbackRequests = []
    var recordedFrameCallback
    var context = createFakeContext()
    delete context.canvas.__sn
    var originalSave = context.save
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
    for (
      var commandIndex = 0;
      commandIndex < MAX_CANVAS_COMMANDS_PER_BATCH;
      commandIndex += 1
    ) {
      context.save()
    }
    expect(fallbackRequests).toEqual([])

    context.save()
    recordedFrameCallback()

    expect(originalSave).toHaveBeenCalledTimes(
      MAX_CANVAS_COMMANDS_PER_BATCH + 1
    )
    expect(fallbackRequests).toEqual([
      { context: context, reason: 'command_batch_overflow' }
    ])
    expect(events).toEqual([])
  })

  it('should switch the whole context to snapshot fallback when estimated bytes overflow', () => {
    var events = []
    var fallbackRequests = []
    var recordedFrameCallback
    var context = createFakeContext()
    var originalFillText = context.fillText
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
    var textChunk = new Array(4097).join('x')
    var commandCount =
      Math.ceil(MAX_CANVAS_COMMAND_BATCH_BYTES / textChunk.length) + 1

    recorder.patchContext(context)
    for (var index = 0; index < commandCount; index += 1) {
      context.fillText(textChunk, 0, 0)
    }
    recordedFrameCallback()

    expect(originalFillText).toHaveBeenCalledTimes(commandCount)
    expect(fallbackRequests).toEqual([
      { context: context, reason: 'command_batch_overflow' }
    ])
    expect(events).toEqual([])
  })

  it('should preflight oversized single arguments before deep serialization', () => {
    var originalBtoa = window.btoa
    var btoaCallCount = 0
    window.btoa = function () {
      btoaCallCount += 1
      return originalBtoa.apply(this, arguments)
    }

    var oversizedArray = new Array(MAX_CANVAS_COMMAND_BATCH_BYTES)
    Object.defineProperty(oversizedArray, '0', {
      configurable: true,
      get: function () {
        fail('oversized array values should not be traversed')
      }
    })
    var oversizedImageData = new ImageData(256, 128)
    var oversizedValues = [
      new Array(MAX_CANVAS_COMMAND_BATCH_BYTES + 1).join('x'),
      oversizedArray,
      new Uint8Array(
        Math.ceil(MAX_CANVAS_COMMAND_BATCH_BYTES / 2) + 1
      ),
      new ArrayBuffer(MAX_CANVAS_COMMAND_BATCH_BYTES),
      oversizedImageData
    ]

    try {
      oversizedValues.forEach(function (value) {
        var fallbackRequests = []
        var context = createFakeContext()
        var recorder = createCanvas2DCommandRecorder({
          requestAnimationFrameImpl: function () {
            return 1
          },
          requestSnapshotFallback: function (
            fallbackContext,
            reason
          ) {
            fallbackRequests.push({
              context: fallbackContext,
              reason: reason
            })
          }
        })
        var originalSetLineDash = context.setLineDash
        recorder.patchContext(context)

        context.setLineDash(value)

        expect(originalSetLineDash).toHaveBeenCalledWith(value)
        expect(fallbackRequests).toEqual([
          { context: context, reason: 'command_batch_overflow' }
        ])
        recorder.stop()
      })
    } finally {
      window.btoa = originalBtoa
    }

    expect(btoaCallCount).toBe(0)
  })

  it('should preserve the application return value when a canvas argument falls back', () => {
    var fallbackRequests = []
    var context = createFakeContext()
    var sourceCanvas = document.createElement('canvas')
    var expectedResult = { ok: true }
    context.setLineDash.and.returnValue(expectedResult)
    var originalSetLineDash = context.setLineDash
    spyOn(sourceCanvas, 'toDataURL')
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function () {
        return 1
      },
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      }
    })

    recorder.patchContext(context)
    var result = context.setLineDash(sourceCanvas)

    expect(result).toBe(expectedResult)
    expect(originalSetLineDash).toHaveBeenCalledWith(sourceCanvas)
    expect(sourceCanvas.toDataURL).not.toHaveBeenCalled()
    expect(fallbackRequests).toEqual([
      { context: context, reason: 'canvas_element_argument' }
    ])
  })

  it('should preserve the application exception when the original method throws', () => {
    var context = createFakeContext()
    var expectedError = new Error('application draw failed')
    context.fillRect.and.callFake(function () {
      throw expectedError
    })
    var recorder = createCanvas2DCommandRecorder({
      requestAnimationFrameImpl: function () {
        return 1
      }
    })

    recorder.patchContext(context)

    var caughtError
    try {
      context.fillRect(1, 2, 3, 4)
    } catch (error) {
      caughtError = error
    }
    expect(caughtError).toBe(expectedError)
  })

  it('should retain unpublished canvas commands and emit them once after publication', () => {
    var events = []
    var fallbackRequests = []
    var timers = []
    var currentTime = 0
    var context = createFakeContext()
    delete context.canvas.__sn
    var recorder = createCanvas2DCommandRecorder({
      now: function () {
        return currentTime
      },
      requestAnimationFrameImpl: jasmine.createSpy('requestAnimationFrame').and.returnValue(1),
      setTimeoutImpl: function (callback, delay) {
        timers.push({ callback: callback, delay: delay })
        return timers.length
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout'),
      requestSnapshotFallback: function (fallbackContext, reason) {
        fallbackRequests.push({ context: fallbackContext, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    recorder.patchContext(context)
    context.fillRect(1, 2, 3, 4)
    recorder.flush()
    context.fillText('published later', 5, 6)
    recorder.flush()

    expect(events).toEqual([])
    expect(fallbackRequests).toEqual([])
    expect(timers.length).toBe(1)
    expect(timers[0].delay).toBe(
      MAX_UNPUBLISHED_CANVAS_COMMAND_RETENTION_MS
    )

    currentTime =
      MAX_UNPUBLISHED_CANVAS_COMMAND_RETENTION_MS - 1
    context.canvas.__sn = { id: 42 }
    expect(recorder.retryPublishedContext(context)).toBe(true)
    expect(events.length).toBe(1)
    expect(events[0].data.id).toBe(42)
    expect(events[0].data.commands).toEqual([
      jasmine.objectContaining({
        property: 'fillRect',
        args: [1, 2, 3, 4]
      }),
      jasmine.objectContaining({
        property: 'fillText',
        args: ['published later', 5, 6]
      })
    ])
    expect(recorder.retryPublishedContext(context)).toBe(false)
    expect(events.length).toBe(1)

    context.fillRect(7, 8, 9, 10)
    recorder.flush()
    expect(events.length).toBe(2)
    expect(events[1].data.commands).toEqual([
      jasmine.objectContaining({
        property: 'fillRect',
        args: [7, 8, 9, 10]
      })
    ])
    recorder.stop()
  })

  it('should expire detached command batches without blocking a later published canvas', () => {
    var events = []
    var fallbackRequests = []
    var timers = []
    var currentTime = 0
    var firstDetachedContext
    var sharedPrototype = {
      fillRect: jasmine.createSpy('fillRect')
    }
    var recorder = createCanvas2DCommandRecorder({
      now: function () {
        return currentTime
      },
      requestAnimationFrameImpl: jasmine
        .createSpy('requestAnimationFrame')
        .and.returnValue(1),
      setTimeoutImpl: function (callback, delay) {
        timers.push({ callback: callback, delay: delay })
        return timers.length
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout'),
      requestSnapshotFallback: function (context, reason) {
        fallbackRequests.push({ context: context, reason: reason })
      },
      emit: function (event) {
        events.push(event)
      }
    })

    for (
      var index = 0;
      index < MAX_PENDING_CANVAS_COMMAND_CONTEXTS;
      index += 1
    ) {
      var detachedContext = Object.create(sharedPrototype)
      detachedContext.canvas = document.createElement('canvas')
      if (!firstDetachedContext) {
        firstDetachedContext = detachedContext
      }
      recorder.patchContext(detachedContext)
      detachedContext.fillRect(0, 0, 1, 1)
    }
    recorder.flush()

    expect(events).toEqual([])
    expect(timers.length).toBe(1)
    expect(timers[0].delay).toBe(
      MAX_UNPUBLISHED_CANVAS_COMMAND_RETENTION_MS
    )

    currentTime = MAX_UNPUBLISHED_CANVAS_COMMAND_RETENTION_MS
    timers.shift().callback()

    firstDetachedContext.fillRect(4, 5, 6, 7)
    recorder.flush()
    expect(fallbackRequests).toEqual([])

    firstDetachedContext.canvas.__sn = { id: 98 }
    expect(
      recorder.retryPublishedContext(firstDetachedContext)
    ).toBe(true)
    expect(fallbackRequests).toEqual([
      {
        context: firstDetachedContext,
        reason: 'canvas_publication_timeout'
      }
    ])
    expect(
      recorder.retryPublishedContext(firstDetachedContext)
    ).toBe(false)
    expect(events).toEqual([])

    var publishedContext = Object.create(sharedPrototype)
    publishedContext.canvas = document.createElement('canvas')
    publishedContext.canvas.__sn = { id: 99 }
    recorder.patchContext(publishedContext)
    publishedContext.fillRect(2, 3, 4, 5)
    recorder.flush()

    expect(events.length).toBe(1)
    expect(events[0].data.id).toBe(99)
    expect(events[0].data.commands).toEqual([
      jasmine.objectContaining({
        property: 'fillRect',
        args: [2, 3, 4, 5]
      })
    ])
    recorder.stop()
  })

  ;['pause', 'reset', 'stop'].forEach(function (lifecycleAction) {
    it(
      'should release unpublished canvas commands on ' + lifecycleAction,
      function () {
        var events = []
        var context = createFakeContext()
        delete context.canvas.__sn
        var recorder = createCanvas2DCommandRecorder({
          requestAnimationFrameImpl: jasmine
            .createSpy('requestAnimationFrame')
            .and.returnValue(1),
          emit: function (event) {
            events.push(event)
          }
        })

        recorder.patchContext(context)
        context.fillRect(1, 2, 3, 4)
        recorder.flush()
        recorder[lifecycleAction]()
        if (lifecycleAction === 'pause') {
          recorder.resume()
        }
        context.canvas.__sn = { id: 43 }

        expect(recorder.retryPublishedContext(context)).toBe(false)
        expect(events).toEqual([])
        if (lifecycleAction !== 'stop') {
          recorder.stop()
        }
      }
    )
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
