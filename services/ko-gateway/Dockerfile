FROM node:22-alpine
WORKDIR /app
COPY services/ko-gateway/package.json ./package.json
COPY services/ko-gateway/src ./src
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/server.js"]
