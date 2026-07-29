;(function () {
  'use strict'

  var canvas = document.getElementById('game-canvas')
  var scoreElement = document.getElementById('score')
  var shieldElement = document.getElementById('shield')
  var waveElement = document.getElementById('wave')
  var messageElement = document.getElementById('game-message')
  var replayButton = document.getElementById('replay-button')
  var pauseButton = document.getElementById('pause-button')
  var stressButton = document.getElementById('stress-button')
  var burstButton = document.getElementById('burst-button')
  var resetButton = document.getElementById('reset-button')
  var samplingSelect = document.getElementById('sampling-select')
  var captureOutput = document.getElementById('capture-output')
  var metricWebGL = document.getElementById('metric-webgl')
  var metricFps = document.getElementById('metric-fps')
  var metricDraws = document.getElementById('metric-draws')
  var metricObjects = document.getElementById('metric-objects')
  var metricSnapshots = document.getElementById('metric-snapshots')
  var metricBytes = document.getElementById('metric-bytes')
  var metricLatency = document.getElementById('metric-latency')
  var metricScheduler = document.getElementById('metric-scheduler')
  var metricSession = document.getElementById('metric-session')
  var metricSegment = document.getElementById('metric-segment')
  var recordingStatus = document.getElementById('recording-status')
  var replayDot = document.getElementById('replay-dot')
  var query = new URLSearchParams(window.location.search)
  var sampling = query.get('sampling') || '2'
  if (['1', '2', '4', 'all'].indexOf(sampling) === -1) {
    sampling = '2'
  }
  var numericSampling = sampling === 'all' ? 'all' : Number(sampling)
  var captureProfiles = {
    1: {
      targetFps: 2,
      interval: 500,
      cooldown: 50,
      quality: 0.35,
      maxCanvasSize: 800
    },
    2: {
      targetFps: 4,
      interval: 250,
      cooldown: 50,
      quality: 0.4,
      maxCanvasSize: 960
    },
    4: {
      targetFps: 8,
      interval: 125,
      cooldown: 50,
      quality: 0.32,
      maxCanvasSize: 720
    },
    all: {
      targetFps: 4,
      interval: 250,
      cooldown: 50,
      quality: 0.4,
      maxCanvasSize: 960
    }
  }
  var captureProfile = captureProfiles[sampling] || captureProfiles[2]
  var destroyed = false
  var replayEnabled = true
  var paused = false
  var stressMode = query.get('stress') === '1'
  var pointerDown = false
  var keys = {}
  var frameHandle
  var telemetryTimer
  var lastFrameAt = performance.now()
  var fpsWindowStartedAt = lastFrameAt
  var framesInWindow = 0
  var drawsInWindow = 0
  var lastShotAt = 0
  var knownSnapshotKeys = Object.create(null)
  var knownSnapshotKeyQueue = []
  var maxKnownSnapshotKeys = 500
  var replaySnapshotStartedAts = []
  var totalReplaySnapshots = 0
  var lastReplaySnapshot
  var lastCanvasMutation
  var score = 0
  var shield = 100
  var wave = 1
  var nextWaveScore = 1200

  var diagnostics = (window.__webglReplayGame = {
    ready: false,
    webglAvailable: false,
    preserveDrawingBuffer: undefined,
    sampling: numericSampling,
    captureProfile: captureProfile,
    stressMode: stressMode,
    replaySnapshots: 0,
    lastSnapshot: undefined,
    lastMutation: undefined,
    errors: []
  })

  function recordError(error) {
    var message = error && error.message ? error.message : String(error)
    diagnostics.errors.push(message)
    captureOutput.textContent = 'ERROR\n' + message
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min)
  }

  function formatBytes(bytes) {
    if (typeof bytes !== 'number') {
      return 'none'
    }
    if (bytes < 1024) {
      return bytes + ' B'
    }
    return (bytes / 1024).toFixed(1) + ' KiB'
  }

  function initializeReplay() {
    if (!window.DATAFLUX_RUM) {
      recordingStatus.textContent = 'SDK unavailable'
      return
    }

    var autoInterval = captureProfile.interval
    window.DATAFLUX_RUM.init({
      applicationId: 'test_dcl',
      site: 'https://cn3-rum-openway.guance.com',
      clientToken: 'b806cd20126446c4848605cb254f92ed',
      service: 'browser',
      env: 'production',
      version: '1.0.0',
      sessionSampleRate: 100,
      sessionReplaySampleRate: 70,
      replayCanvasEnabled: true,
      replayCanvasMode: 'auto',
      replayCanvasSampling: numericSampling,
      replayCanvasQuality: captureProfile.quality,
      replayCanvasMaxCanvasSize: captureProfile.maxCanvasSize,
      replayCanvasMaxEncodedBytes: 40000,
      replayCanvasMaxConcurrentEncodes: 1,
      replayCanvasAutoInterval: autoInterval,
      replayCanvasAutoCooldown: captureProfile.cooldown,
      replayCanvasAutoUnchangedBackoff: Math.max(autoInterval * 2, 1000),
      replayCanvasAutoFailureBackoff: Math.max(autoInterval * 4, 3000),
      replayCanvasAutoMaxPerRun: 1,
      compressIntakeRequests: true,
      trackInteractions: true,
      traceType: 'ddtrace',
      allowedTracingOrigins: [
        'https://api.example.com',
        /https:\/\/.*\.my-api-domain\.com/
      ]
    })
    // Keep the requested 70% production configuration, but force this
    // acceptance page into the sampled cohort so a demo run is deterministic.
    window.DATAFLUX_RUM.setForcedSession()
    window.DATAFLUX_RUM.startSessionReplayRecording()
    recordingStatus.textContent = 'starting'
  }

  try {
    initializeReplay()
  } catch (error) {
    recordError(error)
    recordingStatus.textContent = 'init failed'
  }

  var gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: true,
    depth: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance'
  })

  diagnostics.webglAvailable = !!gl
  if (!gl) {
    metricWebGL.textContent = 'unavailable'
    recordError(new Error('This browser does not expose a WebGL context.'))
    return
  }

  diagnostics.preserveDrawingBuffer =
    gl.getContextAttributes().preserveDrawingBuffer
  metricWebGL.textContent =
    'WebGL 1 · preserve=' + diagnostics.preserveDrawingBuffer

  var backgroundVertexShader = [
    'attribute vec2 a_position;',
    'varying vec2 v_uv;',
    'void main() {',
    '  v_uv = a_position * 0.5 + 0.5;',
    '  gl_Position = vec4(a_position, 0.0, 1.0);',
    '}'
  ].join('\n')
  var backgroundFragmentShader = [
    'precision mediump float;',
    'varying vec2 v_uv;',
    'uniform float u_time;',
    'uniform vec2 u_resolution;',
    'float hash(vec2 point) {',
    '  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);',
    '}',
    'void main() {',
    '  vec2 uv = v_uv;',
    '  vec2 centered = uv - 0.5;',
    '  centered.x *= u_resolution.x / max(u_resolution.y, 1.0);',
    '  float nebula = sin(centered.x * 4.5 + u_time * 0.09);',
    '  nebula += sin(centered.y * 7.0 - u_time * 0.07);',
    '  nebula += sin((centered.x + centered.y) * 9.0);',
    '  nebula = smoothstep(0.7, 2.7, nebula + 1.5);',
    '  vec3 base = mix(vec3(0.012, 0.018, 0.07), vec3(0.12, 0.04, 0.24), nebula);',
    '  float grain = hash(floor(gl_FragCoord.xy * 0.33) + floor(u_time * 0.5));',
    '  base += (grain - 0.5) * 0.018;',
    '  float glow = 0.12 / max(length(centered - vec2(0.32, 0.12)), 0.08);',
    '  base += vec3(0.03, 0.12, 0.18) * glow;',
    '  gl_FragColor = vec4(base, 1.0);',
    '}'
  ].join('\n')
  var spriteVertexShader = [
    'attribute vec2 a_position;',
    'attribute float a_size;',
    'attribute vec4 a_color;',
    'uniform float u_pixel_ratio;',
    'varying vec4 v_color;',
    'void main() {',
    '  gl_Position = vec4(a_position, 0.0, 1.0);',
    '  gl_PointSize = max(1.0, a_size * u_pixel_ratio);',
    '  v_color = a_color;',
    '}'
  ].join('\n')
  var spriteFragmentShader = [
    'precision mediump float;',
    'varying vec4 v_color;',
    'uniform float u_shape;',
    'void main() {',
    '  vec2 point = gl_PointCoord * 2.0 - 1.0;',
    '  float distanceToCenter = length(point);',
    '  float alpha = 1.0;',
    '  if (u_shape < 0.5) {',
    '    alpha = smoothstep(1.0, 0.0, distanceToCenter);',
    '    alpha *= alpha;',
    '  } else if (u_shape < 1.5) {',
    '    float angle = atan(point.y, point.x);',
    '    float edge = 0.78 + 0.10 * sin(angle * 7.0 + v_color.a * 11.0);',
    '    alpha = 1.0 - smoothstep(edge - 0.06, edge, distanceToCenter);',
    '  } else if (u_shape < 2.5) {',
    '    alpha = smoothstep(1.0, 0.0, distanceToCenter);',
    '    alpha = pow(alpha, 2.0);',
    '  } else if (u_shape < 3.5) {',
    '    alpha = smoothstep(1.0, 0.1, distanceToCenter) * v_color.a;',
    '  } else {',
    '    float body = step(abs(point.x), (point.y + 1.0) * 0.42);',
    '    body *= step(point.y, 0.82);',
    '    float engine = smoothstep(0.42, 0.0, length(point - vec2(0.0, 0.72)));',
    '    alpha = max(body, engine * 0.75);',
    '  }',
    '  if (alpha < 0.01) discard;',
    '  gl_FragColor = vec4(v_color.rgb, alpha);',
    '}'
  ].join('\n')

  function compileShader(type, source) {
    var shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var info = gl.getShaderInfoLog(shader)
      gl.deleteShader(shader)
      throw new Error('Shader compilation failed: ' + info)
    }
    return shader
  }

  function createProgram(vertexSource, fragmentSource) {
    var program = gl.createProgram()
    var vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource)
    var fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource)
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var info = gl.getProgramInfoLog(program)
      gl.deleteProgram(program)
      throw new Error('Program link failed: ' + info)
    }
    return program
  }

  var backgroundProgram
  var spriteProgram
  try {
    backgroundProgram = createProgram(
      backgroundVertexShader,
      backgroundFragmentShader
    )
    spriteProgram = createProgram(spriteVertexShader, spriteFragmentShader)
  } catch (error) {
    recordError(error)
    return
  }

  var backgroundBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, backgroundBuffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW
  )
  var spriteBuffer = gl.createBuffer()
  var backgroundPositionLocation = gl.getAttribLocation(
    backgroundProgram,
    'a_position'
  )
  var backgroundTimeLocation = gl.getUniformLocation(backgroundProgram, 'u_time')
  var backgroundResolutionLocation = gl.getUniformLocation(
    backgroundProgram,
    'u_resolution'
  )
  var spritePositionLocation = gl.getAttribLocation(spriteProgram, 'a_position')
  var spriteSizeLocation = gl.getAttribLocation(spriteProgram, 'a_size')
  var spriteColorLocation = gl.getAttribLocation(spriteProgram, 'a_color')
  var spritePixelRatioLocation = gl.getUniformLocation(
    spriteProgram,
    'u_pixel_ratio'
  )
  var spriteShapeLocation = gl.getUniformLocation(spriteProgram, 'u_shape')

  var player = {
    x: 0,
    y: -0.68,
    vx: 0,
    vy: 0,
    targetX: 0,
    targetY: -0.68,
    size: 34
  }
  var stars = []
  var asteroids = []
  var bullets = []
  var particles = []
  var spriteVertexData = new Float32Array(0)
  var playerBatch = [player]

  function getReusableVertexData(length) {
    if (spriteVertexData.length < length) {
      var capacity = Math.max(spriteVertexData.length || 256, 256)
      while (capacity < length) {
        capacity *= 2
      }
      spriteVertexData = new Float32Array(capacity)
    }
    return spriteVertexData.subarray(0, length)
  }

  function createStar() {
    return {
      x: randomBetween(-1, 1),
      y: randomBetween(-1, 1),
      size: randomBetween(1, 3.8),
      speed: randomBetween(0.018, 0.08),
      alpha: randomBetween(0.25, 0.95)
    }
  }

  function resetAsteroid(asteroid, startAbove) {
    var radius = randomBetween(0.025, stressMode ? 0.065 : 0.085)
    asteroid.x = randomBetween(-0.94, 0.94)
    asteroid.y = startAbove
      ? randomBetween(1.05, 2.4)
      : randomBetween(-1, 1)
    asteroid.vx = randomBetween(-0.06, 0.06)
    asteroid.vy = -randomBetween(0.07, 0.18) - wave * 0.004
    asteroid.radius = radius
    asteroid.size = radius * 430
    asteroid.seed = Math.random()
    return asteroid
  }

  function createAsteroid(startAbove) {
    return resetAsteroid({}, startAbove)
  }

  function setSceneLoad() {
    var starTarget = stressMode ? 720 : 280
    var asteroidTarget = stressMode ? 150 : 42
    while (stars.length < starTarget) {
      stars.push(createStar())
    }
    stars.length = starTarget
    while (asteroids.length < asteroidTarget) {
      asteroids.push(createAsteroid(true))
    }
    asteroids.length = asteroidTarget
    diagnostics.stressMode = stressMode
    stressButton.textContent = 'Stress: ' + (stressMode ? 'on' : 'off')
  }

  function spawnBurst(x, y, count, color) {
    var burstCount = stressMode ? count * 2 : count
    for (var index = 0; index < burstCount; index += 1) {
      var angle = Math.random() * Math.PI * 2
      var speed = randomBetween(0.08, 0.42)
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: randomBetween(3, 12),
        life: randomBetween(0.35, 1.1),
        color: color || [0.4, 0.9, 1]
      })
    }
    var particleLimit = stressMode ? 1100 : 360
    if (particles.length > particleLimit) {
      particles.splice(0, particles.length - particleLimit)
    }
  }

  function shoot(now) {
    if (now - lastShotAt < (stressMode ? 65 : 110)) {
      return
    }
    lastShotAt = now
    bullets.push({
      x: player.x,
      y: player.y + 0.06,
      vx: randomBetween(-0.012, 0.012),
      vy: 1.1,
      life: 1.8,
      size: stressMode ? 10 : 8
    })
    spawnBurst(player.x, player.y + 0.03, 3, [0.35, 0.9, 1])
  }

  function updatePlayer(delta, now) {
    var horizontal =
      (keys.ArrowRight || keys.KeyD ? 1 : 0) -
      (keys.ArrowLeft || keys.KeyA ? 1 : 0)
    var vertical =
      (keys.ArrowUp || keys.KeyW ? 1 : 0) -
      (keys.ArrowDown || keys.KeyS ? 1 : 0)
    if (horizontal || vertical) {
      player.vx += horizontal * delta * 2.3
      player.vy += vertical * delta * 2.3
    } else {
      player.vx += (player.targetX - player.x) * delta * 4.5
      player.vy += (player.targetY - player.y) * delta * 4.5
    }
    player.vx *= Math.pow(0.03, delta)
    player.vy *= Math.pow(0.03, delta)
    player.x = clamp(player.x + player.vx * delta, -0.93, 0.93)
    player.y = clamp(player.y + player.vy * delta, -0.9, 0.86)
    if (keys.Space || pointerDown) {
      shoot(now)
    }
  }

  function updateScene(delta, now) {
    updatePlayer(delta, now)

    stars.forEach(function (star) {
      star.y -= star.speed * delta
      if (star.y < -1.04) {
        star.y = 1.04
        star.x = randomBetween(-1, 1)
      }
    })

    bullets = bullets.filter(function (bullet) {
      bullet.x += bullet.vx * delta
      bullet.y += bullet.vy * delta
      bullet.life -= delta
      return bullet.life > 0 && bullet.y < 1.1
    })

    particles = particles.filter(function (particle) {
      particle.x += particle.vx * delta
      particle.y += particle.vy * delta
      particle.vx *= Math.pow(0.18, delta)
      particle.vy *= Math.pow(0.18, delta)
      particle.life -= delta
      return particle.life > 0
    })

    asteroids.forEach(function (asteroid) {
      asteroid.x += asteroid.vx * delta
      asteroid.y += asteroid.vy * delta
      if (asteroid.x < -1.08 || asteroid.x > 1.08) {
        asteroid.vx *= -1
      }
      if (asteroid.y < -1.12) {
        shield = Math.max(0, shield - 2)
        resetAsteroid(asteroid, true)
      }
    })

    for (
      var bulletIndex = bullets.length - 1;
      bulletIndex >= 0;
      bulletIndex -= 1
    ) {
      var bullet = bullets[bulletIndex]
      var hit = false
      for (
        var asteroidIndex = 0;
        asteroidIndex < asteroids.length;
        asteroidIndex += 1
      ) {
        var asteroid = asteroids[asteroidIndex]
        var dx = bullet.x - asteroid.x
        var dy = bullet.y - asteroid.y
        if (dx * dx + dy * dy < asteroid.radius * asteroid.radius) {
          score += Math.round(80 + asteroid.radius * 900)
          spawnBurst(asteroid.x, asteroid.y, 16, [1, 0.45, 0.35])
          resetAsteroid(asteroid, true)
          hit = true
          break
        }
      }
      if (hit) {
        bullets.splice(bulletIndex, 1)
      }
    }

    if (score >= nextWaveScore) {
      wave += 1
      nextWaveScore += 1200 + wave * 260
      spawnBurst(player.x, player.y, 42, [0.6, 0.45, 1])
    }
  }

  function resizeCanvas() {
    var rect = canvas.getBoundingClientRect()
    var pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6)
    var width = Math.max(1, Math.round(rect.width * pixelRatio))
    var height = Math.max(1, Math.round(rect.height * pixelRatio))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    gl.viewport(0, 0, canvas.width, canvas.height)
    return pixelRatio
  }

  function drawBackground(time) {
    gl.disable(gl.BLEND)
    gl.useProgram(backgroundProgram)
    gl.bindBuffer(gl.ARRAY_BUFFER, backgroundBuffer)
    gl.enableVertexAttribArray(backgroundPositionLocation)
    gl.vertexAttribPointer(
      backgroundPositionLocation,
      2,
      gl.FLOAT,
      false,
      0,
      0
    )
    gl.uniform1f(backgroundTimeLocation, time)
    gl.uniform2f(backgroundResolutionLocation, canvas.width, canvas.height)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    drawsInWindow += 1
  }

  function drawBatch(objects, shape, pixelRatio, writeVertex) {
    if (!objects.length) {
      return
    }
    var vertexData = getReusableVertexData(objects.length * 7)
    objects.forEach(function (object, index) {
      var offset = index * 7
      writeVertex(object, vertexData, offset)
    })

    gl.useProgram(spriteProgram)
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(spritePositionLocation)
    gl.enableVertexAttribArray(spriteSizeLocation)
    gl.enableVertexAttribArray(spriteColorLocation)
    gl.vertexAttribPointer(
      spritePositionLocation,
      2,
      gl.FLOAT,
      false,
      28,
      0
    )
    gl.vertexAttribPointer(spriteSizeLocation, 1, gl.FLOAT, false, 28, 8)
    gl.vertexAttribPointer(spriteColorLocation, 4, gl.FLOAT, false, 28, 12)
    gl.uniform1f(spritePixelRatioLocation, pixelRatio)
    gl.uniform1f(spriteShapeLocation, shape)
    gl.drawArrays(gl.POINTS, 0, objects.length)
    drawsInWindow += 1
  }

  function writeStarVertex(star, data, offset) {
    data[offset] = star.x
    data[offset + 1] = star.y
    data[offset + 2] = star.size
    data[offset + 3] = 0.55
    data[offset + 4] = 0.78
    data[offset + 5] = 1
    data[offset + 6] = star.alpha
  }

  function writeAsteroidVertex(asteroid, data, offset) {
    data[offset] = asteroid.x
    data[offset + 1] = asteroid.y
    data[offset + 2] = asteroid.size
    data[offset + 3] = 0.55 + asteroid.seed * 0.16
    data[offset + 4] = 0.48
    data[offset + 5] = 0.72
    data[offset + 6] = asteroid.seed
  }

  function writeBulletVertex(bullet, data, offset) {
    data[offset] = bullet.x
    data[offset + 1] = bullet.y
    data[offset + 2] = bullet.size
    data[offset + 3] = 0.35
    data[offset + 4] = 0.96
    data[offset + 5] = 1
    data[offset + 6] = 1
  }

  function writeParticleVertex(particle, data, offset) {
    data[offset] = particle.x
    data[offset + 1] = particle.y
    data[offset + 2] = particle.size
    data[offset + 3] = particle.color[0]
    data[offset + 4] = particle.color[1]
    data[offset + 5] = particle.color[2]
    data[offset + 6] = clamp(particle.life, 0, 1)
  }

  function writePlayerVertex(ship, data, offset) {
    data[offset] = ship.x
    data[offset + 1] = ship.y
    data[offset + 2] = ship.size
    data[offset + 3] = 0.55
    data[offset + 4] = 0.86
    data[offset + 5] = 1
    data[offset + 6] = 1
  }

  function drawScene(time) {
    var pixelRatio = resizeCanvas()
    drawBackground(time)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    drawBatch(stars, 0, pixelRatio, writeStarVertex)
    drawBatch(asteroids, 1, pixelRatio, writeAsteroidVertex)
    drawBatch(bullets, 2, pixelRatio, writeBulletVertex)
    drawBatch(particles, 3, pixelRatio, writeParticleVertex)
    drawBatch(playerBatch, 4, pixelRatio, writePlayerVertex)
  }

  function updateHud() {
    scoreElement.textContent = String(score).padStart(6, '0')
    shieldElement.textContent = shield + '%'
    shieldElement.style.color = shield < 30 ? '#ff668f' : ''
    waveElement.textContent = String(wave).padStart(2, '0')
  }

  function frame(now) {
    if (destroyed) {
      return
    }
    var delta = Math.min((now - lastFrameAt) / 1000, 0.05)
    lastFrameAt = now
    if (!paused) {
      updateScene(delta, now)
      drawScene(now / 1000)
      framesInWindow += 1
    }
    if (now - fpsWindowStartedAt >= 1000) {
      var elapsed = (now - fpsWindowStartedAt) / 1000
      metricFps.textContent = Math.round(framesInWindow / elapsed)
      metricDraws.textContent = Math.round(drawsInWindow / elapsed) + '/s'
      framesInWindow = 0
      drawsInWindow = 0
      fpsWindowStartedAt = now
      updateHud()
    }
    frameHandle = window.requestAnimationFrame(frame)
  }

  function togglePause(forcePaused) {
    paused =
      typeof forcePaused === 'boolean' ? forcePaused : !paused
    messageElement.hidden = !paused
    pauseButton.textContent = paused ? 'Resume' : 'Pause'
    diagnostics.paused = paused
  }

  function resetGame() {
    score = 0
    shield = 100
    wave = 1
    nextWaveScore = 1200
    bullets = []
    particles = []
    player.x = 0
    player.y = -0.68
    player.targetX = 0
    player.targetY = -0.68
    asteroids.forEach(function (asteroid) {
      resetAsteroid(asteroid, true)
    })
    updateHud()
  }

  function updatePointer(event) {
    var rect = canvas.getBoundingClientRect()
    player.targetX = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1)
    player.targetY = clamp(1 - ((event.clientY - rect.top) / rect.height) * 2, -1, 1)
  }

  function updateReplayTelemetry() {
    if (!window.DATAFLUX_RUM || !replayEnabled) {
      return
    }
    try {
      var isRecording = window.DATAFLUX_RUM.isRecording()
      recordingStatus.textContent = isRecording ? 'recording' : 'starting'
      replayDot.classList.toggle('is-live', isRecording)
      var history =
        window.DATAFLUX_RUM.getAutoCanvasSnapshotDebugHistoryForDebug() || []
      history.forEach(function (entry) {
        if (entry.scheduler !== 'webgl_snapshot') {
          return
        }
        var key = String(entry.startedAt) + ':' + String(entry.completedAt)
        if (!knownSnapshotKeys[key]) {
          knownSnapshotKeys[key] = true
          knownSnapshotKeyQueue.push(key)
          if (knownSnapshotKeyQueue.length > maxKnownSnapshotKeys) {
            delete knownSnapshotKeys[knownSnapshotKeyQueue.shift()]
          }
          totalReplaySnapshots += 1
          replaySnapshotStartedAts.push(entry.startedAt)
          replaySnapshotStartedAts = replaySnapshotStartedAts.filter(
            function (startedAt) {
              return entry.startedAt - startedAt <= 5000
            }
          )
        }
        lastReplaySnapshot = entry
      })
      lastCanvasMutation =
        window.DATAFLUX_RUM.getLastCanvasMutationForDebug()
      var internalContext = window.DATAFLUX_RUM.getInternalContext()
      var lastSegment =
        window.DATAFLUX_RUM.getLastReplaySegmentFlushForDebug()
      var sessionId =
        internalContext &&
        internalContext.session &&
        internalContext.session.id
      var viewId =
        internalContext &&
        internalContext.view &&
        internalContext.view.id

      diagnostics.replaySnapshots = totalReplaySnapshots
      diagnostics.lastSnapshot = lastReplaySnapshot
      diagnostics.lastMutation = lastCanvasMutation
      diagnostics.captureFps =
        replaySnapshotStartedAts.length > 1
          ? ((replaySnapshotStartedAts.length - 1) * 1000) /
            (replaySnapshotStartedAts[replaySnapshotStartedAts.length - 1] -
              replaySnapshotStartedAts[0])
          : undefined
      diagnostics.sessionId = sessionId
      diagnostics.viewId = viewId
      diagnostics.lastSegment = lastSegment
      diagnostics.objectCount =
        stars.length + asteroids.length + bullets.length + particles.length + 1

      metricSnapshots.textContent = totalReplaySnapshots
      metricObjects.textContent = diagnostics.objectCount
      metricScheduler.textContent = lastReplaySnapshot
        ? (diagnostics.captureFps
            ? diagnostics.captureFps.toFixed(1)
            : 'measuring') +
          ' FPS · target ' +
          captureProfile.targetFps
        : captureProfile.targetFps + ' FPS target'
      metricBytes.textContent = lastCanvasMutation
        ? formatBytes(lastCanvasMutation.encodedBytesCount)
        : 'none'
      metricLatency.textContent = lastReplaySnapshot
        ? Math.max(
            0,
            lastReplaySnapshot.completedAt - lastReplaySnapshot.startedAt
          ) + ' ms'
        : 'none'
      metricSession.textContent = sessionId
        ? sessionId.slice(0, 8) + '…'
        : 'waiting'
      metricSession.title = sessionId || ''
      metricSegment.textContent = lastSegment
        ? '#' + lastSegment.sequence + ' · ' + formatBytes(lastSegment.rawBytesCount)
        : 'waiting'
      metricSegment.title = lastSegment
        ? lastSegment.flushReason
        : ''
      captureOutput.textContent = JSON.stringify(
        {
          sampling: numericSampling,
          captureProfile: captureProfile,
          actualCaptureFps: diagnostics.captureFps,
          preserveDrawingBuffer: diagnostics.preserveDrawingBuffer,
          sessionId: sessionId,
          viewId: viewId,
          snapshot: lastReplaySnapshot,
          mutation: lastCanvasMutation,
          segment: lastSegment,
          objects: diagnostics.objectCount,
          stressMode: stressMode
        },
        null,
        2
      )
    } catch (error) {
      recordError(error)
    }
  }

  replayButton.addEventListener('click', function () {
    if (!window.DATAFLUX_RUM) {
      return
    }
    replayEnabled = !replayEnabled
    if (replayEnabled) {
      window.DATAFLUX_RUM.startSessionReplayRecording()
      recordingStatus.textContent = 'starting'
    } else {
      window.DATAFLUX_RUM.stopSessionReplayRecording()
      recordingStatus.textContent = 'stopped'
      replayDot.classList.remove('is-live')
    }
    replayButton.textContent = 'Replay: ' + (replayEnabled ? 'on' : 'off')
    diagnostics.replayEnabled = replayEnabled
  })
  pauseButton.addEventListener('click', function () {
    togglePause()
  })
  stressButton.addEventListener('click', function () {
    stressMode = !stressMode
    setSceneLoad()
    spawnBurst(player.x, player.y, 50, [0.65, 0.45, 1])
  })
  burstButton.addEventListener('click', function () {
    spawnBurst(
      randomBetween(-0.55, 0.55),
      randomBetween(-0.2, 0.55),
      90,
      [0.35, 0.95, 1]
    )
  })
  resetButton.addEventListener('click', resetGame)
  samplingSelect.value = sampling
  samplingSelect.addEventListener('change', function () {
    var nextQuery = new URLSearchParams(window.location.search)
    nextQuery.set('sampling', samplingSelect.value)
    if (stressMode) {
      nextQuery.set('stress', '1')
    } else {
      nextQuery.delete('stress')
    }
    window.location.search = nextQuery.toString()
  })
  window.addEventListener('keydown', function (event) {
    keys[event.code] = true
    if (event.code === 'Space') {
      event.preventDefault()
    }
    if (event.code === 'KeyP' && !event.repeat) {
      togglePause()
    }
  })
  window.addEventListener('keyup', function (event) {
    keys[event.code] = false
  })
  canvas.addEventListener('pointermove', updatePointer)
  canvas.addEventListener('pointerdown', function (event) {
    pointerDown = true
    updatePointer(event)
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointerup', function (event) {
    pointerDown = false
    canvas.releasePointerCapture(event.pointerId)
  })
  canvas.addEventListener('click', function () {
    if (paused) {
      togglePause(false)
    }
  })
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      keys = {}
      pointerDown = false
    }
  })

  setSceneLoad()
  updateHud()
  drawScene(performance.now() / 1000)
  frameHandle = window.requestAnimationFrame(frame)
  telemetryTimer = window.setInterval(updateReplayTelemetry, 500)
  diagnostics.ready = true
  diagnostics.pause = function () {
    togglePause(true)
  }
  diagnostics.resume = function () {
    togglePause(false)
  }
  diagnostics.setStress = function (enabled) {
    stressMode = !!enabled
    setSceneLoad()
  }
  diagnostics.burst = function () {
    spawnBurst(0, 0.15, 100, [0.4, 0.9, 1])
  }
  diagnostics.destroy = function () {
    destroyed = true
    window.cancelAnimationFrame(frameHandle)
    window.clearInterval(telemetryTimer)
  }
})()
