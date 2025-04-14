import { display } from '../helper/display'
import { assign, getType, each } from '../helper/tools'

/**
 * Clone input data and ensure known user properties (id, name, email)
 * are strings, as defined here:
 */
export function sanitizeUser(newUser) {
  // We shallow clone only to prevent mutation of user data.
  var user = assign({}, newUser)
  var keys = ['id', 'name', 'email']
  each(keys, function (key) {
    if (key in user) {
      user[key] = String(user[key])
    }
  })

  return user
}

/**
 * Simple check to ensure user is valid
 */
export function checkUser(newUser) {
  var isValid = getType(newUser) === 'object'
  if (!isValid) {
    display.error('Unsupported user:', newUser)
  }
  return isValid
}
