import {
  deepSnakeCase,
  find,
  findByPath,
  findCommaSeparatedValue,
  findCommaSeparatedValues,
  findLast,
  includes,
  isMatchOption,
  objectHasValue,
  toSnakeCase,
  withSnakeCaseKeys
} from './tools'

describe('tools helpers', () => {
  it('should find a named value inside a comma separated string', () => {
    expect(findCommaSeparatedValue('a=1; b=2; c=test-value', 'b')).toBe('2')
    expect(findCommaSeparatedValue('a=1; b=2', 'missing')).toBeUndefined()
  })

  it('should collect all values from a comma separated string', () => {
    expect(
      Array.from(findCommaSeparatedValues('a=1; b=2; c=test-value').entries())
    ).toEqual([
      ['a', '1'],
      ['b', '2'],
      ['c', 'test-value']
    ])
  })

  it('should find nested values by path', () => {
    const source = {
      user: {
        profile: {
          name: 'alice'
        }
      }
    }

    expect(findByPath(source, 'user.profile.name')).toBe('alice')
    expect(findByPath(source, 'user.profile.age')).toBeUndefined()
    expect(findByPath(source, 'user.profile.name.length')).toBeUndefined()
  })

  it('should validate tracing match options', () => {
    expect(isMatchOption('value')).toBeTrue()
    expect(isMatchOption(/value/)).toBeTrue()
    expect(isMatchOption(() => true)).toBeTrue()
    expect(isMatchOption(123)).toBeFalse()
  })

  it('should support includes, find and findLast helpers', () => {
    expect(includes('browser-sdk', 'sdk')).toBeTrue()
    expect(find([1, 2, 3], (value) => value > 1)).toBe(2)
    expect(findLast([1, 2, 3, 4], (value) => value % 2 === 0)).toBe(4)
  })

  it('should convert keys to snake case recursively', () => {
    const candidate = {
      userName: 'alice',
      nestedValue: {
        accountId: 1
      },
      items: [{ itemName: 'first-item' }]
    }

    expect(toSnakeCase('sessionReplayRate')).toBe('session_replay_rate')
    expect(toSnakeCase('trace-id')).toBe('trace_id')
    expect(withSnakeCaseKeys(candidate)).toEqual({
      user_name: 'alice',
      nested_value: {
        account_id: 1
      },
      items: [{ item_name: 'first-item' }]
    })
    expect(deepSnakeCase([{ nestedValue: true }])).toEqual([
      { nested_value: true }
    ])
  })

  it('should check whether an object contains a specific value', () => {
    expect(objectHasValue({ a: 1, b: 2 }, 2)).toBeTrue()
    expect(objectHasValue({ a: 1, b: 2 }, 3)).toBeFalse()
  })
})
