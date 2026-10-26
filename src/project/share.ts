import { parseProjectJson, type ProjectFile, type ProjectParseResult } from './file';

export const SHARE_PREFIX = '#p=';
const MAX_DECOMPRESSED_BYTES = 8 * 1024 * 1024;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Links are untrusted input, so inflation stops at `maxBytes` instead of trusting the stream. */
async function inflate(bytes: Uint8Array<ArrayBuffer>, maxBytes: number): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`payload exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(joined);
}

export async function encodeShare(file: ProjectFile): Promise<string> {
  return toBase64Url(await deflate(JSON.stringify(file)));
}

export async function decodeShare(encoded: string, maxBytes = MAX_DECOMPRESSED_BYTES): Promise<ProjectParseResult> {
  let text: string;
  try {
    text = await inflate(fromBase64Url(encoded), maxBytes);
  } catch (e) {
    return { ok: false, errors: [{ path: '', message: `invalid share link: ${(e as Error).message}` }] };
  }
  return parseProjectJson(text);
}
