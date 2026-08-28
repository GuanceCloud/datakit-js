;(function () {
  'use strict'

  var query = new URLSearchParams(window.location.search)
  var clarity = query.get('clarity') || 'balanced'
  var sampling = Number(query.get('sampling') || 2)
  if ([1, 2, 4].indexOf(sampling) === -1) {
    sampling = 2
  }

  var profiles = {
    1: {
      targetFps: 2,
      interval: 500,
      quality: 0.35,
      maxCanvasSize: 800,
      maxEncodedBytes: 40000,
      cooldown: 50
    },
    2: {
      targetFps: 4,
      interval: 250,
      quality: 0.4,
      maxCanvasSize: 960,
      maxEncodedBytes: 40000,
      cooldown: 50
    },
    4: {
      targetFps: 8,
      interval: 125,
      quality: 0.32,
      maxCanvasSize: 720,
      maxEncodedBytes: 40000,
      cooldown: 50
    }
  }
  var profile = profiles[sampling]
  if (clarity === 'high') {
    sampling = 1
    profile = {
      targetFps: 2,
      interval: 500,
      quality: 0.88,
      maxCanvasSize: 2260,
      maxEncodedBytes: 300000,
      cooldown: 100
    }
  }
  var recordingEnabled = true
  var knownSnapshots = Object.create(null)
  var knownSnapshotOrder = []
  var snapshotStartedAts = []
  var totalSnapshots = 0
  var diagnosticMutationSamples = []

  var diagnostics = (window.__cocosReplayDemo = {
    upstream: 'https://github.com/cocos/cocos-tutorial-airplane',
    upstreamCommit: '2aa02adc51144327a163356f019a77560eb04460',
    creatorVersion: '3.3.2',
    startedAt: Date.now(),
    freshSessionRequested: query.get('fresh') === '1',
    replayInitializedBeforeEngine: false,
    clarity: clarity,
    sampling: sampling,
    targetCaptureFps: profile.targetFps,
    snapshots: 0,
    errors: []
  })

  function byId(id) {
    return document.getElementById(id)
  }

  function formatBytes(bytes) {
    if (typeof bytes !== 'number') {
      return 'waiting'
    }
    if (bytes < 1024) {
      return bytes + ' B'
    }
    return (bytes / 1024).toFixed(1) + ' KiB'
  }

  function shortId(value) {
    return value ? value.slice(0, 8) + '…' : 'waiting'
  }

  function readCocosCounter(stats, name) {
    var stat = stats && stats[name]
    if (!stat || !stat.counter || typeof stat.counter.human !== 'function') {
      return undefined
    }
    return stat.counter.human()
  }

  function recordError(error) {
    diagnostics.errors.push(error && error.message ? error.message : String(error))
    byId('recording-status').textContent = 'init failed'
  }

  function initializeReplayBeforeCocos() {
    if (!window.DATAFLUX_RUM) {
      throw new Error('DATAFLUX_RUM is unavailable')
    }
    if (
      !window.DATAFLUX_RUM_WEBGL ||
      typeof window.DATAFLUX_RUM_WEBGL.webglReplayPlugin !== 'function'
    ) {
      throw new Error('DATAFLUX_RUM_WEBGL plugin is unavailable')
    }

    window.DATAFLUX_RUM.init({
      applicationId: 'test_dcl',
      site: 'https://cn3-rum-openway.guance.com',
      clientToken: 'b806cd20126446c4848605cb254f92ed',
      service: 'browser-cocos-airplane',
      env: 'production',
      version: 'creator-3.3.2@2aa02adc',
      plugins: [window.DATAFLUX_RUM_WEBGL.webglReplayPlugin()],
      sessionSampleRate: 100,
      sessionReplaySampleRate: 100,
      replayCanvasEnabled: true,
      replayCanvasMode: 'auto',
      replayCanvasSampling: sampling,
      replayCanvasQuality: profile.quality,
      replayCanvasMaxCanvasSize: profile.maxCanvasSize,
      replayCanvasMaxEncodedBytes: profile.maxEncodedBytes,
      replayCanvasMaxConcurrentEncodes: 1,
      replayCanvasAutoInterval: profile.interval,
      replayCanvasAutoCooldown: profile.cooldown,
      replayCanvasAutoUnchangedBackoff: Math.max(profile.interval * 2, 1000),
      replayCanvasAutoFailureBackoff: Math.max(profile.interval * 4, 3000),
      replayCanvasAutoMaxPerRun: 1,
      compressIntakeRequests: true,
      trackInteractions: true
    })
    if (diagnostics.freshSessionRequested) {
      window.DATAFLUX_RUM.stopSession()
      window.DATAFLUX_RUM.startSession({ sessionSampleRate: 100 })
    }
    window.DATAFLUX_RUM.setForcedSession()
    window.DATAFLUX_RUM.startSessionReplayRecording()
    diagnostics.replayInitializedBeforeEngine = true
  }

  try {
    initializeReplayBeforeCocos()
  } catch (error) {
    recordError(error)
  }

  function updateTelemetry() {
    if (!window.DATAFLUX_RUM) {
      return
    }
    try {
      var isRecording = window.DATAFLUX_RUM.isRecording()
      var history =
        window.DATAFLUX_RUM.getAutoCanvasSnapshotDebugHistoryForDebug() || []
      var lastSnapshot

      history.forEach(function (entry) {
        if (entry.scheduler !== 'webgl_snapshot') {
          return
        }
        var key = entry.startedAt + ':' + entry.completedAt
        if (!knownSnapshots[key]) {
          knownSnapshots[key] = true
          knownSnapshotOrder.push(key)
          if (knownSnapshotOrder.length > 600) {
            delete knownSnapshots[knownSnapshotOrder.shift()]
          }
          totalSnapshots += 1
          snapshotStartedAts.push(entry.startedAt)
        }
        lastSnapshot = entry
      })

      if (lastSnapshot) {
        snapshotStartedAts = snapshotStartedAts.filter(function (startedAt) {
          return lastSnapshot.startedAt - startedAt <= 5000
        })
      }

      var captureFps =
        snapshotStartedAts.length > 1
          ? ((snapshotStartedAts.length - 1) * 1000) /
            (snapshotStartedAts[snapshotStartedAts.length - 1] -
              snapshotStartedAts[0])
          : undefined
      var lastMutation = window.DATAFLUX_RUM.getLastCanvasMutationForDebug()
      var lastSegment = window.DATAFLUX_RUM.getLastReplaySegmentFlushForDebug()
      var internalContext = window.DATAFLUX_RUM.getInternalContext()
      var sessionId =
        internalContext && internalContext.session && internalContext.session.id
      var viewId = internalContext && internalContext.view && internalContext.view.id
      var cocos = window.__cocosReplayDebug && window.__cocosReplayDebug.cc
      var cocosStats = cocos && cocos.profiler && cocos.profiler._stats
      var gameFps = readCocosCounter(cocosStats, 'fps')
      var drawCalls = readCocosCounter(cocosStats, 'draws')
      var frameTime = readCocosCounter(cocosStats, 'frame')
      var triangles = readCocosCounter(cocosStats, 'tricount')

      diagnostics.recording = isRecording
      diagnostics.snapshots = totalSnapshots
      diagnostics.captureFps = captureFps
      diagnostics.lastSnapshot = lastSnapshot
      diagnostics.lastMutation = lastMutation
      diagnostics.lastSegment = lastSegment
      diagnostics.sessionId = sessionId
      diagnostics.viewId = viewId
      diagnostics.game = {
        fps: gameFps,
        drawCalls: drawCalls,
        frameTime: frameTime,
        triangles: triangles
      }

      var gameCanvas = byId('GameCanvas')
      diagnostics.canvasNodeId = gameCanvas
        ? window.DATAFLUX_RUM.getSerializedNodeIdForDebug(gameCanvas)
        : undefined

      byId('recording-status').textContent = isRecording ? 'recording' : 'stopped'
      byId('replay-dot').classList.toggle('is-live', isRecording)
      byId('metric-snapshots').textContent = String(totalSnapshots)
      byId('metric-sampling').textContent =
        (captureFps ? captureFps.toFixed(1) : 'measuring') +
        ' / ' +
        profile.targetFps +
        ' FPS'
      byId('metric-bytes').textContent = lastMutation
        ? formatBytes(lastMutation.encodedBytesCount)
        : 'waiting'
      byId('metric-capture-size').textContent = lastMutation
        ? lastMutation.width + ' × ' + lastMutation.height
        : 'waiting'
      byId('metric-latency').textContent = lastSnapshot
        ? Math.max(0, lastSnapshot.completedAt - lastSnapshot.startedAt) + ' ms'
        : 'waiting'
      byId('metric-session').textContent = shortId(sessionId)
      byId('metric-session').title = sessionId || ''
      byId('metric-view').textContent = shortId(viewId)
      byId('metric-view').title = viewId || ''
      byId('metric-game-fps').textContent =
        typeof gameFps === 'number' ? String(gameFps) : 'waiting'
      byId('metric-draws').textContent =
        typeof drawCalls === 'number' ? String(drawCalls) : 'waiting'
      byId('metric-frame-time').textContent =
        typeof frameTime === 'number' ? frameTime + ' ms' : 'waiting'
      byId('metric-triangles').textContent =
        typeof triangles === 'number' ? String(triangles) : 'waiting'
      byId('metric-segment').textContent = lastSegment
        ? '#' + lastSegment.sequence + ' · ' + lastSegment.flushReason
        : 'waiting'
    } catch (error) {
      recordError(error)
    }
  }

  byId('metric-sampling').textContent = profile.targetFps + ' FPS target'
  byId('metric-clarity').textContent =
    clarity === 'high' ? 'high · q' + profile.quality : 'balanced'
  document.querySelector('.replay-panel').dataset.startedAt = String(
    diagnostics.startedAt
  )
  byId('replay-toggle').addEventListener('click', function () {
    if (!window.DATAFLUX_RUM) {
      return
    }
    if (recordingEnabled) {
      window.DATAFLUX_RUM.stopSessionReplayRecording()
    } else {
      window.DATAFLUX_RUM.startSessionReplayRecording()
    }
    recordingEnabled = !recordingEnabled
    this.textContent = 'Replay: ' + (recordingEnabled ? 'on' : 'off')
    updateTelemetry()
  })
  byId('copy-session').addEventListener('click', function () {
    var text = JSON.stringify({
      sessionId: diagnostics.sessionId,
      viewId: diagnostics.viewId
    })
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
    }
    this.textContent = 'Copied'
    var button = this
    setTimeout(function () {
      button.textContent = 'Copy IDs'
    }, 1200)
  })

  window.addEventListener('error', function (event) {
    recordError(event.error || event.message)
  })
  window.setInterval(updateTelemetry, 500)
  if (query.has('diagnose')) {
    var diagnosticPoll = window.setInterval(function () {
      var history = window.DATAFLUX_RUM.getDomMutationHistoryForDebug() || []
      history.forEach(function (entry) {
        var key = JSON.stringify(entry)
        if (diagnosticMutationSamples.indexOf(key) === -1) {
          diagnosticMutationSamples.push(key)
        }
      })
    }, 25)
    window.setTimeout(function () {
      window.clearInterval(diagnosticPoll)
      var gameCanvas = byId('GameCanvas')
      byId('replay-debug-json').textContent = JSON.stringify(
        {
          canvasNodeId: gameCanvas
            ? window.DATAFLUX_RUM.getSerializedNodeIdForDebug(gameCanvas)
            : undefined,
          canvasMutationHistory:
            window.DATAFLUX_RUM.getCanvasMutationHistoryForDebug(),
          domMutationSamples: diagnosticMutationSamples.map(function (entry) {
            return JSON.parse(entry)
          })
        },
        null,
        2
      )
    }, 2500)
  }
  updateTelemetry()
})()
