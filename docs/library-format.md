# Module library format

A library is a JSON document describing modules (DIN-rail devices, bars, combs) and enclosures.
Libraries are stored in the browser (IndexedDB), imported from files and exported from the library
editor. The machine-readable description is `libraries/library.schema.json` (JSON Schema draft-07);
the application validates with its own code, and tests keep the two in step. Point an editor at the
schema with a `$schema` key (accepted and dropped on import).

Unknown fields are rejected. Errors are reported with their path, for example `modules[3].poles`.

## Library

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | `1` | required |
| `id` | identifier | required; letters, digits, `.`, `_`, `-`, starting with a letter or digit |
| `name` | string | required |
| `version` | string | optional, at most 40 characters; shown so two copies can be told apart |
| `vendor` | string | optional |
| `url` | string | optional; `http` or `https` only, at most 300 characters, no spaces |
| `description` | string | optional, one line, at most 300 characters |
| `modules` | array | module definitions |
| `enclosures` | array | enclosure definitions |

The id `generic-iec` belongs to the bundled library and is refreshed at start-up; importing or saving
another library under it is refused. Edit a copy of the bundled library instead.

## Module

| Field | Type | Notes |
| --- | --- | --- |
| `id` | identifier | required, unique in the library |
| `kind` | enum | `breaker`, `rcd`, `rcbo`, `contactor`, `spd`, `meter`, `psu`, `terminal`, `busbar`, `comb`, `switch`, `relay`, `other` |
| `name` | string | required |
| `widthUnits` | integer | width in 17.5 mm units |
| `poles` | 1, 2, 3 or 4 | decides the derived terminals |
| `sku`, `ratedCurrentA`, `curve`, `breakingCapacityKA`, `residualCurrentMa` | optional | `curve` is one of `B C D K Z`; searchable in the palette |
| `terminals` | array | replaces the terminals derived from `poles` |
| `comb` | object | required for, and only allowed on, kind `comb` |
| `resizable` | object | optional, any kind; lets a placed copy have its own width |

### Derived terminals

Without `terminals`, each pole yields a terminal on the top and the bottom side: 1P has `L`; 2P has
`L` and `N`; 3P has `L1 L2 L3`; 4P has `L1 L2 L3 N`.

### Explicit terminals

| Field | Notes |
| --- | --- |
| `name` | identifier; unique per side |
| `conductor` | `L`, `L1`, `L2`, `L3`, `N`, `PE`, `C`, `DCP` or `DCN`; `L` is a phase decided by what feeds it |
| `side` | `top` or `bottom` |
| `net` | terminals of one module that share a net are connected inside it (a terminal bar); without a net a terminal is isolated |
| `unit` | horizontal position in module units from the left edge, below the width; not combined with `count`. On a resizable module a negative value counts from the right edge (`-1` is the last unit), and any position must exist at the narrowest width |
| `count` | 1 to 48 identical terminals named `name1`, `name2`, ... |

A module has at most 64 terminals.

### Conductor families

Wires join terminals of one family only: the phases (`L`, `L1`-`L3`), `N`, `PE`, and the control
family (`C`, `DCP`, `DCN`). Use `C` for relay contacts and signal wires and `DCP`/`DCN` for the plus
and minus of a DC supply, so that 24 V and dry contacts never share a net with mains conductors.
A net that joins `DCP` and `DCN` is reported by Check as a short circuit.

A device with two supplies, such as a changeover switch, lists both inputs as separate terminals on
the top side and gives them no `net`, because nothing joins them inside the module.

### Comb

`comb.pattern` lists 1 to 8 conductors repeated along the span, one pin per module unit;
`comb.side` is the side the pins reach. A comb has no `terminals`.

### Resizable

`resizable: { minUnits, maxUnits }` lets a placed copy have its own width in that range, because
devices of one kind differ in width between makes: a voltage relay of one make is 1 unit wide, of
another 2. Set the width of a placed copy in the inspector (*Width*). `widthUnits` must lie inside the range.

Terminal groups, the entries that have a `count`, scale with the width: a 6-unit bar with 12 terminals
gets 18 at 9 units. A terminal without a `count` stays single. Terminals of a resizable module without a
`unit` are spread over the width; with one they stay at that position from the left, or from the right when it is negative.

Leave `resizable` out for devices whose width follows from their poles, such as breakers.

## Enclosure

`id`, `name` and `railLengthsUnits`: usable length of each DIN rail from top to bottom, in units
(1 to 20 rails, each 1 to 144 units).

## Behaviour in the application

- **Projects keep a snapshot** of the module definitions they use and prefer it to the libraries, so a
  project opens the same way after a library changes. The panel inspector shows whether the snapshot
  matches the libraries; *Update modules from libraries* refreshes it. The update is one undoable step
  and asks for confirmation when it would remove wires or create net problems.
- **Import** validates first. A library with an id that is already stored replaces it only after the
  differences (and the version change) are shown and confirmed; an identical one is ignored.
- **Library editor**: *New library…* starts an empty library, *edit* on a stored library opens it, and
  *copy* on the bundled library makes an editable copy. Problems are listed live, *Save* is blocked
  while any exist, and *Export* downloads the validated JSON.
- **Bundled library** is generated by `npm run gen:library` from the rating series in
  `src/library/genericSeries.ts`. Its widths are typical values, not manufacturer data. Rerun the
  script after changing the series; a test fails when the committed JSON differs from the output.
