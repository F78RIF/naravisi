"""Unit test provider Gemini dengan mock client (tanpa internet)."""

import base64
import io
import unittest
from unittest.mock import MagicMock

from PIL import Image
from google.genai import errors, types

from app.config import Settings, load_settings
from app.image_utils import decode_base64_image
from app.main import create_app
from app.providers import GeminiCaptioner, ProviderError
from app.service import CaptionService

try:
    from fastapi.testclient import TestClient
except ImportError:  # pragma: no cover
    TestClient = None


def make_test_image(size=(100, 100), color=(50, 100, 200)) -> Image.Image:
    return Image.new("RGB", size, color)


def make_b64(size=(64, 40), color=(40, 80, 220)) -> str:
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def make_mock_response(text: str | None = None, finish_reason: str = "STOP", block_reason: str | None = None):
    parts = [types.Part.from_text(text=text)] if text is not None else []
    candidate = types.Candidate(
        finish_reason=finish_reason,
        content=types.Content(parts=parts) if parts else None,
    )
    prompt_feedback = types.GenerateContentResponsePromptFeedback(block_reason=block_reason) if block_reason else None
    return types.GenerateContentResponse(
        candidates=[candidate],
        prompt_feedback=prompt_feedback,
    )


class TestGeminiCaptioner(unittest.TestCase):
    def test_sukses(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = make_mock_response(
            "Seorang pria sedang berjalan di taman kota dengan latar pepohonan hijau."
        )

        captioner = GeminiCaptioner(
            api_key="dummy-key-for-test",
            model_name="gemini-2.5-flash",
            client=mock_client,
            timeout_seconds=15.0,
            max_output_tokens=120,
        )

        img = make_test_image()
        caption = captioner.caption(img)

        self.assertEqual(caption, "Seorang pria sedang berjalan di taman kota dengan latar pepohonan hijau.")
        mock_client.models.generate_content.assert_called_once()
        call_kwargs = mock_client.models.generate_content.call_args.kwargs
        self.assertEqual(call_kwargs["model"], "gemini-2.5-flash")
        self.assertEqual(len(call_kwargs["contents"]), 2)
        # Bagian pertama: Part gambar JPEG
        self.assertEqual(call_kwargs["contents"][0].inline_data.mime_type, "image/jpeg")
        # Bagian kedua: Teks instruksi
        self.assertIn("Deskripsikan gambar ini dalam 1–2 kalimat bahasa Indonesia", call_kwargs["contents"][1])

    def test_sukses_membersihkan_awalan_gambar_ini(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = make_mock_response(
            "Gambar ini menunjukkan seekor kucing tidur di lantai."
        )

        captioner = GeminiCaptioner(api_key="dummy-key", client=mock_client)
        caption = captioner.caption(make_test_image())
        self.assertEqual(caption, "seekor kucing tidur di lantai.")

    def test_integrasi_caption_service(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = make_mock_response(
            "seekor kucing putih duduk di dekat jendela"
        )

        captioner = GeminiCaptioner(
            api_key="dummy-key",
            model_name="gemini-2.5-flash",
            client=mock_client,
        )
        svc = CaptionService(captioner, translator=None)

        result = svc.describe(make_test_image(), lang="id")
        self.assertEqual(result.text, "Seekor kucing putih duduk di dekat jendela.")
        self.assertEqual(result.text_en, "")
        self.assertEqual(result.lang, "id")
        self.assertEqual(result.model, "gemini-2.5-flash")
        self.assertIsInstance(result.latency_ms, int)

    def test_error_429_kuota_habis(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = errors.APIError(
            429,
            {"error": {"code": 429, "message": "Resource has been exhausted", "status": "RESOURCE_EXHAUSTED"}},
        )

        captioner = GeminiCaptioner(api_key="dummy-key", client=mock_client)

        with self.assertRaises(ProviderError) as ctx:
            captioner.caption(make_test_image())

        self.assertEqual(ctx.exception.code, "MODEL_BUSY")
        self.assertEqual(ctx.exception.message, "Layanan AI sedang sibuk, coba lagi sebentar.")

    def test_error_key_salah_400_invalid_argument(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = errors.ClientError(
            400,
            {
                "error": {
                    "code": 400,
                    "message": "API key not valid. Please pass a valid API key.",
                    "status": "INVALID_ARGUMENT",
                    "details": [{"reason": "API_KEY_INVALID"}],
                }
            },
        )

        captioner = GeminiCaptioner(api_key="dummy-key", client=mock_client)

        with self.assertRaises(ProviderError) as ctx:
            captioner.caption(make_test_image())

        self.assertEqual(ctx.exception.code, "MODEL_AUTH")
        self.assertIn("Kunci API Gemini tidak valid", ctx.exception.message)

    def test_error_key_salah_401_403(self):
        for status_code in (401, 403):
            with self.subTest(status_code=status_code):
                mock_client = MagicMock()
                mock_client.models.generate_content.side_effect = errors.APIError(
                    status_code,
                    {"error": {"code": status_code, "message": "The caller does not have permission"}},
                )

                captioner = GeminiCaptioner(api_key="dummy-key", client=mock_client)

                with self.assertRaises(ProviderError) as ctx:
                    captioner.caption(make_test_image())

                self.assertEqual(ctx.exception.code, "MODEL_AUTH")

    def test_key_kosong_menolak_saat_inisialisasi(self):
        with self.assertRaises(ValueError) as ctx:
            GeminiCaptioner(api_key="")
        self.assertIn("GEMINI_API_KEY wajib diisi", str(ctx.exception))

    def test_respons_kosong(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = make_mock_response(text="")

        captioner = GeminiCaptioner(api_key="dummy-key", client=mock_client)
        # Captioner mengembalikan string kosong
        self.assertEqual(captioner.caption(make_test_image()), "")

        # Service melempar ValueError saat string kosong
        svc = CaptionService(captioner, translator=None)
        with self.assertRaises(ValueError) as ctx:
            svc.describe(make_test_image())
        self.assertIn("Model tidak menghasilkan deskripsi", str(ctx.exception))

    def test_respons_none_tanpa_candidate(self):
        mock_client = MagicMock()
        resp = types.GenerateContentResponse(candidates=[])
        mock_client.models.generate_content.return_value = resp

        captioner = GeminiCaptioner(api_key="dummy-key", client=mock_client)
        self.assertEqual(captioner.caption(make_test_image()), "")

    def test_respons_diblokir_safety_candidate(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = make_mock_response(
            text=None,
            finish_reason="SAFETY",
        )

        captioner = GeminiCaptioner(api_key="dummy-key", client=mock_client)
        with self.assertRaises(ProviderError) as ctx:
            captioner.caption(make_test_image())

        self.assertEqual(ctx.exception.code, "MODEL_SAFETY")
        self.assertIn("filter keamanan", ctx.exception.message)

    def test_respons_diblokir_prompt_feedback(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = make_mock_response(
            text=None,
            block_reason="SAFETY",
        )

        captioner = GeminiCaptioner(api_key="dummy-key", client=mock_client)
        with self.assertRaises(ProviderError) as ctx:
            captioner.caption(make_test_image())

        self.assertEqual(ctx.exception.code, "MODEL_SAFETY")

    def test_api_key_tidak_bocor_ke_pesan_galat(self):
        secret_key = "AIzaSySecretTestingKey999"
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = errors.APIError(
            500,
            {"error": {"code": 500, "message": f"Server crash for key {secret_key}"}},
        )

        captioner = GeminiCaptioner(api_key=secret_key, client=mock_client)
        with self.assertRaises(ProviderError) as ctx:
            captioner.caption(make_test_image())

        self.assertNotIn(secret_key, str(ctx.exception))
        self.assertIn("[REDACTED]", str(ctx.exception))


class TestGeminiConfig(unittest.TestCase):
    def test_config_provider_gemini_tanpa_key_melempar_galat(self):
        import os

        old_prov = os.environ.get("CAPTION_PROVIDER")
        old_key = os.environ.get("GEMINI_API_KEY")
        try:
            os.environ["CAPTION_PROVIDER"] = "gemini"
            os.environ["GEMINI_API_KEY"] = ""
            with self.assertRaises(ValueError) as ctx:
                load_settings()
            self.assertIn("GEMINI_API_KEY wajib diisi", str(ctx.exception))
        finally:
            if old_prov is not None:
                os.environ["CAPTION_PROVIDER"] = old_prov
            else:
                os.environ.pop("CAPTION_PROVIDER", None)
            if old_key is not None:
                os.environ["GEMINI_API_KEY"] = old_key
            else:
                os.environ.pop("GEMINI_API_KEY", None)

    def test_config_provider_gemini_dengan_key_sukses(self):
        import os

        old_prov = os.environ.get("CAPTION_PROVIDER")
        old_key = os.environ.get("GEMINI_API_KEY")
        old_model = os.environ.get("GEMINI_MODEL")
        try:
            os.environ["CAPTION_PROVIDER"] = "gemini"
            os.environ["GEMINI_API_KEY"] = "test-api-key-123"
            os.environ["GEMINI_MODEL"] = "gemini-2.0-flash-lite"
            cfg = load_settings()
            self.assertEqual(cfg.provider, "gemini")
            self.assertEqual(cfg.gemini_api_key, "test-api-key-123")
            self.assertEqual(cfg.gemini_model, "gemini-2.0-flash-lite")
            self.assertEqual(cfg.gemini_timeout_seconds, 15.0)
            self.assertEqual(cfg.gemini_max_output_tokens, 120)
        finally:
            if old_prov is not None:
                os.environ["CAPTION_PROVIDER"] = old_prov
            else:
                os.environ.pop("CAPTION_PROVIDER", None)
            if old_key is not None:
                os.environ["GEMINI_API_KEY"] = old_key
            else:
                os.environ.pop("GEMINI_API_KEY", None)
            if old_model is not None:
                os.environ["GEMINI_MODEL"] = old_model
            else:
                os.environ.pop("GEMINI_MODEL", None)


@unittest.skipIf(TestClient is None, "fastapi/httpx belum terpasang")
class TestGeminiApi(unittest.TestCase):
    def test_api_caption_gemini_sukses(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = make_mock_response(
            "Dua orang sedang membaca buku di perpustakaan."
        )

        captioner = GeminiCaptioner(api_key="test-key", client=mock_client)
        svc = CaptionService(captioner, translator=None)
        settings = Settings(provider="gemini", blip_model="", translation_model="", max_image_side=768)
        app = create_app(settings, svc)
        client = TestClient(app)

        res = client.post("/caption", json={"image_base64": make_b64(), "lang": "id"})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["text"], "Dua orang sedang membaca buku di perpustakaan.")
        self.assertEqual(data["text_en"], "")
        self.assertEqual(data["lang"], "id")

    def test_api_caption_gemini_429_model_busy(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = errors.APIError(
            429,
            {"error": {"code": 429, "message": "Resource exhausted", "status": "RESOURCE_EXHAUSTED"}},
        )

        captioner = GeminiCaptioner(api_key="test-key", client=mock_client)
        svc = CaptionService(captioner, translator=None)
        settings = Settings(provider="gemini", blip_model="", translation_model="", max_image_side=768)
        app = create_app(settings, svc)
        client = TestClient(app)

        res = client.post("/caption", json={"image_base64": make_b64(), "lang": "id"})
        self.assertEqual(res.status_code, 422)
        data = res.json()
        self.assertEqual(data["detail"]["code"], "MODEL_BUSY")
        self.assertEqual(data["detail"]["message"], "Layanan AI sedang sibuk, coba lagi sebentar.")

    def test_api_caption_gemini_auth_error(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = errors.ClientError(
            400,
            {"error": {"code": 400, "message": "API key not valid", "status": "INVALID_ARGUMENT"}},
        )

        captioner = GeminiCaptioner(api_key="test-key", client=mock_client)
        svc = CaptionService(captioner, translator=None)
        settings = Settings(provider="gemini", blip_model="", translation_model="", max_image_side=768)
        app = create_app(settings, svc)
        client = TestClient(app)

        res = client.post("/caption", json={"image_base64": make_b64(), "lang": "id"})
        self.assertEqual(res.status_code, 422)
        data = res.json()
        self.assertEqual(data["detail"]["code"], "MODEL_AUTH")

    def test_api_caption_gemini_empty_response(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = make_mock_response(text="")

        captioner = GeminiCaptioner(api_key="test-key", client=mock_client)
        svc = CaptionService(captioner, translator=None)
        settings = Settings(provider="gemini", blip_model="", translation_model="", max_image_side=768)
        app = create_app(settings, svc)
        client = TestClient(app)

        res = client.post("/caption", json={"image_base64": make_b64(), "lang": "id"})
        self.assertEqual(res.status_code, 422)
        data = res.json()
        self.assertEqual(data["detail"]["code"], "NO_CAPTION")


if __name__ == "__main__":
    unittest.main()
