var router = { isReady: false }

export function useRouter() {
  return router
}

export function setNextRouter(nextRouter) {
  router = nextRouter
}

export function resetNextRouter() {
  router = { isReady: false }
}
