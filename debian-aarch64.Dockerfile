FROM messense/manylinux2014-cross:aarch64

ENV RUSTUP_HOME=/usr/local/rustup \
  CARGO_HOME=/usr/local/cargo \
  PATH=/usr/local/cargo/bin:$PATH \
  CC=clang \
  CXX=clang++ \
  CC_aarch64_unknown_linux_gnu=clang \
  CXX_aarch64_unknown_linux_gnu=clang++ \
  C_INCLUDE_PATH=/usr/aarch64-unknown-linux-gnu/aarch64-unknown-linux-gnu/sysroot/usr/include

RUN wget -O - https://apt.llvm.org/llvm-snapshot.gpg.key | apt-key add - && \
  echo "deb http://apt.llvm.org/focal/ llvm-toolchain-focal-14 main" >> /etc/apt/sources.list && \
  echo "deb-src http://apt.llvm.org/focal/ llvm-toolchain-focal-14 main" >> /etc/apt/sources.list && \
  curl -sL https://deb.nodesource.com/setup_16.x | bash - && \
  apt-get install -y --fix-missing --no-install-recommends \
  curl \
  llvm-14 \
  clang-14 \
  lld-14 \
  nodejs \
  xz-utils \
  rcs \
  git \
  make \
  ninja-build && \
  apt-get autoremove -y && \
  curl https://sh.rustup.rs -sSf | sh -s -- -y && \
  rustup target add aarch64-unknown-linux-gnu && \
  npm install -g yarn pnpm lerna && \
  npm cache clean --force && \
  npm cache verify && \
  ln -sf /usr/bin/clang-14 /usr/bin/clang && \
  ln -sf /usr/bin/clang++-14 /usr/bin/clang++ && \
  ln -sf /usr/bin/lld-14 /usr/bin/lld && \
  ln -sf /usr/bin/clang-14 /usr/bin/cc
