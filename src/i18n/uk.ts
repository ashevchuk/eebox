import type { Dictionary } from './catalogue';
import { DESIGNER } from './uk-designer';
import { DYNAMIC } from './uk-dynamic';
import { INSPECTOR } from './uk-inspector';
import { PAGE } from './uk-page';
import { UI } from './uk-ui';

/** Everything that is shown in Ukrainian; the phrases are the English the application is written in. */
export const UKRAINIAN: Dictionary = { ...PAGE, ...UI, ...INSPECTOR, ...DESIGNER, ...DYNAMIC };
