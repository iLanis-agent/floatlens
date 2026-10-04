(function (root) {
  'use strict';
  // IEEE 754 binary32 / binary64 from exact rational arithmetic (BigInt). No use of JS Number conversion.
  var FORMATS = {
    f64: { name: 'binary64 (double)', p: 53, ebits: 11, bias: 1023, emax: 1023, emin: -1022 },
    f32: { name: 'binary32 (float)', p: 24, ebits: 8, bias: 127, emax: 127, emin: -126 }
  };
  function bitlen(n) { return n === 0n ? 0 : n.toString(2).length; }
  function pow10(k) { return 10n ** BigInt(k); }

  // Parse a finite decimal string into an exact rational {neg, n, d}. Returns {error} on bad input.
  function parseDecimal(str) {
    var s = String(str).trim().replace(/_/g, '');
    var m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) return { error: 'Not a decimal number. Use digits with an optional point and exponent, like 0.1, -2.5e-8 or 9007199254740993.' };
    var ip = m[2] || '', fp = m[3] || '', ex = m[4] ? parseInt(m[4], 10) : 0;
    if (Math.abs(ex) > 100000) return { error: 'Exponent too large for this tool (limit 100000).' };
    var digits = BigInt((ip + fp) || '0'), scale = ex - fp.length, n = digits, d = 1n;
    if (scale >= 0) n = digits * pow10(scale); else d = pow10(-scale);
    return { neg: m[1] === '-', n: n, d: d };
  }
  // Round positive rational n/d to the format: nearest, ties to even. Returns {kind, m, q} with value m * 2^q.
  function roundRational(n, d, F) {
    if (n === 0n) return { kind: 'zero', m: 0n, q: F.emin - (F.p - 1) };
    var e = bitlen(n) - bitlen(d); // floor(log2(n/d)) is e or e-1
    // adjust so that 2^e <= n/d < 2^(e+1)
    if (e >= 0) { if (n < d * (1n << BigInt(e))) e--; } else { if (n * (1n << BigInt(-e)) < d) e--; }
    var q = Math.max(e, F.emin) - (F.p - 1), N = n, D = d;
    if (q >= 0) D = d * (1n << BigInt(q)); else N = n * (1n << BigInt(-q));
    var m = N / D, r = N % D, twice = 2n * r;
    if (twice > D || (twice === D && (m & 1n) === 1n)) m++;
    if (m >= (1n << BigInt(F.p))) { m = m >> 1n; q++; }
    if (m === 0n) return { kind: 'zero', m: 0n, q: F.emin - (F.p - 1) };
    if (q + F.p - 1 > F.emax) return { kind: 'inf', m: 0n, q: 0 };
    return { kind: 'finite', m: m, q: q };
  }
  function qmin(F) { return F.emin - (F.p - 1); }
  function classify(v, F) {
    if (v.kind === 'zero') return 'zero'; if (v.kind === 'inf') return 'infinity';
    return v.m < (1n << BigInt(F.p - 1)) ? 'subnormal' : 'normal';
  }
  // bits as a BigInt of width 1 + ebits + (p-1)
  function toBits(v, neg, F) {
    var fb = F.p - 1, bits;
    if (v.kind === 'zero') bits = 0n;
    else if (v.kind === 'inf') bits = ((1n << BigInt(F.ebits)) - 1n) << BigInt(fb);
    else if (v.m < (1n << BigInt(fb))) bits = v.m; // subnormal
    else bits = (BigInt(v.q + fb + F.bias) << BigInt(fb)) | (v.m - (1n << BigInt(fb)));
    return neg ? bits | (1n << BigInt(F.ebits + fb)) : bits;
  }
  function fromBits(bits, F) {
    var fb = F.p - 1, neg = ((bits >> BigInt(F.ebits + fb)) & 1n) === 1n, ex = Number((bits >> BigInt(fb)) & ((1n << BigInt(F.ebits)) - 1n)), fr = bits & ((1n << BigInt(fb)) - 1n);
    if (ex === (1 << F.ebits) - 1) return { neg: neg, kind: fr === 0n ? 'inf' : 'nan', m: 0n, q: 0 };
    if (ex === 0) return { neg: neg, kind: fr === 0n ? 'zero' : 'finite', m: fr, q: qmin(F) };
    return { neg: neg, kind: 'finite', m: fr + (1n << BigInt(fb)), q: ex - F.bias - fb };
  }
  // exact decimal expansion of m * 2^q (no trailing zeros), as {int, frac}
  function exactDecimal(m, q) {
    if (m === 0n) return '0';
    if (q >= 0) return (m << BigInt(q)).toString();
    var k = -q, num = m * (5n ** BigInt(k)), s = num.toString();
    while (s.length <= k) s = '0' + s;
    var ip = s.slice(0, s.length - k), fp = s.slice(s.length - k).replace(/0+$/, '');
    return fp ? ip + '.' + fp : ip;
  }
  // shortest digit string (<= maxDigits) that rounds back to the same value; closest to the exact value among that length
  function shortest(v, F) {
    if (v.kind !== 'finite') return { digits: '0', exp10: 0 };
    var n, d; if (v.q >= 0) { n = v.m << BigInt(v.q); d = 1n; } else { n = v.m; d = 1n << BigInt(-v.q); }
    // decimal exponent e10 with 10^e10 <= n/d < 10^(e10+1)
    var e10 = Math.floor(((bitlen(n) - bitlen(d)) * Math.LN2) / Math.LN10);
    function ge(x) { return x >= 0 ? n >= d * pow10(x) : n * pow10(-x) >= d; }
    while (!ge(e10)) e10--; while (ge(e10 + 1)) e10++;
    for (var k = 1; k <= 25; k++) {
      // scaled = n/d * 10^(k-1-e10) rounded to nearest integer (half up is fine, ties are measure zero for shortest)
      var sh = k - 1 - e10, N = n, D = d;
      if (sh >= 0) N = n * pow10(sh); else D = d * pow10(-sh);
      var c = N / D, r = N % D; if (2n * r >= D) c++;
      var ex = e10; if (c >= pow10(k)) { c = c / 10n; ex++; }
      // candidate = c * 10^(ex-k+1); does it parse back to v?
      var cn = c, cd = 1n, sc = ex - k + 1; if (sc >= 0) cn = c * pow10(sc); else cd = pow10(-sc);
      var back = roundRational(cn, cd, F);
      if (back.kind === v.kind && back.m === v.m && back.q === v.q) return { digits: c.toString(), exp10: ex };
    }
    return { digits: '?', exp10: 0 };
  }
  function sciString(sh, neg) {
    var dg = sh.digits, e = sh.exp10, body;
    if (dg === '0') body = '0';
    else if (e >= -6 && e < 21) { // plain decimal
      if (e >= dg.length - 1) body = dg + new Array(e - dg.length + 2).join('0');
      else if (e >= 0) body = dg.slice(0, e + 1) + '.' + dg.slice(e + 1);
      else body = '0.' + new Array(-e).join('0') + dg;
    } else body = dg[0] + (dg.length > 1 ? '.' + dg.slice(1) : '') + 'e' + (e < 0 ? '-' : '+') + Math.abs(e);
    return (neg ? '-' : '') + body;
  }
  function valueString(v, neg, F) { // shortest round-trip form
    if (v.kind === 'inf') return neg ? '-Infinity' : 'Infinity';
    if (v.kind === 'zero') return neg ? '-0' : '0';
    return sciString(shortest(v, F), neg);
  }
  function next(v, F) { // next larger magnitude
    var m = v.m + 1n, q = v.q;
    if (v.kind === 'zero') return { kind: 'finite', m: 1n, q: qmin(F) };
    if (m >= (1n << BigInt(F.p))) { m >>= 1n; q++; }
    if (q + F.p - 1 > F.emax) return { kind: 'inf', m: 0n, q: 0 };
    return { kind: 'finite', m: m, q: q };
  }
  function prev(v, F) { // next smaller magnitude
    if (v.kind === 'inf') return { kind: 'finite', m: (1n << BigInt(F.p)) - 1n, q: F.emax - (F.p - 1) };
    if (v.kind === 'zero') return null;
    if (v.m === 1n && v.q === qmin(F)) return { kind: 'zero', m: 0n, q: qmin(F) };
    if (v.m === (1n << BigInt(F.p - 1)) && v.q > qmin(F)) return { kind: 'finite', m: (1n << BigInt(F.p)) - 1n, q: v.q - 1 };
    return { kind: 'finite', m: v.m - 1n, q: v.q };
  }
  function hexBits(bits, F) { var w = (1 + F.ebits + F.p - 1) / 4; var s = bits.toString(16).toUpperCase(); while (s.length < w) s = '0' + s; return '0x' + s; }
  function binParts(bits, F) {
    var fb = F.p - 1, s = bits.toString(2); while (s.length < 1 + F.ebits + fb) s = '0' + s;
    return { sign: s.slice(0, 1), exp: s.slice(1, 1 + F.ebits), frac: s.slice(1 + F.ebits) };
  }
  // difference between exact decimal input (n/d) and the stored value m*2^q, as signed decimal string (exact, may be long)
  function errorString(n, d, v) {
    if (v.kind !== 'finite') return null;
    var vn, vd; if (v.q >= 0) { vn = v.m << BigInt(v.q); vd = 1n; } else { vn = v.m; vd = 1n << BigInt(-v.q); }
    var num = vn * d - n * vd, den = vd * d; // stored - input
    return { sign: num < 0n ? -1 : num > 0n ? 1 : 0, num: num < 0n ? -num : num, den: den };
  }
  function ratioToSci(num, den, digits) {
    if (num === 0n) return '0';
    var e10 = Math.floor(((bitlen(num) - bitlen(den)) * Math.LN2) / Math.LN10);
    function ge(x) { return x >= 0 ? num >= den * pow10(x) : num * pow10(-x) >= den; }
    while (!ge(e10)) e10--; while (ge(e10 + 1)) e10++;
    var sh = digits - 1 - e10, N = num, D = den; if (sh >= 0) N = num * pow10(sh); else D = den * pow10(-sh);
    var c = N / D; if (2n * (N % D) >= D) c++; var s = c.toString(); if (s.length > digits) { s = s.slice(0, digits); e10++; }
    return s[0] + (s.length > 1 ? '.' + s.slice(1) : '') + 'e' + (e10 < 0 ? '-' : '+') + Math.abs(e10);
  }
  function analyze(str, fmtId) {
    var F = FORMATS[fmtId], p = parseDecimal(str);
    if (p.error) return p;
    var v = roundRational(p.n, p.d, F), bits = toBits(v, p.neg, F), out = { format: F.name, fmtId: fmtId, neg: p.neg, kind: classify(v, F), v: v };
    out.hex = hexBits(bits, F); out.bits = binParts(bits, F); out.bitsInt = bits;
    out.shortest = valueString(v, p.neg, F);
    if (v.kind === 'finite') {
      out.exact = (p.neg ? '-' : '') + exactDecimal(v.m, v.q);
      var er = errorString(p.n, p.d, v); out.errSign = er.sign; out.errSci = er.sign === 0 ? '0' : ratioToSci(er.num, er.den, 4);
      out.exactMatch = er.sign === 0;
      out.ulpExp = v.q; out.ulpSci = v.q >= 0 ? ratioToSci(1n << BigInt(v.q), 1n, 4) : ratioToSci(1n, 1n << BigInt(-v.q), 4);
      var nx = next(v, F), pv = prev(v, F);
      out.nextUp = valueString(nx, p.neg, F); out.nextDown = pv ? valueString(pv, p.neg, F) : null; // "up"/"down" in magnitude
      out.significand = v.m.toString(2);
    } else if (v.kind === 'inf') { out.exact = null; out.overflow = true; }
    else out.exact = '0';
    return out;
  }
  // arithmetic on two decimal inputs read as binary64 values, result rounded once (IEEE correctly-rounded op)
  function toRat(v, neg) { if (v.kind === 'zero') return { s: 1n, n: 0n, d: 1n }; var n, d; if (v.q >= 0) { n = v.m << BigInt(v.q); d = 1n; } else { n = v.m; d = 1n << BigInt(-v.q); } return { s: neg ? -1n : 1n, n: n, d: d }; }
  function arith(aStr, op, bStr, fmtId) {
    var F = FORMATS[fmtId], pa = parseDecimal(aStr), pb = parseDecimal(bStr);
    if (pa.error) return { error: 'First number: ' + pa.error }; if (pb.error) return { error: 'Second number: ' + pb.error };
    var va = roundRational(pa.n, pa.d, F), vb = roundRational(pb.n, pb.d, F);
    if (va.kind === 'inf' || vb.kind === 'inf') return { error: 'An input overflows to infinity in this format. Use smaller numbers.' };
    var A = toRat(va, pa.neg), B = toRat(vb, pb.neg), sn, sd;
    // signed numerator over denominator: exact real result of the operation on the two stored values
    var an = A.s * A.n, bn = B.s * B.n;
    if (op === '+') { sn = an * B.d + bn * A.d; sd = A.d * B.d; }
    else if (op === '-') { sn = an * B.d - bn * A.d; sd = A.d * B.d; }
    else if (op === '*') { sn = an * bn; sd = A.d * B.d; }
    else if (op === '/') { if (bn === 0n) return { error: 'Division by zero gives Infinity or NaN; try another divisor.' }; sn = an * B.d; sd = A.d * bn; }
    else return { error: 'Operator must be + - * or /.' };
    if (sd < 0n) { sd = -sd; sn = -sn; }
    var neg = sn < 0n, mag = neg ? -sn : sn, v = roundRational(mag, sd, F), bits = toBits(v, neg, F);
    var r = { a: valueString(va, pa.neg, F), b: valueString(vb, pb.neg, F), result: valueString(v, neg, F), hex: hexBits(bits, F), kind: classify(v, F) };
    r.exactReal = mag === 0n ? '0' : (neg ? '-' : '') + ratioToSci(mag, sd, 20);
    if (v.kind === 'finite') {
      var er = errorString(mag, sd, v); r.errSci = er.sign === 0 ? '0' : (er.sign < 0 ? '-' : '+') + ratioToSci(er.num, er.den, 3);
      var ulpN = v.q >= 0 ? 1n << BigInt(v.q) : 1n, ulpD = v.q >= 0 ? 1n : 1n << BigInt(-v.q);
      r.errUlps = er.sign === 0 ? '0' : ratioToSci(er.num * ulpD, er.den * ulpN, 2);
    }
    r.exactResult = v.kind === 'finite' ? (neg ? '-' : '') + exactDecimal(v.m, v.q) : null;
    return r;
  }
  var api = { FORMATS: FORMATS, parseDecimal: parseDecimal, roundRational: roundRational, analyze: analyze, arith: arith, toBits: toBits, fromBits: fromBits, exactDecimal: exactDecimal, shortest: shortest, valueString: valueString, next: next, prev: prev, classify: classify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FloatLens = api;
})(typeof window !== 'undefined' ? window : this);
