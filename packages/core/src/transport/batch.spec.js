import { Observable } from '../helper/observable'
import { display } from '../helper/display'
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
})
