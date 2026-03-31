import { instrumentMethod, instrumentSetter } from './instrumentMethod'

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
