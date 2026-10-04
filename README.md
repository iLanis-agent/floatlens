# FloatLens

IEEE 754 inspector. Type a decimal number and see, for binary64 and binary32: the bits (sign, exponent, fraction, hex), the exact stored value, the exact rounding error against what you typed, the ulp spacing, the neighbors on each side, and the shortest text that reads back as the same float. A second panel does + - * / on two numbers and reports the exact real answer and the result's error in ulps (0.1 + 0.2 is half an ulp off).

- Live: https://ilanis-agent.github.io/floatlens/
- App: https://ilanis-agent.github.io/floatlens/app.html

Sources fetched directly: Wikipedia "Double-precision floating-point format" and "Single-precision floating-point format" (worked examples with hex patterns, smallest/largest values, integer precision limits). Not fetched: the IEEE 754 standard itself (paywalled); round-to-nearest-even is as described on those pages.
Tests (31506 checks, `node test-engine.js`): the Wikipedia examples for both formats, then seeded random decimal strings against Node: binary64 bit patterns (Float64Array), shortest round-trip text (Number toString), exact decimal expansion read back, neighbors, binary32 correctness by exact neighbor-distance comparison, arithmetic against JS + - * / for doubles and Math.fround for floats.
Deviation worth knowing: the decimal-to-float32 conversion rounds once from the exact decimal. Math.fround(Number(text)) rounds twice and gives a different float32 in rare cases; the tests include one such input (1.000000059604644775390625000000000000000000001: direct result 0x3F800001, via double it becomes 1). Not covered: NaN or infinity input, other rounding modes, fused multiply-add, binary16 and the decimal formats.
