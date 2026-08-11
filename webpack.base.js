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
  keepBuildEnvVariables,
  propertyMangleRegex,
  propertyMangleBuiltins,
  compressPasses,
  compressInline,
  mangleTopLevel
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
            toplevel: Boolean(mangleTopLevel),
            // This allowlist is deliberately limited to SDK-owned control
            // objects and short-lived module-private state whose producers and
            // consumers are bundled together.  Do not add configuration,
            // intake/replay payload, debug result, worker message, or plugin
            // contract fields here.
            properties: {
              builtins: Boolean(propertyMangleBuiltins),
              // These names are part of the published RUM API and also occur
              // on internal recorder objects.  Keep them stable even if a
              // future private-property rule accidentally matches them.
              reserved: [
                'snapshotCanvas',
                'takeSubsequentFullSnapshot',
                'startSession',
                // Stable cross-bundle contract used by the optional WebGL
                // replay plugin. The host and addon are minified separately,
                // so neither side may rename these fields independently.
                'sessionReplayWebGL',
                'isWebGLCanvas',
                'encodeWithLifecycle',
                'result',
                'physicalSettled',
                // These names are too generic to rename safely. They may be
                // introduced later on public objects even though their current
                // uses are internal, and mangling them saves only a few bytes.
                'eventCount',
                'mutations',
                'transaction',
                'overflow'
              ],
              regex:
                propertyMangleRegex ||
                /^(?:\$r[A-Z].*|HIDDEN|IGNORE|ALLOW|MASK_USER_INPUT|UNLOADING|FROZEN|RESOURCE|ERROR|ACTION|LONG_TASK|LOGGER|REPLAY|ONGOING|STOPPED|FINALIZED|endClocks|mutationResourceBudget|getPendingEncodedBytesCount|flushPendingActionsSync|notifyBeforeAddMessage|notifyAfterRemoveMessage|setFlushTrackedResource|getViewInteractionCount|stopViewInteractionCount|hadActivityOnPointerDown|autoUnchangedBackoff|autoFailureBackoff|maxPendingRawBytes|getTrackerIdFromRequestHeaders|computeHandlingStack|startCompressionWorker|trackRequestResource|setCompressionStatus|getCompressionStatus|setContextProvider|createDetachedTracker|mutationRecordCount|mutationNodeCount|callback|subscribe|unsubscribe|requestIndex|enqueueFirst|ongoingOrderedRequestCount|eventBudgetReservation|eventApproxBytes|eventCount|nativeCallbackCount|directNodeCount|recordIndex|addedIndex|removedIndex|reservations|mutations|transaction|fallbackReason|overflow|requiresBaselineOnDrop|publicationToken|serializerTask|serializedNode|serializedNodeIds|accountedApproxBytes|isDeferred|wasDeferred|isActiveSerializerTask|isCompleted|hasStructuralRemoval|findPendingRootTask|addPendingRootTask|refreshPendingRootTask|markPendingRootTaskPublishedDependency|handlePendingRootRemoval|provisionalShadowRoots|pendingOverflowAfterReset|provisionalOwner|unpublishedMutationOverflowReported|stopMutationObserver|stopInputObserver|mutationObserverDeactivated|deactivateMutationObserver|refreshAndFlushPendingRootForNode|commitProvisionalShadowRoots|rollbackProvisionalShadowRoots|retryQueued|nextEligibleAt|consecutiveRecordRejectedCount|shouldRecordCanvasCheckedAt|shouldRecordCanvasAllowed|animationFrameTarget|contextPrototypeEntries|mutationGroup|pendingTaskCount|mutationGroupDependencyReleased|approxBytesReleased|getOverflowCount|createMutationGroup|completeMutationGroup|cancelMutationGroup|dropMutationGroupTasks|addsApproxBytes|removesApproxBytes|textsApproxBytes|attributesApproxBytes|addApproxBytes|removeApproxBytesByKey|textApproxBytesById|attributeApproxBytesById|removesByKey|textsById|attributesById|mutationPayloads|mutationApproxBytes|hasOversizedEntry|isSerializationComplexityOverflow|isMaxNodeComplexityReached|isMaxApproxBytesReached|isMaxNodeCountReached|isMaxDepthReached|estimatedBytesCount|finishCallback|writeCallback|serializationContext|parentNodePrivacyLevel|mutationNodeSerializationCb|requestAnimationFrameImpl|cancelAnimationFrameImpl|setTimeoutImpl|clearTimeoutImpl|onFullSnapshotFailure|onReplayResetExhausted|queuedPayloads|encoderFallback|shouldSerializeChildren|shadowRootsController|getSerializedNodeId|getPendingRawBytesCount|fallbackSnapshotRequested|forceSnapshotFallback|markPersistentSnapshotFallback|createCanvasSnapshotBaselineToken|markCanvasSnapshotBaseline|childNodesOptions|processedNodeCount|lastProcessedChild|onSerializedNode|frameSignatureExtractor|encodeBridge|isNodeActive|onMutationDebug|startContinuousCanvasSnapshotLoop|startCanvasCommandCapture|startCanvasWebGLSnapshotObserver|createCanvasObserver|scheduleSubsequentFullSnapshot|flushScheduledFullSnapshot|prepareForViewChange|flushMutations|mutationPerfCb|mutationOverflowCb|mutationActivityCb|initObservers|initShadowRootsController|initializationFailureCallbacks|flushedShadowRootCount|startPaused|getVisibilityState|scheduleMicrotask|getCurrentTime|getCanvases|maxFallbackTimerCount|maxFallbackTimerDelay|commandRecorder|canvasPrototype|addEventListenerImpl|shouldTrackAutoBaseline|requestSnapshotFallback|flushCanvasImmediately|createWebGLReadbackState|getCanvasType|getCanvasId|onCommandOverflow|onContextMutation|onContextDiscovered|lastAutoSuccessfulSnapshotAtByCanvas|lastAutoFrameSignatureByCanvas|objectRefRegistry|pendingRawBytesLimit|onSegmentFlushed|onReplayResetNeeded|beforePageExitFlush|pendingSessionRenewal|flushOpenConnections|resumeOpenConnections|bufferedAmountPreSend|openClocks|sessionStateUpdateObservable|renewSession|forceSession|findTrackedSession|unpublishedDeadline|cleanupDisconnectedShadowRoots|patchContext|patchSharedPrototype|rejectContext|retryPublishedContext|scanExistingCanvases|elementsScrollPositions|rawResourceEvent|finished|flushed|timeoutId|orphanTimeoutId|transportStatus|currentBackoffTime|bandwidthMonitor|queueFullReported|ongoingRequestCount|ongoingByteCount|canHandle|initialViewMetrics|commonViewMetrics|savedCommonContext|customerContext|getCommonViewMetrics|setLoadEvent|stopINPTracking|setViewEnd|eventCounts|getUserActivity|hasPageActivity|throttled|registered|renewObservable|expireObservable|previousState|newState|resourceTrackerManager|expandOrRenewSession|keepSessionAlive|updateSessionState|setErrorForSession|restartSession|getSession|persistSession|retrieveSession|expireSession|isLockEnabled|generation|approxBytes|isQueued|rootNode|nextChild|deadline|overflowed|isCancelled|isComplete|ruleCount|normalizationState|mutationTasksController|isWatermarkReached|visitedStyleSheets|fallbackDirty|mutationGeneration|nextFrameSignature|mutationEntries|characterCount|serializedRecordData|addMutations|isOverflowed|handleOverflow|isNodeIgnored|addShadowRoot|removeShadowRoot|isNodePublished|isNodeInSkippedShadowRoot|shadowRootCreatedCb|timeCheckCount|nextScanCursor|parentSerializedNode|mutationCb|weakRef|onDebug|isRetained|entered|indexByObject|serializeArgs|serializeObjectRef|groupsByForm|groupsWithoutForm|refreshCount|sourceHeight|targetHeight|sourcePixels|targetPixels|styleSheetByHref|viewportResizeCb|isForcedSnapshot|isAutoSnapshot|unlockSegment|flushBufferSegment|onSuccess|onFailure|lastFailureStatus|initializationTimeoutDelay|getSegmentsCount|getStatus|isStopped|ensureWorker|createWorker|dependencies|characters|exceeded|flushContext|encodedDataUrlCacheMaxCharacters|shouldRecordContext|scheduleCleanup|onPostCall|onLastUnsubscribe|closeActive|estimateEncodedBytesCount|onFirstSubscribe|observers|callbacks|notifyAfterAddMessage|isEmpty|exhausted|nodeCount|parameters|bytesLimit|onMessage|cleanupErrorCb|lookahead|match_length|ins_h|inputCb|mediaInteractionCb|mouseInteractionCb|mousemoveCb|scrollCb|styleSheetCb|frustrationCb|focusCb|visualViewportResizeCb|weakRefFactory|stopObservable|flushController|flushObservable|changeObservable|pageExitObservable|sessionExpireObservable|initializationTimeoutId|orphanTimeoutId|clearTimeoutId|makeRecorderPublicApi|lifeCycle|sessionManager|contextManager|customerDataTracker|actionContexts|getTraceId|getSpanId|makeTracingHeaders|isTracingSupported|clearTracingIfNeeded|requestHeaderMatched|updateCustomerData|getOrCreateTracker|createCompressionEncoder|findView|findActionId|findAllActionId|getTimeStamp|addRecord|addPageState|getInteractionToNextPaint|matchRequestResourceEntry|errorSessionReplayAllowed|sessionStoreStrategyType|SegmentPending|WaitingForInitialRecord|isNodeIgnoredForStatelessObserver|customTraceId|sessionHasError|domainContext|bytesCount|trackingType)$/
            }
          },
          compress: {
            passes: compressPasses || 2,
            toplevel: Boolean(mangleTopLevel),
            inline: mangleTopLevel
              ? compressInline === undefined
                ? 2
                : compressInline
              : undefined
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
            plugins: [
              [
                '@babel/plugin-transform-runtime',
                { version: require('@babel/runtime/package.json').version }
              ]
            ]
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
