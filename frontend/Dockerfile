# Vite bakes VITE_* env vars into the built JS bundle at build time, not
# read at container startup - so the backend URL is a build ARG here, not
# a runtime environment variable. Rebuild the image to point at a
# different backend.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_HTTP_BASE=http://localhost:8000
ARG VITE_API_WS_BASE=ws://localhost:8000
ENV VITE_API_HTTP_BASE=${VITE_API_HTTP_BASE}
ENV VITE_API_WS_BASE=${VITE_API_WS_BASE}
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
