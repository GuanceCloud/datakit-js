const path = require('path')
const webpackBase = require('../../webpack.base')

// The compression worker vendors a closed copy of pako.  These properties are
// private to that bundle and never cross postMessage.  Keep this list scoped to
// worker.js: generic names such as `output` and `options` are not safe to
// mangle in the public SDK or canvas-worker bundles.
const workerPrivatePropertyRegex = /^(?:\$r[A-Z].*|static_tree|extra_bits|extra_base|elems|max_length|has_stree|dyn_tree|max_code|stat_desc|good_length|max_lazy|nice_length|max_chain|func|pending_buf|pending_buf_size|pending_out|gzhead|gzindex|last_flush|w_size|w_bits|w_mask|window_size|hash_size|hash_bits|hash_mask|hash_shift|block_start|prev_match|match_available|strstart|match_start|prev_length|max_chain_length|max_lazy_match|good_match|nice_match|dyn_ltree|dyn_dtree|bl_tree|l_desc|d_desc|bl_desc|bl_count|heap_len|heap_max|l_buf|lit_bufsize|last_lit|d_buf|opt_len|static_len|bi_buf|bi_valid|next_in|avail_in|total_in|next_out|avail_out|total_out|data_type|adler|_dict_set|lookahead|match_length|ins_h|prev|strategy|heap|depth|insert|output|msg|strm|chunks|options|ended|onData|onEnd|chunkSize|windowBits|memLevel|raw|gzip|header|dictionary|xflags|extra_len|hcrc|done)$/

module.exports = (env, args) => {
  const configs = [
    webpackBase({
      mode: args.mode,
      filename: '[name].js',
      entry: {
        worker: path.resolve(__dirname, 'src/index.js')
      },
      path: path.resolve(__dirname, 'bundle'),
      propertyMangleRegex: workerPrivatePropertyRegex,
      compressPasses: 3
    }),
    webpackBase({
      mode: args.mode,
      filename: '[name].js',
      entry: {
        'canvas-worker': path.resolve(__dirname, 'src/canvasWorker.js')
      },
      path: path.resolve(__dirname, 'bundle')
    })
  ]

  configs.forEach((config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@cloudcare/browser-core/worker$': path.resolve(
        __dirname,
        '../core/src/worker.js'
      )
    }
  })
  return configs
}
