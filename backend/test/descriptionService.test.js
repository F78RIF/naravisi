import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDescriptionService } from '../src/services/descriptionService.js';
import { fakeAiClient, PNG_1PX_BASE64 } from './helpers.js';

const MAX = 1024 * 1024;

describe('descriptionService.describe (UC-GBR-04/05)', () => {
  it('mengembalikan deskripsi beserta metadata', async () => {
    const ai = fakeAiClient();
    const svc = createDescriptionService({ aiClient: ai, maxImageBytes: MAX });
    const out = await svc.describe({
      image_base64: PNG_1PX_BASE64,
      page_url: 'https://contoh.id/berita',
      image_url: 'https://contoh.id/a.png',
    });
    assert.equal(out.text, 'Seekor kucing duduk di atas sofa.');
    assert.equal(out.lang, 'id');
    assert.equal(out.image_mime, 'image/png');
    assert.equal(out.page_url, 'https://contoh.id/berita');
    assert.equal(ai.calls.length, 1);
    assert.equal(ai.calls[0].lang, 'id');
  });

  it('bahasa default "id", menerima "en"', async () => {
    const ai = fakeAiClient();
    const svc = createDescriptionService({ aiClient: ai, maxImageBytes: MAX });
    await svc.describe({ image_base64: PNG_1PX_BASE64, lang: 'en' });
    assert.equal(ai.calls[0].lang, 'en');
  });

  it('menolak bahasa yang tidak didukung tanpa memanggil AI', async () => {
    const ai = fakeAiClient();
    const svc = createDescriptionService({ aiClient: ai, maxImageBytes: MAX });
    await assert.rejects(svc.describe({ image_base64: PNG_1PX_BASE64, lang: 'jp' }), { code: 'INVALID_REQUEST' });
    assert.equal(ai.calls.length, 0);
  });

  it('menolak body bukan objek', async () => {
    const svc = createDescriptionService({ aiClient: fakeAiClient(), maxImageBytes: MAX });
    await assert.rejects(svc.describe(null), { code: 'INVALID_REQUEST' });
  });

  it('tidak memanggil AI bila gambar tidak valid', async () => {
    const ai = fakeAiClient();
    const svc = createDescriptionService({ aiClient: ai, maxImageBytes: MAX });
    await assert.rejects(svc.describe({ image_base64: 'xx' }), { code: 'IMAGE_INVALID' });
    assert.equal(ai.calls.length, 0);
  });
});
