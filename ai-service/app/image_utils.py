"""Dekode dan normalisasi gambar sebelum dikirim ke model."""

from __future__ import annotations

import base64
import binascii
import io

from PIL import Image, ImageOps, UnidentifiedImageError

# Lindungi dari "decompression bomb" (gambar kecil yang mengembang jadi raksasa).
Image.MAX_IMAGE_PIXELS = 40_000_000

MIN_SIDE = 16


class ImageError(ValueError):
    """Gambar tidak dapat dibaca. `code` stabil, `message` berbahasa Indonesia."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def decode_base64_image(data: str, max_side: int = 768) -> Image.Image:
    if not data or not isinstance(data, str):
        raise ImageError("IMAGE_MISSING", "Data gambar tidak dikirim.")

    raw = data.strip()
    if raw.startswith("data:"):
        _, _, raw = raw.partition(",")

    try:
        blob = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ImageError("IMAGE_INVALID", "Data gambar bukan base64 yang valid.") from exc

    try:
        img = Image.open(io.BytesIO(blob))
        img.load()  # memaksa dekode penuh agar file rusak terdeteksi di sini
    except Image.DecompressionBombError as exc:
        raise ImageError("IMAGE_TOO_LARGE", "Resolusi gambar terlalu besar.") from exc
    except (UnidentifiedImageError, OSError) as exc:
        raise ImageError("IMAGE_UNREADABLE", "Gambar tidak dapat dibuka atau formatnya tidak didukung.") from exc

    return normalize_image(img, max_side=max_side)


def normalize_image(img: Image.Image, max_side: int = 768) -> Image.Image:
    # GIF/WebP animasi: ambil frame pertama.
    if getattr(img, "is_animated", False):
        img.seek(0)

    # Hormati orientasi EXIF dari foto ponsel.
    img = ImageOps.exif_transpose(img)

    if img.width < MIN_SIDE or img.height < MIN_SIDE:
        raise ImageError("IMAGE_TOO_SMALL", "Gambar terlalu kecil untuk dideskripsikan.")

    # Transparansi ditumpuk di atas latar putih (logo PNG transparan jadi terbaca).
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        img = background
    else:
        img = img.convert("RGB")

    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

    return img
