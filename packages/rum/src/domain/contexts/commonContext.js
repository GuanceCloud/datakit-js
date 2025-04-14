export function buildCommonContext(
  globalContextManager,
  userContextManager,
  recorderApi
) {
  return {
    context: globalContextManager.getContext(),
    user: userContextManager.getContext(),
    hasReplay: recorderApi.isRecording() ? true : undefined
  }
}
