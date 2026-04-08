import { LifeCycle, LifeCycleEventType } from '@cloudcare/browser-core'
import { startRecording } from './startRecording'
import { RecordType } from '../types'
import { setSerializedNodeId } from '../domain/replay/record/serializationUtils'

describe('startRecording', () => {
  let originalBridge

  function parseBridgePayloads(sendEvent) {
    return sendEvent.calls.allArgs().map((args) => JSON.parse(args[0]))
  }

  beforeEach(() => {
    originalBridge = window.FTWebViewJavascriptBridge
  })

  afterEach(() => {
    window.FTWebViewJavascriptBridge = originalBridge
  })

  it('should send replay records through the event bridge and react to view lifecycle events', () => {
    const sendEvent = jasmine.createSpy('sendEvent')
    const lifeCycle = new LifeCycle()

    window.FTWebViewJavascriptBridge = {
      getAllowedWebViewHosts: () => '["localhost"]',
      sendEvent
    }

    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {},
      {
        findView: () => ({ id: 'view-current' })
      }
    )

    const initialPayloads = parseBridgePayloads(sendEvent)
    expect(initialPayloads.some((payload) => payload.data.type === RecordType.Meta)).toBeTrue()
    expect(initialPayloads.some((payload) => payload.data.type === RecordType.FullSnapshot)).toBeTrue()

    sendEvent.calls.reset()

    lifeCycle.notify(LifeCycleEventType.VIEW_ENDED)

    let payloads = parseBridgePayloads(sendEvent)
    expect(payloads[payloads.length - 1]).toEqual({
      name: 'session_replay',
      data: jasmine.objectContaining({
        type: RecordType.ViewEnd
      }),
      view: { id: 'view-current' }
    })

    sendEvent.calls.reset()

    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
      startClocks: { timeStamp: 1234 }
    })

    payloads = parseBridgePayloads(sendEvent)
    expect(
      payloads.some(
        (payload) =>
          payload.name === 'session_replay' &&
          payload.data.type === RecordType.FullSnapshot &&
          payload.data.timestamp === 1234
      )
    ).toBeTrue()

    recording.stop()
  })

  it('should stop forwarding lifecycle-triggered replay records after stop is called', () => {
    const sendEvent = jasmine.createSpy('sendEvent')
    const lifeCycle = new LifeCycle()

    window.FTWebViewJavascriptBridge = {
      getAllowedWebViewHosts: () => '["localhost"]',
      sendEvent
    }

    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {},
      {
        findView: () => ({ id: 'view-current' })
      }
    )

    sendEvent.calls.reset()
    recording.stop()

    lifeCycle.notify(LifeCycleEventType.VIEW_ENDED)
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
      startClocks: { timeStamp: 4567 }
    })

    expect(sendEvent).not.toHaveBeenCalled()
  })

  it('should expose snapshotCanvas from the underlying recorder', async () => {
    const sendEvent = jasmine.createSpy('sendEvent')
    const lifeCycle = new LifeCycle()
    const canvas = document.createElement('canvas')
    canvas.width = 20
    canvas.height = 10
    document.body.appendChild(canvas)

    window.FTWebViewJavascriptBridge = {
      getAllowedWebViewHosts: () => '["localhost"]',
      sendEvent
    }

    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input',
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxEncodedBytes: 40000,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {},
      {
        findView: () => ({ id: 'view-current' })
      }
    )

    setSerializedNodeId(canvas, 42)
    const result = await recording.snapshotCanvas(canvas)
    const serializedNodeId = recording.getSerializedNodeIdForDebug(canvas)
    const autoSnapshotResult =
      recording.getLastAutoCanvasSnapshotResultForDebug()

    expect(result).toEqual({ ok: true })
    expect(serializedNodeId).toBe(42)
    expect(autoSnapshotResult).toBeUndefined()
    expect(
      parseBridgePayloads(sendEvent).some(
        (payload) =>
          payload.name === 'session_replay' &&
          payload.data.type === RecordType.IncrementalSnapshot &&
          payload.data.data.source === 9
      )
    ).toBeTrue()

    recording.stop()
    canvas.remove()
  })
})
