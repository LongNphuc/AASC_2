# ---- Admin panel: build Vue 3 + Tailwind ra public/admin ----
FROM node:24-bookworm-slim AS admin
WORKDIR /app/admin-ui
COPY admin-ui/package.json admin-ui/package-lock.json ./
RUN npm ci
COPY admin-ui ./
RUN npm run build

# ---- Backend: cài thư viện, biên dịch TypeScript, bỏ thư viện dev ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- Runtime: mã đã biên dịch, thư viện chạy, trang admin, mapping mẫu ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
  PORT=3000 \
  LOG_DIR=/app/logs
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json mapping.json ./
COPY --from=admin --chown=node:node /app/public/admin ./public/admin
RUN mkdir -p logs secrets && chown node:node logs secrets
USER node
EXPOSE 3000

# Docker gọi GET /health mỗi 30 giây; 3 lần liên tiếp lỗi thì đánh dấu "unhealthy".
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "dist/main.js"]
