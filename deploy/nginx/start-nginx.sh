#!/bin/sh
# NaraVisi · deploy/nginx/start-nginx.sh
# Fungsi   : Memilih konfigurasi nginx: HTTP saja (sebelum sertifikat ada) atau HTTPS (setelah Let's Encrypt).
# Kebutuhan: RNF-07 (HTTPS/TLS)
# Terkait  : http-only.conf.template, https.conf.template, deploy/docker-compose.prod.yml (layanan nginx & certbot)
set -eu

: "${DOMAIN:?DOMAIN kosong - isi di deploy/.env}"
DIR=/etc/naravisi-nginx
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

if [ -f "$CERT" ]; then
  TEMPLATE="$DIR/https.conf.template"
  echo "NaraVisi: sertifikat ditemukan, HTTPS aktif untuk ${DOMAIN}."
else
  TEMPLATE="$DIR/http-only.conf.template"
  echo "NaraVisi: sertifikat BELUM ada. Hanya HTTP (untuk verifikasi Let's Encrypt). Lihat ORACLE_FREE.md bagian 9."
fi

# Hanya ${DOMAIN} yang diganti; variabel nginx seperti $host tetap utuh.
envsubst '${DOMAIN}' < "$TEMPLATE" > /etc/nginx/conf.d/default.conf

# Muat ulang tiap 12 jam agar sertifikat yang diperpanjang certbot ikut terpakai.
( while :; do sleep 43200; nginx -s reload; done ) &

exec nginx -g 'daemon off;'
