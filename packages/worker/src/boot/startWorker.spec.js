import { startWorker } from './startWorker'

describe('worker/startWorker', () => {
  let originalBuildEnvVersion
  let originalSelf

  beforeEach(() => {
    originalBuildEnvVersion = globalThis.__BUILD_ENV__SDK_VERSION__
    globalThis.__BUILD_ENV__SDK_VERSION__ = 'worker-test-version'
    originalSelf = globalThis.self
  })

  afterEach(() => {
    globalThis.__BUILD_ENV__SDK_VERSION__ = originalBuildEnvVersion
    globalThis.self = originalSelf
  })

  function createWorkerScope(postMessageImpl) {
    const scope = {
      listener: undefined,
      addEventListener(type, listener) {
        expect(type).toBe('message')
        this.listener = listener
      },
      postMessage: postMessageImpl || jasmine.createSpy('postMessage')
    }
    return scope
  }

  it('should initialize and write compressed chunks for a stream', () => {
    const workerScope = createWorkerScope()

    startWorker(workerScope)

    workerScope.listener({
      data: {
        action: 'init'
      }
    })
    workerScope.listener({
      data: {
        action: 'write',
        id: 'write-1',
        streamId: 'stream-1',
        data: 'hello worker'
      }
    })

    expect(workerScope.postMessage.calls.argsFor(0)[0]).toEqual({
      type: 'initialized',
      version: 'worker-test-version'
    })
    expect(workerScope.postMessage.calls.argsFor(1)[0]).toEqual(
      jasmine.objectContaining({
        type: 'wrote',
        id: 'write-1',
        streamId: 'stream-1',
        result: jasmine.any(Uint8Array),
        trailer: jasmine.any(Uint8Array),
        additionalBytesCount: 12
      })
    )
  })

  it('should reset a stream and create a fresh deflate state on the next write', () => {
    const workerScope = createWorkerScope()

    startWorker(workerScope)

    workerScope.listener({
      data: {
        action: 'write',
        id: 'write-1',
        streamId: 'stream-1',
        data: 'first'
      }
    })
    const firstTrailer = workerScope.postMessage.calls.mostRecent().args[0].trailer

    workerScope.listener({
      data: {
        action: 'reset',
        streamId: 'stream-1'
      }
    })
    workerScope.listener({
      data: {
        action: 'write',
        id: 'write-2',
        streamId: 'stream-1',
        data: 'first'
      }
    })

    expect(workerScope.postMessage.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        type: 'wrote',
        id: 'write-2',
        streamId: 'stream-1',
        trailer: firstTrailer
      })
    )
  })

  it('should send stringified errors when postMessage cannot clone the original error', () => {
    let callCount = 0
    const workerScope = createWorkerScope((payload) => {
      callCount += 1
      if (callCount <= 2) {
        throw new Error('postMessage failed')
      }
      expect(payload).toEqual({
        type: 'errored',
        error: 'Error: postMessage failed',
        streamId: undefined
      })
    })

    startWorker(workerScope)

    workerScope.listener({
      data: {
        action: 'init'
      }
    })

    expect(callCount).toBe(3)
  })

  it('should report top-level setup failures', () => {
    const workerScope = {
      addEventListener() {
        throw new Error('setup failed')
      },
      postMessage: jasmine.createSpy('postMessage')
    }

    startWorker(workerScope)

    expect(workerScope.postMessage).toHaveBeenCalledWith({
      type: 'errored',
      error: jasmine.any(Error),
      streamId: undefined
    })
  })

  it('should ignore unknown actions without posting a response', () => {
    const workerScope = createWorkerScope()

    startWorker(workerScope)
    workerScope.listener({
      data: {
        action: 'unknown'
      }
    })

    expect(workerScope.postMessage).not.toHaveBeenCalled()
  })

  it('should include the stream id when write response posting fails', () => {
    let callCount = 0
    const workerScope = createWorkerScope((payload) => {
      callCount += 1
      if (callCount === 1) {
        throw new Error('write post failed')
      }
      expect(payload).toEqual({
        type: 'errored',
        error: jasmine.any(Error),
        streamId: 'broken-stream'
      })
    })

    startWorker(workerScope)
    workerScope.listener({
      data: {
        action: 'write',
        id: 'write-1',
        streamId: 'broken-stream',
        data: 'hello'
      }
    })

    expect(callCount).toBe(2)
  })

  it('should use the global self scope when no worker scope is provided', () => {
    const workerScope = createWorkerScope()
    globalThis.self = workerScope

    startWorker()
    workerScope.listener({
      data: {
        action: 'init'
      }
    })

    expect(workerScope.postMessage).toHaveBeenCalledWith({
      type: 'initialized',
      version: 'worker-test-version'
    })
  })
})
