FROM rust:1-bookworm AS builder

WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY cli/Cargo.toml cli/Cargo.lock ./cli/
COPY cli/src ./cli/src
COPY cli/README.md ./cli/README.md

WORKDIR /workspace/cli
RUN cargo build --release --locked

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /workspace/cli/target/release/msctl /usr/local/bin/msctl

EXPOSE 8765
ENTRYPOINT ["msctl"]
CMD ["--help"]
