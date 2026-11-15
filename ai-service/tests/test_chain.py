# NaraVisi · ai-service/tests/test_chain.py
# Fungsi   : Tes rantai provider (PF-13): CAPTION_CHAIN, provider tanpa kunci dilewati, 429 → berikutnya, keluaran
#            OpenRouter/Hugging Face disamakan ke format Gemini, bukan JSON → keyakinan rendah, /health tanpa nilai kunci.
#            Semua memakai klien palsu (tanpa internet).
# Kebutuhan: PF-13, PF-04
from __future__ import annotations

import json
import os
import unittest
from unittest import mock

import httpx
from fastapi.testclient import TestClient
from google.genai import errors

from app.cloud import OpenAICompatCaptioner, parse_structured
from app.config import Settings, load_settings, parse_chain, production_problems
from app.main import build_service, create_app
from app.providers import ProviderError
from tests.test_gemini import KEY, MODEL, FakeClient, answer, api_error, b64, image, response

OR_KEY = "sk-or-v1-kunciujirahasia0000"
HF_KEY = "hf_kunciUjiRahasia0000000"


class FakeHttp:
    """httpx.Client palsu: `script` = daftar (status, body) berurutan; mencatat setiap permintaan."""

    def __init__(self, *script):
        self.script = list(script)
        self.requests = []

        def handler(req: httpx.Request) -> httpx.Response:
            self.requests.append(req)
            item = self.script.pop(0) if len(self.script) > 1 else self.script[0]
            if isinstance(item, Exception):
                raise item
            status, body = item
            return httpx.Response(status, json=body) if not isinstance(body, str) else httpx.Response(status, text=body)

        self.client = httpx.Client(transport=httpx.MockTransport(handler))

    def post(self, *a, **kw):
        return self.client.post(*a, **kw)


def chat(content):
    return 200, {"choices": [{"message": {"role": "assistant", "content": content}}]}


def settings(chain, **kw):
    base = dict(provider=chain[0] if chain[0] in ("gemini", "blip", "mock") else "gemini", blip_model="", translation_model="",
                max_image_side=768, chain=tuple(chain), gemini_api_key=KEY, gemini_model=MODEL, fallback_provider="none",
                fewshot_path="tidak-ada.json")
    base.update(kw)
    return Settings(**base)


