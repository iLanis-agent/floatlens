'use strict';
var F = require('./engine.js'), assert = require('assert'), n = 0, fails = 0;
function eq(a, b, m) { n++; try { assert.deepStrictEqual(a, b); } catch (e) { fails++; console.log('FAIL', m, String(a), String(b)); } }
function hex64(s) { return F.analyze(s, 'f64').hex; } function hex32(s) { return F.analyze(s, 'f32').hex; }
// Wikipedia worked examples, binary64
eq(hex64('5'), '0x4014000000000000', 'w64 5'); eq(hex64('6'), '0x4018000000000000', 'w64 6'); eq(hex64('23'), '0x4037000000000000', 'w64 23');
eq(hex64('0.01171875'), '0x3F88000000000000', 'w64 3/256'); eq(hex64('2'), '0x4000000000000000', 'w64 2'); eq(hex64('1'), '0x3FF0000000000000', 'w64 1');
eq(hex64('4.9406564584124654e-324'), '0x0000000000000001', 'w64 smallest subnormal'); eq(F.analyze('4.9406564584124654e-324', 'f64').kind, 'subnormal', 'subnormal class');
eq(hex64('2.2250738585072014e-308'), '0x0010000000000000', 'w64 smallest normal'); eq(hex64('1.7976931348623157e308'), '0x7FEFFFFFFFFFFFFF', 'w64 largest');
eq(F.analyze('1.7976931348623159e308', 'f64').kind, 'infinity', 'just above the overflow threshold is infinity');
eq(F.analyze('1.7976931348623158e308', 'f64').hex, '0x7FEFFFFFFFFFFFFF', 'below the overflow threshold rounds to max');
eq(hex64('-0'), '0x8000000000000000', 'w64 -0'); eq(hex64('0'), '0x0000000000000000', 'w64 +0');
eq(hex64('0.1'), '0x3FB999999999999A', 'w64 0.1'); eq(F.analyze('0.1', 'f64').exact, '0.1000000000000000055511151231257827021181583404541015625', 'exact 0.1');
// binary32 notable cases
eq(hex32('1.4012984643e-45'), '0x00000001', 'w32 smallest subnormal'); eq(hex32('1.1754943508e-38'), '0x00800000', 'w32 smallest normal');
eq(hex32('3.4028234664e38'), '0x7F7FFFFF', 'w32 largest'); eq(hex32('0.999999940395355225'), '0x3F7FFFFF', 'w32 largest below one');
eq(hex32('1'), '0x3F800000', 'w32 one'); eq(hex32('1.00000011920928955'), '0x3F800001', 'w32 1+2^-23'); eq(hex32('-2'), '0xC0000000', 'w32 -2');
eq(hex32('0'), '0x00000000', 'w32 0'); eq(hex32('-0'), '0x80000000', 'w32 -0'); eq(F.analyze('3.5e38', 'f32').kind, 'infinity', 'w32 overflow');
eq(F.analyze('16777217', 'f32').exact, '16777216', 'w32 16777217 rounds to even'); eq(F.analyze('16777219', 'f32').exact, '16777220', 'w32 16777219 rounds up to even multiple of 2');
eq(F.analyze('9007199254740993', 'f64').exact, '9007199254740992', 'w64 2^53+1 rounds to even');
eq(F.analyze('9007199254740995', 'f64').exact, '9007199254740996', 'w64 2^53+3 rounds to even multiple of 2');
// seeded random decimal strings
var seed = 987654321; function rnd(k) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; }
function rdig(k) { var s = ''; for (var i = 0; i < k; i++) s += rnd(10); return s; }
function rstr() { var m = rdig(1 + rnd(20)), f = rnd(2) ? '.' + rdig(1 + rnd(18)) : '', e = rnd(3) ? 'e' + (rnd(2) ? '-' : '') + rnd(330) : ''; return (rnd(4) ? '' : '-') + m + f + e; }
var f64 = new Float64Array(1), u64 = new BigUint64Array(f64.buffer), mismatchF32 = 0, f32tot = 0;
for (var i = 0; i < 4000; i++) {
  var s = rstr(), x = Number(s); f64[0] = x;
  var a = F.analyze(s, 'f64');
  eq(a.bitsInt, u64[0], 'bits ' + s);
  if (x !== 0) eq(a.shortest, String(x).replace(/e\+?(-?)(\d)/, function (_, sg, d) { return 'e' + (sg || '+') + d; }).replace(/^(-?)(\d)e/, '$1$2e'), 'shortest ' + s);
  if (isFinite(x) && x !== 0) {
    eq(Number(a.exact), x, 'exact decimal reads back ' + s);
    var back = F.analyze(a.exact, 'f64'); eq(back.exactMatch, true, 'exact decimal is exact ' + s);
    eq(F.analyze(a.shortest, 'f64').bitsInt, a.bitsInt, 'shortest round trips ' + s);
    // neighbors: next larger magnitude is the adjacent double
    var up = new Float64Array(1), ub = new BigUint64Array(up.buffer); ub[0] = u64[0] + 1n; var nxt = F.analyze(a.nextUp.replace(/^-/, ''), 'f64').bitsInt;
    if (x !== 0 && isFinite(up[0])) eq(nxt, (u64[0] & 0x7FFFFFFFFFFFFFFFn) + 1n, 'next ' + s);
  }
  // binary32: correct rounding by neighbor distance, and agreement with Math.fround except double-rounding cases
  var b = F.analyze(s, 'f32'), fr = Math.fround(x); f32tot++;
  if (b.kind === 'finite' || b.kind === 'normal' || b.kind === 'subnormal') {
    var parsed = F.parseDecimal(s), v = b.v;
    function dist(w) { var num = w.q >= 0 ? w.m << BigInt(w.q) : w.m, den = w.q >= 0 ? 1n : 1n << BigInt(-w.q); var dn = num * parsed.d - parsed.n * den; return (dn < 0n ? -dn : dn) * 1n; }
    var dv = dist(v), dd = dist(v) , nx = F.next(v, F.FORMATS.f32), pv = F.prev(v, F.FORMATS.f32);
    // compare with neighbors using common denominator: distances share denominator parsed.d * 2^k, so compare cross-multiplied
    function distRat(w) { var num = w.q >= 0 ? w.m << BigInt(w.q) : w.m, den = w.q >= 0 ? 1n : 1n << BigInt(-w.q); var dn = num * parsed.d - parsed.n * den; return { n: dn < 0n ? -dn : dn, d: den * parsed.d }; }
    function le(x1, x2) { return x1.n * x2.d <= x2.n * x1.d; }
    var me = distRat(v); if (nx.kind === 'finite') eq(le(me, distRat(nx)), true, 'f32 nearest vs next ' + s); if (pv && pv.kind === 'finite') eq(le(me, distRat(pv)), true, 'f32 nearest vs prev ' + s);
  }
  var fb = new Float32Array(1), ub32 = new Uint32Array(fb.buffer); fb[0] = x;
  if (BigInt(ub32[0]) !== b.bitsInt) mismatchF32++;
}
// double rounding through Number() makes Math.fround(Number(s)) differ from correct rounding only in rare cases
eq(mismatchF32 < 20, true, 'f32 vs Math.fround mismatches are rare: ' + mismatchF32 + ' of ' + f32tot);
// known double-rounding case: 1 + 2^-24 + tiny. Correct float32 rounding is above the midpoint (up); via double it lands on the midpoint and rounds to even (down)
var dr = '1.000000059604644775390625000000000000000000001'; // 1 + 2^-24 + 1e-45ish
eq(F.analyze(dr, 'f32').hex, '0x3F800001', 'direct decimal to float32 rounds up');
eq(Math.fround(Number(dr)), 1, 'via double it rounds to 1 (double rounding)');
// arithmetic against JS (binary64) and Math.fround (binary32)
function rnum() { var x = (rnd(2000001) - 1000000) / 1000 * Math.pow(10, rnd(9) - 4); return String(x); }
for (i = 0; i < 3000; i++) {
  var sa = rnum(), sb = rnum(), op = '+-*/'[rnd(4)], xa = Number(sa), xb = Number(sb);
  if (op === '/' && xb === 0) continue;
  var js = op === '+' ? xa + xb : op === '-' ? xa - xb : op === '*' ? xa * xb : xa / xb;
  var r = F.arith(sa, op, sb, 'f64'); if (r.error) { eq(isFinite(js), false, 'arith error only on overflow ' + sa + op + sb); continue; }
  f64[0] = js; var h = u64[0].toString(16).toUpperCase(); while (h.length < 16) h = '0' + h;
  eq(r.hex, '0x' + h, 'f64 arith ' + sa + op + sb);
  var fa = Math.fround(xa), fbv = Math.fround(xb), jf = Math.fround(op === '+' ? fa + fbv : op === '-' ? fa - fbv : op === '*' ? fa * fbv : fa / fbv);
  var r32 = F.arith(sa, op, sb, 'f32'); if (r32.error) continue;
  var fl = new Float32Array(1), ul = new Uint32Array(fl.buffer); fl[0] = jf; var h2 = ul[0].toString(16).toUpperCase(); while (h2.length < 8) h2 = '0' + h2;
  eq(r32.hex, '0x' + h2, 'f32 arith ' + sa + op + sb);
}
eq(F.arith('0.1', '+', '0.2', 'f64').result, '0.30000000000000004', '0.1+0.2');
eq(F.arith('0.1', '+', '0.2', 'f64').errUlps, '5.0e-1', '0.1+0.2 error is half an ulp');
eq(F.arith('0.3', '-', '0.1', 'f64').result, '0.19999999999999998', '0.3-0.1');
eq(F.arith('1', '/', '3', 'f32').result, '0.33333334', '1/3 float32');
// input handling
['', 'abc', '1.2.3', '1e', '--1', 'Infinity', '0x10', '.', '1e999999'].forEach(function (s) { eq(!!F.analyze(s, 'f64').error, true, 'rejects ' + s); });
['.5', '5.', '+3', '1E3', '  7  ', '1_000'].forEach(function (s) { eq(!!F.analyze(s, 'f64').error, false, 'accepts ' + s); });
eq(F.analyze('.5', 'f64').hex, '0x3FE0000000000000', '.5');
console.log(n + ' checks, ' + fails + ' failures'); process.exit(fails ? 1 : 0);
