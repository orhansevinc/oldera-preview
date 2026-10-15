FROM node:22-alpine
WORKDIR /opt/oldkoweb
COPY services ./services
COPY database ./database
COPY world-data ./world-data
COPY runtime ./runtime
RUN npm --prefix services/oldko-data install --omit=dev --ignore-scripts \
 && npm --prefix services/account-api install --omit=dev --ignore-scripts
ENV NODE_ENV=production
EXPOSE 8081 8088 15100 15001
CMD ["node","services/domain-live-runtime/server.js"]
