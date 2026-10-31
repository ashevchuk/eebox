import { version } from '../package.json';

/** The commit this build was made from, set by the build; `dev` when the application is run without it. */
declare const __BUILD_COMMIT__: string;
export const BUILD: string = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'dev';

/** The version of this build, from package.json. */
export const APP_VERSION: string = version;

/** What every file the application writes says about its author, so a file can be traced to a release. */
export const GENERATOR = `eebox ${APP_VERSION}`;

const GENERATOR_PATTERN = /^eebox \d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

/** The check of a `generator` field: the name and the version of the application that wrote the file. */
export const generatorCheck = (value: unknown): string | null =>
  typeof value === 'string' && GENERATOR_PATTERN.test(value) ? null : 'must read like "eebox 1.2.3"';

/** The same file without the mark of its author, which says nothing about its content: two writers of one project differ only in it. */
export function withoutGenerator<T extends object>(file: T): Omit<T, 'generator'> {
  const { generator: _author, ...content } = file as T & { generator?: string };
  return content;
}

/**
 * A sentence for a file that was refused, saying which version wrote it, so a person can tell a mistake in the file
 * from a file of another version. Null when the text is not an object, so there is nothing to say.
 */
export function versionHint(text: string, current: string = GENERATOR): string | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const written = (raw as Record<string, unknown>).generator;
  if (written === undefined) return `The file does not say which version wrote it; this is ${current}.`;
  if (generatorCheck(written) !== null) return null;
  return written === current ? null : `The file was written by ${written as string}; this is ${current}.`;
}
