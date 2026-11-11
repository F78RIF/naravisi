# NaraVisi · deploy/docker/backend.Dockerfile
# Fungsi   : Image backend (Node.js 22) untuk docker-compose.prod.yml; konteks build = folder backend/.
# Kebutuhan: semua RF (REST API), RNF-07 (berjalan di belakang nginx HTTPS)
# Terkait  : deploy/docker-compose.prod.yml, backend.Dockerfile.dockerignore, backend/scripts/setup-db.js
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY scripts ./scripts

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# setup-db.js idempoten: membuat tabel bila belum ada, paket Premium, dan akun Admin dari ADMIN_EMAIL/ADMIN_PASSWORD.
CMD ["sh", "-c", "node scripts/setup-db.js && exec node src/server.js"]
