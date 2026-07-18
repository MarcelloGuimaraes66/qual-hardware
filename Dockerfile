FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV QUAL_HARDWARE_SQLITE_PATH=/data/qual-hardware.sqlite
ENV REPORT_STORAGE_DIR=/data/reports
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/contracts ./contracts
COPY --from=build /app/database ./database
RUN mkdir -p /data/reports && chown -R node:node /data
USER node
EXPOSE 4178
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=6 CMD ["node", "-e", "fetch('http://127.0.0.1:4178/api/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]
CMD ["node", "dist/server/server/index.js"]
