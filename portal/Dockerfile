FROM node:22-alpine

WORKDIR /app

COPY portal/package.json portal/package-lock.json* ./
RUN npm install

COPY portal/ ./
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
