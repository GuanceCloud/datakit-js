import {
  absoluteToDoc,
  fixBrowserCompatibilityIssuesInCSS,
  getAbsoluteSrcsetString,
  getSerializedCanvasNodes,
  makeUrlAbsolute,
  setSerializedNodeId,
  switchToAbsoluteUrl
} from './serializationUtils'

describe('replay/record/serializationUtils', () => {
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

  it('should make urls absolute and fall back to the original value on invalid input', () => {
    expect(
      makeUrlAbsolute('../img/a.png', 'https://example.com/assets/css/app.css')
    ).toBe('https://example.com/assets/img/a.png')
    expect(
      typeof makeUrlAbsolute('://broken', 'https://example.com/base')
    ).toBe('string')
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
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    setSerializedNodeId(canvas, 42)

    expect(getSerializedCanvasNodes().some((node) => node === canvas)).toBeTrue()

    const originalContains = document.documentElement.contains.bind(
      document.documentElement
    )
    spyOn(document.documentElement, 'contains').and.callFake((node) =>
      node === canvas ? false : originalContains(node)
    )

    expect(getSerializedCanvasNodes().some((node) => node === canvas)).toBeFalse()
  })

  it('should re-register a canvas after pruning it from the auto replay sampling set', () => {
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    setSerializedNodeId(canvas, 42)

    let connected = false
    spyOn(document.documentElement, 'contains').and.callFake((node) =>
      node === canvas ? connected : false
    )
    expect(getSerializedCanvasNodes().some((node) => node === canvas)).toBeFalse()

    connected = true
    setSerializedNodeId(canvas, 42)

    expect(getSerializedCanvasNodes().some((node) => node === canvas)).toBeTrue()
  })
})
