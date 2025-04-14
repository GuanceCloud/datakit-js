// ie11 supports WeakMap but not WeakSet
var PLACEHOLDER = 1
export function WeakSet(initialValues) {
  this.map = new WeakMap()
  if (initialValues) {
    initialValues.forEach(function (value) {
      this.map.set(value, PLACEHOLDER)
    })
  }
}
WeakSet.prototype.add = function (value) {
  this.map.set(value, PLACEHOLDER)
  return this
}
WeakSet.prototype.delete = function (value) {
  return this.map.delete(value)
}
WeakSet.prototype.has = function (value) {
  return this.map.has(value)
}
