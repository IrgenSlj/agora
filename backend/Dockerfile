FROM node:22-bookworm-slim

WORKDIR /app

RUN npm install -g wrangler

COPY package.json tsconfig.json wrangler.toml ./
RUN npm install

COPY schema.sql src/ ./src/

EXPOSE 8787

ENV AGORA_ENV=development

CMD ["sh", "-c", "wrangler d1 execute agora --local --file=src/schema.sql 2>/dev/null; exec wrangler dev --port 8787 --ip 0.0.0.0 --local"]
