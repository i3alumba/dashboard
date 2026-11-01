FROM node:22-bookworm-slim@sha256:9f0dde62d10e7ff7a310ecaebd66225f6b46c17e6cb778449a77b05d3541bea2 AS builder

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
