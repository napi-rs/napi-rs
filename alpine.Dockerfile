FROM node:lts-alpine

ENV RUSTFLAGS="-C target-feature=-crt-static" \
  PATH="/usr/local/cargo/bin/rustup:/root/.cargo/bin:$PATH" \
  CC="clang" \
  CXX="clang++"

RUN sed -i -e 's/v[[:digit:]]\..*\//edge\//g' /etc/apk/repositories && \
  apk update && \
  apk add rustup musl-dev build-base && \
  rustup-init -y
