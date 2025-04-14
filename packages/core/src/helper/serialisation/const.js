// RUM and logs batch bytes limit is 16KB
// ensure that we leave room for other event attributes and maintain a decent amount of event per batch
// (3KB (customer data) + 1KB (other attributes)) * 4 (events per batch) = 16KB

export var CustomerDataType = {
  FeatureFlag: 'feature flag evaluation',
  User: 'user',
  GlobalContext: 'global context',
  View: 'view'
}
