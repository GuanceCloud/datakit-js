!(function () {
  'use strict'
  function t(t, a) {
    var n =
      ('undefined' != typeof Symbol && t[Symbol.iterator]) || t['@@iterator']
    if (!n) {
      if (
        Array.isArray(t) ||
        (n = (function (t, a) {
          if (!t) return
          if ('string' == typeof t) return e(t, a)
          var n = Object.prototype.toString.call(t).slice(8, -1)
          'Object' === n && t.constructor && (n = t.constructor.name)
          if ('Map' === n || 'Set' === n) return Array.from(t)
          if (
            'Arguments' === n ||
            /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)
          )
            return e(t, a)
        })(t)) ||
        (a && t && 'number' == typeof t.length)
      ) {
        n && (t = n)
        var r = 0,
          i = function () {}
        return {
          s: i,
          n: function () {
            return r >= t.length ? { done: !0 } : { done: !1, value: t[r++] }
          },
          e: function (t) {
            throw t
          },
          f: i
        }
      }
      throw new TypeError(
        'Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.'
      )
    }
    var s,
      _ = !0,
      h = !1
    return {
      s: function () {
        n = n.call(t)
      },
      n: function () {
        var t = n.next()
        return (_ = t.done), t
      },
      e: function (t) {
        ;(h = !0), (s = t)
      },
      f: function () {
        try {
          _ || null == n.return || n.return()
        } finally {
          if (h) throw s
        }
      }
    }
  }
  function e(t, e) {
    ;(null == e || e > t.length) && (e = t.length)
    for (var a = 0, n = new Array(e); a < e; a++) n[a] = t[a]
    return n
  }
  function a(e) {
    var a,
      n = e.reduce(function (t, e) {
        return t + e.length
      }, 0),
      r = new Uint8Array(n),
      i = 0,
      s = t(e)
    try {
      for (s.s(); !(a = s.n()).done; ) {
        var _ = a.value
        r.set(_, i), (i += _.length)
      }
    } catch (t) {
      s.e(t)
    } finally {
      s.f()
    }
    return r
  }
  function n(t) {
    for (var e = t.length; --e >= 0; ) t[e] = 0
  }
  var r = 256,
    i = 286,
    s = 30,
    _ = 15,
    h = new Uint8Array([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5,
      5, 5, 5, 0
    ]),
    l = new Uint8Array([
      0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
      11, 11, 12, 12, 13, 13
    ]),
    o = new Uint8Array([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7
    ]),
    d = new Uint8Array([
      16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15
    ]),
    u = new Array(576)
  n(u)
  var f = new Array(60)
  n(f)
  var c = new Array(512)
  n(c)
  var p = new Array(256)
  n(p)
  var g = new Array(29)
  n(g)
  var v,
    w,
    b,
    m = new Array(s)
  function y(t, e, a, n, r) {
    ;(this.static_tree = t),
      (this.extra_bits = e),
      (this.extra_base = a),
      (this.elems = n),
      (this.max_length = r),
      (this.has_stree = t && t.length)
  }
  function k(t, e) {
    ;(this.dyn_tree = t), (this.max_code = 0), (this.stat_desc = e)
  }
  n(m)
  var z = function (t) {
      return t < 256 ? c[t] : c[256 + (t >>> 7)]
    },
    A = function (t, e) {
      ;(t.pending_buf[t.pending++] = 255 & e),
        (t.pending_buf[t.pending++] = (e >>> 8) & 255)
    },
    x = function (t, e, a) {
      t.bi_valid > 16 - a
        ? ((t.bi_buf |= (e << t.bi_valid) & 65535),
          A(t, t.bi_buf),
          (t.bi_buf = e >> (16 - t.bi_valid)),
          (t.bi_valid += a - 16))
        : ((t.bi_buf |= (e << t.bi_valid) & 65535), (t.bi_valid += a))
    },
    E = function (t, e, a) {
      x(t, a[2 * e], a[2 * e + 1])
    },
    Z = function (t, e) {
      var a = 0
      do {
        ;(a |= 1 & t), (t >>>= 1), (a <<= 1)
      } while (--e > 0)
      return a >>> 1
    },
    S = function (t, e, a) {
      var n,
        r,
        i = new Array(16),
        s = 0
      for (n = 1; n <= _; n++) i[n] = s = (s + a[n - 1]) << 1
      for (r = 0; r <= e; r++) {
        var h = t[2 * r + 1]
        0 !== h && (t[2 * r] = Z(i[h]++, h))
      }
    },
    U = function (t) {
      var e
      for (e = 0; e < i; e++) t.dyn_ltree[2 * e] = 0
      for (e = 0; e < s; e++) t.dyn_dtree[2 * e] = 0
      for (e = 0; e < 19; e++) t.bl_tree[2 * e] = 0
      ;(t.dyn_ltree[512] = 1),
        (t.opt_len = t.static_len = 0),
        (t.last_lit = t.matches = 0)
    },
    R = function (t) {
      t.bi_valid > 8
        ? A(t, t.bi_buf)
        : t.bi_valid > 0 && (t.pending_buf[t.pending++] = t.bi_buf),
        (t.bi_buf = 0),
        (t.bi_valid = 0)
    },
    L = function (t, e, a, n) {
      var r = 2 * e,
        i = 2 * a
      return t[r] < t[i] || (t[r] === t[i] && n[e] <= n[a])
    },
    F = function (t, e, a) {
      for (
        var n = t.heap[a], r = a << 1;
        r <= t.heap_len &&
        (r < t.heap_len && L(e, t.heap[r + 1], t.heap[r], t.depth) && r++,
        !L(e, n, t.heap[r], t.depth));

      )
        (t.heap[a] = t.heap[r]), (a = r), (r <<= 1)
      t.heap[a] = n
    },
    T = function (t, e, a) {
      var n,
        i,
        s,
        _,
        o = 0
      if (0 !== t.last_lit)
        do {
          ;(n =
            (t.pending_buf[t.d_buf + 2 * o] << 8) |
            t.pending_buf[t.d_buf + 2 * o + 1]),
            (i = t.pending_buf[t.l_buf + o]),
            o++,
            0 === n
              ? E(t, i, e)
              : ((s = p[i]),
                E(t, s + r + 1, e),
                0 !== (_ = h[s]) && ((i -= g[s]), x(t, i, _)),
                n--,
                (s = z(n)),
                E(t, s, a),
                0 !== (_ = l[s]) && ((n -= m[s]), x(t, n, _)))
        } while (o < t.last_lit)
      E(t, 256, e)
    },
    I = function (t, e) {
      var a,
        n,
        r,
        i = e.dyn_tree,
        s = e.stat_desc.static_tree,
        h = e.stat_desc.has_stree,
        l = e.stat_desc.elems,
        o = -1
      for (t.heap_len = 0, t.heap_max = 573, a = 0; a < l; a++)
        0 !== i[2 * a]
          ? ((t.heap[++t.heap_len] = o = a), (t.depth[a] = 0))
          : (i[2 * a + 1] = 0)
      for (; t.heap_len < 2; )
        (i[2 * (r = t.heap[++t.heap_len] = o < 2 ? ++o : 0)] = 1),
          (t.depth[r] = 0),
          t.opt_len--,
          h && (t.static_len -= s[2 * r + 1])
      for (e.max_code = o, a = t.heap_len >> 1; a >= 1; a--) F(t, i, a)
      r = l
      do {
        ;(a = t.heap[1]),
          (t.heap[1] = t.heap[t.heap_len--]),
          F(t, i, 1),
          (n = t.heap[1]),
          (t.heap[--t.heap_max] = a),
          (t.heap[--t.heap_max] = n),
          (i[2 * r] = i[2 * a] + i[2 * n]),
          (t.depth[r] =
            (t.depth[a] >= t.depth[n] ? t.depth[a] : t.depth[n]) + 1),
          (i[2 * a + 1] = i[2 * n + 1] = r),
          (t.heap[1] = r++),
          F(t, i, 1)
      } while (t.heap_len >= 2)
      ;(t.heap[--t.heap_max] = t.heap[1]),
        (function (t, e) {
          var a,
            n,
            r,
            i,
            s,
            h,
            l = e.dyn_tree,
            o = e.max_code,
            d = e.stat_desc.static_tree,
            u = e.stat_desc.has_stree,
            f = e.stat_desc.extra_bits,
            c = e.stat_desc.extra_base,
            p = e.stat_desc.max_length,
            g = 0
          for (i = 0; i <= _; i++) t.bl_count[i] = 0
          for (
            l[2 * t.heap[t.heap_max] + 1] = 0, a = t.heap_max + 1;
            a < 573;
            a++
          )
            (i = l[2 * l[2 * (n = t.heap[a]) + 1] + 1] + 1) > p &&
              ((i = p), g++),
              (l[2 * n + 1] = i),
              n > o ||
                (t.bl_count[i]++,
                (s = 0),
                n >= c && (s = f[n - c]),
                (h = l[2 * n]),
                (t.opt_len += h * (i + s)),
                u && (t.static_len += h * (d[2 * n + 1] + s)))
          if (0 !== g) {
            do {
              for (i = p - 1; 0 === t.bl_count[i]; ) i--
              t.bl_count[i]--,
                (t.bl_count[i + 1] += 2),
                t.bl_count[p]--,
                (g -= 2)
            } while (g > 0)
            for (i = p; 0 !== i; i--)
              for (n = t.bl_count[i]; 0 !== n; )
                (r = t.heap[--a]) > o ||
                  (l[2 * r + 1] !== i &&
                    ((t.opt_len += (i - l[2 * r + 1]) * l[2 * r]),
                    (l[2 * r + 1] = i)),
                  n--)
          }
        })(t, e),
        S(i, o, t.bl_count)
    },
    O = function (t, e, a) {
      var n,
        r,
        i = -1,
        s = e[1],
        _ = 0,
        h = 7,
        l = 4
      for (
        0 === s && ((h = 138), (l = 3)), e[2 * (a + 1) + 1] = 65535, n = 0;
        n <= a;
        n++
      )
        (r = s),
          (s = e[2 * (n + 1) + 1]),
          (++_ < h && r === s) ||
            (_ < l
              ? (t.bl_tree[2 * r] += _)
              : 0 !== r
              ? (r !== i && t.bl_tree[2 * r]++, t.bl_tree[32]++)
              : _ <= 10
              ? t.bl_tree[34]++
              : t.bl_tree[36]++,
            (_ = 0),
            (i = r),
            0 === s
              ? ((h = 138), (l = 3))
              : r === s
              ? ((h = 6), (l = 3))
              : ((h = 7), (l = 4)))
    },
    N = function (t, e, a) {
      var n,
        r,
        i = -1,
        s = e[1],
        _ = 0,
        h = 7,
        l = 4
      for (0 === s && ((h = 138), (l = 3)), n = 0; n <= a; n++)
        if (((r = s), (s = e[2 * (n + 1) + 1]), !(++_ < h && r === s))) {
          if (_ < l)
            do {
              E(t, r, t.bl_tree)
            } while (0 != --_)
          else
            0 !== r
              ? (r !== i && (E(t, r, t.bl_tree), _--),
                E(t, 16, t.bl_tree),
                x(t, _ - 3, 2))
              : _ <= 10
              ? (E(t, 17, t.bl_tree), x(t, _ - 3, 3))
              : (E(t, 18, t.bl_tree), x(t, _ - 11, 7))
          ;(_ = 0),
            (i = r),
            0 === s
              ? ((h = 138), (l = 3))
              : r === s
              ? ((h = 6), (l = 3))
              : ((h = 7), (l = 4))
        }
    },
    D = !1,
    C = function (t, e, a, n) {
      x(t, 0 + (n ? 1 : 0), 3),
        (function (t, e, a, n) {
          R(t),
            n && (A(t, a), A(t, ~a)),
            t.pending_buf.set(t.window.subarray(e, e + a), t.pending),
            (t.pending += a)
        })(t, e, a, !0)
    },
    M = function (t, e, a, n) {
      var i,
        s,
        _ = 0
      t.level > 0
        ? (2 === t.strm.data_type &&
            (t.strm.data_type = (function (t) {
              var e,
                a = 4093624447
              for (e = 0; e <= 31; e++, a >>>= 1)
                if (1 & a && 0 !== t.dyn_ltree[2 * e]) return 0
              if (
                0 !== t.dyn_ltree[18] ||
                0 !== t.dyn_ltree[20] ||
                0 !== t.dyn_ltree[26]
              )
                return 1
              for (e = 32; e < r; e++) if (0 !== t.dyn_ltree[2 * e]) return 1
              return 0
            })(t)),
          I(t, t.l_desc),
          I(t, t.d_desc),
          (_ = (function (t) {
            var e
            for (
              O(t, t.dyn_ltree, t.l_desc.max_code),
                O(t, t.dyn_dtree, t.d_desc.max_code),
                I(t, t.bl_desc),
                e = 18;
              e >= 3 && 0 === t.bl_tree[2 * d[e] + 1];
              e--
            );
            return (t.opt_len += 3 * (e + 1) + 5 + 5 + 4), e
          })(t)),
          (i = (t.opt_len + 3 + 7) >>> 3),
          (s = (t.static_len + 3 + 7) >>> 3) <= i && (i = s))
        : (i = s = a + 5),
        a + 4 <= i && -1 !== e
          ? C(t, e, a, n)
          : 4 === t.strategy || s === i
          ? (x(t, 2 + (n ? 1 : 0), 3), T(t, u, f))
          : (x(t, 4 + (n ? 1 : 0), 3),
            (function (t, e, a, n) {
              var r
              for (
                x(t, e - 257, 5), x(t, a - 1, 5), x(t, n - 4, 4), r = 0;
                r < n;
                r++
              )
                x(t, t.bl_tree[2 * d[r] + 1], 3)
              N(t, t.dyn_ltree, e - 1), N(t, t.dyn_dtree, a - 1)
            })(t, t.l_desc.max_code + 1, t.d_desc.max_code + 1, _ + 1),
            T(t, t.dyn_ltree, t.dyn_dtree)),
        U(t),
        n && R(t)
    },
    B = {
      _tr_init: function (t) {
        D ||
          (!(function () {
            var t,
              e,
              a,
              n,
              r,
              d = new Array(16)
            for (a = 0, n = 0; n < 28; n++)
              for (g[n] = a, t = 0; t < 1 << h[n]; t++) p[a++] = n
            for (p[a - 1] = n, r = 0, n = 0; n < 16; n++)
              for (m[n] = r, t = 0; t < 1 << l[n]; t++) c[r++] = n
            for (r >>= 7; n < s; n++)
              for (m[n] = r << 7, t = 0; t < 1 << (l[n] - 7); t++)
                c[256 + r++] = n
            for (e = 0; e <= _; e++) d[e] = 0
            for (t = 0; t <= 143; ) (u[2 * t + 1] = 8), t++, d[8]++
            for (; t <= 255; ) (u[2 * t + 1] = 9), t++, d[9]++
            for (; t <= 279; ) (u[2 * t + 1] = 7), t++, d[7]++
            for (; t <= 287; ) (u[2 * t + 1] = 8), t++, d[8]++
            for (S(u, 287, d), t = 0; t < s; t++)
              (f[2 * t + 1] = 5), (f[2 * t] = Z(t, 5))
            ;(v = new y(u, h, 257, i, _)),
              (w = new y(f, l, 0, s, _)),
              (b = new y(new Array(0), o, 0, 19, 7))
          })(),
          (D = !0)),
          (t.l_desc = new k(t.dyn_ltree, v)),
          (t.d_desc = new k(t.dyn_dtree, w)),
          (t.bl_desc = new k(t.bl_tree, b)),
          (t.bi_buf = 0),
          (t.bi_valid = 0),
          U(t)
      },
      _tr_stored_block: C,
      _tr_flush_block: M,
      _tr_tally: function (t, e, a) {
        return (
          (t.pending_buf[t.d_buf + 2 * t.last_lit] = (e >>> 8) & 255),
          (t.pending_buf[t.d_buf + 2 * t.last_lit + 1] = 255 & e),
          (t.pending_buf[t.l_buf + t.last_lit] = 255 & a),
          t.last_lit++,
          0 === e
            ? t.dyn_ltree[2 * a]++
            : (t.matches++,
              e--,
              t.dyn_ltree[2 * (p[a] + r + 1)]++,
              t.dyn_dtree[2 * z(e)]++),
          t.last_lit === t.lit_bufsize - 1
        )
      },
      _tr_align: function (t) {
        x(t, 2, 3),
          E(t, 256, u),
          (function (t) {
            16 === t.bi_valid
              ? (A(t, t.bi_buf), (t.bi_buf = 0), (t.bi_valid = 0))
              : t.bi_valid >= 8 &&
                ((t.pending_buf[t.pending++] = 255 & t.bi_buf),
                (t.bi_buf >>= 8),
                (t.bi_valid -= 8))
          })(t)
      }
    },
    H = function (t, e, a, n) {
      for (var r = 65535 & t, i = (t >>> 16) & 65535, s = 0; 0 !== a; ) {
        a -= s = a > 2e3 ? 2e3 : a
        do {
          i = (i + (r = (r + e[n++]) | 0)) | 0
        } while (--s)
        ;(r %= 65521), (i %= 65521)
      }
      return r | (i << 16)
    },
    Y = new Uint32Array(
      (function () {
        for (var t, e = [], a = 0; a < 256; a++) {
          t = a
          for (var n = 0; n < 8; n++)
            t = 1 & t ? 3988292384 ^ (t >>> 1) : t >>> 1
          e[a] = t
        }
        return e
      })()
    ),
    K = function (t, e, a, n) {
      var r = Y,
        i = n + a
      t ^= -1
      for (var s = n; s < i; s++) t = (t >>> 8) ^ r[255 & (t ^ e[s])]
      return ~t
    },
    P = {
      2: 'need dictionary',
      1: 'stream end',
      0: '',
      '-1': 'file error',
      '-2': 'stream error',
      '-3': 'data error',
      '-4': 'insufficient memory',
      '-5': 'buffer error',
      '-6': 'incompatible version'
    },
    j = {
      Z_NO_FLUSH: 0,
      Z_PARTIAL_FLUSH: 1,
      Z_SYNC_FLUSH: 2,
      Z_FULL_FLUSH: 3,
      Z_FINISH: 4,
      Z_BLOCK: 5,
      Z_TREES: 6,
      Z_OK: 0,
      Z_STREAM_END: 1,
      Z_NEED_DICT: 2,
      Z_ERRNO: -1,
      Z_STREAM_ERROR: -2,
      Z_DATA_ERROR: -3,
      Z_MEM_ERROR: -4,
      Z_BUF_ERROR: -5,
      Z_NO_COMPRESSION: 0,
      Z_BEST_SPEED: 1,
      Z_BEST_COMPRESSION: 9,
      Z_DEFAULT_COMPRESSION: -1,
      Z_FILTERED: 1,
      Z_HUFFMAN_ONLY: 2,
      Z_RLE: 3,
      Z_FIXED: 4,
      Z_DEFAULT_STRATEGY: 0,
      Z_BINARY: 0,
      Z_TEXT: 1,
      Z_UNKNOWN: 2,
      Z_DEFLATED: 8
    },
    G = B._tr_init,
    X = B._tr_stored_block,
    W = B._tr_flush_block,
    $ = B._tr_tally,
    q = B._tr_align,
    J = j.Z_NO_FLUSH,
    Q = j.Z_PARTIAL_FLUSH,
    V = j.Z_FULL_FLUSH,
    tt = j.Z_FINISH,
    et = j.Z_BLOCK,
    at = j.Z_OK,
    nt = j.Z_STREAM_END,
    rt = j.Z_STREAM_ERROR,
    it = j.Z_DATA_ERROR,
    st = j.Z_BUF_ERROR,
    _t = j.Z_DEFAULT_COMPRESSION,
    ht = j.Z_FILTERED,
    lt = j.Z_HUFFMAN_ONLY,
    ot = j.Z_RLE,
    dt = j.Z_FIXED,
    ut = j.Z_DEFAULT_STRATEGY,
    ft = j.Z_UNKNOWN,
    ct = j.Z_DEFLATED,
    pt = 258,
    gt = 262,
    vt = 103,
    wt = 113,
    bt = 666,
    mt = function (t, e) {
      return (t.msg = P[e]), e
    },
    yt = function (t) {
      return (t << 1) - (t > 4 ? 9 : 0)
    },
    kt = function (t) {
      for (var e = t.length; --e >= 0; ) t[e] = 0
    },
    zt = function (t, e, a) {
      return ((e << t.hash_shift) ^ a) & t.hash_mask
    },
    At = function (t) {
      var e = t.state,
        a = e.pending
      a > t.avail_out && (a = t.avail_out),
        0 !== a &&
          (t.output.set(
            e.pending_buf.subarray(e.pending_out, e.pending_out + a),
            t.next_out
          ),
          (t.next_out += a),
          (e.pending_out += a),
          (t.total_out += a),
          (t.avail_out -= a),
          (e.pending -= a),
          0 === e.pending && (e.pending_out = 0))
    },
    xt = function (t, e) {
      W(
        t,
        t.block_start >= 0 ? t.block_start : -1,
        t.strstart - t.block_start,
        e
      ),
        (t.block_start = t.strstart),
        At(t.strm)
    },
    Et = function (t, e) {
      t.pending_buf[t.pending++] = e
    },
    Zt = function (t, e) {
      ;(t.pending_buf[t.pending++] = (e >>> 8) & 255),
        (t.pending_buf[t.pending++] = 255 & e)
    },
    St = function (t, e) {
      var a,
        n,
        r = t.max_chain_length,
        i = t.strstart,
        s = t.prev_length,
        _ = t.nice_match,
        h = t.strstart > t.w_size - gt ? t.strstart - (t.w_size - gt) : 0,
        l = t.window,
        o = t.w_mask,
        d = t.prev,
        u = t.strstart + pt,
        f = l[i + s - 1],
        c = l[i + s]
      t.prev_length >= t.good_match && (r >>= 2),
        _ > t.lookahead && (_ = t.lookahead)
      do {
        if (
          l[(a = e) + s] === c &&
          l[a + s - 1] === f &&
          l[a] === l[i] &&
          l[++a] === l[i + 1]
        ) {
          ;(i += 2), a++
          do {} while (
            l[++i] === l[++a] &&
            l[++i] === l[++a] &&
            l[++i] === l[++a] &&
            l[++i] === l[++a] &&
            l[++i] === l[++a] &&
            l[++i] === l[++a] &&
            l[++i] === l[++a] &&
            l[++i] === l[++a] &&
            i < u
          )
          if (((n = pt - (u - i)), (i = u - pt), n > s)) {
            if (((t.match_start = e), (s = n), n >= _)) break
            ;(f = l[i + s - 1]), (c = l[i + s])
          }
        }
      } while ((e = d[e & o]) > h && 0 != --r)
      return s <= t.lookahead ? s : t.lookahead
    },
    Ut = function (t) {
      var e,
        a,
        n,
        r,
        i,
        s,
        _,
        h,
        l,
        o,
        d = t.w_size
      do {
        if (
          ((r = t.window_size - t.lookahead - t.strstart),
          t.strstart >= d + (d - gt))
        ) {
          t.window.set(t.window.subarray(d, d + d), 0),
            (t.match_start -= d),
            (t.strstart -= d),
            (t.block_start -= d),
            (e = a = t.hash_size)
          do {
            ;(n = t.head[--e]), (t.head[e] = n >= d ? n - d : 0)
          } while (--a)
          e = a = d
          do {
            ;(n = t.prev[--e]), (t.prev[e] = n >= d ? n - d : 0)
          } while (--a)
          r += d
        }
        if (0 === t.strm.avail_in) break
        if (
          ((s = t.strm),
          (_ = t.window),
          (h = t.strstart + t.lookahead),
          (l = r),
          (o = void 0),
          (o = s.avail_in) > l && (o = l),
          (a =
            0 === o
              ? 0
              : ((s.avail_in -= o),
                _.set(s.input.subarray(s.next_in, s.next_in + o), h),
                1 === s.state.wrap
                  ? (s.adler = H(s.adler, _, o, h))
                  : 2 === s.state.wrap && (s.adler = K(s.adler, _, o, h)),
                (s.next_in += o),
                (s.total_in += o),
                o)),
          (t.lookahead += a),
          t.lookahead + t.insert >= 3)
        )
          for (
            i = t.strstart - t.insert,
              t.ins_h = t.window[i],
              t.ins_h = zt(t, t.ins_h, t.window[i + 1]);
            t.insert &&
            ((t.ins_h = zt(t, t.ins_h, t.window[i + 3 - 1])),
            (t.prev[i & t.w_mask] = t.head[t.ins_h]),
            (t.head[t.ins_h] = i),
            i++,
            t.insert--,
            !(t.lookahead + t.insert < 3));

          );
      } while (t.lookahead < gt && 0 !== t.strm.avail_in)
    },
    Rt = function (t, e) {
      for (var a, n; ; ) {
        if (t.lookahead < gt) {
          if ((Ut(t), t.lookahead < gt && e === J)) return 1
          if (0 === t.lookahead) break
        }
        if (
          ((a = 0),
          t.lookahead >= 3 &&
            ((t.ins_h = zt(t, t.ins_h, t.window[t.strstart + 3 - 1])),
            (a = t.prev[t.strstart & t.w_mask] = t.head[t.ins_h]),
            (t.head[t.ins_h] = t.strstart)),
          0 !== a &&
            t.strstart - a <= t.w_size - gt &&
            (t.match_length = St(t, a)),
          t.match_length >= 3)
        )
          if (
            ((n = $(t, t.strstart - t.match_start, t.match_length - 3)),
            (t.lookahead -= t.match_length),
            t.match_length <= t.max_lazy_match && t.lookahead >= 3)
          ) {
            t.match_length--
            do {
              t.strstart++,
                (t.ins_h = zt(t, t.ins_h, t.window[t.strstart + 3 - 1])),
                (a = t.prev[t.strstart & t.w_mask] = t.head[t.ins_h]),
                (t.head[t.ins_h] = t.strstart)
            } while (0 != --t.match_length)
            t.strstart++
          } else
            (t.strstart += t.match_length),
              (t.match_length = 0),
              (t.ins_h = t.window[t.strstart]),
              (t.ins_h = zt(t, t.ins_h, t.window[t.strstart + 1]))
        else (n = $(t, 0, t.window[t.strstart])), t.lookahead--, t.strstart++
        if (n && (xt(t, !1), 0 === t.strm.avail_out)) return 1
      }
      return (
        (t.insert = t.strstart < 2 ? t.strstart : 2),
        e === tt
          ? (xt(t, !0), 0 === t.strm.avail_out ? 3 : 4)
          : t.last_lit && (xt(t, !1), 0 === t.strm.avail_out)
          ? 1
          : 2
      )
    },
    Lt = function (t, e) {
      for (var a, n, r; ; ) {
        if (t.lookahead < gt) {
          if ((Ut(t), t.lookahead < gt && e === J)) return 1
          if (0 === t.lookahead) break
        }
        if (
          ((a = 0),
          t.lookahead >= 3 &&
            ((t.ins_h = zt(t, t.ins_h, t.window[t.strstart + 3 - 1])),
            (a = t.prev[t.strstart & t.w_mask] = t.head[t.ins_h]),
            (t.head[t.ins_h] = t.strstart)),
          (t.prev_length = t.match_length),
          (t.prev_match = t.match_start),
          (t.match_length = 2),
          0 !== a &&
            t.prev_length < t.max_lazy_match &&
            t.strstart - a <= t.w_size - gt &&
            ((t.match_length = St(t, a)),
            t.match_length <= 5 &&
              (t.strategy === ht ||
                (3 === t.match_length && t.strstart - t.match_start > 4096)) &&
              (t.match_length = 2)),
          t.prev_length >= 3 && t.match_length <= t.prev_length)
        ) {
          ;(r = t.strstart + t.lookahead - 3),
            (n = $(t, t.strstart - 1 - t.prev_match, t.prev_length - 3)),
            (t.lookahead -= t.prev_length - 1),
            (t.prev_length -= 2)
          do {
            ++t.strstart <= r &&
              ((t.ins_h = zt(t, t.ins_h, t.window[t.strstart + 3 - 1])),
              (a = t.prev[t.strstart & t.w_mask] = t.head[t.ins_h]),
              (t.head[t.ins_h] = t.strstart))
          } while (0 != --t.prev_length)
          if (
            ((t.match_available = 0),
            (t.match_length = 2),
            t.strstart++,
            n && (xt(t, !1), 0 === t.strm.avail_out))
          )
            return 1
        } else if (t.match_available) {
          if (
            ((n = $(t, 0, t.window[t.strstart - 1])) && xt(t, !1),
            t.strstart++,
            t.lookahead--,
            0 === t.strm.avail_out)
          )
            return 1
        } else (t.match_available = 1), t.strstart++, t.lookahead--
      }
      return (
        t.match_available &&
          ((n = $(t, 0, t.window[t.strstart - 1])), (t.match_available = 0)),
        (t.insert = t.strstart < 2 ? t.strstart : 2),
        e === tt
          ? (xt(t, !0), 0 === t.strm.avail_out ? 3 : 4)
          : t.last_lit && (xt(t, !1), 0 === t.strm.avail_out)
          ? 1
          : 2
      )
    }
  function Ft(t, e, a, n, r) {
    ;(this.good_length = t),
      (this.max_lazy = e),
      (this.nice_length = a),
      (this.max_chain = n),
      (this.func = r)
  }
  var Tt = [
    new Ft(0, 0, 0, 0, function (t, e) {
      var a = 65535
      for (a > t.pending_buf_size - 5 && (a = t.pending_buf_size - 5); ; ) {
        if (t.lookahead <= 1) {
          if ((Ut(t), 0 === t.lookahead && e === J)) return 1
          if (0 === t.lookahead) break
        }
        ;(t.strstart += t.lookahead), (t.lookahead = 0)
        var n = t.block_start + a
        if (
          (0 === t.strstart || t.strstart >= n) &&
          ((t.lookahead = t.strstart - n),
          (t.strstart = n),
          xt(t, !1),
          0 === t.strm.avail_out)
        )
          return 1
        if (
          t.strstart - t.block_start >= t.w_size - gt &&
          (xt(t, !1), 0 === t.strm.avail_out)
        )
          return 1
      }
      return (
        (t.insert = 0),
        e === tt
          ? (xt(t, !0), 0 === t.strm.avail_out ? 3 : 4)
          : (t.strstart > t.block_start && (xt(t, !1), t.strm.avail_out), 1)
      )
    }),
    new Ft(4, 4, 8, 4, Rt),
    new Ft(4, 5, 16, 8, Rt),
    new Ft(4, 6, 32, 32, Rt),
    new Ft(4, 4, 16, 16, Lt),
    new Ft(8, 16, 32, 32, Lt),
    new Ft(8, 16, 128, 128, Lt),
    new Ft(8, 32, 128, 256, Lt),
    new Ft(32, 128, 258, 1024, Lt),
    new Ft(32, 258, 258, 4096, Lt)
  ]
  function It() {
    ;(this.strm = null),
      (this.status = 0),
      (this.pending_buf = null),
      (this.pending_buf_size = 0),
      (this.pending_out = 0),
      (this.pending = 0),
      (this.wrap = 0),
      (this.gzhead = null),
      (this.gzindex = 0),
      (this.method = ct),
      (this.last_flush = -1),
      (this.w_size = 0),
      (this.w_bits = 0),
      (this.w_mask = 0),
      (this.window = null),
      (this.window_size = 0),
      (this.prev = null),
      (this.head = null),
      (this.ins_h = 0),
      (this.hash_size = 0),
      (this.hash_bits = 0),
      (this.hash_mask = 0),
      (this.hash_shift = 0),
      (this.block_start = 0),
      (this.match_length = 0),
      (this.prev_match = 0),
      (this.match_available = 0),
      (this.strstart = 0),
      (this.match_start = 0),
      (this.lookahead = 0),
      (this.prev_length = 0),
      (this.max_chain_length = 0),
      (this.max_lazy_match = 0),
      (this.level = 0),
      (this.strategy = 0),
      (this.good_match = 0),
      (this.nice_match = 0),
      (this.dyn_ltree = new Uint16Array(1146)),
      (this.dyn_dtree = new Uint16Array(122)),
      (this.bl_tree = new Uint16Array(78)),
      kt(this.dyn_ltree),
      kt(this.dyn_dtree),
      kt(this.bl_tree),
      (this.l_desc = null),
      (this.d_desc = null),
      (this.bl_desc = null),
      (this.bl_count = new Uint16Array(16)),
      (this.heap = new Uint16Array(573)),
      kt(this.heap),
      (this.heap_len = 0),
      (this.heap_max = 0),
      (this.depth = new Uint16Array(573)),
      kt(this.depth),
      (this.l_buf = 0),
      (this.lit_bufsize = 0),
      (this.last_lit = 0),
      (this.d_buf = 0),
      (this.opt_len = 0),
      (this.static_len = 0),
      (this.matches = 0),
      (this.insert = 0),
      (this.bi_buf = 0),
      (this.bi_valid = 0)
  }
  var Ot = function (t) {
      if (!t || !t.state) return mt(t, rt)
      ;(t.total_in = t.total_out = 0), (t.data_type = ft)
      var e = t.state
      return (
        (e.pending = 0),
        (e.pending_out = 0),
        e.wrap < 0 && (e.wrap = -e.wrap),
        (e.status = e.wrap ? 42 : wt),
        (t.adler = 2 === e.wrap ? 0 : 1),
        (e.last_flush = J),
        G(e),
        at
      )
    },
    Nt = function (t) {
      var e,
        a = Ot(t)
      return (
        a === at &&
          (((e = t.state).window_size = 2 * e.w_size),
          kt(e.head),
          (e.max_lazy_match = Tt[e.level].max_lazy),
          (e.good_match = Tt[e.level].good_length),
          (e.nice_match = Tt[e.level].nice_length),
          (e.max_chain_length = Tt[e.level].max_chain),
          (e.strstart = 0),
          (e.block_start = 0),
          (e.lookahead = 0),
          (e.insert = 0),
          (e.match_length = e.prev_length = 2),
          (e.match_available = 0),
          (e.ins_h = 0)),
        a
      )
    },
    Dt = function (t, e, a, n, r, i) {
      if (!t) return rt
      var s = 1
      if (
        (e === _t && (e = 6),
        n < 0 ? ((s = 0), (n = -n)) : n > 15 && ((s = 2), (n -= 16)),
        r < 1 ||
          r > 9 ||
          a !== ct ||
          n < 8 ||
          n > 15 ||
          e < 0 ||
          e > 9 ||
          i < 0 ||
          i > dt)
      )
        return mt(t, rt)
      8 === n && (n = 9)
      var _ = new It()
      return (
        (t.state = _),
        (_.strm = t),
        (_.wrap = s),
        (_.gzhead = null),
        (_.w_bits = n),
        (_.w_size = 1 << _.w_bits),
        (_.w_mask = _.w_size - 1),
        (_.hash_bits = r + 7),
        (_.hash_size = 1 << _.hash_bits),
        (_.hash_mask = _.hash_size - 1),
        (_.hash_shift = ~~((_.hash_bits + 3 - 1) / 3)),
        (_.window = new Uint8Array(2 * _.w_size)),
        (_.head = new Uint16Array(_.hash_size)),
        (_.prev = new Uint16Array(_.w_size)),
        (_.lit_bufsize = 1 << (r + 6)),
        (_.pending_buf_size = 4 * _.lit_bufsize),
        (_.pending_buf = new Uint8Array(_.pending_buf_size)),
        (_.d_buf = 1 * _.lit_bufsize),
        (_.l_buf = 3 * _.lit_bufsize),
        (_.level = e),
        (_.strategy = i),
        (_.method = a),
        Nt(t)
      )
    },
    Ct = {
      deflateInit: function (t, e) {
        return Dt(t, e, ct, 15, 8, ut)
      },
      deflateInit2: Dt,
      deflateReset: Nt,
      deflateResetKeep: Ot,
      deflateSetHeader: function (t, e) {
        return t && t.state
          ? 2 !== t.state.wrap
            ? rt
            : ((t.state.gzhead = e), at)
          : rt
      },
      deflate: function (t, e) {
        var a, n
        if (!t || !t.state || e > et || e < 0) return t ? mt(t, rt) : rt
        var r = t.state
        if (
          !t.output ||
          (!t.input && 0 !== t.avail_in) ||
          (r.status === bt && e !== tt)
        )
          return mt(t, 0 === t.avail_out ? st : rt)
        r.strm = t
        var i = r.last_flush
        if (((r.last_flush = e), 42 === r.status))
          if (2 === r.wrap)
            (t.adler = 0),
              Et(r, 31),
              Et(r, 139),
              Et(r, 8),
              r.gzhead
                ? (Et(
                    r,
                    (r.gzhead.text ? 1 : 0) +
                      (r.gzhead.hcrc ? 2 : 0) +
                      (r.gzhead.extra ? 4 : 0) +
                      (r.gzhead.name ? 8 : 0) +
                      (r.gzhead.comment ? 16 : 0)
                  ),
                  Et(r, 255 & r.gzhead.time),
                  Et(r, (r.gzhead.time >> 8) & 255),
                  Et(r, (r.gzhead.time >> 16) & 255),
                  Et(r, (r.gzhead.time >> 24) & 255),
                  Et(
                    r,
                    9 === r.level ? 2 : r.strategy >= lt || r.level < 2 ? 4 : 0
                  ),
                  Et(r, 255 & r.gzhead.os),
                  r.gzhead.extra &&
                    r.gzhead.extra.length &&
                    (Et(r, 255 & r.gzhead.extra.length),
                    Et(r, (r.gzhead.extra.length >> 8) & 255)),
                  r.gzhead.hcrc &&
                    (t.adler = K(t.adler, r.pending_buf, r.pending, 0)),
                  (r.gzindex = 0),
                  (r.status = 69))
                : (Et(r, 0),
                  Et(r, 0),
                  Et(r, 0),
                  Et(r, 0),
                  Et(r, 0),
                  Et(
                    r,
                    9 === r.level ? 2 : r.strategy >= lt || r.level < 2 ? 4 : 0
                  ),
                  Et(r, 3),
                  (r.status = wt))
          else {
            var s = (ct + ((r.w_bits - 8) << 4)) << 8
            ;(s |=
              (r.strategy >= lt || r.level < 2
                ? 0
                : r.level < 6
                ? 1
                : 6 === r.level
                ? 2
                : 3) << 6),
              0 !== r.strstart && (s |= 32),
              (s += 31 - (s % 31)),
              (r.status = wt),
              Zt(r, s),
              0 !== r.strstart &&
                (Zt(r, t.adler >>> 16), Zt(r, 65535 & t.adler)),
              (t.adler = 1)
          }
        if (69 === r.status)
          if (r.gzhead.extra) {
            for (
              a = r.pending;
              r.gzindex < (65535 & r.gzhead.extra.length) &&
              (r.pending !== r.pending_buf_size ||
                (r.gzhead.hcrc &&
                  r.pending > a &&
                  (t.adler = K(t.adler, r.pending_buf, r.pending - a, a)),
                At(t),
                (a = r.pending),
                r.pending !== r.pending_buf_size));

            )
              Et(r, 255 & r.gzhead.extra[r.gzindex]), r.gzindex++
            r.gzhead.hcrc &&
              r.pending > a &&
              (t.adler = K(t.adler, r.pending_buf, r.pending - a, a)),
              r.gzindex === r.gzhead.extra.length &&
                ((r.gzindex = 0), (r.status = 73))
          } else r.status = 73
        if (73 === r.status)
          if (r.gzhead.name) {
            a = r.pending
            do {
              if (
                r.pending === r.pending_buf_size &&
                (r.gzhead.hcrc &&
                  r.pending > a &&
                  (t.adler = K(t.adler, r.pending_buf, r.pending - a, a)),
                At(t),
                (a = r.pending),
                r.pending === r.pending_buf_size)
              ) {
                n = 1
                break
              }
              ;(n =
                r.gzindex < r.gzhead.name.length
                  ? 255 & r.gzhead.name.charCodeAt(r.gzindex++)
                  : 0),
                Et(r, n)
            } while (0 !== n)
            r.gzhead.hcrc &&
              r.pending > a &&
              (t.adler = K(t.adler, r.pending_buf, r.pending - a, a)),
              0 === n && ((r.gzindex = 0), (r.status = 91))
          } else r.status = 91
        if (91 === r.status)
          if (r.gzhead.comment) {
            a = r.pending
            do {
              if (
                r.pending === r.pending_buf_size &&
                (r.gzhead.hcrc &&
                  r.pending > a &&
                  (t.adler = K(t.adler, r.pending_buf, r.pending - a, a)),
                At(t),
                (a = r.pending),
                r.pending === r.pending_buf_size)
              ) {
                n = 1
                break
              }
              ;(n =
                r.gzindex < r.gzhead.comment.length
                  ? 255 & r.gzhead.comment.charCodeAt(r.gzindex++)
                  : 0),
                Et(r, n)
            } while (0 !== n)
            r.gzhead.hcrc &&
              r.pending > a &&
              (t.adler = K(t.adler, r.pending_buf, r.pending - a, a)),
              0 === n && (r.status = vt)
          } else r.status = vt
        if (
          (r.status === vt &&
            (r.gzhead.hcrc
              ? (r.pending + 2 > r.pending_buf_size && At(t),
                r.pending + 2 <= r.pending_buf_size &&
                  (Et(r, 255 & t.adler),
                  Et(r, (t.adler >> 8) & 255),
                  (t.adler = 0),
                  (r.status = wt)))
              : (r.status = wt)),
          0 !== r.pending)
        ) {
          if ((At(t), 0 === t.avail_out)) return (r.last_flush = -1), at
        } else if (0 === t.avail_in && yt(e) <= yt(i) && e !== tt)
          return mt(t, st)
        if (r.status === bt && 0 !== t.avail_in) return mt(t, st)
        if (
          0 !== t.avail_in ||
          0 !== r.lookahead ||
          (e !== J && r.status !== bt)
        ) {
          var _ =
            r.strategy === lt
              ? (function (t, e) {
                  for (var a; ; ) {
                    if (0 === t.lookahead && (Ut(t), 0 === t.lookahead)) {
                      if (e === J) return 1
                      break
                    }
                    if (
                      ((t.match_length = 0),
                      (a = $(t, 0, t.window[t.strstart])),
                      t.lookahead--,
                      t.strstart++,
                      a && (xt(t, !1), 0 === t.strm.avail_out))
                    )
                      return 1
                  }
                  return (
                    (t.insert = 0),
                    e === tt
                      ? (xt(t, !0), 0 === t.strm.avail_out ? 3 : 4)
                      : t.last_lit && (xt(t, !1), 0 === t.strm.avail_out)
                      ? 1
                      : 2
                  )
                })(r, e)
              : r.strategy === ot
              ? (function (t, e) {
                  for (var a, n, r, i, s = t.window; ; ) {
                    if (t.lookahead <= pt) {
                      if ((Ut(t), t.lookahead <= pt && e === J)) return 1
                      if (0 === t.lookahead) break
                    }
                    if (
                      ((t.match_length = 0),
                      t.lookahead >= 3 &&
                        t.strstart > 0 &&
                        (n = s[(r = t.strstart - 1)]) === s[++r] &&
                        n === s[++r] &&
                        n === s[++r])
                    ) {
                      i = t.strstart + pt
                      do {} while (
                        n === s[++r] &&
                        n === s[++r] &&
                        n === s[++r] &&
                        n === s[++r] &&
                        n === s[++r] &&
                        n === s[++r] &&
                        n === s[++r] &&
                        n === s[++r] &&
                        r < i
                      )
                      ;(t.match_length = pt - (i - r)),
                        t.match_length > t.lookahead &&
                          (t.match_length = t.lookahead)
                    }
                    if (
                      (t.match_length >= 3
                        ? ((a = $(t, 1, t.match_length - 3)),
                          (t.lookahead -= t.match_length),
                          (t.strstart += t.match_length),
                          (t.match_length = 0))
                        : ((a = $(t, 0, t.window[t.strstart])),
                          t.lookahead--,
                          t.strstart++),
                      a && (xt(t, !1), 0 === t.strm.avail_out))
                    )
                      return 1
                  }
                  return (
                    (t.insert = 0),
                    e === tt
                      ? (xt(t, !0), 0 === t.strm.avail_out ? 3 : 4)
                      : t.last_lit && (xt(t, !1), 0 === t.strm.avail_out)
                      ? 1
                      : 2
                  )
                })(r, e)
              : Tt[r.level].func(r, e)
          if (((3 !== _ && 4 !== _) || (r.status = bt), 1 === _ || 3 === _))
            return 0 === t.avail_out && (r.last_flush = -1), at
          if (
            2 === _ &&
            (e === Q
              ? q(r)
              : e !== et &&
                (X(r, 0, 0, !1),
                e === V &&
                  (kt(r.head),
                  0 === r.lookahead &&
                    ((r.strstart = 0), (r.block_start = 0), (r.insert = 0)))),
            At(t),
            0 === t.avail_out)
          )
            return (r.last_flush = -1), at
        }
        return e !== tt
          ? at
          : r.wrap <= 0
          ? nt
          : (2 === r.wrap
              ? (Et(r, 255 & t.adler),
                Et(r, (t.adler >> 8) & 255),
                Et(r, (t.adler >> 16) & 255),
                Et(r, (t.adler >> 24) & 255),
                Et(r, 255 & t.total_in),
                Et(r, (t.total_in >> 8) & 255),
                Et(r, (t.total_in >> 16) & 255),
                Et(r, (t.total_in >> 24) & 255))
              : (Zt(r, t.adler >>> 16), Zt(r, 65535 & t.adler)),
            At(t),
            r.wrap > 0 && (r.wrap = -r.wrap),
            0 !== r.pending ? at : nt)
      },
      deflateEnd: function (t) {
        if (!t || !t.state) return rt
        var e = t.state.status
        return 42 !== e &&
          69 !== e &&
          73 !== e &&
          91 !== e &&
          e !== vt &&
          e !== wt &&
          e !== bt
          ? mt(t, rt)
          : ((t.state = null), e === wt ? mt(t, it) : at)
      },
      deflateSetDictionary: function (t, e) {
        var a = e.length
        if (!t || !t.state) return rt
        var n = t.state,
          r = n.wrap
        if (2 === r || (1 === r && 42 !== n.status) || n.lookahead) return rt
        if (
          (1 === r && (t.adler = H(t.adler, e, a, 0)),
          (n.wrap = 0),
          a >= n.w_size)
        ) {
          0 === r &&
            (kt(n.head), (n.strstart = 0), (n.block_start = 0), (n.insert = 0))
          var i = new Uint8Array(n.w_size)
          i.set(e.subarray(a - n.w_size, a), 0), (e = i), (a = n.w_size)
        }
        var s = t.avail_in,
          _ = t.next_in,
          h = t.input
        for (
          t.avail_in = a, t.next_in = 0, t.input = e, Ut(n);
          n.lookahead >= 3;

        ) {
          var l = n.strstart,
            o = n.lookahead - 2
          do {
            ;(n.ins_h = zt(n, n.ins_h, n.window[l + 3 - 1])),
              (n.prev[l & n.w_mask] = n.head[n.ins_h]),
              (n.head[n.ins_h] = l),
              l++
          } while (--o)
          ;(n.strstart = l), (n.lookahead = 2), Ut(n)
        }
        return (
          (n.strstart += n.lookahead),
          (n.block_start = n.strstart),
          (n.insert = n.lookahead),
          (n.lookahead = 0),
          (n.match_length = n.prev_length = 2),
          (n.match_available = 0),
          (t.next_in = _),
          (t.input = h),
          (t.avail_in = s),
          (n.wrap = r),
          at
        )
      },
      deflateInfo: 'pako deflate (from Nodeca project)'
    }
  for (var Mt = new Uint8Array(256), Bt = 0; Bt < 256; Bt++)
    Mt[Bt] =
      Bt >= 252
        ? 6
        : Bt >= 248
        ? 5
        : Bt >= 240
        ? 4
        : Bt >= 224
        ? 3
        : Bt >= 192
        ? 2
        : 1
  Mt[254] = Mt[254] = 1
  var Ht = function () {
      ;(this.input = null),
        (this.next_in = 0),
        (this.avail_in = 0),
        (this.total_in = 0),
        (this.output = null),
        (this.next_out = 0),
        (this.avail_out = 0),
        (this.total_out = 0),
        (this.msg = ''),
        (this.state = null),
        (this.data_type = 2),
        (this.adler = 0)
    },
    Yt = Object.prototype.toString,
    Kt = j.Z_NO_FLUSH,
    Pt = j.Z_SYNC_FLUSH,
    jt = j.Z_FULL_FLUSH,
    Gt = j.Z_FINISH,
    Xt = j.Z_OK,
    Wt = j.Z_STREAM_END,
    $t = j.Z_DEFAULT_COMPRESSION,
    qt = j.Z_DEFAULT_STRATEGY,
    Jt = j.Z_DEFLATED
  function Qt() {
    this.options = {
      level: $t,
      method: Jt,
      chunkSize: 16384,
      windowBits: 15,
      memLevel: 8,
      strategy: qt
    }
    var t = this.options
    t.raw && t.windowBits > 0
      ? (t.windowBits = -t.windowBits)
      : t.gzip && t.windowBits > 0 && t.windowBits < 16 && (t.windowBits += 16),
      (this.err = 0),
      (this.msg = ''),
      (this.ended = !1),
      (this.chunks = []),
      (this.strm = new Ht()),
      (this.strm.avail_out = 0)
    var e = Ct.deflateInit2(
      this.strm,
      t.level,
      t.method,
      t.windowBits,
      t.memLevel,
      t.strategy
    )
    if (e !== Xt) throw new Error(P[e])
    if ((t.header && Ct.deflateSetHeader(this.strm, t.header), t.dictionary)) {
      var a
      if (
        ((a =
          '[object ArrayBuffer]' === Yt.call(t.dictionary)
            ? new Uint8Array(t.dictionary)
            : t.dictionary),
        (e = Ct.deflateSetDictionary(this.strm, a)) !== Xt)
      )
        throw new Error(P[e])
      this._dict_set = !0
    }
  }
  function Vt(t, e, a) {
    try {
      t.postMessage({ type: 'errored', error: e, streamId: a })
    } catch (n) {
      t.postMessage({ type: 'errored', error: String(e), streamId: a })
    }
  }
  function te(t) {
    var e = t.strm.adler
    return new Uint8Array([
      3,
      0,
      (e >>> 24) & 255,
      (e >>> 16) & 255,
      (e >>> 8) & 255,
      255 & e
    ])
  }
  ;(Qt.prototype.push = function (t, e) {
    var a,
      n,
      r = this.strm,
      i = this.options.chunkSize
    if (this.ended) return !1
    for (
      n = e === ~~e ? e : !0 === e ? Gt : Kt,
        '[object ArrayBuffer]' === Yt.call(t)
          ? (r.input = new Uint8Array(t))
          : (r.input = t),
        r.next_in = 0,
        r.avail_in = r.input.length;
      ;

    )
      if (
        (0 === r.avail_out &&
          ((r.output = new Uint8Array(i)), (r.next_out = 0), (r.avail_out = i)),
        (n === Pt || n === jt) && r.avail_out <= 6)
      )
        this.onData(r.output.subarray(0, r.next_out)), (r.avail_out = 0)
      else {
        if ((a = Ct.deflate(r, n)) === Wt)
          return (
            r.next_out > 0 && this.onData(r.output.subarray(0, r.next_out)),
            (a = Ct.deflateEnd(this.strm)),
            this.onEnd(a),
            (this.ended = !0),
            a === Xt
          )
        if (0 !== r.avail_out) {
          if (n > 0 && r.next_out > 0)
            this.onData(r.output.subarray(0, r.next_out)), (r.avail_out = 0)
          else if (0 === r.avail_in) break
        } else this.onData(r.output)
      }
    return !0
  }),
    (Qt.prototype.onData = function (t) {
      this.chunks.push(t)
    }),
    (Qt.prototype.onEnd = function (t) {
      t === Xt &&
        (this.result = (function (t) {
          for (var e = 0, a = 0, n = t.length; a < n; a++) e += t[a].length
          for (
            var r = new Uint8Array(e), i = 0, s = 0, _ = t.length;
            i < _;
            i++
          ) {
            var h = t[i]
            r.set(h, s), (s += h.length)
          }
          return r
        })(this.chunks)),
        (this.chunks = []),
        (this.err = t),
        (this.msg = this.strm.msg)
    }),
    (function (t) {
      void 0 === t && (t = self)
      try {
        var e = new Map()
        t.addEventListener('message', function (n) {
          try {
            var r = (function (t, e) {
              switch (e.action) {
                case 'init':
                  return { type: 'initialized', version: '3.1.23' }
                case 'write':
                  var n = t.get(e.streamId)
                  n || ((n = new Qt()), t.set(e.streamId, n))
                  var r = n.chunks.length,
                    i = (function (t) {
                      if (
                        'function' == typeof TextEncoder &&
                        TextEncoder.prototype.encode
                      )
                        return new TextEncoder().encode(t)
                      let e,
                        a,
                        n,
                        r,
                        i,
                        s = t.length,
                        _ = 0
                      for (r = 0; r < s; r++)
                        (a = t.charCodeAt(r)),
                          55296 == (64512 & a) &&
                            r + 1 < s &&
                            ((n = t.charCodeAt(r + 1)),
                            56320 == (64512 & n) &&
                              ((a = 65536 + ((a - 55296) << 10) + (n - 56320)),
                              r++)),
                          (_ += a < 128 ? 1 : a < 2048 ? 2 : a < 65536 ? 3 : 4)
                      for (e = new Uint8Array(_), i = 0, r = 0; i < _; r++)
                        (a = t.charCodeAt(r)),
                          55296 == (64512 & a) &&
                            r + 1 < s &&
                            ((n = t.charCodeAt(r + 1)),
                            56320 == (64512 & n) &&
                              ((a = 65536 + ((a - 55296) << 10) + (n - 56320)),
                              r++)),
                          a < 128
                            ? (e[i++] = a)
                            : a < 2048
                            ? ((e[i++] = 192 | (a >>> 6)),
                              (e[i++] = 128 | (63 & a)))
                            : a < 65536
                            ? ((e[i++] = 224 | (a >>> 12)),
                              (e[i++] = 128 | ((a >>> 6) & 63)),
                              (e[i++] = 128 | (63 & a)))
                            : ((e[i++] = 240 | (a >>> 18)),
                              (e[i++] = 128 | ((a >>> 12) & 63)),
                              (e[i++] = 128 | ((a >>> 6) & 63)),
                              (e[i++] = 128 | (63 & a)))
                      return e
                    })(e.data)
                  return (
                    n.push(i, j.Z_SYNC_FLUSH),
                    {
                      type: 'wrote',
                      id: e.id,
                      streamId: e.streamId,
                      result: a(n.chunks.slice(r)),
                      trailer: te(n),
                      additionalBytesCount: i.length
                    }
                  )
                case 'reset':
                  t.delete(e.streamId)
              }
            })(e, n.data)
            r && t.postMessage(r)
          } catch (e) {
            Vt(t, e, n.data && 'streamId' in n.data ? n.data.streamId : void 0)
          }
        })
      } catch (e) {
        Vt(t, e)
      }
    })()
})()
