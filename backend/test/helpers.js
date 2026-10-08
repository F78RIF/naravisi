// PNG 1x1 piksel transparan, ditambah padding agar lolos batas minimal 12 byte.
export const PNG_1PX_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export const JPEG_HEADER_BASE64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
]).toString('base64');

export function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (body === undefined) throw new SyntaxError('no json');
      return body;
    },
  };
}

export function fakeAiClient(overrides = {}) {
  const calls = [];
  return {
    calls,
    async caption(args) {
      calls.push(args);
      if (overrides.caption) return overrides.caption(args);
      return { text: 'Seekor kucing duduk di atas sofa.', textEn: 'a cat sitting on a couch', lang: args.lang, model: 'mock', latencyMs: 5 };
    },
    async health() {
      return { ok: true, provider: 'mock' };
    },
  };
}
