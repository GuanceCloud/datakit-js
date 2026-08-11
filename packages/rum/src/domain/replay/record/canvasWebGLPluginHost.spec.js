import {
  createNoopObserver,
  createSessionReplayWebGLRuntime
} from './canvasWebGLPluginHost'
import { setReplayCanvasContextType } from './canvasContext'

describe('replay/record/canvasWebGLPluginHost', () => {
  function createEncodeBridge(result) {
    return {
      encode: jasmine
        .createSpy('encode')
        .and.resolveTo(result || { dataUrl: '2d' }),
      reset: jasmine.createSpy('reset'),
      stop: jasmine.createSpy('stop')
    }
  }

  it('should classify known WebGL canvases without an addon', () => {
    var canvas = document.createElement('canvas')
    var unknownCanvas = document.createElement('canvas')
    setReplayCanvasContextType(canvas, 'webgl')

    expect(createNoopObserver().isWebGLCanvas(canvas)).toBeTrue()
    expect(createNoopObserver().isWebGLCanvas(unknownCanvas)).toBeFalse()
  })

  it('should create a runtime through the registered positional contract', async () => {
    var baseEncodeBridge = createEncodeBridge()
    var addonEncodeBridge = createEncodeBridge({ dataUrl: 'webgl' })
    var startObserver = jasmine.createSpy('startObserver')
    var report = jasmine.createSpy('report')
    var createRuntime = jasmine
      .createSpy('createRuntime')
      .and.returnValue([addonEncodeBridge, startObserver])
    var configuration = { sessionReplayWebGL: createRuntime }

    var runtime = createSessionReplayWebGLRuntime(
      configuration,
      baseEncodeBridge,
      report
    )

    expect(createRuntime).toHaveBeenCalledTimes(1)
    expect(createRuntime.calls.first().args[0]).toBe(configuration)
    expect(createRuntime.calls.first().args[1]).toBe(baseEncodeBridge)
    expect(createRuntime.calls.first().args[2]).toEqual(
      jasmine.any(Function)
    )
    expect(createRuntime.calls.first().args[3]).toBe(report)
    expect(createRuntime.calls.first().args.length).toBe(4)
    expect(runtime[0]).toBe(addonEncodeBridge)
    expect(runtime[1]).toBe(startObserver)
    expect(await runtime[0].encode(document.createElement('canvas')))
      .toEqual({ dataUrl: 'webgl' })
  })

  it('should isolate missing and throwing runtimes from 2d replay', async () => {
    var baseEncodeBridge = createEncodeBridge({ dataUrl: '2d' })
    var report = jasmine.createSpy('report')
    var missing = createSessionReplayWebGLRuntime({}, baseEncodeBridge)
    var throwing = createSessionReplayWebGLRuntime(
      {
        sessionReplayWebGL: function () {
          throw new Error('runtime failed')
        }
      },
      baseEncodeBridge,
      report
    )

    expect(missing).toEqual([])
    expect(throwing).toEqual([])
    expect(report).toHaveBeenCalledWith(
      'create_runtime',
      jasmine.any(Error)
    )
    expect(await baseEncodeBridge.encode(document.createElement('canvas')))
      .toEqual({ dataUrl: '2d' })
  })

  it('should create a fresh addon runtime after replay restarts', () => {
    var createRuntime = jasmine.createSpy('createRuntime').and.callFake(
      function () {
        return [createEncodeBridge(), function () {}]
      }
    )
    var configuration = { sessionReplayWebGL: createRuntime }
    var baseEncodeBridge = createEncodeBridge()

    var first = createSessionReplayWebGLRuntime(
      configuration,
      baseEncodeBridge
    )
    first[0].stop()
    var second = createSessionReplayWebGLRuntime(
      configuration,
      baseEncodeBridge
    )

    expect(createRuntime).toHaveBeenCalledTimes(2)
    expect(second[0]).not.toBe(first[0])
  })
})
