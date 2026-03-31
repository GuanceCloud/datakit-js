import { concatBuffers } from './worker'

describe('worker entry', () => {
  it('should re-export concatBuffers', () => {
    const result = concatBuffers([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4])
    ])

    expect(Array.from(result)).toEqual([1, 2, 3, 4])
  })
})
