FROM node:lts

ENV RUSTUP_HOME=/usr/local/rustup \
  CARGO_HOME=/usr/local/cargo \
  PATH=/usr/local/cargo/bin:$PATH

RUN wget -O - https://apt.llvm.org/llvm-snapshot.gpg.key | apt-key add - && \
  echo "deb http://apt.llvm.org/stretch/ llvm-toolchain-stretch main" >> /etc/apt/sources.list && \
  echo "deb-src http://apt.llvm.org/stretch/ llvm-toolchain-stretch main" >> /etc/apt/sources.list && \
  apt-get update && \
  apt-get install -y --fix-missing \
  llvm \
  clang \
  rcs \
  ninja-build && \
  curl https://sh.rustup.rs -sSf | sh -s -- -y
