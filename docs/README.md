# Documentation Site

The documentation site is built with VitePress and uses Vite+ (`vp`) for local tasks.

## Commands

Run these commands from the repository root:

```sh
pnpm docs:dev
pnpm docs:build
pnpm docs:check
pnpm docs:typecheck
```

Run them from this directory when working only on the documentation site:

```sh
pnpm dev
pnpm build
pnpm check
pnpm typecheck
```

`format` uses Oxfmt through Vite+. Markdown files are excluded because their formatting is controlled by the documentation authoring conventions and VitePress rendering.
