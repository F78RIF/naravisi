import base64
import io
import unittest

from PIL import Image

from app.image_utils import ImageError, decode_base64_image
from app.providers import MockCaptioner, MockTranslator
from app.service import CaptionService, clean_english_caption, to_sentence


def make_b64(size=(64, 40), color=(40, 80, 220), mode="RGB", fmt="PNG") -> str:
    img = Image.new(mode, size, color)
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode()


class TestCleaning(unittest.TestCase):
    def test_removes_blip_artifacts(self):
        self.assertEqual(clean_english_caption("arafed man riding a bike"), "man riding a bike")
        self.assertEqual(clean_english_caption("there is a dog on the grass ."), "a dog on the grass")

    def test_removes_leading_filler_and_repeats(self):
        self.assertEqual(clean_english_caption("a picture of a a cat"), "a cat")

    def test_to_sentence(self):
        self.assertEqual(to_sentence("seekor kucing di sofa"), "Seekor kucing di sofa.")
        self.assertEqual(to_sentence("Halo!"), "Halo!")
        self.assertEqual(to_sentence("   "), "")


class TestDecode(unittest.TestCase):
    def test_png_and_data_url(self):
        b64 = make_b64()
        self.assertEqual(decode_base64_image(b64).mode, "RGB")
        self.assertEqual(decode_base64_image("data:image/png;base64," + b64).size, (64, 40))

    def test_downscale_large(self):
        img = decode_base64_image(make_b64(size=(2000, 1000), fmt="JPEG"), max_side=768)
        self.assertEqual(max(img.size), 768)

    def test_transparent_png_flattened_to_white(self):
        img = decode_base64_image(make_b64(mode="RGBA", color=(0, 0, 0, 0)))
        self.assertEqual(img.getpixel((5, 5)), (255, 255, 255))

    def test_invalid_inputs(self):
        cases = {
            "": "IMAGE_MISSING",
            "%%%": "IMAGE_INVALID",
            base64.b64encode(b"<svg></svg>").decode(): "IMAGE_UNREADABLE",
            make_b64(size=(8, 8)): "IMAGE_TOO_SMALL",
        }
        for data, code in cases.items():
            with self.subTest(code=code):
                with self.assertRaises(ImageError) as ctx:
                    decode_base64_image(data)
                self.assertEqual(ctx.exception.code, code)


class TestCaptionService(unittest.TestCase):
    def setUp(self):
        self.svc = CaptionService(MockCaptioner(), MockTranslator())

    def test_indonesian(self):
        res = self.svc.describe(decode_base64_image(make_b64(size=(120, 40))), "id")
        self.assertEqual(res.lang, "id")
        self.assertEqual(res.text, "Gambar melebar yang sebagian besar berwarna biru.")
        self.assertEqual(res.text_en, "A wide image that is mostly blue.")
        self.assertEqual(res.model, "mock + mock")

    def test_english(self):
        res = self.svc.describe(decode_base64_image(make_b64(size=(40, 120), color=(220, 40, 40))), "en")
        self.assertEqual(res.text, "A tall image that is mostly red.")
        self.assertEqual(res.lang, "en")

    def test_empty_caption_raises(self):
        class Empty:
            name = "empty"

            def caption(self, image):
                return "arafed"

        with self.assertRaises(ValueError):
            CaptionService(Empty(), None).describe(decode_base64_image(make_b64()))


if __name__ == "__main__":
    unittest.main()


class TestWarmUp(unittest.TestCase):
    def test_runs_one_inference_and_ignores_empty_caption(self):
        from app.main import warm_up

        class EmptyCaptioner(MockCaptioner):
            calls = 0

            def caption(self, image):
                EmptyCaptioner.calls += 1
                return ""

        warm_up(CaptionService(EmptyCaptioner(), MockTranslator()))  # tidak melempar galat
        self.assertEqual(EmptyCaptioner.calls, 1)
