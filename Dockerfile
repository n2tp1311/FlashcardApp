FROM node:20-alpine

# node-sqlite3-wasm is pure WASM — no native build tools needed

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p data

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server/index.js"]
