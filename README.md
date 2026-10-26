# eebox

A modular electrical panel designer that runs entirely in the browser. Lay out DIN-rail modules, comb bus bars and terminal bars on a front view of the panel, and wire them in a multi-conductor schematic that stays linked to the placed modules. There is no backend: projects live in your browser or in files, and module libraries are JSON files you bring yourself.

**Try it: https://ashevchuk.github.io/eebox/**

![Panel layout](docs/images/panel.png)

![Wiring schematic](docs/images/schematic.png)

## Features

- **Panel layout.** Rails of any length and spacing in 17.5 mm module units. Drag modules from the palette, reorder modules and rails, take modules off a rail onto a shelf and put them back.
- **Poles and conductors.** A module has real terminals: L, L1-L3, N and PE per pole, top and bottom. Neutral and earth bars have custom widths, comb bus bars distribute phases to the modules under them.
- **Wiring schematic.** Wire terminal to terminal, or wire all poles of two nodes at once. Wires obey conductor families (phase to phase, N to N, PE to PE), are routed around nodes and can carry labels.
- **Labels on everything.** Modules, rails, wires, terminals, sources, loads and the drawing itself.
- **Object inspector.** Edit the properties of whatever is selected, with validation. Changes that would remove wires ask first.
- **Check.** Finds overlaps, wrongly joined conductors and orphaned nodes, and warns about design problems: a load without protective earth, a module fed through its outputs only, more current drawn on one phase than a module is rated for, and loads that can be fed without passing an RCD or RCBO.
- **Your own libraries.** Import JSON libraries, search and group the palette, update placed modules from a changed library, or write a library in the built-in editor. See [docs/library-format.md](docs/library-format.md).
- **Output.** PNG, SVG, parts list as CSV, a print sheet (panel, schematic, parts list), save and open project files, share links, autosave.

![Library editor](docs/images/library-editor.png)

## Quick start

Open the page, drag modules from the palette onto a rail, switch to *Schematic* and wire them. To see a finished design, open [`examples/house-panel.json`](examples/house-panel.json) with *Open...*.

The bundled *Generic IEC modules* library is generated from standard rating series. Its widths are typical values and do not come from any manufacturer, so import your own library for real parts.

## Development

```bash
npm install
npm run dev                 # dev server
npm test                    # unit tests
npm run typecheck
npm run build:dist-file     # static build in dist-file/, opens from file://
```

There are no runtime dependencies. The code is split into a pure model (no DOM, unit-tested) and the UI on top of it; `src/library`, `src/layout`, `src/schematic`, `src/electrical` and `src/project` hold the model.

Pushes to `main` run the tests and deploy `dist-file/` to GitHub Pages.

## Limits

- No load, cable or selectivity calculations yet; the checks above are advice, not a design verification.
- Printing keeps the dark background of the drawings.
- A project keeps its own copy of the modules it uses, so a changed library reaches it only through *Update modules from libraries*.

## License

[MIT](LICENSE)
