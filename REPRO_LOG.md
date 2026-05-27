# Repro log

Minimal reproduction of: `<VChartFull>` server rendering fails on Nuxt **4.4.6** when its
`option` prop contains a JavaScript function (e.g. `tooltip.formatter`), with
`[400] Invalid island request hash`. Works on **4.4.4**.

## Environment

| item | value |
|---|---|
| OS | macOS 26.4.1 (arm64) |
| Node | v24.15.0 |
| npm | 11.12.1 |
| `nuxt` | `4.4.6` (broken) / `4.4.4` (works) — pinned exactly |
| `nuxt-echarts` | `1.0.1` |
| `echarts` | `6.1.0` |
| `vue-echarts` | `8.0.1` |
| `ohash` | `2.0.11` (the version Nuxt 4.4.6 ships) |

## Files

- `app/pages/index.vue` — **failing** page: `option.tooltip.formatter` is a JS function.
- `app/pages/control.vue` — **control** page: same chart, `formatter` is the ECharts string
  template `'{b}: {c}'`, so `option` is fully JSON-serializable.
- `ohash-test.mjs` — standalone demonstration that `hash(propsWithFn) !== hash(jsonRoundTrip(props))`.

---

## Case 0 — `ohash` round-trip (the crux)

```bash
node ohash-test.mjs
```

Output:

```
hash(withFn)   = 0wJdiBvJBtdFY6WtifvJO_DVWd1zRtAcc4VRGZ-VUVo
hash(jsonSafe) = -49pVVpJwzBNTznJqT9-jpIQtEVykI44tp1jTfd-nIQ
equal?         = false
jsonSafe.tooltip = {"trigger":"axis"}
```

The function is silently dropped by `JSON.parse(JSON.stringify(...))` (`tooltip` loses its
`formatter`), so the two hashes differ. This is exactly the client-vs-server mismatch that the
island handler rejects.

---

## Case 1 — Nuxt **4.4.6**, `nuxi generate --fail-on-error` → FAILS (exit 1)

```bash
npm pkg set dependencies.nuxt=4.4.6 && npm install
npx nuxi generate --fail-on-error
```

Relevant prerender output (full log: the index island 400s, the control island does not):

```
[nitro]   ├─ / (218ms)
[nitro]   ├─ /__nuxt_island/VChartIsland_iKlQOHkF6gxU8MoHtfR7auknr1iWVjNjTaOFqtWeY.json (46ms)
  │ ├── [400] Invalid island request hash
  │ └── Linked from /
[nitro]   ├─ /control (51ms)
[nitro]   ├─ /__nuxt_island/VChartIsland_ddrgTRk3hYHDnQb33z7iqeuMfX3sQUmeW8k5cEPE.json (0ms)
[nitro]
Errors prerendering:
[nitro]   ├─ /__nuxt_island/VChartIsland_iKlQOHkF6gxU8MoHtfR7auknr1iWVjNjTaOFqtWeY.json (46ms)
  │ ├── [400] Invalid island request hash
  │ └── Linked from /

 ERROR  Exiting due to prerender errors.
```

- The island for `/` (the function-bearing chart) returns **`[400] Invalid island request hash`**.
- The island for `/control` (`VChartIsland_ddrgTRk3…`) renders with **no error**.
- `--fail-on-error` then aborts the build with exit code 1.

The failing hash is stable across runs (`VChartIsland_iKlQOHkF…`), so the repro is deterministic.

---

## Case 2 — control page passes (same run, no 400)

The control page's island (`VChartIsland_ddrgTRk3hYHDnQb33z7iqeuMfX3sQUmeW8k5cEPE.json`) appears in
the same `4.4.6` prerender pass **without** a `[400]` line attached and is **not** listed under
"Errors prerendering". The only difference between the two pages is whether `option` contains a
function, which isolates the cause to the function — not islands or ECharts in general.

---

## Case 3 — Nuxt **4.4.4**, same code → SUCCEEDS (exit 0)

```bash
npm pkg set dependencies.nuxt=4.4.4 && npm install
rm -rf node_modules/.cache .nuxt
npx nuxi generate --fail-on-error
```

Relevant output:

```
[nitro]   ├─ / (277ms)
[nitro]   ├─ /__nuxt_island/VChartIsland_iKlQOHkF6gxU8MoHtfR7auknr1iWVjNjTaOFqtWeY.json (7ms)
[nitro]   ├─ /control (9ms)
[nitro]   ├─ /__nuxt_island/VChartIsland_ddrgTRk3hYHDnQb33z7iqeuMfX3sQUmeW8k5cEPE.json (0ms)
```

- Exit code **0**.
- The **same** index island hash (`VChartIsland_iKlQOHkF…`) now renders with **no 400** — the
  function is still present in `option`; 4.4.4 simply does not validate the island request hash.

This confirms the regression is specific to the hash validation added in 4.4.6
([nuxt/nuxt#35077](https://github.com/nuxt/nuxt/pull/35077), shipped in
[v4.4.6](https://github.com/nuxt/nuxt/releases/tag/v4.4.6)).

(After this case, `nuxt` was restored to `4.4.6` so the repo is left in its failing state.)

> 4.4.5 was not tested; per the v4.4.6 changelog the validation landed in 4.4.6, and 4.4.4 ✅ /
> 4.4.6 ❌ is sufficient to bracket the regression.

---

## Source confirmation (read from installed `node_modules`)

- `nuxt-echarts@1.0.1` `dist/runtime/components/VChartServer.vue` forwards the user's `option`
  straight into the server island:
  ```vue
  <VChartIsland ref="root" :theme="realTheme" :option="option" :init-options="realInitOptions" @error="onError">
  ```
- `@nuxt/nitro-server@4.4.6` `dist/runtime/handlers/island.mjs` (~line 149–170) reads props back via
  `destr(rawContext?.props)`, recomputes `computeIslandHash(componentName, filteredProps, clientContext, undefined)`,
  and throws `createError({ statusCode: 400, statusMessage: "Invalid island request hash" })` on mismatch.
