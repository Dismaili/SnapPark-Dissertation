FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY package*.json ./
RUN npm install

COPY src ./src

EXPOSE 3004

CMD ["npm", "start"]
