# Briefing: minimal reproducer for a `nuxt-echarts` + Nuxt 4.4.6 island regression

## Your goal

Build the **smallest possible standalone Nuxt app** in this directory that reproduces the bug
described below, then draft a GitHub issue for the **`nuxt-echarts`** repo
(https://github.com/kingyue737/nuxt-echarts) using that repro.

The repro must be self-contained — do **not** depend on anything outside this directory. Everything
you need to know about the original context is in this file; you do not need to read the
`es-cms-local-data` project.

---

## TL;DR of the bug

On **Nuxt 4.4.6** (works fine on 4.4.4), prerendering or SSR-rendering a `<VChartFull>` (a.k.a.
`<v-chart-full>`) whose `option` prop contains a **JavaScript function** (e.g. an ECharts
`tooltip.formatter` or `axisLabel.formatter` callback) fails with:

```
[400] Invalid island request hash
```

…for every chart instance, aborting `nuxt generate --fail-on-error`.

Charts whose `option` is pure JSON-safe data (no functions) render fine.

---

## Why this happens (root cause — verified, not guessed)

This was tracked down in the original project by reading the installed source of `nuxt`,
`@nuxt/nitro-server`, and `nuxt-echarts`, plus an empirical `ohash` test. The chain:

1. **Nuxt 4.4.6 added island-request hash validation.** PR
   [nuxt/nuxt#35077](https://github.com/nuxt/nuxt/pull/35077) ("fix(nitro): validate island request
   hash matches props"), merged 2026-05-13, shipped in
   [v4.4.6](https://github.com/nuxt/nuxt/releases/tag/v4.4.6) on 2026-05-18. It is a deliberate
   security fix against island **cache poisoning**, not an accidental bug. Its description:
   *"this handles a potential issue where the island cache could render a component with mismatching
   props + hash, potentially poisoning future island responses."*

2. **How the validation works.**
   - Client side (`nuxt/dist/app/components/nuxt-island.js`): computes
     `hashId = computeIslandHash(name, filterIslandProps(props.props), context, source)` from the
     **live JS props object**, and puts that hash in the island request URL
     `/__nuxt_island/<Name>_<hash>.json`. The props themselves are sent JSON-serialized in the
     request query/body.
   - Server side (`@nuxt/nitro-server/dist/runtime/handlers/island.mjs`): reads the props back from
     the request (`destr(rawContext.props)`), recomputes the hash, and if it doesn't match the hash
     in the URL, throws `createError({ statusCode: 400, statusMessage: "Invalid island request hash" })`.
   - The hash function (`nuxt/dist/app/island-hash.js`) is `hash([name, filteredProps, context, source])`
     from `ohash`, walking the whole props object.

3. **Functions don't survive the round-trip.** The client hashes the props object *with* the
   function still attached. The props then go through `JSON.stringify` → URL/body → `destr` on the
   server, which **drops functions**. So the server recomputes the hash from a props object that is
   missing the function, gets a different hash, and rejects the request.

   Empirically confirmed with `ohash` (this is the crux — include something like it in the repro):
   ```js
   import { hash } from 'ohash';
   const withFn   = { option: { tooltip: { formatter: (p) => 'X' }, series: [{ data: [1,2,3] }] } };
   const jsonSafe = JSON.parse(JSON.stringify(withFn)); // tooltip becomes {}  — formatter gone
   hash(withFn) === hash(jsonSafe); // => false
   ```

4. **Why `nuxt-echarts` is implicated (why we file it there, not against nuxt core).**
   `nuxt-echarts@1.0.1` registers `<VChartFull>` in two modes (see
   `node_modules/nuxt-echarts/dist/module.mjs`):
   - client mode → `VChartClient`
   - **server mode → `VChartServer.vue`, whose template renders `<VChartIsland>`** — a
     `mode: "server"` component, i.e. a real `<NuxtIsland>`.

   `VChartServer.vue` passes the user's `option` straight through to `<VChartIsland>` as an island
   prop:
   ```vue
   <!-- node_modules/nuxt-echarts/dist/runtime/components/VChartServer.vue -->
   <VChartIsland ref="root" :theme="realTheme" :option="option" :init-options="realInitOptions" @error="onError">
   ```
   So **any function inside `option`** (formatters, etc.) ends up as part of a `<NuxtIsland>` prop,
   which is exactly what 4.4.6's hash validation now chokes on. `nuxt-echarts` is the layer that
   decides to render ECharts via a server island and to forward `option` as a prop, so it is the
   right place to surface the incompatibility. (The maintainers may ultimately push it upstream to
   nuxt core — that's fine; our job is a clean repro + clear writeup.)

   `VChartIsland.server.vue` only uses `option` to call `echarts.init(...).setOption(option)` and
   render an SVG string server-side — the function in `option` is genuinely needed by ECharts, so
   "just don't pass functions" is not a real fix for users.

---

## Versions to use (match the original failing environment)

| package | version |
|---|---|
| `nuxt` | **`4.4.6`** (pin exactly; this is the broken version) |
| `nuxt-echarts` | `^1.0.1` |
| `echarts` | `^6.0.0` |
| `vue-echarts` | `^8.0.1` |

Node: use an active LTS (the original used 24.15.0; anything ≥ 20 is fine for the repro).

Pin `nuxt` to the exact version so the repro is deterministic — `npm create nuxt` may scaffold a
newer release.

---

## What to build

Keep it to the minimum that demonstrates the failure plus a control that passes.

1. **Scaffold a bare Nuxt app** here (`npm create nuxt@latest .` or manual `package.json` +
   `nuxt.config.ts`), then pin `nuxt` to `4.4.6` and add `nuxt-echarts`, `echarts`, `vue-echarts`.

2. **`nuxt.config.ts`**: register the module and the chart/components actually used, e.g.
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
   (Include whatever ECharts pieces your chosen `option` needs — a missing component otherwise
   produces unrelated errors and muddies the repro.)

3. **A failing page** (`app/pages/index.vue` or `pages/index.vue` depending on scaffold), with a
   single `<v-chart-full>` whose `option` contains a function:
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

4. **A control page** (`pages/control.vue`) with the *same* chart but **no function** in `option`
   (drop `tooltip.formatter`, or use ECharts' string-template formatter like `'{b}: {c}'`). This
   should prerender cleanly and proves the issue is specifically the function, not islands/ECharts
   in general.

---

## How to verify the repro

1. **Reproduce the failure:**
   ```bash
   npx nuxi generate --fail-on-error    # or: npm run generate
   ```
   Expect it to fail, and expect `Invalid island request hash` and `__nuxt_island/VChartIsland_…json`
   lines in the output for the index page but **not** the control page. Capture the full output.

2. **Confirm the control passes** — if you isolate the control page (or read the per-route prerender
   log), it should generate without the 400.

3. **Confirm it's version-specific** (strongest evidence for the maintainers): change `nuxt` to
   `4.4.4`, reinstall, re-run `nuxi generate --fail-on-error`. It should now **succeed** with the
   function still present. Then put it back to `4.4.6`. Document both results.

   - Bonus if cheap: `4.4.5` is expected to still work (the validation landed in 4.4.6 per the
     changelog). Confirming 4.4.4 ✅ / 4.4.6 ❌ is sufficient; testing 4.4.5 is optional.

4. Optionally check `npm run dev` and a runtime SSR serve (`node .output/server/index.mjs` after
   `nuxi build`) to note whether the 400 also appears outside prerender — useful scope info for the
   issue, but `generate --fail-on-error` is the primary signal.

Keep a short `REPRO_LOG.md` recording the exact commands run and the observed output for each case
(4.4.6 failing page, 4.4.6 control page, 4.4.4 passing). The issue draft will quote these.

---

## Deliverables in this directory

1. The working minimal Nuxt app (committed/scaffolded files).
2. `REPRO_LOG.md` — commands + observed output for each verification case above.
3. `ISSUE_DRAFT.md` — the GitHub issue text for `nuxt-echarts`, structured as:
   - **Title:** something like *"`<VChartFull>` server rendering breaks on Nuxt 4.4.6: `option` with a
     function (e.g. `tooltip.formatter`) → `400 Invalid island request hash`"*
   - **Environment:** nuxt 4.4.6, nuxt-echarts 1.0.1, echarts 6.x, vue-echarts 8.x, Node version, OS.
   - **Reproduction:** link to a public repo / StackBlitz if you can create one, plus the inline
     minimal page from this repo.
   - **Steps:** `nuxi generate --fail-on-error` → 400s.
   - **Expected:** charts with function-bearing `option` render server-side as they did on ≤ 4.4.5.
   - **Actual:** every `<VChartFull>` instance fails island hash validation; quote the error.
   - **Root cause analysis:** summarize section "Why this happens" above — `VChartServer.vue` forwards
     `option` (with functions) into `<VChartIsland>` as a `<NuxtIsland>` prop; Nuxt 4.4.6
     ([#35077](https://github.com/nuxt/nuxt/pull/35077)) now hashes island props on the client and
     re-validates on the server, but functions are dropped by JSON serialization in transit, so the
     hashes never match. Include the `ohash` snippet as evidence.
   - **Suggested directions (offer, don't prescribe):** e.g. render the SVG without round-tripping
     `option` through island props (pass only serializable config + render server-side in one pass),
     or document that `option` for server-rendered charts must be JSON-serializable, or coordinate an
     upstream fix in nuxt core to normalize the hash input. Make clear this may need to be fixed in
     nuxt core rather than nuxt-echarts.

---

## Accuracy guardrails

- Distinguish verified facts from inference in the issue. **Verified by source-reading + test:** the
  4.4.6 hash-validation code paths, the `nuxt-echarts` `VChartServer → VChartIsland` forwarding, and
  that `ohash` differs across the JSON round-trip. **To confirm in your repro:** that this actually
  surfaces as `400 Invalid island request hash` end-to-end in a clean app, and the 4.4.4-vs-4.4.6
  difference.
- Don't claim it's a `nuxt-echarts` defect with certainty — frame it as an incompatibility surfaced
  by a nuxt core security change, and let the maintainers decide where the fix belongs.
- If the repro does **not** reproduce as described, stop and report that finding rather than forcing
  it — the original symptom was observed in a larger app, and a clean-room repro failing to trigger
  it is itself important information.

## Reference links

- PR (the change): https://github.com/nuxt/nuxt/pull/35077
- Release: https://github.com/nuxt/nuxt/releases/tag/v4.4.6
- `<NuxtIsland>` docs: https://nuxt.com/docs/4.x/api/components/nuxt-island
- nuxt-echarts repo: https://github.com/kingyue737/nuxt-echarts
- Related older island/SSG hash issue (context, not the same bug): https://github.com/nuxt/nuxt/issues/30131
