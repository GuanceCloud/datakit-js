var pathname = '/'
var params = {}

export function useParams() {
  return params
}

export function usePathname() {
  return pathname
}

export function setNextNavigation(nextPathname, nextParams) {
  pathname = nextPathname
  params = nextParams || {}
}

export function resetNextNavigation() {
  pathname = '/'
  params = {}
}
