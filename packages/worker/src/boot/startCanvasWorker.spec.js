import { startCanvasWorker } from './startCanvasWorker'

describe('worker/startCanvasWorker', () => {
  let originalBuildEnvVersion
  let originalSelf

  beforeEach(() => {
    originalBuildEnvVersion = globalThis.__BUILD_ENV__SDK_VERSION__
    globalThis.__BUILD_ENV__SDK_VERSION__ = 'canvas-worker-test-version'
    originalSelf = globalThis.self
  })

  afterEach(() => {
    globalThis.__BUILD_ENV__SDK_VERSION__ = originalBuildEnvVersion
    globalThis.self = originalSelf
  })

  function createWorkerScope(postMessageImpl) {
    return {
      listener: undefined,
      addEventListener(type, listener) {
        expect(type).toBe('message')
        this.listener = listener
      },
      postMessage: postMessageImpl || jasmine.createSpy('postMessage')
    }
  }

  it('should acknowledge init messages', () => {
    const workerScope = createWorkerScope()

    startCanvasWorker(workerScope)
    workerScope.listener({ data: { action: 'init' } })

    expect(workerScope.postMessage).toHaveBeenCalledWith({
      action: 'initialized',
      version: 'canvas-worker-test-version'
    })
  })

  it('should ignore unknown actions', () => {
    const workerScope = createWorkerScope()

    startCanvasWorker(workerScope)
    workerScope.listener({ data: { action: 'noop' } })

    expect(workerScope.postMessage).not.toHaveBeenCalled()
  })
})
