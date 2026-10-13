# SpatialDesk AI - production image: static client + Node API server.
# Build:  docker build -t spatialdesk .
# Run:    docker run -p 8787:8787 -e ANTHROPIC_API_KEY=... spatialdesk
FROM node:22-alpine AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8787 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
EXPOSE 8787
USER node
CMD ["node", "server/index.js"]
