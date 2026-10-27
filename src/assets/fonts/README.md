# Fonts

`NotoSans-Regular.woff` and `NotoSans-Bold.woff` are Noto Sans 2.015 cut down to the characters the drawings
use, so that text measures and looks the same on every machine. They are embedded in the page as data
URIs because the page has to open from `file://`, where a font file beside it would be refused.

Made with fontTools (`pyftsubset`) from the unhinted full fonts:

```bash
pyftsubset NotoSans-Regular.ttf --flavor=woff --no-hinting --layout-features='kern,liga' \
  --unicodes='U+0020-007E,U+00A0-00FF,U+0100-017F,U+0391-03C9,U+0400-04FF,U+2010-2027,U+2030-203A,U+20AC,U+2190-2193,U+2212,U+2264,U+2265,U+00B7' \
  --output-file=NotoSans-Regular.woff
```

The licence is in `LICENSE.txt`. A character outside the subset is drawn in the next font of the stack.
