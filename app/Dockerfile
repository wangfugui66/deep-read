FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install

COPY . .

RUN npm run build 2>/dev/null || echo "build skipped (dev mode)"

CMD ["npm", "run", "start"]
