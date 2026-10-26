import { SCHEMA_VERSION, type Library } from './types';

/** The library that collects what a person designs; unlike the bundled one it is never replaced at start-up. */
export const MY_LIBRARY_ID = 'my-modules';
export const MY_LIBRARY_NAME = 'My modules';

export function emptyMyLibrary(): Library {
  return { schemaVersion: SCHEMA_VERSION, id: MY_LIBRARY_ID, name: MY_LIBRARY_NAME, modules: [], enclosures: [] };
}
