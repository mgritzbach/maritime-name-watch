FROM node:22-bookworm-slim

WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

RUN mkdir -p /data && chown node:node /data

USER node
ENV PORT=8787 STATE_PATH=/data/state.json AUTO_RUN=true
EXPOSE 8787

CMD ["node", "src/index.mjs"]
