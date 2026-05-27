# nuxt-echarts + Nuxt 4.4.6 island-hash repro

Minimal reproduction: a server-rendered `<v-chart-full>` whose `option` contains a JavaScript
function (e.g. `tooltip.formatter`) fails prerender/SSR on **Nuxt 4.4.6** with
`[400] Invalid island request hash`. Works on **4.4.4**.

## Run it

```bash
npm install
npx nuxi generate --fail-on-error   # fails on 4.4.6 with the index page's island
node ohash-test.mjs                 # shows why: hash differs across a JSON round-trip
```

## Layout

- `app/pages/index.vue` — fails: `option.tooltip.formatter` is a function.
- `app/pages/control.vue` — passes: same chart, string-template formatter (JSON-safe `option`).
- `ohash-test.mjs` — standalone proof that the function-bearing props hash differs from the
  JSON-round-tripped props.
- `REPRO_LOG.md` — exact commands + observed output for 4.4.6 (fail), control (pass), 4.4.4 (pass).
- `ISSUE_DRAFT.md` — drafted GitHub issue for [`nuxt-echarts`](https://github.com/kingyue737/nuxt-echarts).

See `ISSUE_DRAFT.md` for the full root-cause analysis.
