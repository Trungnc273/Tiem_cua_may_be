FROM node:22.19-alpine AS build
WORKDIR /app
RUN npm install --global pnpm@12.4.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:22.19-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 PRODUCT_UPLOAD_DIR=/data/uploads/products
WORKDIR /app
RUN mkdir -p /data/uploads/products && chown -R node:node /data/uploads
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/drizzle ./dist/drizzle
USER node
EXPOSE 4000
CMD ["node", "dist/src/server.js"]
