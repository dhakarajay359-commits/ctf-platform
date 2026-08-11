FROM node:14-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8081

# Drop privileges
USER node

CMD [ "node", "app.js" ]
