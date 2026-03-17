FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/frontend apps/frontend

ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build --workspace @vibe/shared \
  && npm run build --workspace @vibe/frontend

FROM nginx:1.27-alpine AS runtime
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html

EXPOSE 80
