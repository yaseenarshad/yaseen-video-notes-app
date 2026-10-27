# Milkdown components patch (CSS zoom, list-item caret restore)

`milkdown-components-7.22.1-yaz1410.tgz` is a version-pinned build of
`@milkdown/components@7.22.1` with two fixes:

- YAZ-1410: table drag preview, drag-over, and boundary indicator geometry are
  correct when the editor is inside a CSS `zoom` context.
- YAZ-2131 4B: the list-item node view restores the caret once per editor view
  per frame instead of once per list item. Opening a note with N bullets used to
  run N whole-plugin transactions in one frame (22.6 s for a 5k-line note). The
  caret still lands where the last of those N restores put it. Drop this hunk
  once upstream Milkdown releases the same fix.

Upstream PR: prepared, awaiting Yasin's go (the patch and PR text are in
`client/vendor/upstream/list-item-restore/`); drop this hunk under
YAZ-2213 once released.

The package name and version remain unchanged so every Milkdown package uses
the same 7.22.1 dependency graph.

When updating an existing checkout, use `npm ci` to install the locked archive.
Because the package version is unchanged, `npm install` can retain an already
installed upstream copy. `client/src/editor/tableZoom.test.ts` checks the actual
installed runtime and catches that stale installation, as does
`client/src/editor/listItemCaretRestore.test.ts`.

The upstream package is MIT licensed and includes its original `LICENSE` file.
Source: <https://registry.npmjs.org/@milkdown/components/-/components-7.22.1.tgz>
Upstream npm integrity:
`sha512-6IA8fcFcBTm/x1X1typz73yUoT1JuN4srmifGAIeWEtCnayEwRjFxpQOoQrfvMgBYx4DSHcPVLhJUlR/xbBtxg==`.

Rebuild from the pinned registry artifact:

```sh
node tools/buildMilkdownPatch.mjs components
```

For an offline rebuild, pass the unmodified upstream npm archive:

```sh
node tools/buildMilkdownPatch.mjs components --source /path/to/components-7.22.1.tgz
```

The build verifies the entire upstream archive against its pinned integrity, then
applies the adjacent readable `.patch` with Git. It fails if the source has drifted.
Use `--output /path/to/rebuilt.tgz` to compare a rebuild without replacing the
vendor archive.
Only these files differ from upstream:

- `src/table-block/dnd/preview.ts`
- `src/table-block/dnd/drag-over-handler.ts`
- `src/table-block/view/pointer.ts`
- `lib/table-block/index.js`
- `src/list-item-block/view.ts`
- `lib/list-item-block/index.js`

The stale table-block and list-item-block source maps and their
`sourceMappingURL` lines are removed because the compiled runtime is patched
directly. No exports or declarations change.
