FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node assets/forecast.js ./assets/forecast.js
COPY --chown=node:node server/google-weather.mjs ./server/google-weather.mjs
USER node
EXPOSE 8080
CMD ["node", "server/google-weather.mjs"]
