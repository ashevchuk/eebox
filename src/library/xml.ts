/**
 * A reader for the part of XML that an SVG drawing uses, written by hand so that it needs no DOM and
 * cannot be talked into anything: no document type, no entities of its own, no external references.
 */
export interface XmlElement {
  /** The name without a namespace prefix; SVG names are case sensitive. */
  name: string;
  attributes: Record<string, string>;
  children: Array<XmlElement | string>;
}

export type XmlResult = { ok: true; root: XmlElement } | { ok: false; message: string };

export const MAX_XML_LENGTH = 262_144;
export const MAX_XML_ELEMENTS = 2000;
export const MAX_XML_DEPTH = 32;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const NAME = /[A-Za-z_][A-Za-z0-9_.:-]*/y;
const SPACE = /\s*/y;

class Failure extends Error {}

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (_all, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isInteger(code) || code < 0x20 || code > 0x10ffff || (code >= 0xd800 && code < 0xe000)) throw new Failure('a character reference that is not a text character');
      return String.fromCodePoint(code);
    }
    const known = ENTITIES[body];
    if (known === undefined) throw new Failure(`the entity &${body}; is not one of the five that are allowed`);
    return known;
  });
}

const local = (name: string): string => name.slice(name.lastIndexOf(':') + 1);

/** Reads one element and what it holds, or says why the text is not an SVG this application will read. */
export function parseXml(source: string): XmlResult {
  if (source.length > MAX_XML_LENGTH) return { ok: false, message: `The file is larger than ${MAX_XML_LENGTH / 1024} KB.` };
  const text = source.replace(/^﻿/, '');
  let at = 0;
  let elements = 0;
  const fail = (message: string): never => {
    throw new Failure(message);
  };
  const skipSpace = () => {
    SPACE.lastIndex = at;
    SPACE.exec(text);
    at = SPACE.lastIndex;
  };
  const name = (): string => {
    NAME.lastIndex = at;
    const match = NAME.exec(text);
    if (!match) return fail(`a name was expected at character ${at}`);
    at = NAME.lastIndex;
    return match[0];
  };

  function element(depth: number): XmlElement {
    if (depth > MAX_XML_DEPTH) fail(`the elements are nested deeper than ${MAX_XML_DEPTH} levels`);
    if (++elements > MAX_XML_ELEMENTS) fail(`there are more than ${MAX_XML_ELEMENTS} elements`);
    at++; // <
    const tag = name();
    const attributes: Record<string, string> = {};
    for (;;) {
      skipSpace();
      if (text.startsWith('/>', at)) {
        at += 2;
        return { name: local(tag), attributes, children: [] };
      }
      if (text[at] === '>') {
        at++;
        break;
      }
      const key = name();
      skipSpace();
      if (text[at] !== '=') fail(`the attribute ${key} has no value`);
      at++;
      skipSpace();
      const quote = text[at];
      if (quote !== '"' && quote !== "'") return fail(`the value of ${key} is not quoted`);
      const end = text.indexOf(quote, at + 1);
      if (end < 0) return fail(`the value of ${key} is not closed`);
      const value = text.slice(at + 1, end);
      if (value.includes('<')) fail(`the value of ${key} holds a <`);
      attributes[local(key)] = decode(value);
      at = end + 1;
    }
    const children: Array<XmlElement | string> = [];
    for (;;) {
      const next = text.indexOf('<', at);
      if (next < 0) return fail(`the element ${tag} is not closed`);
      if (next > at) {
        const chunk = decode(text.slice(at, next));
        if (chunk !== '') children.push(chunk);
      }
      at = next;
      if (text.startsWith('</', at)) {
        at += 2;
        const closing = name();
        skipSpace();
        if (text[at] !== '>') fail('a closing tag is not finished');
        at++;
        if (closing !== tag) fail(`the element ${tag} is closed by ${closing}`);
        return { name: local(tag), attributes, children };
      }
      if (text.startsWith('<!--', at)) {
        const end = text.indexOf('-->', at + 4);
        if (end < 0) fail('a comment is not closed');
        at = end + 3;
      } else if (text.startsWith('<![CDATA[', at)) {
        const end = text.indexOf(']]>', at + 9);
        if (end < 0) fail('a CDATA section is not closed');
        children.push(text.slice(at + 9, end));
        at = end + 3;
      } else if (text.startsWith('<?', at)) {
        const end = text.indexOf('?>', at + 2);
        if (end < 0) fail('a processing instruction is not closed');
        at = end + 2;
      } else if (text.startsWith('<!', at)) {
        fail('a declaration inside an element');
      } else {
        children.push(element(depth + 1));
      }
    }
  }

  try {
    if (/<!(DOCTYPE|ENTITY)/i.test(text)) fail('the file declares a document type or entities, which are not read');
    for (;;) {
      skipSpace();
      if (at >= text.length) return fail('there is no element in the file');
      if (text.startsWith('<?', at)) {
        const end = text.indexOf('?>', at + 2);
        if (end < 0) fail('a processing instruction is not closed');
        at = end + 2;
      } else if (text.startsWith('<!--', at)) {
        const end = text.indexOf('-->', at + 4);
        if (end < 0) fail('a comment is not closed');
        at = end + 3;
      } else if (text[at] === '<' && /[A-Za-z_]/.test(text[at + 1] ?? '')) {
        break;
      } else {
        fail(`unexpected text at character ${at}`);
      }
    }
    const root = element(0);
    skipSpace();
    while (at < text.length && text.startsWith('<!--', at)) {
      const end = text.indexOf('-->', at + 4);
      if (end < 0) fail('a comment is not closed');
      at = end + 3;
      skipSpace();
    }
    if (at < text.length) fail('there is more than one element at the top');
    return { ok: true, root };
  } catch (error) {
    if (error instanceof Failure) return { ok: false, message: `This is not an SVG that can be read: ${error.message}.` };
    throw error;
  }
}
