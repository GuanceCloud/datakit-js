import {
  createDeflateEncoder,
  DEFLATE_WORKER_ACTIVITY_GRACE_TIMEOUT,
  DEFLATE_WORKER_ACTIVITY_TIMEOUT,
  DeflateEncoderStreamId
} from './deflateEncoder'

describe('deflateEncoder', () => {
  function createWorker() {
    return {
      listeners: {},
      postMessage: jasmine.createSpy('postMessage'),
      addEventListener(type, listener) {
        this.listeners[type] = listener
      },
      removeEventListener: jasmine.createSpy('removeEventListener')
    }
  }

  function emitMessage(worker, data) {
    worker.listeners.message({ data })
  }

  async function inflate(output) {
    const stream = new Blob([output])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'))
    return new Response(stream).text()
  }

  it('should collect worker writes and finish asynchronously', () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(worker, DeflateEncoderStreamId.RUM)
    const writeCallback = jasmine.createSpy('writeCallback')
    const finishCallback = jasmine.createSpy('finishCallback')

    encoder.write('first', writeCallback)
    expect(worker.postMessage).toHaveBeenCalledWith({
      action: 'write',
      id: 0,
      data: 'first',
      streamId: DeflateEncoderStreamId.RUM
    })

    emitMessage(worker, {
      type: 'wrote',
      id: 0,
      streamId: DeflateEncoderStreamId.RUM,
      additionalBytesCount: 5,
      result: new Uint8Array([1, 2]),
      trailer: new Uint8Array([3])
    })

    expect(writeCallback).toHaveBeenCalledWith(2)

    encoder.finish(finishCallback)
    expect(worker.postMessage).toHaveBeenCalledWith({
      action: 'reset',
      streamId: DeflateEncoderStreamId.RUM
    })
    expect(finishCallback).toHaveBeenCalledWith(
      jasmine.objectContaining({
        rawBytesCount: 5,
        outputBytesCount: 3,
        encoding: 'deflate'
      })
    )
  })

  it('should discard one asynchronous stream without contaminating the next result', () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(
      worker,
      DeflateEncoderStreamId.REPLAY
    )
    const discardedFinish = jasmine.createSpy('discardedFinish')
    const deliveredFinish = jasmine.createSpy('deliveredFinish')

    encoder.write('discarded')
    encoder.$rFinishDiscard(discardedFinish)
    encoder.write('delivered')
    encoder.finish(deliveredFinish)

    emitMessage(worker, {
      type: 'wrote',
      id: 0,
      streamId: DeflateEncoderStreamId.REPLAY,
      additionalBytesCount: 9,
      result: new Uint8Array([1, 2]),
      trailer: new Uint8Array([3])
    })
    emitMessage(worker, {
      type: 'wrote',
      id: 1,
      streamId: DeflateEncoderStreamId.REPLAY,
      additionalBytesCount: 9,
      result: new Uint8Array([4, 5]),
      trailer: new Uint8Array([6])
    })

    expect(discardedFinish).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        rawBytesCount: 0,
        outputBytesCount: 0
      })
    )
    expect(deliveredFinish).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        rawBytesCount: 9,
        output: new Uint8Array([4, 5, 6]),
        outputBytesCount: 3
      })
    )
  })

  it('should estimate encoded bytes from either data or a character count', () => {
    const encoder = createDeflateEncoder(
      createWorker(),
      DeflateEncoderStreamId.REPLAY
    )

    expect(encoder.estimateEncodedBytesCount('12345678')).toBe(1)
    expect(encoder.estimateEncodedBytesCount(8)).toBe(1)
  })

  it('should return pending data when finished synchronously before worker responses', () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(worker, DeflateEncoderStreamId.REPLAY)

    encoder.write('first')
    encoder.write('second')

    const result = encoder.finishSync()

    expect(result.pendingData).toEqual(['first', 'second'])
    expect(result.outputBytesCount).toBe(0)
    expect(worker.postMessage).toHaveBeenCalledWith({
      action: 'reset',
      streamId: DeflateEncoderStreamId.REPLAY
    })
    expect(encoder.getPendingEncodedBytesCount()).toBe(0)
    expect(encoder.getPendingRawBytesCount()).toBe(0)
  })

  it('should synchronously finalize every pending segment boundary as a valid deflate stream', async () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(worker, DeflateEncoderStreamId.REPLAY)
    const firstFinish = jasmine.createSpy('firstFinish')
    const secondFinish = jasmine.createSpy('secondFinish')

    encoder.write('first 😀')
    encoder.finish(firstFinish)
    encoder.write('second 汉字')
    encoder.finish(secondFinish)

    encoder.flushPendingActionsSync()

    expect(firstFinish).toHaveBeenCalledTimes(1)
    expect(secondFinish).toHaveBeenCalledTimes(1)
    expect(await inflate(firstFinish.calls.argsFor(0)[0].output)).toBe(
      'first 😀'
    )
    expect(await inflate(secondFinish.calls.argsFor(0)[0].output)).toBe(
      'second 汉字'
    )
    expect(encoder.getPendingEncodedBytesCount()).toBe(0)
    expect(encoder.getPendingRawBytesCount()).toBe(0)

    emitMessage(worker, {
      type: 'wrote',
      id: 0,
      streamId: DeflateEncoderStreamId.REPLAY,
      additionalBytesCount: 10,
      result: new Uint8Array([1]),
      trailer: new Uint8Array([3])
    })
    emitMessage(worker, {
      type: 'wrote',
      id: 1,
      streamId: DeflateEncoderStreamId.REPLAY,
      additionalBytesCount: 13,
      result: new Uint8Array([2]),
      trailer: new Uint8Array([3])
    })

    expect(firstFinish).toHaveBeenCalledTimes(1)
    expect(secondFinish).toHaveBeenCalledTimes(1)
  })

  it('should append pending data to an already compressed worker prefix synchronously', async () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(worker, DeflateEncoderStreamId.REPLAY)
    const finishCallback = jasmine.createSpy('finishCallback')

    encoder.write('first')
    emitMessage(worker, {
      type: 'wrote',
      id: 0,
      streamId: DeflateEncoderStreamId.REPLAY,
      additionalBytesCount: 5,
      result: new Uint8Array([
        120,
        156,
        74,
        203,
        44,
        42,
        46,
        1,
        0,
        0,
        0,
        255,
        255
      ]),
      trailer: new Uint8Array([3, 0, 6, 87, 2, 41])
    })
    encoder.write(' second')
    encoder.finish(finishCallback)

    encoder.flushPendingActionsSync()

    expect(finishCallback).toHaveBeenCalledTimes(1)
    const result = finishCallback.calls.argsFor(0)[0]
    expect(await inflate(result.output)).toBe('first second')
    expect(result.rawBytesCount).toBe(12)
  })

  it('should preserve worker-compatible UTF-8 encoding without TextEncoder', async () => {
    const originalTextEncoder = window.TextEncoder
    Object.defineProperty(window, 'TextEncoder', {
      configurable: true,
      value: undefined
    })
    try {
      const worker = createWorker()
      const encoder = createDeflateEncoder(
        worker,
        DeflateEncoderStreamId.REPLAY
      )
      const finishCallback = jasmine.createSpy('finishCallback')

      encoder.write('line\n😀汉字')
      encoder.finish(finishCallback)
      encoder.flushPendingActionsSync(60000)

      expect(
        await inflate(finishCallback.calls.argsFor(0)[0].output)
      ).toBe('line\n😀汉字')
    } finally {
      Object.defineProperty(window, 'TextEncoder', {
        configurable: true,
        value: originalTextEncoder
      })
    }
  })

  it('should reject a 4 MiB pending tail before synchronous UTF-8 encoding', () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(worker, DeflateEncoderStreamId.REPLAY)
    const finishCallback = jasmine.createSpy('finishCallback')
    const textEncode = spyOn(
      TextEncoder.prototype,
      'encode'
    ).and.callThrough()

    encoder.write('x'.repeat(2 * 1024 * 1024))
    encoder.finish(finishCallback)

    encoder.flushPendingActionsSync(60000)

    expect(textEncode).not.toHaveBeenCalled()
    expect(finishCallback).toHaveBeenCalledTimes(1)
    expect(finishCallback.calls.argsFor(0)[0]).toEqual(
      jasmine.objectContaining({
        rawBytesCount: 0,
        outputBytesCount: 0,
        error: jasmine.any(Error)
      })
    )
    expect(encoder.getPendingEncodedBytesCount()).toBe(0)
    expect(encoder.getPendingRawBytesCount()).toBe(0)
  })

  it('should apply the synchronous output budget across all pending segments', () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(worker, DeflateEncoderStreamId.REPLAY)
    const firstFinish = jasmine.createSpy('firstFinish')
    const secondFinish = jasmine.createSpy('secondFinish')
    const textEncode = spyOn(
      TextEncoder.prototype,
      'encode'
    ).and.callThrough()

    encoder.write('a'.repeat(40000))
    encoder.finish(firstFinish)
    encoder.write('b'.repeat(40000))
    encoder.finish(secondFinish)

    encoder.flushPendingActionsSync(60000)

    const firstResult = firstFinish.calls.argsFor(0)[0]
    const secondResult = secondFinish.calls.argsFor(0)[0]
    expect(firstResult.error).toBeUndefined()
    expect(firstResult.outputBytesCount).toBeLessThanOrEqual(60000)
    expect(secondResult.error).toEqual(jasmine.any(Error))
    expect(secondResult.outputBytesCount).toBe(0)
    expect(textEncode).toHaveBeenCalledTimes(1)
  })

  it('should not charge a discarded stream against the synchronous unload budget', async () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(
      worker,
      DeflateEncoderStreamId.REPLAY
    )
    const discardedFinish = jasmine.createSpy('discardedFinish')
    const deliveredFinish = jasmine.createSpy('deliveredFinish')
    const textEncode = spyOn(
      TextEncoder.prototype,
      'encode'
    ).and.callThrough()

    encoder.write('a'.repeat(40000))
    encoder.$rFinishDiscard(discardedFinish)
    encoder.write('b'.repeat(40000))
    encoder.finish(deliveredFinish)

    encoder.flushPendingActionsSync(60000)

    const discardedResult = discardedFinish.calls.argsFor(0)[0]
    const deliveredResult = deliveredFinish.calls.argsFor(0)[0]
    expect(discardedResult.error).toBeUndefined()
    expect(discardedResult.outputBytesCount).toBe(0)
    expect(deliveredResult.error).toBeUndefined()
    expect(await inflate(deliveredResult.output)).toBe(
      'b'.repeat(40000)
    )
    expect(textEncode).toHaveBeenCalledTimes(1)
  })

  it('should expose and release pending encoded and raw byte counts', () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(worker, DeflateEncoderStreamId.REPLAY)

    encoder.write('12345678')
    encoder.write('12345678')

    expect(encoder.getPendingEncodedBytesCount()).toBe(2)
    expect(encoder.getPendingRawBytesCount()).toBe(32)

    emitMessage(worker, {
      type: 'wrote',
      id: 0,
      streamId: DeflateEncoderStreamId.REPLAY,
      additionalBytesCount: 8,
      result: new Uint8Array([1]),
      trailer: new Uint8Array([3])
    })
    expect(encoder.getPendingEncodedBytesCount()).toBe(1)
    expect(encoder.getPendingRawBytesCount()).toBe(16)

    emitMessage(worker, {
      type: 'wrote',
      id: 1,
      streamId: DeflateEncoderStreamId.REPLAY,
      additionalBytesCount: 8,
      result: new Uint8Array([2]),
      trailer: new Uint8Array([3])
    })
    expect(encoder.getPendingEncodedBytesCount()).toBe(0)
    expect(encoder.getPendingRawBytesCount()).toBe(0)
  })

  it('should clear pending actions and recover after a stream runtime error', () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(worker, DeflateEncoderStreamId.REPLAY)
    const failedWriteCallback = jasmine.createSpy('failedWriteCallback')
    const recoveredWriteCallback = jasmine.createSpy('recoveredWriteCallback')
    const runtimeError = new Error('deflate failed')

    encoder.write('first', failedWriteCallback)
    emitMessage(worker, {
      type: 'errored',
      streamId: DeflateEncoderStreamId.REPLAY,
      error: runtimeError
    })

    expect(failedWriteCallback).toHaveBeenCalledWith(0, runtimeError)
    expect(encoder.getPendingEncodedBytesCount()).toBe(0)
    expect(encoder.getPendingRawBytesCount()).toBe(0)
    expect(worker.postMessage).toHaveBeenCalledWith({
      action: 'reset',
      streamId: DeflateEncoderStreamId.REPLAY
    })

    encoder.write('second', recoveredWriteCallback)
    emitMessage(worker, {
      type: 'wrote',
      id: 1,
      streamId: DeflateEncoderStreamId.REPLAY,
      additionalBytesCount: 6,
      result: new Uint8Array([4]),
      trailer: new Uint8Array([3])
    })

    expect(recoveredWriteCallback).toHaveBeenCalledWith(1)
  })

  it('should complete a pending finish with an error and keep the listener reusable', () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(worker, DeflateEncoderStreamId.REPLAY)
    const finishCallback = jasmine.createSpy('finishCallback')
    const runtimeError = new Error('deflate failed')

    encoder.write('first')
    encoder.finish(finishCallback)
    emitMessage(worker, {
      type: 'errored',
      streamId: DeflateEncoderStreamId.REPLAY,
      error: runtimeError
    })

    expect(finishCallback).toHaveBeenCalledWith(
      jasmine.objectContaining({
        error: runtimeError,
        outputBytesCount: 0,
        rawBytesCount: 0
      })
    )
    expect(worker.removeEventListener).not.toHaveBeenCalled()

    encoder.write('second')
    expect(worker.postMessage).toHaveBeenCalledWith({
      action: 'write',
      id: 1,
      data: 'second',
      streamId: DeflateEncoderStreamId.REPLAY
    })
  })

  it('should ignore runtime errors belonging to the other shared worker stream', () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(worker, DeflateEncoderStreamId.REPLAY)
    const writeCallback = jasmine.createSpy('writeCallback')

    encoder.write('first', writeCallback)
    emitMessage(worker, {
      type: 'errored',
      streamId: DeflateEncoderStreamId.RUM,
      error: new Error('rum stream failed')
    })
    emitMessage(worker, {
      type: 'wrote',
      id: 0,
      streamId: DeflateEncoderStreamId.REPLAY,
      additionalBytesCount: 5,
      result: new Uint8Array([1]),
      trailer: new Uint8Array([3])
    })

    expect(writeCallback).toHaveBeenCalledWith(1)
  })

  it('should release pending data when the worker emits a native error', () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(worker, DeflateEncoderStreamId.REPLAY)
    const writeCallback = jasmine.createSpy('writeCallback')
    const runtimeError = new Error('worker crashed')

    encoder.write('first', writeCallback)
    worker.listeners.error(runtimeError)

    expect(writeCallback).toHaveBeenCalledWith(0, runtimeError)
    expect(encoder.getPendingEncodedBytesCount()).toBe(0)
    expect(encoder.getPendingRawBytesCount()).toBe(0)

    const nextWriteCallback = jasmine.createSpy('nextWriteCallback')
    encoder.write('second', nextWriteCallback)

    expect(nextWriteCallback).toHaveBeenCalledWith(0, runtimeError)
    expect(worker.postMessage).not.toHaveBeenCalledWith(
      jasmine.objectContaining({
        action: 'write',
        data: 'second'
      })
    )
  })

  it('should notify a terminal worker error only once', () => {
    const worker = createWorker()
    const onTerminalError = jasmine.createSpy('onTerminalError')
    const encoder = createDeflateEncoder(
      worker,
      DeflateEncoderStreamId.REPLAY,
      onTerminalError
    )
    const streamError = new Error('stream failed')
    const terminalError = new Error('worker crashed')

    encoder.write('first')
    emitMessage(worker, {
      type: 'errored',
      streamId: DeflateEncoderStreamId.REPLAY,
      error: streamError
    })

    expect(onTerminalError).not.toHaveBeenCalled()

    worker.listeners.error(terminalError)
    worker.listeners.error(new Error('worker crashed again'))

    expect(onTerminalError).toHaveBeenCalledTimes(1)
    expect(onTerminalError).toHaveBeenCalledWith(terminalError)
  })

  it('should notify when resetting a completed stream fails', () => {
    const worker = createWorker()
    const onTerminalError = jasmine.createSpy('onTerminalError')
    const encoder = createDeflateEncoder(
      worker,
      DeflateEncoderStreamId.REPLAY,
      onTerminalError
    )
    const resetError = new Error('worker reset failed')
    const finishCallback = jasmine.createSpy('finishCallback')

    encoder.write('first')
    emitMessage(worker, {
      type: 'wrote',
      id: 0,
      streamId: DeflateEncoderStreamId.REPLAY,
      additionalBytesCount: 5,
      result: new Uint8Array([1]),
      trailer: new Uint8Array([3])
    })
    worker.postMessage.and.callFake(function (message) {
      if (message.action === 'reset') {
        throw resetError
      }
    })

    encoder.finish(finishCallback)

    expect(finishCallback).toHaveBeenCalledWith(
      jasmine.objectContaining({
        error: resetError,
        outputBytesCount: 0,
        rawBytesCount: 0
      })
    )
    expect(onTerminalError).toHaveBeenCalledTimes(1)
    expect(onTerminalError).toHaveBeenCalledWith(resetError)
  })

  it('should release consumed queue entries without changing pending data order', () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(worker, DeflateEncoderStreamId.REPLAY)

    for (let index = 0; index < 1100; index += 1) {
      encoder.write('chunk-' + index)
    }
    for (let index = 0; index < 1024; index += 1) {
      emitMessage(worker, {
        type: 'wrote',
        id: index,
        streamId: DeflateEncoderStreamId.REPLAY,
        additionalBytesCount: 1,
        result: new Uint8Array([1]),
        trailer: new Uint8Array([3])
      })
    }

    const result = encoder.finishSync()

    expect(result.pendingData.length).toBe(76)
    expect(result.pendingData[0]).toBe('chunk-1024')
    expect(result.pendingData[75]).toBe('chunk-1099')
    expect(encoder.getPendingEncodedBytesCount()).toBe(0)
    expect(encoder.getPendingRawBytesCount()).toBe(0)
  })

  it('should suppress pre-finish write callbacks without scanning and deleting them', () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(worker, DeflateEncoderStreamId.REPLAY)
    const firstWriteCallback = jasmine.createSpy('firstWriteCallback')
    const finishCallback = jasmine.createSpy('finishCallback')
    const laterWriteCallback = jasmine.createSpy('laterWriteCallback')

    encoder.write('first', firstWriteCallback)
    encoder.finish(finishCallback)
    encoder.write('later', laterWriteCallback)

    emitMessage(worker, {
      type: 'wrote',
      id: 0,
      streamId: DeflateEncoderStreamId.REPLAY,
      additionalBytesCount: 5,
      result: new Uint8Array([1]),
      trailer: new Uint8Array([3])
    })
    emitMessage(worker, {
      type: 'wrote',
      id: 1,
      streamId: DeflateEncoderStreamId.REPLAY,
      additionalBytesCount: 5,
      result: new Uint8Array([2]),
      trailer: new Uint8Array([3])
    })

    expect(firstWriteCallback).not.toHaveBeenCalled()
    expect(finishCallback).toHaveBeenCalledTimes(1)
    expect(laterWriteCallback).toHaveBeenCalledWith(1)
  })

  it('should fail a pending finish when the worker stops making progress', () => {
    jasmine.clock().install()
    try {
      const worker = createWorker()
      const onTerminalError = jasmine.createSpy('onTerminalError')
      const encoder = createDeflateEncoder(
        worker,
        DeflateEncoderStreamId.REPLAY,
        onTerminalError
      )
      const writeCallback = jasmine.createSpy('writeCallback')
      const finishCallback = jasmine.createSpy('finishCallback')

      encoder.write('never-answered', writeCallback)
      encoder.finish(finishCallback)

      jasmine.clock().tick(DEFLATE_WORKER_ACTIVITY_TIMEOUT - 1)
      expect(finishCallback).not.toHaveBeenCalled()
      expect(onTerminalError).not.toHaveBeenCalled()

      jasmine.clock().tick(1)

      expect(finishCallback).not.toHaveBeenCalled()
      expect(onTerminalError).not.toHaveBeenCalled()

      jasmine.clock().tick(DEFLATE_WORKER_ACTIVITY_GRACE_TIMEOUT)

      expect(writeCallback).not.toHaveBeenCalled()
      expect(finishCallback).toHaveBeenCalledTimes(1)
      const errorResult = finishCallback.calls.argsFor(0)[0]
      expect(errorResult.error).toEqual(jasmine.any(Error))
      expect(errorResult.error.message).toBe(
        'Deflate worker activity timed out for stream ' +
          DeflateEncoderStreamId.REPLAY
      )
      expect(errorResult.outputBytesCount).toBe(0)
      expect(encoder.getPendingEncodedBytesCount()).toBe(0)
      expect(encoder.getPendingRawBytesCount()).toBe(0)
      expect(onTerminalError).toHaveBeenCalledTimes(1)
      expect(onTerminalError).toHaveBeenCalledWith(errorResult.error)
      encoder.stop()
    } finally {
      jasmine.clock().uninstall()
    }
  })

  it('should accept worker progress during the activity timeout grace turn', () => {
    jasmine.clock().install()
    try {
      const worker = createWorker()
      const onTerminalError = jasmine.createSpy('onTerminalError')
      const encoder = createDeflateEncoder(
        worker,
        DeflateEncoderStreamId.REPLAY,
        onTerminalError
      )
      const writeCallback = jasmine.createSpy('writeCallback')

      encoder.write('delayed-main-thread-delivery', writeCallback)
      jasmine.clock().tick(DEFLATE_WORKER_ACTIVITY_TIMEOUT)
      emitMessage(worker, {
        type: 'wrote',
        id: 0,
        streamId: DeflateEncoderStreamId.REPLAY,
        additionalBytesCount: 5,
        result: new Uint8Array([1]),
        trailer: new Uint8Array([3])
      })
      jasmine.clock().tick(DEFLATE_WORKER_ACTIVITY_GRACE_TIMEOUT)

      expect(writeCallback).toHaveBeenCalledWith(1)
      expect(onTerminalError).not.toHaveBeenCalled()
      encoder.stop()
    } finally {
      jasmine.clock().uninstall()
    }
  })

  it('should renew the watchdog when a slow worker keeps making progress', () => {
    jasmine.clock().install()
    try {
      const worker = createWorker()
      const onTerminalError = jasmine.createSpy('onTerminalError')
      const encoder = createDeflateEncoder(
        worker,
        DeflateEncoderStreamId.REPLAY,
        onTerminalError
      )
      const callbacks = [
        jasmine.createSpy('firstCallback'),
        jasmine.createSpy('secondCallback'),
        jasmine.createSpy('thirdCallback')
      ]

      encoder.write('first', callbacks[0])
      encoder.write('second', callbacks[1])
      encoder.write('third', callbacks[2])

      jasmine.clock().tick(DEFLATE_WORKER_ACTIVITY_TIMEOUT - 1000)
      emitMessage(worker, {
        type: 'initialized',
        version: 'test'
      })
      expect(onTerminalError).not.toHaveBeenCalled()

      for (let actionId = 0; actionId < 3; actionId += 1) {
        jasmine.clock().tick(DEFLATE_WORKER_ACTIVITY_TIMEOUT - 1000)
        expect(onTerminalError).not.toHaveBeenCalled()
        emitMessage(worker, {
          type: 'wrote',
          id: actionId,
          streamId: DeflateEncoderStreamId.REPLAY,
          additionalBytesCount: 5,
          result: new Uint8Array([actionId]),
          trailer: new Uint8Array([3])
        })
      }

      jasmine.clock().tick(DEFLATE_WORKER_ACTIVITY_TIMEOUT)
      expect(onTerminalError).not.toHaveBeenCalled()
      callbacks.forEach(function (callback) {
        expect(callback).toHaveBeenCalledWith(1)
      })
      expect(encoder.getPendingRawBytesCount()).toBe(0)
      encoder.stop()
    } finally {
      jasmine.clock().uninstall()
    }
  })

  it('should not fire the watchdog after finishSync or stop', () => {
    jasmine.clock().install()
    try {
      const worker = createWorker()
      const onTerminalError = jasmine.createSpy('onTerminalError')
      const firstEncoder = createDeflateEncoder(
        worker,
        DeflateEncoderStreamId.REPLAY,
        onTerminalError
      )
      firstEncoder.write('finish-sync')
      firstEncoder.finishSync()

      const secondWorker = createWorker()
      const secondEncoder = createDeflateEncoder(
        secondWorker,
        DeflateEncoderStreamId.REPLAY,
        onTerminalError
      )
      secondEncoder.write('stop')
      secondEncoder.stop()

      jasmine.clock().tick(DEFLATE_WORKER_ACTIVITY_TIMEOUT)

      expect(onTerminalError).not.toHaveBeenCalled()
      firstEncoder.stop()
    } finally {
      jasmine.clock().uninstall()
    }
  })

  it('should release both worker listeners and pending data when stopped', () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(worker, DeflateEncoderStreamId.REPLAY)

    encoder.write('first')
    encoder.stop()

    expect(worker.removeEventListener).toHaveBeenCalledTimes(2)
    expect(encoder.getPendingEncodedBytesCount()).toBe(0)
    expect(encoder.getPendingRawBytesCount()).toBe(0)
  })
})
