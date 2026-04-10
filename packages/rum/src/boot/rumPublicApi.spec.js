import { ActionType, ResourceType } from '@cloudcare/browser-core'

describe('rumPublicApi', () => {
  let makeRumPublicApi
  let originalBuildEnvVersion

  function createValidInitConfiguration(extra) {
    return Object.assign(
      {
        applicationId: 'app-1',
        datakitUrl: 'https://datakit.example.com'
      },
      extra
    )
  }

  beforeEach(() => {
    originalBuildEnvVersion = globalThis.__BUILD_ENV__SDK_VERSION__
    globalThis.__BUILD_ENV__SDK_VERSION__ = 'test-version'
    ;({ makeRumPublicApi } = require('./rumPublicApi'))
  })

  afterEach(() => {
    globalThis.__BUILD_ENV__SDK_VERSION__ = originalBuildEnvVersion
  })

  it('should use the first pre-init startView as the initial manual view and expose common context', () => {
    const startRumResult = {
      addAction: jasmine.createSpy('addAction'),
      addError: jasmine.createSpy('addError'),
      addResource: jasmine.createSpy('addResource'),
      addTiming: jasmine.createSpy('addTiming'),
      getInternalContext: jasmine.createSpy('getInternalContext'),
      getViewContext: jasmine.createSpy('getViewContext'),
      lifeCycle: {},
      session: {},
      setForcedSession: jasmine.createSpy('setForcedSession'),
      setViewContext: jasmine.createSpy('setViewContext'),
      setViewContextProperty: jasmine.createSpy('setViewContextProperty'),
      setViewName: jasmine.createSpy('setViewName'),
      startView: jasmine.createSpy('startView'),
      stopSession: jasmine.createSpy('stopSession'),
      viewContexts: {}
    }
    const startRumImpl = jasmine
      .createSpy('startRumImpl')
      .and.returnValue(startRumResult)
    const snapshotCanvasResult = { ok: true }
    const recorderApi = {
      isRecording: jasmine.createSpy('isRecording').and.returnValue(false),
      getSerializedNodeIdForDebug: jasmine
        .createSpy('getSerializedNodeIdForDebug')
        .and.returnValue(undefined),
      getReplayPerformanceForDebug: jasmine
        .createSpy('getReplayPerformanceForDebug')
        .and.returnValue(undefined),
      onRumStart: jasmine.createSpy('onRumStart'),
      snapshotCanvas: jasmine
        .createSpy('snapshotCanvas')
        .and.returnValue(snapshotCanvasResult),
      start: jasmine.createSpy('start'),
      stop: jasmine.createSpy('stop'),
      takeSubsequentFullSnapshot: jasmine.createSpy('takeSubsequentFullSnapshot')
    }
    const rumPublicApi = makeRumPublicApi(startRumImpl, recorderApi)

    rumPublicApi.setGlobalContextProperty('account', 'pro')
    rumPublicApi.setUser({
      id: 'user-1',
      email: 'user@example.com'
    })
    rumPublicApi.startView('Checkout')
    rumPublicApi.init(
      createValidInitConfiguration({
        trackViewsManually: true
      })
    )

    expect(startRumImpl).toHaveBeenCalledTimes(1)
    expect(startRumImpl.calls.mostRecent().args[4]).toEqual({
      name: 'Checkout'
    })

    const getCommonContext = startRumImpl.calls.mostRecent().args[3]
    expect(getCommonContext()).toEqual({
      context: { account: 'pro' },
      user: {
        id: 'user-1',
        email: 'user@example.com'
      },
      hasReplay: undefined
    })
    expect(startRumResult.startView).not.toHaveBeenCalled()
    expect(recorderApi.onRumStart).toHaveBeenCalledWith(
      startRumResult.lifeCycle,
      jasmine.objectContaining({
        applicationId: 'app-1'
      }),
      startRumResult.session,
      startRumResult.viewContexts,
      undefined
    )
  })

  it('should delegate public APIs to the started strategy with sanitized payloads', () => {
    const startRumResult = {
      addAction: jasmine.createSpy('addAction'),
      addError: jasmine.createSpy('addError'),
      addResource: jasmine.createSpy('addResource'),
      addTiming: jasmine.createSpy('addTiming'),
      getInternalContext: jasmine.createSpy('getInternalContext').and.returnValue({
        view: { id: 'view-1' }
      }),
      getViewContext: jasmine.createSpy('getViewContext').and.returnValue({
        plan: 'pro'
      }),
      lifeCycle: {},
      session: {},
      setForcedSession: jasmine.createSpy('setForcedSession'),
      setViewContext: jasmine.createSpy('setViewContext'),
      setViewContextProperty: jasmine.createSpy('setViewContextProperty'),
      setViewName: jasmine.createSpy('setViewName'),
      startView: jasmine.createSpy('startView'),
      stopSession: jasmine.createSpy('stopSession'),
      viewContexts: {}
    }
    const startRumImpl = jasmine
      .createSpy('startRumImpl')
      .and.returnValue(startRumResult)
    const recorderApi = {
      isRecording: jasmine.createSpy('isRecording').and.returnValue(true),
      getSerializedNodeIdForDebug: jasmine
        .createSpy('getSerializedNodeIdForDebug')
        .and.returnValue(42),
      getReplayPerformanceForDebug: jasmine
        .createSpy('getReplayPerformanceForDebug')
        .and.returnValue({
          processMutationsCount: 3
        }),
      onRumStart: jasmine.createSpy('onRumStart'),
      snapshotCanvas: jasmine.createSpy('snapshotCanvas'),
      start: jasmine.createSpy('start'),
      stop: jasmine.createSpy('stop'),
      takeSubsequentFullSnapshot: jasmine.createSpy('takeSubsequentFullSnapshot')
    }
    const rumPublicApi = makeRumPublicApi(startRumImpl, recorderApi)

    rumPublicApi.init(createValidInitConfiguration())
    rumPublicApi.setViewName('Checkout')
    rumPublicApi.setViewContext({ plan: 'pro' })
    rumPublicApi.setViewContextProperty('step', 2)
    rumPublicApi.addResource({ url: '/asset.js', keep: true, fn: () => {} })
    rumPublicApi.addTypeAction('submit', 42, { nested: { ok: true } })
    rumPublicApi.addAction('clicked', { answer: 42 })
    rumPublicApi.addError(new Error('boom'), { extra: 'value' })
    rumPublicApi.addTiming('ready state', 123)
    rumPublicApi.stopSession()
    rumPublicApi.setForcedSession()

    expect(startRumResult.setViewName).toHaveBeenCalledWith('Checkout')
    expect(startRumResult.setViewContext).toHaveBeenCalledWith({ plan: 'pro' })
    expect(startRumResult.setViewContextProperty).toHaveBeenCalledWith(
      'step',
      2
    )
    expect(startRumResult.addResource).toHaveBeenCalledWith(
      jasmine.objectContaining({
        context: jasmine.objectContaining({
          url: '/asset.js',
          keep: true
        }),
        type: ResourceType.CUSTOM,
        startClocks: jasmine.any(Object),
        handlingStack: jasmine.any(String)
      })
    )
    expect(startRumResult.addAction).toHaveBeenCalledWith(
      jasmine.objectContaining({
        name: 'submit',
        type: ActionType.CUSTOM,
        context: { nested: { ok: true } },
        startClocks: jasmine.any(Object),
        handlingStack: jasmine.any(String)
      })
    )
    expect(startRumResult.addAction).toHaveBeenCalledWith(
      jasmine.objectContaining({
        name: 'clicked',
        type: ActionType.CUSTOM,
        context: { answer: 42 },
        startClocks: jasmine.any(Object),
        handlingStack: jasmine.any(String)
      })
    )
    expect(startRumResult.addError).toHaveBeenCalledWith(
      jasmine.objectContaining({
        error: jasmine.any(Error),
        context: { extra: 'value' },
        startClocks: jasmine.any(Object),
        handlingStack: jasmine.any(String)
      })
    )
    expect(startRumResult.addTiming).toHaveBeenCalledWith('ready state', 123)
    expect(startRumResult.stopSession).toHaveBeenCalled()
    expect(startRumResult.setForcedSession).toHaveBeenCalled()
    expect(rumPublicApi.getViewContext()).toEqual({ plan: 'pro' })
    expect(rumPublicApi.getInternalContext()).toEqual({
      view: { id: 'view-1' }
    })
  })

  it('should expose session replay controls and clone the init configuration', () => {
    const snapshotCanvasResult = { ok: true }
    const autoSnapshotResult = {
      status: 'completed',
      selectedCanvasCount: 1
    }
    const replaySegmentFlushResult = {
      creationReason: 'init',
      flushReason: 'segment_duration_limit',
      recordCountsByType: {
        mutation: 12,
        canvas_mutation: 5
      }
    }
    const replaySegmentFlushHistoryResult = [
      {
        creationReason: 'init',
        flushReason: 'segment_duration_limit'
      },
      {
        creationReason: 'segment_bytes_limit',
        flushReason: 'segment_bytes_limit'
      }
    ]
    const replayPerformanceResult = {
      processMutationsCount: 7,
      mutationCallbackCount: 2,
      replaySegmentFlushCount: 1
    }
    const startRumImpl = jasmine.createSpy('startRumImpl').and.returnValue({
      addAction: jasmine.createSpy('addAction'),
      addError: jasmine.createSpy('addError'),
      addResource: jasmine.createSpy('addResource'),
      addTiming: jasmine.createSpy('addTiming'),
      getInternalContext: jasmine.createSpy('getInternalContext'),
      getViewContext: jasmine.createSpy('getViewContext'),
      lifeCycle: {},
      session: {},
      setForcedSession: jasmine.createSpy('setForcedSession'),
      setViewContext: jasmine.createSpy('setViewContext'),
      setViewContextProperty: jasmine.createSpy('setViewContextProperty'),
      setViewName: jasmine.createSpy('setViewName'),
      startView: jasmine.createSpy('startView'),
      stopSession: jasmine.createSpy('stopSession'),
      viewContexts: {}
    })
    const recorderApi = {
      isRecording: jasmine.createSpy('isRecording').and.returnValue(false),
      getLastAutoCanvasSnapshotResultForDebug: jasmine
        .createSpy('getLastAutoCanvasSnapshotResultForDebug')
        .and.returnValue(autoSnapshotResult),
      getLastReplaySegmentFlushForDebug: jasmine
        .createSpy('getLastReplaySegmentFlushForDebug')
        .and.returnValue(replaySegmentFlushResult),
      getReplaySegmentFlushHistoryForDebug: jasmine
        .createSpy('getReplaySegmentFlushHistoryForDebug')
        .and.returnValue(replaySegmentFlushHistoryResult),
      getReplayPerformanceForDebug: jasmine
        .createSpy('getReplayPerformanceForDebug')
        .and.returnValue(replayPerformanceResult),
      getSerializedNodeIdForDebug: jasmine
        .createSpy('getSerializedNodeIdForDebug')
        .and.returnValue(42),
      onRumStart: jasmine.createSpy('onRumStart'),
      snapshotCanvas: jasmine
        .createSpy('snapshotCanvas')
        .and.returnValue(snapshotCanvasResult),
      start: jasmine.createSpy('start'),
      stop: jasmine.createSpy('stop'),
      takeSubsequentFullSnapshot: jasmine.createSpy('takeSubsequentFullSnapshot')
    }
    const rumPublicApi = makeRumPublicApi(startRumImpl, recorderApi)
    const initConfiguration = createValidInitConfiguration({
      sampleRate: 80
    })

    rumPublicApi.init(initConfiguration)
    const clonedInitConfiguration = rumPublicApi.getInitConfiguration()
    clonedInitConfiguration.applicationId = 'changed'

    expect(rumPublicApi.getInitConfiguration()).toEqual(
      jasmine.objectContaining({
        applicationId: 'app-1',
        sampleRate: 80
      })
    )

    rumPublicApi.startSessionReplayRecording({ force: true })
    rumPublicApi.stopSessionReplayRecording()
    rumPublicApi.takeSubsequentFullSnapshot()
    expect(
      rumPublicApi.getSerializedNodeIdForDebug(document.createElement('canvas'))
    ).toBe(42)
    expect(rumPublicApi.getLastAutoCanvasSnapshotResultForDebug()).toEqual(
      autoSnapshotResult
    )
    expect(rumPublicApi.getLastReplaySegmentFlushForDebug()).toEqual(
      replaySegmentFlushResult
    )
    expect(rumPublicApi.getReplaySegmentFlushHistoryForDebug()).toEqual(
      replaySegmentFlushHistoryResult
    )
    expect(rumPublicApi.getReplayPerformanceForDebug()).toEqual(
      replayPerformanceResult
    )
    expect(rumPublicApi.snapshotCanvas(document.createElement('canvas'))).toBe(
      snapshotCanvasResult
    )

    expect(recorderApi.start).toHaveBeenCalledWith({ force: true })
    expect(recorderApi.stop).toHaveBeenCalled()
    expect(recorderApi.takeSubsequentFullSnapshot).toHaveBeenCalled()
    expect(recorderApi.getSerializedNodeIdForDebug).toHaveBeenCalled()
    expect(recorderApi.getLastAutoCanvasSnapshotResultForDebug).toHaveBeenCalled()
    expect(recorderApi.getLastReplaySegmentFlushForDebug).toHaveBeenCalled()
    expect(recorderApi.snapshotCanvas).toHaveBeenCalled()
  })
})
