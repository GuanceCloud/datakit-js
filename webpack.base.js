const TerserPlugin = require('terser-webpack-plugin')
const webpack = require('webpack')
const nodePath = require('path')
const { buildEnvKeys, getBuildEnvValue } = require('./scripts/build-env')
module.exports = ({
  entry,
  mode,
  path,
  filename,
  types,
  keepBuildEnvVariables
}) => ({
  entry,
  mode,
  output: {
    filename,
    path
  },
  resolve: {
    alias:
      mode === 'development'
        ? {
            '@cloudcare/browser-core$': nodePath.resolve(
              __dirname,
              'packages/core/src/index.js'
            ),
            '@cloudcare/browser-core/worker$': nodePath.resolve(
              __dirname,
              'packages/core/src/worker.js'
            ),
            '@cloudcare/browser-worker$': nodePath.resolve(
              __dirname,
              'packages/worker/src/index.js'
            )
          }
        : {}
  },
  target: ['web', 'es5'],
  devtool: false,
  optimization: {
    minimizer: [
      new TerserPlugin({
        extractComments: false,
        terserOptions: {
          mangle: {
            // This allowlist is deliberately limited to short-lived,
            // module-private replay state. Mangling it cannot alter public
            // configuration, replay payload, or debug result field names.
            properties: {
              // These names are part of the published RUM API and also occur
              // on internal recorder objects.  Keep them stable even if a
              // future private-property rule accidentally matches them.
              reserved: [
                'snapshotCanvas',
                'takeSubsequentFullSnapshot'
              ],
              regex:
                /^(?:\$r[A-Z].*|requiresBaselineOnDrop|publicationToken|serializerTask|serializedNode|serializedNodeIds|accountedApproxBytes|hasStructuralRemoval|findPendingRootTask|addPendingRootTask|refreshPendingRootTask|markPendingRootTaskPublishedDependency|handlePendingRootRemoval|provisionalShadowRoots|pendingOverflowAfterReset|provisionalOwner|unpublishedMutationOverflowReported|stopMutationObserver|stopInputObserver|mutationObserverDeactivated|deactivateMutationObserver|refreshAndFlushPendingRootForNode|commitProvisionalShadowRoots|rollbackProvisionalShadowRoots|retryQueued|nextEligibleAt|consecutiveRecordRejectedCount|shouldRecordCanvasCheckedAt|shouldRecordCanvasAllowed|animationFrameTarget|contextPrototypeEntries|mutationGroup|pendingTaskCount|mutationGroupDependencyReleased|approxBytesReleased|getOverflowCount|createMutationGroup|completeMutationGroup|cancelMutationGroup|dropMutationGroupTasks|addsApproxBytes|removesApproxBytes|textsApproxBytes|attributesApproxBytes|addApproxBytes|removeApproxBytesByKey|textApproxBytesById|attributeApproxBytesById|removesByKey|textsById|attributesById|mutationPayloads|mutationApproxBytes|hasOversizedEntry|isSerializationComplexityOverflow|isMaxNodeComplexityReached|isMaxApproxBytesReached|isMaxNodeCountReached|isMaxDepthReached|estimatedBytesCount|finishCallback|writeCallback|serializationContext|parentNodePrivacyLevel|mutationNodeSerializationCb|requestAnimationFrameImpl|cancelAnimationFrameImpl|setTimeoutImpl|clearTimeoutImpl|onFullSnapshotFailure|onReplayResetExhausted|queuedPayloads|encoderFallback|shouldSerializeChildren|shadowRootsController|getSerializedNodeId|getPendingRawBytesCount|fallbackSnapshotRequested|forceSnapshotFallback|markPersistentSnapshotFallback|createCanvasSnapshotBaselineToken|markCanvasSnapshotBaseline|childNodesOptions|processedNodeCount|lastProcessedChild|onSerializedNode|weakRefFactory|frameSignatureExtractor|encodeBridge|isNodeActive|onMutationDebug|startContinuousCanvasSnapshotLoop|startCanvasCommandCapture|startCanvasWebGLSnapshotObserver|createCanvasObserver|scheduleSubsequentFullSnapshot|flushScheduledFullSnapshot|prepareForViewChange|flushMutations|mutationPerfCb|mutationOverflowCb|mutationActivityCb|initObservers|initShadowRootsController|initializationFailureCallbacks|flushedShadowRootCount|startPaused|getVisibilityState|scheduleMicrotask|getCurrentTime|getCanvases|maxFallbackTimerCount|maxFallbackTimerDelay|commandRecorder|canvasPrototype|addEventListenerImpl|shouldTrackAutoBaseline|requestSnapshotFallback|flushCanvasImmediately|createWebGLReadbackState|getCanvasType|getCanvasId|onCommandOverflow|onContextMutation|onContextDiscovered|lastAutoSuccessfulSnapshotAtByCanvas|lastAutoFrameSignatureByCanvas|objectRefRegistry|pendingRawBytesLimit|onSegmentFlushed|onReplayResetNeeded|beforePageExitFlush)$/
            }
          },
          compress: {
            passes: 2
          }
        }
      })
    ]
  },
  module: {
    rules: [
      {
        test: /\.(?:js|mjs|cjs)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
            plugins: ['@babel/plugin-transform-runtime']
          }
        }
      }
    ]
  },
  plugins: [
    new webpack.SourceMapDevToolPlugin(
      mode === 'development'
        ? // Use an inline source map during development (default options)
          {}
        : // When bundling for release, produce a source map file so it can be used for source code integration,
          // but don't append the source map comment to bundles as we don't upload the source map to
          // the CDN (yet).
          {
            filename: '[file].map',
            append: false,
            noSources: true
          }
    ),
    new webpack.DefinePlugin(
      Object.fromEntries(
        buildEnvKeys
          .filter((key) => !keepBuildEnvVariables?.includes(key))
          .map((key) => [
            `__BUILD_ENV__${key}__`,
            webpack.DefinePlugin.runtimeValue(() =>
              JSON.stringify(getBuildEnvValue(key, mode))
            )
          ])
      )
    )
  ]
})
