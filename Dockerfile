# 设备停机原因分析 - Node.js / Express
FROM node:20-alpine

WORKDIR /app

# 先安装生产依赖（利用层缓存）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 复制应用代码
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# 容器健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

# 直接运行，node:20-alpine 无需额外 init
CMD ["node", "src/server.js"]
