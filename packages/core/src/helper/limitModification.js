import { objectEntries, getType, deepClone } from './tools'
import { sanitize } from './sanitize'

export function limitModification(object, modifiableFieldPaths, modifier) {
  const clone = deepClone(object)
  const result = modifier(clone)

  objectEntries(modifiableFieldPaths).forEach(([fieldPath, fieldType]) =>
    // Traverse both object and clone simultaneously up to the path and apply the modification from the clone to the original object when the type is valid
    setValueAtPath(object, clone, fieldPath.split(/\.|(?=\[\])/), fieldType)
  )

  return result
}

function setValueAtPath(object, clone, pathSegments, fieldType) {
  const [field, ...restPathSegments] = pathSegments

  if (field === '[]') {
    if (Array.isArray(object) && Array.isArray(clone)) {
      object.forEach((item, i) =>
        setValueAtPath(item, clone[i], restPathSegments, fieldType)
      )
    }

    return
  }

  if (!isValidObject(object) || !isValidObject(clone)) {
    return
  }

  if (restPathSegments.length > 0) {
    return setValueAtPath(
      object[field],
      clone[field],
      restPathSegments,
      fieldType
    )
  }

  setNestedValue(object, field, clone[field], fieldType)
}

function setNestedValue(object, field, value, fieldType) {
  const newType = getType(value)

  if (newType === fieldType) {
    object[field] = sanitize(value)
  } else if (
    fieldType === 'object' &&
    (newType === 'undefined' || newType === 'null')
  ) {
    object[field] = {}
  }
}

function isValidObject(object) {
  return getType(object) === 'object'
}
