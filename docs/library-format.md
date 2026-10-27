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
| `name` | string | required; the name in the palette, the search and the parts list |
| `shortName` | string | optional, 1 to 16 characters on one line; what the face of the module shows in place of `name`, which is too long there |
| `widthUnits` | number | width in 17.5 mm units, from 0.1; a fraction is fine, so a relay of 22.5 mm is `1.2857` and a block of 29 mm `1.6571`. The designer takes the width in millimetres |
| `poles` | 1, 2, 3 or 4 | decides the derived terminals |
| `sku`, `ratedCurrentA`, `curve`, `breakingCapacityKA`, `residualCurrentMa` | optional | `curve` is one of `B C D K Z`; searchable in the palette |
| `terminals` | array | replaces the terminals derived from `poles` |
| `comb` | object | required for, and only allowed on, kind `comb` |
| `resizable` | object | optional, any kind; lets a placed copy have its own width |
| `logic` | object | optional; what a relay or contactor does with the voltages it senses, see below. Needs explicit `terminals` |
| `price`, `currency` | optional | what one costs and its currency code, for pricing the parts list |

### Derived terminals

Without `terminals`, each pole yields a terminal on the top and the bottom side: 1P has `L`; 2P has
`L` and `N`; 3P has `L1 L2 L3`; 4P has `L1 L2 L3 N`.

### Explicit terminals

| Field | Notes |
| --- | --- |
| `name` | identifier; unique per side |
| `conductor` | `L`, `L1`, `L2`, `L3`, `N`, `PE`, `PEN`, `C`, `DCP` or `DCN`; `L` is a phase decided by what feeds it, `PEN` is a neutral and a protective earth in one conductor |
| `side` | `top` or `bottom` |
| `net` | terminals of one module that share a net are connected inside it (a terminal bar); without a net a terminal is isolated |
| `unit` | position of the terminal's centre along the module, in module units from the left edge; decimals are allowed. `0` is the centre of the first unit and `0.5` the border between the first and the second. It has to lie inside the module and `0.15` of a unit from either edge (a quarter of the width on a module narrower than 0.6 units, so a 5.2 mm clamp can hold terminals), so `-0.35` to `width - 0.65`; not combined with `count`. On a resizable module a negative value counts from the right edge (`-1` is the centre of the last unit), and any position must exist at the narrowest width |
| `count` | 1 to 48 identical terminals named `name1`, `name2`, ... |

A module has at most 64 terminals.

### Conductor families

Wires join terminals of one family only: the phases (`L`, `L1`-`L3`), `N`, `PE`, and the control
family (`DCP`, `DCN`), so that 24 V never shares a net with mains conductors. The exception is `C`,
the terminal of a contact: it takes a wire of any family, because a contact switches whatever it is
given, and it does not count when Check looks for nets that mix families. A net that joins `DCP`
and `DCN` is reported by Check as a short circuit.

`PEN` is a family of its own: a wire joins `PEN` to `PEN` only. A module that splits a PEN conductor
lists a `PEN` terminal and `N` and `PE` terminals with the same `net`, which is how `N` and `PE` come
out of one `PEN`; the bundled `PEN splitting block` is an example. A net may hold `PEN` together with
`N` and `PE`, but `N` and `PE` joined without a `PEN` are reported by Check as a short circuit, and so
is a second module that splits the same `PEN` net.

A device with two supplies, such as a changeover switch, lists both inputs as separate terminals on
the top side and gives them no `net`, because nothing joins them inside the module.

### Logic

`logic` lets the power view follow a relay or contactor. `inputs` names groups of terminals whose
voltage the device senses; `contacts` joins two terminals while an expression over the input names is true.

```json
"logic": {
  "inputs": { "coil": { "terminals": ["top:A1", "top:A2"], "when": "all" } },
  "contacts": [{ "between": ["top:L1", "bottom:T1"], "closedWhen": "coil" }]
}
```

- Terminals are written as ids, `top:A1`. An input with `"when": "all"` senses voltage when every
  terminal is fed from a source, on different nets (the two terminals of a coil); `"any"` when one is.
- `flags` names facts that no terminal shows, such as a latched impulse relay or an elapsed timer:
  `"flags": { "on": { "label": "Output on", "default": true } }`. A person sets them on a placed copy
  in the inspector, and expressions use them like inputs: `"closedWhen": "V & elapsed"`. A flag may not
  share a name with an input.
