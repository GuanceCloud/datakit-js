import {
  instrumentConstructor,
  instrumentMethod,
  instrumentSetter
} from './instrumentMethod'

describe('instrumentMethod', () => {
  beforeEach(() => {
    jasmine.clock().install()
  })

  afterEach(() => {
    jasmine.clock().uninstall()
  })

  it('should instrument a method call and execute the post-call hook', () => {
    const target = {
      sum(a, b) {
        return a + b
      }
    }
    const preCall = jasmine.createSpy('preCall').and.callFake((call) => {
      call.onPostCall((result) => {
        target.postCallResult = result
      })
    })

    const instrumentation = instrumentMethod(target, 'sum', preCall)
    const result = target.sum(2, 3)

    expect(result).toBe(5)
    expect(preCall).toHaveBeenCalledWith(
      jasmine.objectContaining({
        target,
        parameters: [2, 3]
      })
    )
    expect(target.postCallResult).toBe(5)

    instrumentation.stop()
  })

  it('should restore the original method when stopped', () => {
    const original = jasmine.createSpy('original').and.returnValue(1)
    const target = { fn: original }
    const instrumentation = instrumentMethod(
      target,
      'fn',
      jasmine.createSpy('preCall')
    )

    instrumentation.stop()
    target.fn('value')

    expect(original).toHaveBeenCalledWith('value')
  })

  it('should instrument configurable setters asynchronously', () => {
    const target = {}
    let storedValue
    Object.defineProperty(target, 'value', {
      configurable: true,
      set(value) {
        storedValue = value
      }
    })
    const after = jasmine.createSpy('after')
    const instrumentation = instrumentSetter(target, 'value', after)

    target.value = 42
    expect(storedValue).toBe(42)
    expect(after).not.toHaveBeenCalled()

    jasmine.clock().tick(0)

    expect(after).toHaveBeenCalledWith(target, 42)

    instrumentation.stop()
  })
})

describe('instrumentConstructor', () => {
  let Original

  beforeEach(() => {
    Original = class {
      static OPEN = 1

      constructor(value) {
        this.value = value
        this.observedNewTarget = new.target
      }
    }
  })

  it('should preserve native constructor behavior while instrumented', () => {
    const container = { Original }
    const postCall = jasmine.createSpy('postCall')
    const preCall = jasmine.createSpy('preCall').and.callFake((call) => {
      call.onPostCall(postCall)
    })
    const instrumentation = instrumentConstructor(
      container,
      'Original',
      preCall
    )

    const instance = new container.Original(42)

    expect(preCall).toHaveBeenCalledWith(
      jasmine.objectContaining({
        parameters: [42]
      })
    )
    expect(postCall).toHaveBeenCalledWith(instance)
    expect(instance.value).toBe(42)
    expect(instance.observedNewTarget).toBe(Original)
    expect(instance instanceof Original).toBeTrue()
    expect(instance instanceof container.Original).toBeTrue()
    expect(instance.constructor).toBe(container.Original)
    expect(container.Original.OPEN).toBe(1)

    instrumentation.stop()
  })

  it('should preserve subclasses and their new.target', () => {
    const container = { Original }
    const instrumentation = instrumentConstructor(
      container,
      'Original',
      jasmine.createSpy('preCall')
    )

    class Child extends container.Original {
      childMethod() {
        return 'child'
      }
    }

    const instance = new Child(7)

    expect(instance instanceof Child).toBeTrue()
    expect(instance instanceof Original).toBeTrue()
    expect(instance.observedNewTarget).toBe(Child)
    expect(instance.childMethod()).toBe('child')

    instrumentation.stop()
  })

  it('should restore its own layer without removing a later wrapper', () => {
    const container = { Original }
    const preCall = jasmine.createSpy('preCall')
    const instrumentation = instrumentConstructor(
      container,
      'Original',
      preCall
    )
    const sdkInstrumentation = container.Original

    container.Original = new Proxy(sdkInstrumentation, {
      construct(target, parameters, newTarget) {
        const instance = Reflect.construct(target, parameters, newTarget)
        instance.thirdParty = true
        return instance
      }
    })
    const thirdPartyWrapper = container.Original

    instrumentation.stop()

    const instance = new container.Original(3)
    expect(container.Original).toBe(thirdPartyWrapper)
    expect(instance.thirdParty).toBeTrue()
    expect(instance.value).toBe(3)
    expect(preCall).not.toHaveBeenCalled()
    expect(Original.prototype.constructor).toBe(Original)
  })

  it('should delegate calls without new without notifying instrumentation', () => {
    function Callable(value) {
      return value
    }
    const container = { Callable }
    const preCall = jasmine.createSpy('preCall')
    const instrumentation = instrumentConstructor(
      container,
      'Callable',
      preCall
    )

    expect(container.Callable(5)).toBe(5)
    expect(preCall).not.toHaveBeenCalled()

    instrumentation.stop()
  })

  it('should construct when Reflect.construct is unavailable', () => {
    const originalReflectConstruct = Reflect.construct
    Reflect.construct = undefined
    const container = { Original }
    const postCall = jasmine.createSpy('postCall')
    let instrumentation

    try {
      instrumentation = instrumentConstructor(
        container,
        'Original',
        (call) => call.onPostCall(postCall)
      )
      const instance = new container.Original(9)

      expect(instance.value).toBe(9)
      expect(instance instanceof Original).toBeTrue()
      expect(instance instanceof container.Original).toBeTrue()
      expect(instance.constructor).toBe(container.Original)
      expect(postCall).toHaveBeenCalledWith(instance)
    } finally {
      if (instrumentation) {
        instrumentation.stop()
      }
      Reflect.construct = originalReflectConstruct
    }
  })
})
