import { describe, expect, it } from 'vitest';
import { MAX_XML_DEPTH, MAX_XML_ELEMENTS, MAX_XML_LENGTH, parseXml } from '../src/library/xml';

const ok = (text: string) => {
  const result = parseXml(text);
  if (!result.ok) throw new Error(result.message);
  return result.root;
};
const refused = (text: string) => {
  const result = parseXml(text);
  if (result.ok) throw new Error('expected a refusal');
  return result.message;
};

describe('the XML reader', () => {
  it('reads elements, attributes in either kind of quote and text', () => {
    const root = ok(`<svg a="1" b='two'><g id="x"><text>Hi &amp; bye</text></g><rect/></svg>`);
    expect(root.name).toBe('svg');
    expect(root.attributes).toEqual({ a: '1', b: 'two' });
    const [g, rect] = root.children as Array<{ name: string; children: unknown[] }>;
    expect(g!.name).toBe('g');
    expect(rect!.name).toBe('rect');
    const text = (g!.children[0] as { children: unknown[] }).children;
    expect(text).toEqual(['Hi & bye']);
  });

  it('drops the prefix of names and of attributes', () => {
    const root = ok('<svg:svg xmlns:svg="http://www.w3.org/2000/svg" xlink:href="a" svg:x="3"><svg:rect/></svg:svg>');
    expect(root.name).toBe('svg');
    expect(root.attributes.href).toBe('a');
    expect(root.attributes.x).toBe('3');
    expect((root.children[0] as { name: string }).name).toBe('rect');
  });

  it('skips the declaration, comments and processing instructions, and reads CDATA as text', () => {
    const root = ok('﻿<?xml version="1.0"?>\n<!-- a --><svg><!-- b --><?x y?><text><![CDATA[a < b]]></text></svg><!-- c -->');
    expect(((root.children[0] as { children: unknown[] }).children)).toEqual(['a < b']);
  });

  it('reads the five entities and character references', () => {
    const root = ok('<svg a="&lt;&gt;&quot;&apos;&amp;"><t>&#65;&#x42;</t></svg>');
    expect(root.attributes.a).toBe('<>"\'&');
    expect(((root.children[0] as { children: unknown[] }).children)).toEqual(['AB']);
  });

  it('refuses a document type and entities, which is how a small file becomes a huge one', () => {
    expect(refused('<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg>&a;</svg>')).toMatch(/document type or entities/);
    expect(refused('<!doctype svg><svg/>')).toMatch(/document type or entities/);
  });

  it('refuses an entity that is not one of the five, and a character reference that is not text', () => {
    expect(refused('<svg>&nbsp;</svg>')).toMatch(/entity &nbsp; is not one of the five/);
    expect(refused('<svg>&#0;</svg>')).toMatch(/character reference/);
    expect(refused('<svg>&#xD800;</svg>')).toMatch(/character reference/);
  });

  it('refuses what is not well formed', () => {
    expect(refused('')).toMatch(/no element/);
    expect(refused('plain text')).toMatch(/unexpected text/);
    expect(refused('<svg>')).toMatch(/not closed/);
    expect(refused('<svg></g>')).toMatch(/closed by g/);
    expect(refused('<svg a=1/>')).toMatch(/not quoted/);
    expect(refused('<svg a="1/>')).toMatch(/not closed/);
    expect(refused('<svg a/>')).toMatch(/has no value/);
    expect(refused('<svg a="<"/>')).toMatch(/holds a </);
    expect(refused('<svg/><svg/>')).toMatch(/more than one element/);
    expect(refused('<svg><!x></svg>')).toMatch(/declaration/);
    expect(refused('<svg><!-- x</svg>')).toMatch(/comment/);
  });

  it('is bounded in size, in the number of elements and in depth', () => {
    expect(refused(`<svg>${' '.repeat(MAX_XML_LENGTH)}</svg>`)).toMatch(/larger than/);
    expect(refused(`<svg>${'<g/>'.repeat(MAX_XML_ELEMENTS)}</svg>`)).toMatch(/more than 2000 elements/);
    expect(refused(`${'<g>'.repeat(MAX_XML_DEPTH + 2)}${'</g>'.repeat(MAX_XML_DEPTH + 2)}`)).toMatch(/nested deeper/);
    expect(parseXml(`${'<g>'.repeat(MAX_XML_DEPTH)}${'</g>'.repeat(MAX_XML_DEPTH)}`).ok).toBe(true);
  });
});
