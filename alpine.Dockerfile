FROM rust:alpine

ENV RUSTFLAGS="-C target-feature=-crt-static"

RUN sed -i -e 's/v[[:digit:]]\..*\//edge\//g' /etc/apk/repositories && \
  apk update && \
  apk add nodejs yarn clang musl-dev llvm-dev curl && \
  export NODE_VERSION=$(node -e "console.log(process.version)") && \
  curl -fsSLO $(node -e "console.log(process.release.headersUrl)") && \
  tar -xf "node-$NODE_VERSION-headers.tar.gz" && \
  mv "node-$NODE_VERSION/include/node" include && \
  rm -rf "node-$NODE_VERSION" && \
  rm "node-$NODE_VERSION-headers.tar.gz"