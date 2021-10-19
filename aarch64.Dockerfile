FROM multiarch/ubuntu-core:arm64-focal

ARG NODE_VERSION=14

RUN apt-get update && \
  apt-get install -y ca-certificates gnupg2 curl apt-transport-https && \
  curl -sL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - && \
  apt-get install -y nodejs && \
  npm install -g yarn pnpm
