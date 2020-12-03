FROM node:12.18.3-alpine3.11

WORKDIR /app

COPY ./package.json ./
COPY ./yarn.lock ./
RUN yarn install

COPY .pgpass /root/
COPY . ./

ENTRYPOINT [ "yarn" ]
CMD [ "start" ]
