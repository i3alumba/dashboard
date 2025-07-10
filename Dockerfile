FROM node:alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY src/ src/
COPY index.html ./
COPY tsconfig*.json ./
COPY vite.config.ts ./

RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/nginx.conf

CMD ["nginx", "-g", "daemon off;"]
