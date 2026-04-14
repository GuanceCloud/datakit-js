export function takeAutoCanvasSnapshots(getCanvases, snapshotCanvas) {
  var canvases = Array.prototype.slice.call(getCanvases())
  return canvases.reduce(function (chain, canvas) {
    return chain.then(function () {
      return Promise.resolve(snapshotCanvas(canvas)).catch(function () {})
    })
  }, Promise.resolve())
}
