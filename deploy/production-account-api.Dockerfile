FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /opt/oldkoweb/ws13/services/account-api
COPY ws13/services/account-api/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force
COPY ws13/services/account-api/ ./

WORKDIR /opt/oldkoweb/ws07/services/oldko-data
COPY ws07/services/oldko-data/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force
COPY ws07/services/oldko-data/ ./
COPY ws07/database/migrations/ /opt/oldkoweb/ws07/database/migrations/

WORKDIR /opt/oldkoweb/ws13/services/account-api
USER node
EXPOSE 8081
CMD ["npm", "start"]
