# Một image cho cả api, worker, mock (docker-compose.yml chọn lệnh chạy).

# ---- Tầng 1: cài thư viện (cả thư viện dev để build) ----
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ---- Tầng 2: biên dịch TypeScript, bỏ thư viện dev ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# ---- Tầng 3: runtime, chạy bằng user node ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
  PORT=3000 \
  LOG_DIR=/app/logs
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
# Cấu hình mặc định, chi phí mẫu, payload mẫu (seed, import, demo chạy trong container).
COPY --chown=node:node seeds ./seeds
COPY --chown=node:node samples ./samples
RUN mkdir -p logs && chown node:node logs
USER node
EXPOSE 3000 4000
CMD ["node", "dist/main.js"]
