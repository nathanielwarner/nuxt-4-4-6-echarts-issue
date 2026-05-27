// Demonstrates the crux of the bug: ohash produces different hashes for a props
// object with a function vs. the same object after a JSON round-trip (which drops
// the function). This is exactly what happens to island props between the Nuxt
// client (hashes with the function) and server (re-hashes after destr, no function).
//
//   npm i ohash   (or use the version Nuxt 4.4.6 ships)
//   node ohash-test.mjs
import { hash } from 'ohash';

const withFn = {
  option: {
    tooltip: { trigger: 'axis', formatter: (p) => `value: ${p[0].data}` },
    series: [{ type: 'bar', data: [1, 2, 3] }],
  },
};

// JSON.stringify drops the function; destr on the server parses this shape back.
const jsonSafe = JSON.parse(JSON.stringify(withFn)); // tooltip.formatter is gone

const h1 = hash(withFn);
const h2 = hash(jsonSafe);

console.log('hash(withFn)   =', h1);
console.log('hash(jsonSafe) =', h2);
console.log('equal?         =', h1 === h2); // => false
console.log('jsonSafe.tooltip =', JSON.stringify(jsonSafe.option.tooltip));

if (h1 === h2) {
  console.error('UNEXPECTED: hashes matched; the round-trip did not drop the function');
  process.exit(1);
}
