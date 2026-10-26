# eebox

A modular electrical panel designer that runs entirely in the browser. Lay out DIN-rail modules, comb bus bars and terminal bars on a front view of the panel, and wire them in a multi-conductor schematic that stays linked to the placed modules. There is no backend: projects live in your browser or in files, and module libraries are JSON files you bring yourself.

**Try it: https://ashevchuk.github.io/eebox/**

![Panel layout](docs/images/panel.png)

![Wiring schematic](docs/images/schematic.png)

## Features

- **Panel layout.** Rails of any length and spacing in 17.5 mm module units. Drag modules from the palette, reorder modules and rails, take modules off a rail onto a shelf and put them back.
- **Poles and conductors.** A module has real terminals: L, L1-L3, N and PE per pole, top and bottom, and control terminals (relay contacts, signals, 24 V DC) that cannot be wired to mains conductors. Neutral and earth bars have custom widths, comb bus bars distribute phases to the modules under them.
- **Wiring schematic.** Wire terminal to terminal, or wire all poles of two nodes at once. Wires obey conductor families (phase to phase, N to N, PE to PE, control to control), are routed around nodes and can carry labels.
- **Labels on everything.** Modules, rails, wires, terminals, sources, loads and the drawing itself.
- **Object inspector.** Edit the properties of whatever is selected, with validation. Changes that would remove wires ask first.
- **Loads and cables.** Give a load its power, power factor, cable length and circuit kind to see the current on every wire, from the load up to the source, the voltage drop, and the smallest cable cross-section that carries the current and keeps the drop within the limit. A cable you pick is checked against the breaker and the limit. The cable table and the norms can be replaced in *File > Cable settings*; the built-in ones are a reference only, see the limits below.
- **Check.** Finds overlaps, wrongly joined conductors and orphaned nodes, and warns about design problems: a load without protective earth, a module fed through its outputs only, more current drawn on one phase than a module is rated for, and loads that can be fed without passing an RCD or RCBO.
- **Your own libraries.** Import JSON libraries, search and group the palette, update placed modules from a changed library, or write a library in the built-in editor. See [docs/library-format.md](docs/library-format.md).
- **Output.** PNG and SVG on a white ground, parts list and a list of circuits with the ferrules needed (CSV), a print sheet (panel, schematic, parts list, circuits, ferrules), labels for the modules at actual size and markers for the ends of cables, save and open project files, share links, autosave.

![Library editor](docs/images/library-editor.png)

## Quick start

Open the page, drag modules from the palette onto a rail, switch to *Schematic* and wire them. To see a finished design, open [`examples/house-panel.json`](examples/house-panel.json) with *Open...*.

The bundled *Generic IEC modules* library is generated from standard rating series and covers breakers, RCDs, RCBOs, switches, contactors, voltage and phase monitoring relays, lighting relays, changeover switches for a backup input, a transfer controller, meters and small devices. Its widths are typical values and do not come from any manufacturer, so import your own library for real parts.

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

- The cable table (copper, PVC, 30 °C, methods B1, B2, C and E, 1.5 to 35 mm²) was entered without the standard at hand and is **not verified** against IEC 60364-5-52. Check it before relying on a cable size. There is no grouping or temperature correction and no selectivity calculation. The voltage drop is that of the final circuit only, from the panel to the load, with the simplified formula of the standard.
- Currents assume 230 V single-phase and balanced 400 V three-phase loads. Wires behind a phase bar, and wires in a loop, show no current.
- The checks are advice, not a design verification.
- A project keeps its own copy of the modules it uses, so a changed library reaches it only through *Update modules from libraries*.

## License

[MIT](LICENSE)
