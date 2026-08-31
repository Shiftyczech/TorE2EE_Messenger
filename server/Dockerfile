# Krok 1: Build prostředí
FROM rust:1.80-slim AS builder
WORKDIR /usr/src/app

# Instalace závislostí pro kompilaci (SQLite vyžaduje C kompilátor)
RUN apt-get update && apt-get install -y pkg-config libssl-dev build-essential sqlite3 libsqlite3-dev

# Zkopírování zdrojových kódů a kompilace
COPY . .
RUN cargo build --release --bin tore2ee-server

# Krok 2: Produkční prostředí (Minimalistický image)
FROM debian:bookworm-slim
WORKDIR /app

# Instalace pouze běhových závislostí pro SQLite
RUN apt-get update && apt-get install -y libsqlite3-0 ca-certificates && rm -rf /var/lib/apt/lists/*

# Zkopírování hotové binárky z builderu
COPY --from=builder /usr/src/app/target/release/tore2ee-server /usr/local/bin/tore2ee-server

# Bezpečnostní pravidlo: Nespouštět pod rootem
RUN useradd -m -s /bin/bash toruser && \
    mkdir -p /app/data && \
    chown -R toruser:toruser /app
USER toruser

# Vystavení datového adresáře pro SQLite soubor
VOLUME ["/app/data"]

CMD ["tore2ee-server"]

