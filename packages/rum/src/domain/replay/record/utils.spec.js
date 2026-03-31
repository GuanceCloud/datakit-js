import { RecordType } from '../../../types'
import {
  assembleIncrementalSnapshot,
  forEach,
  getPathToNestedCSSRule,
  isTouchEvent
} from './utils'

describe('replay/record/utils', () => {
  it('should detect touch events', () => {
    expect(isTouchEvent({ changedTouches: [] })).toBeTrue()
    expect(isTouchEvent({})).toBeFalse()
  })

  it('should iterate over array-like values', () => {
    const values = []

    forEach({ 0: 'a', 1: 'b', length: 2 }, (value) => {
      values.push(value)
    })

    expect(values).toEqual(['a', 'b'])
  })

  it('should assemble incremental snapshots', () => {
    const snapshot = assembleIncrementalSnapshot('mutation', {
      adds: [1],
      removes: []
    })

    expect(snapshot).toEqual(
      jasmine.objectContaining({
        type: RecordType.IncrementalSnapshot,
        data: {
          source: 'mutation',
          adds: [1],
          removes: []
        },
        timestamp: jasmine.any(Number)
      })
    )
  })

  it('should compute the nested css rule path', () => {
    const rootRule = { parentStyleSheet: null }
    const nestedRule = { parentRule: rootRule }
    const deeperRule = { parentRule: nestedRule }

    rootRule.parentStyleSheet = {
      cssRules: [rootRule]
    }
    rootRule.cssRules = [nestedRule]
    nestedRule.cssRules = [deeperRule]

    expect(getPathToNestedCSSRule(deeperRule)).toEqual([0, 0, 0])
    expect(getPathToNestedCSSRule({ parentRule: null, parentStyleSheet: null })).toBeUndefined()
  })
})
