# The icons

`regen.tsx` is vendored from [regen-icons](https://github.com/kazdenc/regen-icons) by
kazdenc, under the MIT licence (`REGEN-LICENSE`).

It is vendored rather than installed because **the npm package is prepared but has not
been published**, so the SVG files in the repository are the source of truth. The set is
225 outline icons on a consistent 24px grid, compiled to one named React export each, so
a bundler keeps only what a page uses.

Four icons were added for this product, because a pharmaceutical supply chain needs
shapes the set does not have: `truck`, `thermometer`, `pill` and `syringe`. They were
drawn in the upstream format -- `generator/src/<name>.icon.json`, validated by the
upstream compiler -- rather than hand-written as SVG, so they carry the same stroke,
grid and optical weight as the rest of the set. `box` was not added: `cube` already
names it, and a second shape for the same thing is how a set stops being a family.

## Regenerating

```bash
git clone --depth 1 https://github.com/kazdenc/regen-icons /tmp/regen-icons
cd /tmp/regen-icons/generator && pnpm install && pnpm build
cp dist/icons.tsx <this directory>/regen.tsx
```

The generated file is checked in on purpose: it is the only way the icons ship without
a runtime dependency, and a build step that needs the network is a build step that
fails on a bad day.
