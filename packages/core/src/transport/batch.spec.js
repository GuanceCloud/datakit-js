import { Observable } from '../helper/observable'
import { display } from '../helper/display'
import { createIdentityEncoder } from '../helper/encoder'
import { computeBytesCount } from '../helper/byteUtils'
import { jsonStringify } from '../helper/serialisation/jsonStringify'
import { createBatch, processedMessageByDataMap } from './batch'

describe('batch', () => {
  it('should map telemetry messages into row data', () => {
    const processed = processedMessageByDataMap({
      type: 'telemetry',
      date: 123,
      service: 'browser-rum-sdk',
      telemetry: {
        status: 'debug',
        message: 'test message',
        runtime_env: {
          is_worker: false
        }
      }
    })

    expect(processed.rowData).toEqual(
      jasmine.objectContaining({
        measurement: 'telemetry',
        time: 123,
        fields: jasmine.objectContaining({
          status: 'debug',
          message: 'test message',
          runtime_env: '{"is_worker":false}'
        })
      })
    )
    expect(processed.rowStr).toContain('telemetry')
  })

  it('should include custom context fields and custom_keys in mapped row data', () => {
    const processed = processedMessageByDataMap({
      type: 'telemetry',
      date: 123,
      telemetry: {
        status: 'debug'
      },
      context: {
        customField: 'value'
      }
    })

    expect(processed.rowData.fields.customField).toBe('value')
    expect(processed.rowData.fields.custom_keys).toBe('["customField"]')
  })

  it('should serialize WebSocket resource metrics into transport fields', () => {
    const processed = processedMessageByDataMap({
      type: 'resource',
      date: 123,
      resource: {
        id: 'resource-1',
        type: 'websocket',
        url: 'wss://example.com/socket',
        duration: 10000000,
        websocket: {
          connection_id: 'connection-1',
          handshake_succeeded: true,
          tracking_end_reason: 'close_event',
          messages_in: { count: 2, size: 16 },
          messages_out: { count: 1, size: 4 },
          setup_duration: 3000000
        }
      }
    })

    expect(processed.rowData.fields).toEqual(
      jasmine.objectContaining({
        resource_type: 'websocket',
        resource_websocket_connection_id: 'connection-1',
        resource_websocket_handshake_succeeded: true,
        resource_websocket_tracking_end_reason: 'close_event',
        resource_websocket_messages_in_count: 2,
        resource_websocket_messages_in_size: 16,
        resource_websocket_messages_out_count: 1,
        resource_websocket_messages_out_size: 4,
        resource_websocket_setup_duration: 3000000
      })
    )
    expect(processed.rowStr).toContain(
      'resource_websocket_connection_id="connection-1"'
    )
  })

  it('should discard messages bigger than the allowed size', () => {
    const flushObservable = new Observable()
    const flushController = {
      flushObservable,
      notifyBeforeAddMessage: jasmine.createSpy('notifyBeforeAddMessage'),
      notifyAfterAddMessage: jasmine.createSpy('notifyAfterAddMessage'),
      notifyAfterRemoveMessage: jasmine.createSpy('notifyAfterRemoveMessage')
    }
    const encoder = {
      isAsync: false,
      isEmpty: () => true,
      estimateEncodedBytesCount: () => 100,
      write: jasmine.createSpy('write'),
      finish: jasmine.createSpy('finish')
    }

    spyOn(display, 'warn')

    const batch = createBatch({
      encoder,
      request: {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      messageBytesLimit: 10,
      sendContentTypeByJson: false,
      flushController
    })

    batch.add({ type: 'telemetry', date: 1, telemetry: { status: 'debug' } })

    expect(display.warn).toHaveBeenCalled()
    expect(encoder.write).not.toHaveBeenCalled()
    expect(flushController.notifyBeforeAddMessage).not.toHaveBeenCalled()
  })

  it('should flush encoded data through the regular request path', () => {
    const flushObservable = new Observable()
    const flushController = {
      flushObservable,
      notifyBeforeAddMessage: jasmine.createSpy('notifyBeforeAddMessage'),
      notifyAfterAddMessage: jasmine.createSpy('notifyAfterAddMessage'),
      notifyAfterRemoveMessage: jasmine.createSpy('notifyAfterRemoveMessage')
    }
    const send = jasmine.createSpy('send')
    const encoder = {
      isAsync: false,
      empty: true,
      isEmpty() {
        return this.empty
      },
      estimateEncodedBytesCount: (message) => message.length,
      write: jasmine.createSpy('write').and.callFake((text, callback) => {
        encoder.empty = false
        if (callback) {
          callback(text.length)
        }
      }),
      finish: jasmine.createSpy('finish').and.callFake((callback) => {
        callback({
          output: 'encoded-payload',
          outputBytesCount: 14
        })
      })
    }

    createBatch({
      encoder,
      request: {
        send,
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      messageBytesLimit: 1000,
      sendContentTypeByJson: false,
      flushController
    }).add({ type: 'telemetry', date: 1, telemetry: { status: 'debug' } })

    flushObservable.notify({ reason: 'duration_limit' })

    expect(send).toHaveBeenCalledWith(
      jasmine.objectContaining({
        data: 'encoded-payload',
        bytesCount: 14
      })
    )
  })

  it('should send the failed batch without compression and use the fallback encoder for the next batch', () => {
    const flushObservable = new Observable()
    const flushController = {
      flushObservable,
      notifyBeforeAddMessage: jasmine.createSpy('notifyBeforeAddMessage'),
      notifyAfterAddMessage: jasmine.createSpy('notifyAfterAddMessage'),
      notifyAfterRemoveMessage: jasmine.createSpy('notifyAfterRemoveMessage')
    }
    const send = jasmine.createSpy('send')
    const encoderError = new Error('compression worker failed')
    const finishCallbacks = []
    const failedEncoder = {
      isAsync: true,
      empty: true,
      isEmpty() {
        return this.empty
      },
      estimateEncodedBytesCount: (message) => message.length / 8,
      write: jasmine.createSpy('write').and.callFake(function (
        text,
        callback
      ) {
        failedEncoder.empty = false
        if (callback) {
          callback(text.length)
        }
      }),
      finish: jasmine.createSpy('finish').and.callFake((callback) => {
        failedEncoder.empty = true
        finishCallbacks.push(callback)
      }),
      stop: jasmine.createSpy('stop')
    }
    const encoderFallback = jasmine
      .createSpy('encoderFallback')
      .and.callFake(createIdentityEncoder)
    const batch = createBatch({
      encoder: failedEncoder,
      encoderFallback,
      request: {
        send,
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      messageBytesLimit: 1000,
      sendContentTypeByJson: false,
      flushController
    })

    batch.add({
      type: 'telemetry',
      date: 1,
      telemetry: { status: 'debug', message: 'failed-batch' }
    })
    flushObservable.notify({ reason: 'duration_limit' })

    batch.add({
      type: 'telemetry',
      date: 2,
      telemetry: {
        status: 'debug',
        message: 'queued-before-fallback'
      }
    })
    finishCallbacks.shift()({
      output: new Uint8Array(0),
      outputBytesCount: 0,
      error: encoderError
    })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.calls.argsFor(0)[0]).toEqual(
      jasmine.objectContaining({
        data: jasmine.stringMatching(/failed-batch/),
        bytesCount: jasmine.any(Number)
      })
    )
    expect(send.calls.argsFor(0)[0].bytesCount).toBeGreaterThan(0)
    expect(send.calls.argsFor(0)[0].encoding).toBeUndefined()
    expect(encoderFallback).toHaveBeenCalledTimes(1)
    expect(failedEncoder.stop).toHaveBeenCalledTimes(1)

    batch.add({
      type: 'telemetry',
      date: 3,
      telemetry: { status: 'debug', message: 'fallback-batch' }
    })
    flushObservable.notify({ reason: 'duration_limit' })

    expect(send).toHaveBeenCalledTimes(2)
    expect(send.calls.argsFor(1)[0]).toEqual(
      jasmine.objectContaining({
        data: jasmine.stringMatching(/fallback-batch/),
        bytesCount: jasmine.any(Number)
      })
    )
    expect(send.calls.argsFor(1)[0].data).toContain(
      'queued-before-fallback'
    )
    expect(send.calls.argsFor(1)[0].bytesCount).toBeGreaterThan(0)
    expect(encoderFallback).toHaveBeenCalledTimes(1)
  })

  it('should preserve the original upsert estimate when the encoder changes', () => {
    const flushObservable = new Observable()
    const notifyAfterRemoveMessage = jasmine.createSpy(
      'notifyAfterRemoveMessage'
    )
    const writeCallbacks = []
    const failedEncoder = {
      isAsync: true,
      isEmpty: () => false,
      estimateEncodedBytesCount: (message) => message.length / 8,
      write: jasmine.createSpy('write').and.callFake((_text, callback) => {
        writeCallbacks.push(callback)
      }),
      finish: jasmine.createSpy('finish'),
      stop: jasmine.createSpy('stop')
    }
    const batch = createBatch({
      encoder: failedEncoder,
      encoderFallback: createIdentityEncoder,
      request: {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      messageBytesLimit: 1000,
      sendContentTypeByJson: false,
      flushController: {
        flushObservable,
        notifyBeforeAddMessage: jasmine.createSpy('notifyBeforeAddMessage'),
        notifyAfterAddMessage: jasmine.createSpy('notifyAfterAddMessage'),
        notifyAfterRemoveMessage
      }
    })
    const firstView = {
      type: 'telemetry',
      date: 1,
      telemetry: { status: 'debug', message: 'first view value' }
    }
    const firstSerializedMessage = processedMessageByDataMap(firstView).rowStr
    const firstEstimatedBytes =
      failedEncoder.estimateEncodedBytesCount(firstSerializedMessage)

    batch.upsert(firstView, 'view-1')
    batch.add({
      type: 'telemetry',
      date: 2,
      telemetry: { status: 'debug', message: 'trigger fallback' }
    })
    writeCallbacks.shift()(0, new Error('stream failed'))
    batch.upsert(
      {
        type: 'telemetry',
        date: 3,
        telemetry: { status: 'debug', message: 'updated view value' }
      },
      'view-1'
    )

    expect(notifyAfterRemoveMessage).toHaveBeenCalledOnceWith(
      firstEstimatedBytes
    )
  })

  it('should preserve the JSON content type on a regular encoded flush', () => {
    const flushObservable = new Observable()
    const send = jasmine.createSpy('send')
    const batch = createBatch({
      encoder: createIdentityEncoder(),
      request: {
        send,
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      messageBytesLimit: 1000,
      sendContentTypeByJson: true,
      flushController: {
        flushObservable,
        notifyBeforeAddMessage: jasmine.createSpy('notifyBeforeAddMessage'),
        notifyAfterAddMessage: jasmine.createSpy('notifyAfterAddMessage'),
        notifyAfterRemoveMessage: jasmine.createSpy('notifyAfterRemoveMessage')
      }
    })

    batch.add({
      type: 'telemetry',
      date: 1,
      telemetry: { status: 'debug', message: 'json-batch' }
    })
    flushObservable.notify({ reason: 'duration_limit' })

    expect(send).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        data: jasmine.stringMatching(/^\[.*\]$/),
        type: 'application/json;UTF-8'
      })
    )
  })

  it('should not send an empty payload when an encoder fails without buffered messages', () => {
    const flushObservable = new Observable()
    const send = jasmine.createSpy('send')
    const batch = createBatch({
      encoder: {
        isAsync: false,
        isEmpty: () => true,
        estimateEncodedBytesCount: (message) => message.length,
        write: jasmine.createSpy('write'),
        finish: jasmine.createSpy('finish').and.callFake((callback) => {
          callback({
            output: new Uint8Array(0),
            outputBytesCount: 0,
            error: new Error('encoder failed')
          })
        })
      },
      encoderFallback: createIdentityEncoder,
      request: {
        send,
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      messageBytesLimit: 1000,
      sendContentTypeByJson: false,
      flushController: {
        flushObservable,
        notifyBeforeAddMessage: jasmine.createSpy('notifyBeforeAddMessage'),
        notifyAfterAddMessage: jasmine.createSpy('notifyAfterAddMessage'),
        notifyAfterRemoveMessage: jasmine.createSpy('notifyAfterRemoveMessage')
      }
    })

    flushObservable.notify({ reason: 'duration_limit' })

    expect(send).not.toHaveBeenCalled()
  })

  it('should split pending raw messages and upserts by byte size on page exit', () => {
    const flushObservable = new Observable()
    const send = jasmine.createSpy('sendOnExit')
    const pendingData = []
    const encoder = {
      isAsync: true,
      empty: true,
      isEmpty() {
        return this.empty
      },
      estimateEncodedBytesCount: () => 1,
      write: jasmine.createSpy('write').and.callFake((text, callback) => {
        encoder.empty = false
        pendingData.push(text)
        if (callback) {
          callback(1)
        }
      }),
      finishSync: jasmine.createSpy('finishSync').and.callFake(() => ({
        output: new Uint8Array(0),
        outputBytesCount: 0,
        pendingData: pendingData.splice(0)
      }))
    }
    const messages = [1, 2, 3, 4].map((date) => ({
      type: 'telemetry',
      date,
      telemetry: {
        status: 'debug',
        message: `pending-message-${date}-${'x'.repeat(40)}`
      }
    }))
    const serializedMessages = messages.map(
      (message) => processedMessageByDataMap(message).rowStr
    )
    const bytesLimit = Math.max(
      ...serializedMessages.map(computeBytesCount)
    )
    const batch = createBatch({
      encoder,
      request: {
        send: jasmine.createSpy('send'),
        sendOnExit: send
      },
      bytesLimit,
      messageBytesLimit: 1000,
      sendContentTypeByJson: false,
      flushController: {
        flushObservable,
        notifyBeforeAddMessage: jasmine.createSpy('notifyBeforeAddMessage'),
        notifyAfterAddMessage: jasmine.createSpy('notifyAfterAddMessage'),
        notifyAfterRemoveMessage: jasmine.createSpy('notifyAfterRemoveMessage')
      }
    })

    batch.add(messages[0])
    batch.add(messages[1])
    batch.upsert(messages[2], 'view-1')
    batch.upsert(messages[3], 'view-2')
    flushObservable.notify({ reason: 'before_unload' })

    expect(
      send.calls.allArgs().map((args) => args[0].data)
    ).toEqual(serializedMessages)
    send.calls.allArgs().forEach((args) => {
      expect(args[0].bytesCount).toBeLessThanOrEqual(bytesLimit)
    })
  })

  it('should restore JSON messages across an unfinished flush on page exit', () => {
    const flushObservable = new Observable()
    const send = jasmine.createSpy('sendOnExit')
    const regularSend = jasmine.createSpy('send')
    const pendingData = []
    const finishCallbacks = []
    const partialEncodedOutput = 'compressed-json-prefix'
    const encoder = {
      isAsync: true,
      empty: true,
      isEmpty() {
        return this.empty
      },
      estimateEncodedBytesCount: () => 1,
      write: jasmine.createSpy('write').and.callFake((text, callback) => {
        encoder.empty = false
        pendingData.push(text)
        if (callback) {
          callback(1)
        }
      }),
      finish: jasmine.createSpy('finish').and.callFake((callback) => {
        encoder.empty = true
        finishCallbacks.push(callback)
      }),
      finishSync: jasmine.createSpy('finishSync').and.callFake(() => ({
        output: partialEncodedOutput,
        outputBytesCount: computeBytesCount(partialEncodedOutput),
        encoding: 'deflate',
        pendingData: pendingData.splice(0)
      }))
    }
    const messages = [1, 2, 3, 4, 5].map((date) => ({
      type: 'telemetry',
      date,
      telemetry: {
        status: 'debug',
        message: `pending-json-${date}-{"nested":"value"}-${'x'.repeat(40)}`
      }
    }))
    const serializedMessages = messages.map((message) =>
      jsonStringify(processedMessageByDataMap(message).rowData)
    )
    const bytesLimit =
      Math.max(...serializedMessages.map(computeBytesCount)) + 2
    const batch = createBatch({
      encoder,
      request: {
        send: regularSend,
        sendOnExit: send
      },
      bytesLimit,
      messageBytesLimit: 1000,
      sendContentTypeByJson: true,
      flushController: {
        flushObservable,
        notifyBeforeAddMessage: jasmine.createSpy('notifyBeforeAddMessage'),
        notifyAfterAddMessage: jasmine.createSpy('notifyAfterAddMessage'),
        notifyAfterRemoveMessage: jasmine.createSpy('notifyAfterRemoveMessage')
      }
    })

    batch.add(messages[0])
    batch.upsert(messages[1], 'view-1')
    batch.upsert(messages[2], 'view-2')
    flushObservable.notify({ reason: 'duration_limit' })

    expect(encoder.finish).toHaveBeenCalledTimes(1)
    expect(finishCallbacks).toHaveSize(1)
    expect(regularSend).not.toHaveBeenCalled()

    // Simulate the worker having compressed the first JSON write while the
    // previous batch footer (which also contains its two upserts) is pending.
    expect(pendingData.shift()).toContain(serializedMessages[0])
    batch.add(messages[3])
    batch.upsert(messages[4], 'view-3')
    flushObservable.notify({ reason: 'before_unload' })

    expect(send).toHaveBeenCalledTimes(serializedMessages.length)
    send.calls.allArgs().forEach((args, index) => {
      const payload = args[0]
      expect(payload.type).toBe('application/json;UTF-8')
      expect(payload.bytesCount).toBeLessThanOrEqual(bytesLimit)
      expect(JSON.parse(payload.data)).toEqual([
        JSON.parse(serializedMessages[index])
      ])
    })

    expect(
      send.calls
        .allArgs()
        .some((args) => args[0].data === partialEncodedOutput)
    ).toBeFalse()

    finishCallbacks[0]({
      output: 'late-compressed-payload',
      outputBytesCount: 23,
      encoding: 'deflate'
    })
    expect(regularSend).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(serializedMessages.length)
  })

  it('should preserve one oversized pending message on page exit', () => {
    const flushObservable = new Observable()
    const send = jasmine.createSpy('sendOnExit')
    const pendingData = []
    const encoder = {
      isAsync: true,
      isEmpty: () => pendingData.length === 0,
      estimateEncodedBytesCount: () => 1,
      write: jasmine.createSpy('write').and.callFake((text, callback) => {
        pendingData.push(text)
        callback(1)
      }),
      finishSync: jasmine.createSpy('finishSync').and.callFake(() => ({
        output: new Uint8Array(0),
        outputBytesCount: 0,
        pendingData: pendingData.splice(0)
      }))
    }
    const message = {
      type: 'telemetry',
      date: 1,
      telemetry: {
        status: 'debug',
        message: 'pending oversized message '.repeat(20)
      }
    }
    const serializedMessage = processedMessageByDataMap(message).rowStr
    const bytesLimit = computeBytesCount(serializedMessage) - 1
    const batch = createBatch({
      encoder,
      request: {
        send: jasmine.createSpy('send'),
        sendOnExit: send
      },
      bytesLimit,
      messageBytesLimit: 1000,
      sendContentTypeByJson: false,
      flushController: {
        flushObservable,
        notifyBeforeAddMessage: jasmine.createSpy('notifyBeforeAddMessage'),
        notifyAfterAddMessage: jasmine.createSpy('notifyAfterAddMessage'),
        notifyAfterRemoveMessage: jasmine.createSpy('notifyAfterRemoveMessage')
      }
    })

    batch.add(message)
    flushObservable.notify({ reason: 'before_unload' })

    expect(send).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        data: serializedMessage,
        bytesCount: computeBytesCount(serializedMessage)
      })
    )
    expect(send.calls.argsFor(0)[0].bytesCount).toBeGreaterThan(bytesLimit)
  })

  it('should split fallback messages by their raw byte size on page exit', () => {
    const flushObservable = new Observable()
    const send = jasmine.createSpy('send')
    const failedEncoder = {
      isAsync: true,
      empty: true,
      isEmpty() {
        return this.empty
      },
      estimateEncodedBytesCount: () => 1,
      write: jasmine.createSpy('write').and.callFake((text, callback) => {
        failedEncoder.empty = false
        if (callback) {
          callback(1)
        }
      }),
      finishSync: jasmine.createSpy('finishSync').and.returnValue({
        output: new Uint8Array(0),
        outputBytesCount: 0,
        error: new Error('compression failed')
      }),
      stop: jasmine.createSpy('stop')
    }
    const messages = [1, 2, 3].map((date) => ({
      type: 'telemetry',
      date,
      telemetry: {
        status: 'debug',
        message: `fallback-message-${date}-${'x'.repeat(40)}`
      }
    }))
    const serializedMessages = messages.map(
      (message) => processedMessageByDataMap(message).rowStr
    )
    const bytesLimit =
      Math.max(...serializedMessages.map(computeBytesCount)) + 1

    const batch = createBatch({
      encoder: failedEncoder,
      encoderFallback: createIdentityEncoder,
      request: {
        send: jasmine.createSpy('send'),
        sendOnExit: send
      },
      bytesLimit,
      messageBytesLimit: 1000,
      sendContentTypeByJson: false,
      flushController: {
        flushObservable,
        notifyBeforeAddMessage: jasmine.createSpy('notifyBeforeAddMessage'),
        notifyAfterAddMessage: jasmine.createSpy('notifyAfterAddMessage'),
        notifyAfterRemoveMessage: jasmine.createSpy('notifyAfterRemoveMessage')
      }
    })

    messages.forEach((message) => batch.add(message))
    flushObservable.notify({ reason: 'before_unload' })

    expect(send).toHaveBeenCalledTimes(serializedMessages.length)
    expect(
      send.calls.allArgs().map((args) => args[0].data)
    ).toEqual(serializedMessages)
    send.calls.allArgs().forEach((args) => {
      expect(args[0].bytesCount).toBeLessThanOrEqual(bytesLimit)
    })
  })

  it('should split the first identity batch after a write error', () => {
    const flushObservable = new Observable()
    const send = jasmine.createSpy('send')
    let writeCount = 0
    const failedEncoder = {
      isAsync: true,
      empty: true,
      isEmpty() {
        return this.empty
      },
      estimateEncodedBytesCount: () => 1,
      write: jasmine.createSpy('write').and.callFake((text, callback) => {
        failedEncoder.empty = false
        writeCount += 1
        callback(
          1,
          writeCount === 2 ? new Error('stream write failed') : undefined
        )
      }),
      finish: jasmine.createSpy('finish'),
      stop: jasmine.createSpy('stop')
    }
    const encoderFallback = jasmine
      .createSpy('encoderFallback')
      .and.callFake(createIdentityEncoder)
    const messages = [1, 2, 3].map((date) => ({
      type: 'telemetry',
      date,
      telemetry: {
        status: 'debug',
        message: `identity-message-${date}-${'x'.repeat(40)}`
      }
    }))
    const serializedMessages = messages.map(
      (message) => processedMessageByDataMap(message).rowStr
    )
    const bytesLimit =
      Math.max(...serializedMessages.map(computeBytesCount)) + 1

    const batch = createBatch({
      encoder: failedEncoder,
      encoderFallback,
      request: {
        send,
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      bytesLimit,
      messageBytesLimit: 1000,
      sendContentTypeByJson: false,
      flushController: {
        flushObservable,
        notifyBeforeAddMessage: jasmine.createSpy('notifyBeforeAddMessage'),
        notifyAfterAddMessage: jasmine.createSpy('notifyAfterAddMessage'),
        notifyAfterRemoveMessage: jasmine.createSpy('notifyAfterRemoveMessage')
      }
    })

    messages.forEach((message) => batch.add(message))
    flushObservable.notify({ reason: 'duration_limit' })

    expect(encoderFallback).toHaveBeenCalledTimes(1)
    expect(failedEncoder.stop).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(serializedMessages.length)
    expect(
      send.calls.allArgs().map((args) => args[0].data)
    ).toEqual(serializedMessages)
    send.calls.allArgs().forEach((args) => {
      expect(args[0].bytesCount).toBeLessThanOrEqual(bytesLimit)
    })
  })

  it('should keep fallback JSON chunks valid and preserve their content type', () => {
    const flushObservable = new Observable()
    const send = jasmine.createSpy('send')
    const failedEncoder = {
      isAsync: false,
      isEmpty: () => false,
      estimateEncodedBytesCount: () => 1,
      write: jasmine.createSpy('write').and.callFake((_text, callback) => {
        if (callback) {
          callback(1)
        }
      }),
      finish: jasmine.createSpy('finish').and.callFake((callback) => {
        callback({
          output: new Uint8Array(0),
          outputBytesCount: 0,
          error: new Error('compression failed')
        })
      })
    }
    const messages = [1, 2].map((date) => ({
      type: 'telemetry',
      date,
      telemetry: {
        status: 'debug',
        message: `json-fallback-${date}-${'x'.repeat(40)}`
      }
    }))
    const serializedMessages = messages.map((message) =>
      jsonStringify(processedMessageByDataMap(message).rowData)
    )
    const bytesLimit =
      Math.max(...serializedMessages.map(computeBytesCount)) + 2

    const batch = createBatch({
      encoder: failedEncoder,
      encoderFallback: createIdentityEncoder,
      request: {
        send,
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      bytesLimit,
      messageBytesLimit: 1000,
      sendContentTypeByJson: true,
      flushController: {
        flushObservable,
        notifyBeforeAddMessage: jasmine.createSpy('notifyBeforeAddMessage'),
        notifyAfterAddMessage: jasmine.createSpy('notifyAfterAddMessage'),
        notifyAfterRemoveMessage: jasmine.createSpy('notifyAfterRemoveMessage')
      }
    })

    messages.forEach((message) => batch.add(message))
    flushObservable.notify({ reason: 'duration_limit' })

    expect(send).toHaveBeenCalledTimes(serializedMessages.length)
    send.calls.allArgs().forEach((args, index) => {
      const payload = args[0]
      expect(payload.type).toBe('application/json;UTF-8')
      expect(payload.bytesCount).toBeLessThanOrEqual(bytesLimit)
      expect(JSON.parse(payload.data)).toEqual([
        JSON.parse(serializedMessages[index])
      ])
    })
  })

  it('should send an indivisible fallback message even when it exceeds the batch limit', () => {
    const flushObservable = new Observable()
    const send = jasmine.createSpy('send')
    const failedEncoder = {
      isAsync: false,
      isEmpty: () => true,
      estimateEncodedBytesCount: () => 1,
      write: jasmine.createSpy('write').and.callFake((_text, callback) => {
        callback(1)
      }),
      finish: jasmine.createSpy('finish').and.callFake((callback) => {
        callback({
          output: new Uint8Array(0),
          outputBytesCount: 0,
          error: new Error('compression failed')
        })
      })
    }
    const message = {
      type: 'telemetry',
      date: 1,
      telemetry: {
        status: 'debug',
        message: '单条超限消息'.repeat(30)
      }
    }
    const serializedMessage = processedMessageByDataMap(message).rowStr
    const bytesLimit = computeBytesCount(serializedMessage) - 1

    const batch = createBatch({
      encoder: failedEncoder,
      encoderFallback: createIdentityEncoder,
      request: {
        send,
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      bytesLimit,
      messageBytesLimit: 1000,
      sendContentTypeByJson: false,
      flushController: {
        flushObservable,
        notifyBeforeAddMessage: jasmine.createSpy('notifyBeforeAddMessage'),
        notifyAfterAddMessage: jasmine.createSpy('notifyAfterAddMessage'),
        notifyAfterRemoveMessage: jasmine.createSpy('notifyAfterRemoveMessage')
      }
    })

    batch.add(message)
    flushObservable.notify({ reason: 'duration_limit' })

    expect(send).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        data: serializedMessage,
        bytesCount: computeBytesCount(serializedMessage)
      })
    )
    expect(send.calls.argsFor(0)[0].bytesCount).toBeGreaterThan(bytesLimit)
  })
})
