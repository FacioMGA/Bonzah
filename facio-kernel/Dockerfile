FROM rust:1.97.1-bookworm@sha256:0e2bcaef56d041a486784e54104a81aebe0da44bd03019bd70bc0401e42e4a97 AS rust-toolchain
RUN rustup target add wasm32-unknown-unknown --toolchain 1.97.1

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build
WORKDIR /app
COPY --from=rust-toolchain /usr/local/cargo /usr/local/cargo
COPY --from=rust-toolchain /usr/local/rustup /usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo RUSTUP_HOME=/usr/local/rustup RUSTUP_TOOLCHAIN=1.97.1 PATH=/usr/local/cargo/bin:$PATH
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
COPY tenant-packages ./tenant-packages
COPY rust ./rust
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
ARG BUILD_SHA
LABEL org.opencontainers.image.source="https://github.com/FacioMGA/facio-kernel" \
      org.opencontainers.image.revision="${BUILD_SHA}"
ENV NODE_ENV=production PORT=4310
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist/src ./dist/src
COPY --from=build --chown=node:node /app/rust/money.wasm /app/rust/money.manifest.json ./rust/
RUN rm -rf dist/src/fixtures dist/src/dev.* dist/src/main.* dist/src/domain/money-reference.* && find dist -name '*.map' -delete
COPY --chown=node:node package.json ./
COPY --chown=node:node public ./public
COPY --chown=node:node artifacts/contracts ./artifacts/contracts
USER node
EXPOSE 4310
CMD ["node", "dist/src/hosted.js"]
