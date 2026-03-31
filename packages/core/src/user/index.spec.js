import * as userIndex from './index'

describe('user index', () => {
  it('should re-export user helpers', () => {
    expect(userIndex.sanitizeUser).toEqual(jasmine.any(Function))
    expect(userIndex.checkUser).toEqual(jasmine.any(Function))
  })
})
