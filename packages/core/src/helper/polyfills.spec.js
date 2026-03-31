import { WeakSet } from './polyfills'

describe('polyfills', () => {
  it('should initialize a WeakSet with initial values', () => {
    const first = {}
    const second = {}
    const weakSet = new WeakSet([first, second])

    expect(weakSet.has(first)).toBeTrue()
    expect(weakSet.has(second)).toBeTrue()
  })

  it('should add and delete values', () => {
    const value = {}
    const weakSet = new WeakSet()

    expect(weakSet.add(value)).toBe(weakSet)
    expect(weakSet.has(value)).toBeTrue()
    expect(weakSet.delete(value)).toBeTrue()
    expect(weakSet.has(value)).toBeFalse()
  })
})