class TestRantai(unittest.TestCase):
    def test_parse_chain_urut_unik_dan_menolak_nama_asing(self):
        self.assertEqual(parse_chain(" Gemini, openrouter ,hf,blip,hf "), ("gemini", "openrouter", "hf", "blip"))
        self.assertEqual(parse_chain(""), ())
        with self.assertRaises(ValueError):
            parse_chain("gemini,gpt")

    def test_provider_tanpa_kunci_dilewati_otomatis(self):
        s = settings(["gemini", "openrouter", "hf", "mock"], openrouter_model="m/vision:free")  # kunci OpenRouter & HF kosong
        r = build_service(s, clients={"gemini": FakeClient(response(answer()))})
        self.assertEqual([link.provider for link in r.links if hasattr(link, "provider")][:1], ["gemini"])
        self.assertEqual(r.skipped, ["openrouter", "hf"])
        states = {p["name"]: p["state"] for p in r.status()}
        self.assertEqual(states["openrouter"], "tanpa_kunci")
        self.assertEqual(states["hf"], "tanpa_kunci")

    def test_429_gemini_lanjut_ke_openrouter_lalu_hf_tidak_dipanggil(self):
        orr, hf = FakeHttp(chat(answer(jenis="foto", ringkasan="Dua anak bermain bola di lapangan"))), FakeHttp(chat(answer()))
        s = settings(["gemini", "openrouter", "hf", "mock"], openrouter_api_key=OR_KEY, openrouter_model="m/vision:free",
                     hf_token=HF_KEY, hf_model="org/vlm")
        r = build_service(s, clients={"gemini": FakeClient(api_error(errors.ClientError, 429, "quota")), "openrouter": orr, "hf": hf})
        res = r.describe(image(), "id")
        self.assertEqual(res.provider, "openrouter")
        self.assertTrue(res.fallback)
        self.assertEqual(res.fallback_reason, "MODEL_BUSY")
        self.assertEqual(res.text, "Foto: Dua anak bermain bola di lapangan. Batang berwarna biru, tertinggi pada bulan Juni.")
        self.assertEqual(len(orr.requests), 1)
        self.assertEqual(len(hf.requests), 0)
        # Permintaan OpenRouter: kunci di header, model, instruksi Gemini, gambar sebagai data URL JPEG.
        req = orr.requests[0]
        self.assertEqual(str(req.url), "https://openrouter.ai/api/v1/chat/completions")
        self.assertEqual(req.headers["authorization"], f"Bearer {OR_KEY}")
        body = json.loads(req.content)
        self.assertEqual(body["model"], "m/vision:free")
        self.assertIn("Jangan menebak identitas orang", body["messages"][0]["content"])
        self.assertTrue(body["messages"][1]["content"][1]["image_url"]["url"].startswith("data:image/jpeg;base64,"))

    def test_429_openrouter_lanjut_ke_hf(self):
        orr, hf = FakeHttp((429, {"error": "rate limit"})), FakeHttp(chat(answer(ringkasan="Grafik batang penjualan")))
        s = settings(["openrouter", "hf", "mock"], openrouter_api_key=OR_KEY, openrouter_model="m", hf_token=HF_KEY, hf_model="v")
        res = build_service(s, clients={"openrouter": orr, "hf": hf}).describe(image(), "id")
        self.assertEqual(res.provider, "hf")
        self.assertEqual(res.fallback_reason, "MODEL_BUSY")
        self.assertEqual(str(hf.requests[0].url), "https://router.huggingface.co/v1/chat/completions")

    def test_semua_cloud_gagal_lalu_cadangan_lokal(self):
        orr, hf = FakeHttp((402, {"error": "credits"})), FakeHttp((503, {"error": "down"}))
        s = settings(["openrouter", "hf", "mock"], openrouter_api_key=OR_KEY, openrouter_model="m", hf_token=HF_KEY, hf_model="v")
        r = build_service(s, clients={"openrouter": orr, "hf": hf})
        r.links[-1].load()  # cadangan mock dimuat (di layanan sungguhan: di latar saat start)
        res = r.describe(image(), "id")
        self.assertEqual(res.provider, "mock")
        self.assertEqual(res.fallback_reason, "MODEL_BUSY")

    def test_bukan_json_disusun_sebisanya_keyakinan_rendah(self):
        d = parse_structured("Gambar ini menunjukkan seekor kucing tidur di sofa.")
        self.assertEqual(d["jenis"], "lainnya")
        self.assertEqual(d["keyakinan"], "rendah")
        self.assertEqual(d["ringkasan"], "seekor kucing tidur di sofa.")
        orr = FakeHttp(chat("Seekor kucing tidur di sofa"))
        res = build_service(settings(["openrouter"], openrouter_api_key=OR_KEY, openrouter_model="m"), clients={"openrouter": orr}).describe(image())
        self.assertEqual(res.keyakinan, "rendah")
        self.assertIn("mungkin kurang tepat", res.text)
        self.assertEqual(parse_structured('```json\n{"jenis":"logo","ringkasan":"Logo NaraVisi"}\n```')["jenis"], "logo")
        with self.assertRaises(ProviderError):
            parse_structured("   ")

    def test_peta_galat_http(self):
        cases = [(401, "MODEL_AUTH"), (403, "MODEL_AUTH"), (429, "MODEL_BUSY"), (402, "MODEL_BUSY"), (500, "MODEL_UNAVAILABLE"),
                 (400, "MODEL_ERROR")]
        for status, code in cases:
            with self.subTest(status=status):
                cap = OpenAICompatCaptioner("hf", HF_KEY, "v", client=FakeHttp((status, {"error": "x"})))
                with self.assertRaises(ProviderError) as ctx:
                    cap.describe_structured(image())
                self.assertEqual(ctx.exception.code, code)
                self.assertNotIn(HF_KEY, ctx.exception.message)
        cap = OpenAICompatCaptioner("hf", HF_KEY, "v", client=FakeHttp(httpx.ConnectTimeout("lambat")))
        with self.assertRaises(ProviderError) as ctx:
            cap.describe_structured(image())
        self.assertEqual(ctx.exception.code, "MODEL_TIMEOUT")

    def test_safety_gemini_tidak_dialihkan(self):
        orr = FakeHttp(chat(answer()))
        s = settings(["gemini", "openrouter"], openrouter_api_key=OR_KEY, openrouter_model="m")
        r = build_service(s, clients={"gemini": FakeClient(response(None, block_reason="SAFETY")), "openrouter": orr})
        with self.assertRaises(ProviderError) as ctx:
            r.describe(image())
        self.assertEqual(ctx.exception.code, "MODEL_SAFETY")
        self.assertEqual(len(orr.requests), 0)

    def test_health_status_tiap_provider_tanpa_nilai_kunci(self):
        s = settings(["gemini", "openrouter", "hf", "mock"], openrouter_api_key=OR_KEY, openrouter_model="m")
        r = build_service(s, clients={"gemini": FakeClient(response(answer())), "openrouter": FakeHttp(chat(answer()))})
        client = TestClient(create_app(s, r))
        body = client.get("/health").json()
        self.assertEqual(body["chain"], ["gemini", "openrouter", "hf", "mock"])
        self.assertEqual({p["name"]: p["state"] for p in body["providers"]},
                         {"gemini": "ready", "openrouter": "ready", "mock": "idle", "hf": "tanpa_kunci"})
        text = json.dumps(body)
        for secret in (KEY, OR_KEY):
            self.assertNotIn(secret, text)

    def test_semua_gagal_respons_jelas_bukan_500(self):
        s = settings(["gemini", "openrouter"], openrouter_api_key=OR_KEY, openrouter_model="m")
        r = build_service(s, clients={"gemini": FakeClient(api_error(errors.ClientError, 429, "quota")), "openrouter": FakeHttp((429, {}))})
        res = TestClient(create_app(s, r)).post("/caption", json={"image_base64": b64()})
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res.json()["detail"]["code"], "MODEL_BUSY")