- Expressions use input names, `!` (not), `&` (and), `|` (or) and parentheses: `B & !A`.
- Voltage is followed through wires, bars, combs, closed breakers and switches on phase, neutral and
  earth, and through the closed contacts, repeating until no contact changes. A contactor with logic
  has the position *auto* (follow the coil), *closed* and *open* (override it).
- At most 8 inputs of 8 terminals and 32 contacts per module. Control conductors are not followed. Time
  is not simulated: a timer or an impulse relay is a flag the person sets to see the circuit before and after.

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

### Art

`art` is a list of up to 32 shapes drawn on the face of the module on the panel, over the body and the
band at the top and under the name and the terminals; the first shape is at the bottom. The face is 90 mm
tall and as wide as the module (17.5 mm a unit). Coordinates are millimetres from its top left corner, for
the width the module is made for (`widthUnits`), and what is outside the face is cut off.

| Shape | Fields |
| --- | --- |
| `line` | `x1`, `y1`, `x2`, `y2`, `stroke` (required) |
| `rect` | `x`, `y`, `width`, `height` |
| `ellipse` | `cx`, `cy`, `rx`, `ry` |
| `polyline` | `points` (2 to 64 `[x, y]` pairs), `closed`; a fill needs `closed: true` |
| `text` | `x`, `y`, `text` (1 to 40 characters), `size` (letter height in mm), `fill` (required), `align` (`left`, `centre`, `right`), `bold`, `rotation` (degrees clockwise about the point of the text, from -360 to 360; 90 stands the text up) |
| `path` | `d`: absolute path data in mm, only `M x y`, `L x y`, `C x1 y1 x2 y2 x y` and `Z`, separated by single spaces, at most 400 commands, each piece starting with `M`; a stroke or a fill |

Every shape may have `stroke` and `fill` as `#rrggbb` (a rect, an ellipse and a polyline need at least one
of them), `strokeWidth` in mm (0.5 when absent), and an `anchor` that says what a placed copy of another
width does with it:

- `left` (when absent): stays where it is;
- `right`: moves with the right edge; `centre`: moves by half of the change;
- `stretch`: its x coordinates and widths are scaled with the width, so a circle becomes an ellipse;
- `tile`: repeated every `period` units (0.25 and more) from its place, as many times as whole periods
  fit in the width, at most 48; the rest of the width stays empty.

A path is what an imported SVG turns into: the module designer reads the shapes, paths (with arcs and
curves), polygons, texts and groups with transforms of an SVG file, puts them on the face as the shapes
above and lists what it leaves out (images, scripts, styles, gradients, opacity, clipping). The file is
read by the application's own reader, which refuses a document type and entities and runs nothing.

An SVG written by *Export SVG* has the anchor and the period of a shape in its `data-anchor` and
`data-period` attributes, which the importer reads back and any other program ignores. A shape without
them takes the anchor chosen in the import dialog.

Text is drawn in the font that comes with the application, so it looks the same on every machine.

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

## Importing parts from a CSV table

File ▸ Import library or parts (CSV)… also takes a `.csv` file: one module per row, the first row names the columns. The file name becomes the library id and name. The delimiter (`,` `;` or tab) is detected from the header; with `;` or tab a decimal comma is read as a decimal point.

| Column (aliases) | Meaning |
| --- | --- |
| `name` (title, description) | Required. |
| `width_mm` or `width_units` | One of them is required; mm is converted to 17.5 mm units. |
| `id`, `sku` | The id defaults to a slug of the sku or name and is made unique. |
| `kind` | One of the module kinds; `other` when empty. |
| `poles` | 1 to 4; 1 when empty. |
| `rated_current_a`, `curve`, `breaking_capacity_ka`, `residual_current_ma` | As in the library format. |
| `price`, `currency` | Unit price and its currency. |
| `top_terminals`, `bottom_terminals`, `conductor`, `joined` | Terminal counts per side, their conductor (`L` when empty), and `yes` when every terminal is one point (a distribution block). |

Unknown columns are ignored. A bad row is reported by its row number and nothing is imported. See `examples/parts.csv`.
