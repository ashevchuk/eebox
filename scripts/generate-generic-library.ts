import { writeFileSync } from 'node:fs';
import { genericLibraryText } from '../src/library/genericSeries';

const target = new URL('../libraries/generic-iec.json', import.meta.url);
writeFileSync(target, genericLibraryText());
console.log(`wrote ${target.pathname}`);
