# ODDLY API container. Build from the repository root:
#   docker build -t oddly-api .
# Configure it with environment variables (see backend/.env.example) — never bake secrets in.

FROM rust:1-bookworm AS build
WORKDIR /app
COPY . .
# Lower this when building on a server that runs other apps.
ARG CARGO_BUILD_JOBS=4
RUN cargo build --release --locked -p oddly-api

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/release/oddly-api /usr/local/bin/oddly-api
ENV TRUST_PROXY=true \
    RUST_LOG=oddly_api=info,tower_http=info
EXPOSE 8080
USER nobody
# Binds 0.0.0.0:$PORT (the platform's port) or API_BIND_ADDR.
CMD ["oddly-api"]
