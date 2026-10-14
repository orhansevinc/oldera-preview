FROM node:22-alpine
WORKDIR /app
COPY services/ko1298-session /app/services/ko1298-session
COPY services/ko1298-world /app/services/ko1298-world
CMD ["node", "services/ko1298-session/server.js"]
