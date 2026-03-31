import { CustomerDataType } from './const'

describe('serialisation const', () => {
  it('should expose customer data type labels', () => {
    expect(CustomerDataType).toEqual({
      FeatureFlag: 'feature flag evaluation',
      User: 'user',
      GlobalContext: 'global context',
      View: 'view'
    })
  })
})
