FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY client/package.json client/
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM deps AS build
COPY server ./server
COPY client ./client
RUN npm run build -w client
RUN npm run build -w server
RUN rm -rf server/public && cp -r client/dist server/public

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
ENV NODE_ENV=production
COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/server/package.json ./server/package.json
COPY --from=build --chown=app:app /app/server/dist ./server/dist
COPY --from=build --chown=app:app /app/server/public ./server/public
EXPOSE 4000
WORKDIR /app/server
USER app
CMD ["node", "dist/index.js"]
