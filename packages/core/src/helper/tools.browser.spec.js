import {
  ajax,
  elementMatches,
  getHostname,
  getScreenOrientation,
  isSupportCors,
  loadScript,
  localStorage as storageHelper,
  mediaQueriesSupported,
  sessionStorage as sessionStorageHelper,
  xhr
} from './tools'

describe('tools browser helpers', () => {
  let OriginalXMLHttpRequest
  let OriginalXDomainRequest
  let originalActiveXObject
  let originalCreateElement
  let originalMatchMedia
  let originalMsMatchMedia
  let originalScreenOrientation
  let originalScreenMsOrientation
  let originalScreenMozOrientation

  beforeEach(() => {
    OriginalXMLHttpRequest = window.XMLHttpRequest
    OriginalXDomainRequest = window.XDomainRequest
    originalActiveXObject = window.ActiveXObject
    originalCreateElement = document.createElement
    originalMatchMedia = window.matchMedia
    originalMsMatchMedia = window.msMatchMedia
    originalScreenOrientation = screen.orientation
    originalScreenMsOrientation = screen.msOrientation
    originalScreenMozOrientation = screen.mozOrientation
    Object.defineProperty(screen, 'orientation', {
      configurable: true,
      value: originalScreenOrientation
    })
    Object.defineProperty(screen, 'msOrientation', {
      configurable: true,
      value: originalScreenMsOrientation
    })
    Object.defineProperty(screen, 'mozOrientation', {
      configurable: true,
      value: originalScreenMozOrientation
    })
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    window.XMLHttpRequest = OriginalXMLHttpRequest
    window.XDomainRequest = OriginalXDomainRequest
    window.ActiveXObject = originalActiveXObject
    document.createElement = originalCreateElement
    window.matchMedia = originalMatchMedia
    window.msMatchMedia = originalMsMatchMedia
    Object.defineProperty(screen, 'orientation', {
      configurable: true,
      value: originalScreenOrientation
    })
    Object.defineProperty(screen, 'msOrientation', {
      configurable: true,
      value: originalScreenMsOrientation
    })
    Object.defineProperty(screen, 'mozOrientation', {
      configurable: true,
      value: originalScreenMozOrientation
    })
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('should match selectors with standard and ms-prefixed apis', () => {
    const standardElement = {
      matches: jasmine.createSpy('matches').and.returnValue(true)
    }
    const legacyElement = {
      msMatchesSelector: jasmine
        .createSpy('msMatchesSelector')
        .and.returnValue(true)
    }

    expect(elementMatches(standardElement, '.target')).toBeTrue()
    expect(standardElement.matches).toHaveBeenCalledWith('.target')

    expect(elementMatches(legacyElement, '.legacy')).toBeTrue()
    expect(legacyElement.msMatchesSelector).toHaveBeenCalledWith('.legacy')
    expect(elementMatches({}, '.missing')).toBeFalse()
  })

  it('should wrap localStorage operations and detect support', () => {
    storageHelper.set('key', '{"a":1}')

    expect(storageHelper.get('key')).toBe('{"a":1}')
    expect(storageHelper.parse('key')).toEqual({ a: 1 })
    expect(storageHelper.isSupport()).toBeTrue()

    storageHelper.remove('key')
    expect(storageHelper.get('key')).toBeNull()
  })

  it('should detect sessionStorage support', () => {
    expect(sessionStorageHelper.isSupport()).toBeTrue()
  })

  it('should detect cors support and create xhr instances accordingly', () => {
    function FakeCorsXHR() {
      this.withCredentials = true
    }

    window.XMLHttpRequest = FakeCorsXHR
    window.XDomainRequest = undefined

    expect(isSupportCors()).toBeTrue()
    expect(xhr(true)).toEqual(jasmine.any(FakeCorsXHR))
    expect(xhr(false)).toEqual(jasmine.any(FakeCorsXHR))
  })

  it('should fallback to XDomainRequest for cors and ActiveXObject for legacy xhr', () => {
    function FakeXHRWithoutCors() {}
    function FakeXDomainRequest() {}
    const activeXObjectSpy = jasmine.createSpy('ActiveXObject').and.callFake(
      function (name) {
        if (name === 'Msxml2.XMLHTTP') {
          throw new Error('Msxml2 unavailable')
        }
        return { name }
      }
    )

    window.XMLHttpRequest = FakeXHRWithoutCors
    window.XDomainRequest = FakeXDomainRequest
    window.ActiveXObject = activeXObjectSpy

    expect(isSupportCors()).toBeTrue()
    expect(xhr(true)).toEqual(jasmine.any(FakeXDomainRequest))

    window.XMLHttpRequest = undefined
    expect(xhr(false)).toEqual({ name: 'Microsoft.XMLHTTP' })
  })

  it('should return null for cors requests when no browser transport is available', () => {
    window.XMLHttpRequest = undefined
    window.XDomainRequest = undefined

    expect(isSupportCors()).toBeFalse()
    expect(xhr(true)).toBeNull()
  })

  it('should extract hostnames and fallback to the default error value', () => {
    expect(getHostname('https://example.com/path?a=1')).toBe('example.com')
    expect(getHostname('not a valid url', 'fallback')).toBe('fallback')
  })

  it('should detect media query support and derive screen orientation', () => {
    Object.defineProperty(screen, 'orientation', {
      configurable: true,
      value: { type: 'landscape-primary' }
    })
    window.matchMedia = jasmine.createSpy('matchMedia')

    expect(mediaQueriesSupported()).toBeTrue()
    expect(getScreenOrientation()).toBe('landscape')

    Object.defineProperty(screen, 'orientation', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(screen, 'msOrientation', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(screen, 'mozOrientation', {
      configurable: true,
      value: undefined
    })
    window.matchMedia = jasmine.createSpy('matchMedia').and.callFake((query) => {
      return {
        matches: query === '(orientation: portrait)'
      }
    })

    expect(getScreenOrientation()).toBe('portrait')
  })

  it('should send ajax requests and call success for successful responses', () => {
    let request
    function FakeCorsXHR() {
      this.withCredentials = false
      this.timeout = 0
      this.readyState = 0
      this.status = 0
      this.responseText = ''
      this.headers = {}
      this.open = jasmine.createSpy('open')
      this.setRequestHeader = jasmine
        .createSpy('setRequestHeader')
        .and.callFake((name, value) => {
          this.headers[name] = value
        })
      this.send = jasmine.createSpy('send').and.callFake(() => {
        request = this
      })
      this.abort = jasmine.createSpy('abort')
    }

    window.XMLHttpRequest = FakeCorsXHR

    const successSpy = jasmine.createSpy('success')
    const errorSpy = jasmine.createSpy('error')

    ajax({
      url: '/collect',
      data: '{"a":1}',
      contentType: 'application/json',
      header: { 'X-Test': '1' },
      success: successSpy,
      error: errorSpy
    })

    expect(request.open).toHaveBeenCalledWith('POST', '/collect', true)
    expect(request.withCredentials).toBeTrue()
    expect(request.timeout).toBe(20000)
    expect(request.headers['X-Test']).toBe('1')
    expect(request.headers['X-Requested-With']).toBe('XMLHttpRequest')
    expect(request.headers['Content-type']).toBe(
      'application/json; charset=UTF-8'
    )
    expect(request.send).toHaveBeenCalledWith('{"a":1}')

    request.readyState = 4
    request.status = 200
    request.responseText = '{"ok":true}'
    request.onreadystatechange()

    expect(successSpy).toHaveBeenCalledWith({ ok: true })
    expect(errorSpy).not.toHaveBeenCalled()
    expect(request.onreadystatechange).toBeNull()
    expect(request.onload).toBeNull()
  })

  it('should call the error callback for failing ajax responses and return false when no transport exists', () => {
    let request
    function FakeCorsXHR() {
      this.withCredentials = true
      this.readyState = 0
      this.status = 0
      this.responseText = ''
      this.open = jasmine.createSpy('open')
      this.setRequestHeader = jasmine.createSpy('setRequestHeader')
      this.send = jasmine.createSpy('send').and.callFake(() => {
        request = this
      })
      this.abort = jasmine.createSpy('abort')
    }

    window.XMLHttpRequest = FakeCorsXHR

    const successSpy = jasmine.createSpy('success')
    const errorSpy = jasmine.createSpy('error')

    ajax({
      url: '/collect',
      cors: true,
      credentials: false,
      success: successSpy,
      error: errorSpy
    })

    request.readyState = 4
    request.status = 500
    request.responseText = '{"error":"failed"}'
    request.onreadystatechange()

    expect(successSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith({ error: 'failed' }, 500)

    window.XMLHttpRequest = undefined
    window.XDomainRequest = undefined
    expect(ajax({ url: '/collect', cors: true })).toBeFalse()
  })

  it('should build script and stylesheet elements and wire load/error callbacks', () => {
    const createdElements = []
    document.createElement = jasmine
      .createSpy('createElement')
      .and.callFake((tagName) => {
        const attributes = {}
        const element = {
          tagName,
          attributes,
          setAttribute: jasmine
            .createSpy('setAttribute')
            .and.callFake((name, value) => {
              attributes[name] = value
            })
        }
        createdElements.push(element)
        return element
      })

    const appendSpy = jasmine.createSpy('appendCall')
    const jsSuccessSpy = jasmine.createSpy('jsSuccess')
    const cssErrorSpy = jasmine.createSpy('cssError')

    loadScript({
      type: 'js',
      url: 'https://example.com/sdk.js',
      success: jsSuccessSpy,
      appendCall: appendSpy
    })

    const script = createdElements[0]
    expect(script.async).toBe('async')
    expect(script.attributes.charset).toBe('UTF-8')
    expect(script.src).toBe('https://example.com/sdk.js')
    expect(script.type).toBe('text/javascript')
    expect(appendSpy).toHaveBeenCalledWith(script)

    script.onload.call(script)
    expect(jsSuccessSpy).toHaveBeenCalled()
    expect(script.onload).toBeNull()
    expect(script.onreadystatechange).toBeNull()

    loadScript({
      type: 'css',
      url: 'https://example.com/sdk.css',
      error: cssErrorSpy,
      appendCall: appendSpy
    })

    const link = createdElements[1]
    expect(link.rel).toBe('stylesheet')
    expect(link.href).toBe('https://example.com/sdk.css')

    link.onerror()
    expect(cssErrorSpy).toHaveBeenCalled()
    expect(link.onerror).toBeNull()
  })
})
