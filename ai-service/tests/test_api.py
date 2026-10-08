"""Uji endpoint FastAPI. Membutuhkan `pip install -r requirements.txt`."""

import unittest

try:
    from fastapi.testclient import TestClient
except ImportError:  # pragma: no cover
    TestClient = None

from tests.test_service import make_b64


@unittest.skipIf(TestClient is None, "fastapi/httpx belum terpasang")
class TestApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app.config import Settings
        from app.main import create_app
        from app.providers import MockCaptioner, MockTranslator
        from app.service import CaptionService

        settings = Settings(provider="mock", blip_model="", translation_model="", max_image_side=768)
        app = create_app(settings, CaptionService(MockCaptioner(), MockTranslator()))
        cls.client = TestClient(app)

    def test_health(self):
        body = self.client.get("/health").json()
        self.assertEqual(body["status"], "ok")

    def test_caption_ok(self):
        res = self.client.post("/caption", json={"image_base64": make_b64(), "lang": "id"})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["text"].endswith("."))

    def test_caption_unreadable(self):
        res = self.client.post("/caption", json={"image_base64": "aGFsbw==", "lang": "id"})
        self.assertEqual(res.status_code, 415)
        self.assertEqual(res.json()["detail"]["code"], "IMAGE_UNREADABLE")

    def test_caption_bad_lang(self):
        res = self.client.post("/caption", json={"image_base64": make_b64(), "lang": "fr"})
        self.assertEqual(res.status_code, 422)
