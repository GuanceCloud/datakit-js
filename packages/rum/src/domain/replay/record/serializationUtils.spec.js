import {
  absoluteToDoc,
  fixBrowserCompatibilityIssuesInCSS,
  getAbsoluteSrcsetString,
  makeUrlAbsolute,
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
})
