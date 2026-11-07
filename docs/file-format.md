# Files and their versions

eebox writes three kinds of file. Each says what it is and which version of its format it follows, and each is stamped with the application that wrote it.

| File | `format` | Version field | Where |
|---|---|---|---|
| Project | `eebox-project` | `version` | File > Save, a share link, the list of projects |
| Backup of everything | `eebox-workspace` | `version` | File > Backup |
| Module library | none | `schemaVersion` | exporting a library; see [library-format.md](library-format.md) |

## Two marks, for different things

- **The version of the format** (`version`, `schemaVersion`) is a whole number. It is what a reader checks before it trusts the rest of the file, and what a migration will turn on. A reader that meets a number it does not know refuses the file.
- **`generator`** is text such as `eebox 0.7.0`: the release that wrote the file. It decides nothing. It says where a file came from, so that a file that is refused can be told from a file that is only of another release. It is written on every export and may be missing from a file that was written by hand or by an earlier release; a file with a `generator` that does not read like `eebox 1.2.3` is refused.

When a file is refused, the message adds a line such as *The file was written by eebox 0.5.0; this is eebox 0.7.0.* The comparison of two project files, and the list of projects, ignore `generator`: the same project written by two releases is one project.

## When the version of the format changes

Raise the number when a change is not compatible with what the previous reader accepts:

- a field is removed, renamed, or given another meaning;
- a field that was optional becomes required;
- a value that was allowed is no longer allowed.

Adding an optional field, or accepting more than before, is compatible and does not raise it. Unknown fields are refused on purpose, so a file that has a field this build does not know is refused whatever the number says, and `generator` then tells the person why.

When the number is raised, add a line below saying what changed and in which release, and, once there are users with files of the older version, a function that turns an older file into the new one before it is checked. There is no such function yet, and until there is, a file of another version is refused.

## The versions

### Project and backup: version 1

The format of eebox 0.7.0. The number has not been raised since the first release, although the format changed between releases before 0.7.0 (for example the module height and mounting, the position and orientation of a rail, plates, the duct of a wire, the depth of a duct). A file written by a release before 0.7.0 may therefore be refused for what it holds, not for its number; it carries no `generator` to say so.

### Library: schemaVersion 1

The format of eebox 0.7.0, with the same remark: `heightMm` and `mounting` became required on a module before 0.7.0 without a new number.
