FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json

RUN npm ci

COPY . .
RUN npm run build --workspace client

FROM node:20-alpine AS runtime

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json

RUN npm ci --omit=dev

COPY server ./server
COPY --from=build /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV PORT=11142

EXPOSE 11142

CMD ["node", "server/src/index.js"]