class TestKonfigurasiRantai(unittest.TestCase):
    ENV = {"CAPTION_CHAIN": "gemini,openrouter,hf,blip", "GEMINI_API_KEY": KEY, "GEMINI_MODEL": MODEL,
           "OPENROUTER_API_KEY": OR_KEY, "OPENROUTER_MODEL": "m/vision:free", "HF_TOKEN": "", "HF_MODEL": ""}

    def test_load_settings_rantai_dan_kunci_tidak_tercetak(self):
        with mock.patch.dict(os.environ, self.ENV, clear=True):
            s = load_settings()
        self.assertEqual(s.chain, ("gemini", "openrouter", "hf", "blip"))
        self.assertEqual(s.fallback_provider, "blip")
        self.assertEqual(s.openrouter_model, "m/vision:free")
        self.assertNotIn(OR_KEY, repr(s))
        self.assertNotIn(KEY, repr(s))
        self.assertEqual(set(s.secrets), {KEY, OR_KEY})

    def test_rantai_tanpa_kunci_gemini_tidak_gagal_start(self):
        with mock.patch.dict(os.environ, {"CAPTION_CHAIN": "gemini,openrouter,blip", "OPENROUTER_API_KEY": OR_KEY,
                                          "OPENROUTER_MODEL": "m"}, clear=True):
            s = load_settings()
        r = build_service(s, clients={"openrouter": FakeHttp(chat(answer()))})
        self.assertEqual(r.skipped, ["gemini"])
        self.assertEqual(r.provider, "openrouter")

    def test_tanpa_rantai_perilaku_lama(self):
        with mock.patch.dict(os.environ, {"CAPTION_PROVIDER": "mock"}, clear=True):
            s = load_settings()
        self.assertEqual(s.effective_chain, ("mock",))

    def test_production_rantai_wajib_gemini_dulu_dan_blip(self):
        with mock.patch.dict(os.environ, {**self.ENV, "CAPTION_CHAIN": "openrouter,gemini"}, clear=True):
            problems = production_problems()
        self.assertTrue(any("diawali 'gemini'" in p for p in problems))
        self.assertTrue(any("'blip'" in p for p in problems))
        with mock.patch.dict(os.environ, {**self.ENV, "CAPTION_PROVIDER": "gemini"}, clear=True):
            self.assertEqual(production_problems(), [])


if __name__ == "__main__":
    unittest.main()
