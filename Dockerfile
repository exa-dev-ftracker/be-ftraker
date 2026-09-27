# ========== BUILD STAGE ==========
FROM node:20-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build


# ========== RUNTIME STAGE ==========
FROM node:20-slim AS runtime
WORKDIR /app

# Hanya copy hasil build + node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./

EXPOSE 8080 3003

CMD ["node", "dist/index.js"]
