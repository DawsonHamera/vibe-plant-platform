FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

FROM deps AS build
WORKDIR /app

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/backend apps/backend

RUN npm run build --workspace @vibe/shared \
  && npm run build --workspace @vibe/backend

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/apps/backend

# Install openssl for certificate generation
RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/packages/shared /app/packages/shared
COPY --from=build /app/apps/backend/dist ./dist
COPY --from=build /app/apps/backend/migrations ./migrations
COPY apps/backend/package.json ./package.json
COPY apps/backend/entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
