# Частина 1 постачається зі своїм самодостатнім образом.
# У ДЗ #5 (де вже є свій Dockerfile/образ) достатньо перевикористати
# наявний сервіс `api` — команда та сама: `npm test`.
FROM node:24-alpine

WORKDIR /app

# Спершу лише маніфести — щоб кешувати шар з npm ci.
COPY package.json package-lock.json ./
RUN npm ci

# Далі — джерела, конфіг і тести.
COPY tsconfig.json ./
COPY src ./src
COPY test ./test

# `npm test` = tsc (pretest) + node --test по скомпільованому dist.
CMD ["npm", "test"]
