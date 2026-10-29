FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json *.mjs *.html *.js *.css *.json ./
COPY --chown=node:node test/ ./test/
RUN npm test && mkdir -p /app/data && chown node:node /app/data
USER node
ENV PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
CMD ["npm", "start"]
