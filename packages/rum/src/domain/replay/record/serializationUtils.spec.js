import {
  absoluteToDoc,
  fixBrowserCompatibilityIssuesInCSS,
  getAbsoluteSrcsetString,
  getCssRulesString,
  MAX_SERIALIZED_CANVAS_REGISTRY_SIZE,
  MAX_SERIALIZED_NODE_ANCESTOR_DEPTH,
  STYLESHEET_SERIALIZATION_MAX_CHARACTER_COUNT,
  STYLESHEET_SERIALIZATION_MAX_RULE_COUNT,
  STYLESHEET_SERIALIZATION_MAX_SNAPSHOT_BYTES,
  createStyleSheetsSerializerTask,
  getSerializedCanvasNodes,
  getSerializedCanvasNodesSnapshot,
  makeUrlAbsolute,
  nodeAndAncestorsHaveSerializedNode,
  setSerializedNodeId,
  startSerializedCanvasTracking,
  serializeStyleSheets,
  switchToAbsoluteUrl
} from './serializationUtils'

describe('replay/record/serializationUtils', () => {
  it('should bound serialized ancestor validation on excessively deep DOM paths', () => {
    const root = document.createElement('div')
    let current = root
    setSerializedNodeId(current, 1)
    for (
      let depth = 0;
      depth < MAX_SERIALIZED_NODE_ANCESTOR_DEPTH;
      depth += 1
    ) {
      const child = document.createElement('div')
      current.appendChild(child)
      current = child
      setSerializedNodeId(current, depth + 2)
    }

    expect(nodeAndAncestorsHaveSerializedNode(current)).toBeFalse()
  })

  it('should patch background-clip css for browser compatibility', () => {
    expect(
      fixBrowserCompatibilityIssuesInCSS('body { background-clip: text; }')
    ).toContain('-webkit-background-clip: text;')
  })

  it('should switch relative css urls to absolute ones', () => {
    expect(
      switchToAbsoluteUrl(
        "body { background-image: url('../img/a.png'); }",
        'https://example.com/assets/css/app.css'
      )
    ).toContain('https://example.com/assets/img/a.png')
    expect(
      switchToAbsoluteUrl(
        "body { background-image: url('data:image/png;base64,abc'); }",
        'https://example.com/assets/css/app.css'
      )
    ).toContain('data:image/png;base64,abc')
  })

  it('should resolve nested imported stylesheet urls against each import href', () => {
    const nestedImportedStyleSheet = {
      cssRules: [
        {
          cssText: ".nested { mask-image: url('./icons/two.svg'); }"
        }
      ]
    }
    const importedStyleSheet = {
      href: 'https://cdn.example.com/themes/one.css',
      cssRules: [
        {
          href: 'nested/two.css',
          styleSheet: nestedImportedStyleSheet
        },
        {
          cssText: ".imported { background: url('../img/one.png'); }"
        }
      ]
    }
    const cssText = getCssRulesString({
      href: 'https://example.com/assets/app.css',
      cssRules: [
        {
          href: 'https://cdn.example.com/themes/one.css',
          styleSheet: importedStyleSheet
        },
        {
          cssText: ".top { background: url('./top.png'); }"
        }
      ]
    })

    expect(cssText).toContain(
      'https://cdn.example.com/themes/nested/icons/two.svg'
    )
    expect(cssText).toContain('https://cdn.example.com/img/one.png')
    expect(cssText).toContain('https://example.com/assets/top.png')
  })

  it('should retain an inaccessible import rule instead of dropping its stylesheet', () => {
    const inaccessibleImportedStyleSheet = {}
    Object.defineProperty(inaccessibleImportedStyleSheet, 'cssRules', {
      get: () => {
        throw new Error('cross-origin stylesheet')
      }
    })

    const cssText = getCssRulesString({
      href: 'https://example.com/assets/app.css',
      cssRules: [
        {
          cssText: '@import url("./theme.css");',
          href: './theme.css',
          styleSheet: inaccessibleImportedStyleSheet
        }
      ]
    })

    expect(cssText).toContain(
      '@import url("https://example.com/assets/theme.css");'
    )
  })

  it('should make urls absolute and fall back to the original value on invalid input', () => {
    expect(
      makeUrlAbsolute('../img/a.png', 'https://example.com/assets/css/app.css')
    ).toBe('https://example.com/assets/img/a.png')
    expect(
      typeof makeUrlAbsolute('://broken', 'https://example.com/base')
    ).toBe('string')
  })

  it('should retain a stylesheet larger than the former serialization cap', () => {
    const cssText = 'x'.repeat(200001)

    expect(
      getCssRulesString({
        href: 'https://example.com/app.css',
        cssRules: [{ cssText }]
      })
    ).toBe(cssText)
  })

  it('should retain adopted stylesheet rules larger than the former cap', () => {
    const cssText = 'x'.repeat(200001)

    expect(
      serializeStyleSheets([
        {
          cssRules: [{ cssText }],
          disabled: false,
          media: []
        }
      ])[0].cssRules
    ).toEqual([cssText])
  })

  it('should resume adopted stylesheet serialization after yielding at its deadline', () => {
    let now = 0
    spyOn(performance, 'now').and.callFake(() => now)
    const rules = Array.from({ length: 3 }, (_, index) => ({
      cssText: `.rule-${index} { color: red; }`
    }))
    const task = createStyleSheetsSerializerTask([
      { cssRules: rules }
    ])

    expect(
      task.advance(1, STYLESHEET_SERIALIZATION_MAX_SNAPSHOT_BYTES)
    ).toBeTrue()
    expect(task.serializedStyleSheets[0].cssRules).toEqual(
      rules.map((rule) => rule.cssText)
    )

    const yieldedTask = createStyleSheetsSerializerTask([
      { cssRules: rules }
    ])
    now = 2
    expect(
      yieldedTask.advance(1, STYLESHEET_SERIALIZATION_MAX_SNAPSHOT_BYTES)
    ).toBeFalse()
    now = 3
    expect(
      yieldedTask.advance(4, STYLESHEET_SERIALIZATION_MAX_SNAPSHOT_BYTES)
    ).toBeTrue()
    expect(yieldedTask.serializedStyleSheets[0].cssRules).toEqual(
      rules.map((rule) => rule.cssText)
    )
  })

  it('should keep the current rule pending when only the slice byte budget is exhausted', () => {
    const cssText = '.pending-rule { color: rebeccapurple; }'
    const task = createStyleSheetsSerializerTask([
      { cssRules: [{ cssText }] }
    ])

    expect(task.advance(Infinity, 40, 1024)).toBeFalse()
    expect(task.isMaxApproxBytesReached).toBeTrue()
    expect(task.serializedStyleSheets[0].cssRules).toEqual([])
    expect(task.serializedStyleSheets[0].isTruncated).toBeUndefined()

    expect(task.advance(Infinity, 1024, 1024)).toBeTrue()
    expect(task.isMaxApproxBytesReached).toBeFalse()
    expect(task.serializedStyleSheets[0].cssRules).toEqual([cssText])
    expect(task.serializedStyleSheets[0].isTruncated).toBeUndefined()
  })

  it('should use one bounded budget across all adopted stylesheets', () => {
    const cssText = 'x'.repeat(
      Math.floor(STYLESHEET_SERIALIZATION_MAX_SNAPSHOT_BYTES / 3)
    )
    const task = createStyleSheetsSerializerTask([
      { cssRules: [{ cssText }] },
      { cssRules: [{ cssText }] }
    ])

    expect(
      task.advance(
        Number.MAX_SAFE_INTEGER,
        STYLESHEET_SERIALIZATION_MAX_SNAPSHOT_BYTES
      )
    ).toBeTrue()
    expect(task.approxBytes).toBeLessThanOrEqual(
      STYLESHEET_SERIALIZATION_MAX_SNAPSHOT_BYTES
    )
    expect(task.serializedStyleSheets[0].cssRules).toEqual([cssText])
    expect(task.serializedStyleSheets[1].cssRules).toEqual([])
    expect(task.serializedStyleSheets[1].isTruncated).toBeTrue()
    expect(task.isMaxApproxBytesReached).toBeFalse()
  })

  it('should discard a partial CSSOM result when it exceeds the active time budget', () => {
    const rules = Array.from({ length: 96 }, (_, index) => ({
      cssText: `.rule-${index} { color: red; }`
    }))
    const nowSpy = spyOn(performance, 'now').and.returnValues(0, 0, 0, 5)

    const cssText = getCssRulesString({
      href: 'https://example.com/app.css',
      cssRules: rules
    })

    expect(cssText).toBeNull()
    expect(nowSpy).toHaveBeenCalled()
  })

  it('should discard CSSOM inlining that exceeds character or rule limits', () => {
    const oversizedCssText = 'x'.repeat(
      STYLESHEET_SERIALIZATION_MAX_CHARACTER_COUNT + 1
    )
    const tooManyRules = Array.from(
      { length: STYLESHEET_SERIALIZATION_MAX_RULE_COUNT + 1 },
      () => ({ cssText: 'a{}' })
    )

    expect(
      getCssRulesString({
        href: 'https://example.com/oversized.css',
        cssRules: [{ cssText: oversizedCssText }]
      })
    ).toBeNull()
    expect(
      getCssRulesString({
        href: 'https://example.com/too-many-rules.css',
        cssRules: tooManyRules
      })
    ).toBeNull()
  })

  it('should convert relative urls and srcset entries against the document', () => {
    expect(absoluteToDoc(document, '/assets/logo.svg')).toContain('/assets/logo.svg')
    expect(
      getAbsoluteSrcsetString(
        document,
        '/img/a.png 1x, /img/b.png 2x'
      )
    ).toContain('/img/a.png 1x,')
    expect(
      getAbsoluteSrcsetString(
        document,
        '/img/a.png 1x, /img/b.png 2x'
      )
    ).toContain('/img/b.png 2x')
  })

  it('should expose connected serialized canvas nodes for auto replay sampling', () => {
    const stopTracking = startSerializedCanvasTracking()
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    setSerializedNodeId(canvas, 42)

    expect(getSerializedCanvasNodes().some((node) => node === canvas)).toBeTrue()

    canvas.remove()

    expect(getSerializedCanvasNodes().some((node) => node === canvas)).toBeFalse()
    stopTracking()
  })

  it('should re-register a canvas after pruning it from the auto replay sampling set', () => {
    const stopTracking = startSerializedCanvasTracking()
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    setSerializedNodeId(canvas, 42)

    canvas.remove()
    expect(getSerializedCanvasNodes(1).some((node) => node === canvas)).toBeFalse()

    document.body.appendChild(canvas)
    setSerializedNodeId(canvas, 42)

    expect(getSerializedCanvasNodes(1).some((node) => node === canvas)).toBeTrue()
    stopTracking()
    canvas.remove()
  })

  it('should scan a bounded registry fairly across calls', () => {
    const stopTracking = startSerializedCanvasTracking()
    const canvases = []
    let connectionCheckCount = 0
    for (let index = 0; index < 130; index += 1) {
      const canvas = document.createElement('canvas')
      Object.defineProperty(canvas, 'isConnected', {
        configurable: true,
        get: function () {
          connectionCheckCount += 1
          return true
        }
      })
      canvases.push(canvas)
      setSerializedNodeId(canvas, index + 1)
    }

    expect(getSerializedCanvasNodes(64)).toEqual(canvases.slice(0, 64))
    expect(connectionCheckCount).toBe(64)
    expect(getSerializedCanvasNodes(64)).toEqual(canvases.slice(64, 128))
    expect(connectionCheckCount).toBe(128)
    expect(getSerializedCanvasNodes(64)).toEqual(canvases.slice(128))
    expect(connectionCheckCount).toBe(130)
    expect(getSerializedCanvasNodes(64)).toEqual(canvases.slice(0, 64))
    expect(connectionCheckCount).toBe(194)

    stopTracking()
  })

  it('should take a bounded canvas snapshot without consuming the shared scan cursor', () => {
    const stopTracking = startSerializedCanvasTracking()
    const canvases = []
    let connectionCheckCount = 0
    for (let index = 0; index < 4; index += 1) {
      const canvas = document.createElement('canvas')
      Object.defineProperty(canvas, 'isConnected', {
        configurable: true,
        get: function () {
          connectionCheckCount += 1
          return true
        }
      })
      canvases.push(canvas)
      setSerializedNodeId(canvas, index + 1)
    }

    expect(getSerializedCanvasNodes(3)).toEqual(canvases.slice(0, 3))
    expect(getSerializedCanvasNodesSnapshot(64)).toEqual(canvases)
    expect(connectionCheckCount).toBe(7)
    expect(getSerializedCanvasNodes(1)).toEqual([canvases[3]])
    expect(connectionCheckCount).toBe(8)

    stopTracking()
  })

  it('should collect active canvases beyond sparse snapshot registry slots', () => {
    const stopTracking = startSerializedCanvasTracking()
    const staleCanvases = []
    for (let index = 0; index < 64; index += 1) {
      const canvas = document.createElement('canvas')
      Object.defineProperty(canvas, 'isConnected', {
        configurable: true,
        value: false
      })
      staleCanvases.push(canvas)
      setSerializedNodeId(canvas, index + 1)
    }
    const activeCanvas = document.createElement('canvas')
    Object.defineProperty(activeCanvas, 'isConnected', {
      configurable: true,
      value: true
    })
    setSerializedNodeId(activeCanvas, staleCanvases.length + 1)

    expect(getSerializedCanvasNodesSnapshot(1)).toEqual([activeCanvas])

    stopTracking()
  })

  it('should keep the serialized canvas registry bounded during long-lived churn', () => {
    const stopTracking = startSerializedCanvasTracking()
    const canvases = []
    const canvasCount = MAX_SERIALIZED_CANVAS_REGISTRY_SIZE + 16
    for (let index = 0; index < canvasCount; index += 1) {
      const canvas = document.createElement('canvas')
      Object.defineProperty(canvas, 'isConnected', {
        configurable: true,
        value: true
      })
      canvases.push(canvas)
      setSerializedNodeId(canvas, index + 1)
    }

    const trackedCanvases = getSerializedCanvasNodes()
    expect(trackedCanvases.length).toBe(
      MAX_SERIALIZED_CANVAS_REGISTRY_SIZE
    )
    expect(
      trackedCanvases.some(function (canvas) {
        return canvas === canvases[0]
      })
    ).toBeFalse()
    expect(
      trackedCanvases.some(function (canvas) {
        return canvas === canvases[canvasCount - 1]
      })
    ).toBeTrue()

    stopTracking()
  })

  it('should delete disconnected canvases as soon as a bounded scan reaches them', () => {
    const stopTracking = startSerializedCanvasTracking()
    const disconnectedCanvas = document.createElement('canvas')
    const connectedCanvas = document.createElement('canvas')
    document.body.appendChild(disconnectedCanvas)
    document.body.appendChild(connectedCanvas)
    setSerializedNodeId(disconnectedCanvas, 51)
    setSerializedNodeId(connectedCanvas, 52)
    disconnectedCanvas.remove()

    expect(getSerializedCanvasNodes(1)).toEqual([])
    document.body.appendChild(disconnectedCanvas)

    expect(getSerializedCanvasNodes()).toEqual([connectedCanvas])

    stopTracking()
    disconnectedCanvas.remove()
    connectedCanvas.remove()
  })

  it('should retain connected canvases inside shadow roots', () => {
    const stopTracking = startSerializedCanvasTracking()
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const canvas = document.createElement('canvas')
    shadowRoot.appendChild(canvas)
    document.body.appendChild(host)
    setSerializedNodeId(canvas, 61)

    expect(canvas.isConnected).toBeTrue()
    expect(getSerializedCanvasNodes(1)).toEqual([canvas])

    stopTracking()
    host.remove()
  })

  it('should clear a partially consumed iterator when the final tracker stops', () => {
    const stopFirstTracking = startSerializedCanvasTracking()
    const oldCanvases = [
      document.createElement('canvas'),
      document.createElement('canvas')
    ]
    oldCanvases.forEach(function (canvas, index) {
      Object.defineProperty(canvas, 'isConnected', {
        configurable: true,
        value: true
      })
      setSerializedNodeId(canvas, 70 + index)
    })

    expect(getSerializedCanvasNodes(1)).toEqual([oldCanvases[0]])
    stopFirstTracking()

    const stopSecondTracking = startSerializedCanvasTracking()
    const nextCanvas = document.createElement('canvas')
    Object.defineProperty(nextCanvas, 'isConnected', {
      configurable: true,
      value: true
    })
    setSerializedNodeId(nextCanvas, 80)

    expect(getSerializedCanvasNodes(64)).toEqual([nextCanvas])
    stopSecondTracking()
  })

  it('should retain canvases only while auto replay sampling is active', () => {
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)

    setSerializedNodeId(canvas, 42)
    expect(getSerializedCanvasNodes()).not.toContain(canvas)

    const stopTracking = startSerializedCanvasTracking()
    setSerializedNodeId(canvas, 42)
    expect(getSerializedCanvasNodes()).toContain(canvas)

    stopTracking()
    expect(getSerializedCanvasNodes()).not.toContain(canvas)
  })

  it('should keep the registry until every recorder stops tracking', () => {
    const stopFirstTracking = startSerializedCanvasTracking()
    const stopSecondTracking = startSerializedCanvasTracking()
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    setSerializedNodeId(canvas, 42)

    stopFirstTracking()
    expect(getSerializedCanvasNodes()).toContain(canvas)

    stopSecondTracking()
    expect(getSerializedCanvasNodes()).not.toContain(canvas)
  })
})
