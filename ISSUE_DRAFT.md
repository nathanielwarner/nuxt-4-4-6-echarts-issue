# `<VChartFull>` server rendering breaks on Nuxt 4.4.6: `option` with a function (e.g. `tooltip.formatter`) → `400 Invalid island request hash`

## Summary

When a `<VChartFull>` / `<v-chart-full>` is server-rendered (the default `mode: "server"` path,
which renders a `<NuxtIsland>`) and its `option` prop contains **any JavaScript function** — an
ECharts `tooltip.formatter`, `axisLabel.formatter`, etc. — prerendering/SSR on **Nuxt 4.4.6** fails
with:

```
[400] Invalid island request hash
```

for every such chart instance. With `nuxi generate --fail-on-error` this aborts the whole build.
The same code works on **Nuxt 4.4.4**. Charts whose `option` is pure JSON-safe data render fine on
both versions.

I believe this is an incompatibility surfaced by a Nuxt **core** security change (island request
hash validation, [nuxt/nuxt#35077](https://github.com/nuxt/nuxt/pull/35077)), rather than a clear
defect in `nuxt-echarts` — but `nuxt-echarts` is the layer that forwards `option` (functions and
all) into a `<NuxtIsland>` prop, so I'm filing here first; the fix may ultimately belong upstream.

## Environment

| package | version |
|---|---|
| `nuxt` | `4.4.6` (broken) / `4.4.4` (works) |
| `nuxt-echarts` | `1.0.1` |
| `echarts` | `6.1.0` |
| `vue-echarts` | `8.0.1` |
| Node | `24.15.0` |
| OS | macOS 26.4.1 (arm64) |

## Reproduction

Minimal app (two pages — one with a function in `option`, one without):

`nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['nuxt-echarts'],
  echarts: {
    renderer: ['svg'],
    charts: ['BarChart'],
    components: ['TooltipComponent', 'GridComponent'],
  },
});
```

`app/pages/index.vue` (**fails** — `formatter` is a function):

```vue
<template>
  <v-chart-full :option="option" :init-options="{ width: 400, height: 300 }" />
</template>

<script setup>
const option = {
  tooltip: {
    trigger: 'axis',
    formatter: (params) => `value: ${params[0].data}`, // <-- the function that breaks it
  },
  xAxis: { type: 'category', data: ['a', 'b', 'c'] },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', data: [1, 2, 3] }],
};
</script>
```

`app/pages/control.vue` (**passes** — same chart, string-template `formatter`):

```vue
<template>
  <v-chart-full :option="option" :init-options="{ width: 400, height: 300 }" />
</template>

<script setup>
const option = {
  tooltip: { trigger: 'axis', formatter: '{b}: {c}' }, // JSON-serializable
  xAxis: { type: 'category', data: ['a', 'b', 'c'] },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', data: [1, 2, 3] }],
};
</script>
```

### Steps

```bash
npx nuxi generate --fail-on-error
```

### Actual

The index island 400s; the control island does not:

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

Build exits with code 1. Every server-rendered chart with a function in `option` fails the same way.

### Expected

Charts whose `option` contains a function render server-side as they did on ≤ 4.4.5. (The function
is genuinely consumed by ECharts when it builds the SVG server-side, so "don't pass functions" isn't
a real workaround for these users.)

### Version check (it's the regression in 4.4.6)

Same code, only `nuxt` changed:

- `nuxt@4.4.4` → `nuxi generate --fail-on-error` **succeeds (exit 0)**; the same index island hash
  (`VChartIsland_iKlQOHkF…`) renders with no 400, function still present.
- `nuxt@4.4.6` → **fails (exit 0 → 1)** as above.

## Root cause analysis

Verified by reading the installed source of `nuxt`, `@nuxt/nitro-server`, and `nuxt-echarts`, plus an
`ohash` test:

1. **Nuxt 4.4.6 added island-request hash validation** —
   [nuxt/nuxt#35077](https://github.com/nuxt/nuxt/pull/35077) ("fix(nitro): validate island request
   hash matches props"), shipped in [v4.4.6](https://github.com/nuxt/nuxt/releases/tag/v4.4.6). It's a
   deliberate fix against island cache poisoning, not an accidental bug.

2. **How it works.** The client (`nuxt/dist/app/components/nuxt-island.js`) computes
   `hashId = computeIslandHash(name, filterIslandProps(props.props), context, source)` from the **live
   JS props object** and puts it in the request URL `/__nuxt_island/<Name>_<hash>.json`; the props are
   sent JSON-serialized. The server
   (`@nuxt/nitro-server/dist/runtime/handlers/island.mjs`, ~L149–170) reads them back with
   `destr(rawContext?.props)`, recomputes the hash, and on mismatch throws
   `createError({ statusCode: 400, statusMessage: "Invalid island request hash" })`. The hash is
   `ohash`'s `hash([...])` walking the whole props object.

3. **Functions don't survive the round-trip.** The client hashes the props **with** the function
   attached; `JSON.stringify` → URL/body → `destr` on the server **drops the function**, so the server
   hashes a different object and rejects the request. Demonstrated with `ohash@2.0.11` (the version
   4.4.6 ships):

   ```js
   import { hash } from 'ohash';
   const withFn   = { option: { tooltip: { trigger: 'axis', formatter: (p) => 'X' }, series: [{ data: [1,2,3] }] } };
   const jsonSafe = JSON.parse(JSON.stringify(withFn)); // tooltip becomes { trigger: 'axis' } — formatter gone
   hash(withFn) === hash(jsonSafe); // => false
   ```

   ```
   hash(withFn)   = 0wJdiBvJBtdFY6WtifvJO_DVWd1zRtAcc4VRGZ-VUVo
   hash(jsonSafe) = -49pVVpJwzBNTznJqT9-jpIQtEVykI44tp1jTfd-nIQ
   equal?         = false
   ```

4. **Where `nuxt-echarts` comes in.** `VChartServer.vue` forwards the user's `option` straight into
   the server island as a prop:

   ```vue
   <!-- node_modules/nuxt-echarts/dist/runtime/components/VChartServer.vue -->
   <VChartIsland ref="root" :theme="realTheme" :option="option" :init-options="realInitOptions" @error="onError">
   ```

   So any function inside `option` becomes part of a `<NuxtIsland>` prop — precisely what 4.4.6's hash
   validation now rejects. `VChartIsland.server.vue` then needs that function to call
   `echarts.init(...).setOption(option)` and render the SVG, so functions in `option` are a legitimate,
   common use.

## Suggested directions (offered, not prescribed)

- Render the SVG without round-tripping `option` through island props — e.g. serialize only what's
  needed and render server-side in one pass, so function-bearing `option` never has to survive
  JSON + a hash check.
- Or document that `option` for server-rendered charts must currently be JSON-serializable on 4.4.6+,
  and point function users at client-only rendering as a workaround.
- Or coordinate an upstream fix in Nuxt core to normalize the hash input on both sides (hash the
  post-serialization props on the client too), since this likely affects any island whose props carry
  non-JSON values — not just ECharts. This may be the proper home for the fix.

## References

- PR: https://github.com/nuxt/nuxt/pull/35077
- Release: https://github.com/nuxt/nuxt/releases/tag/v4.4.6
- `<NuxtIsland>` docs: https://nuxt.com/docs/4.x/api/components/nuxt-island
- Related older island/SSG hash issue (context, not the same bug): https://github.com/nuxt/nuxt/issues/30131
