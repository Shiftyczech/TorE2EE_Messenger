# TorE2EE Messenger

Ultra-bezpečný a plně anonymní komunikátor fungující v síti Tor (Onion v3) s End-to-End šifrováním (Double Ratchet / X3DH) a Zero-Knowledge backend relay serverem.

---

## Architektura a Bezpečnostní Model

- **Identita:** Žádné registrace, telefonní čísla ani emaily. Identita = **Ed25519** pár klíčů odvozený z BIP-39 seed phrase.
- **Relay Server (Rust):** Asynchronní Zero-Knowledge relay (`axum` + `tokio`). Server vidí pouze `recipient_pubkey_hash` a zašifrovaný binární payload.
- **Autentizace:** WebSocket Challenge-Response s Ed25519 podpisem náhodného 32B nonce generovaného serverem.
- **Zero-Knowledge Delivery:** Jakmile si klient zprávu vyzvedne, server ji v atomické transakci nenávratně maže. Neuložené zprávy se automaticky promazávají po uplynutí TTL (výchozí 14 dní).
- **Transport:** Tor Hidden Service (.onion v3) / SOCKS5 proxy `127.0.0.1:9050`.

---

## Struktura repozitáře

```
├── server/          # Rust Zero-Knowledge Relay Server (Axum, Tokio, SQLite TTL Queue)
│   ├── src/
│   │   ├── auth.rs      # Ed25519 ověření podpisu a SHA-256 mailbox hashing
│   │   ├── config.rs    # Načítání ENV konfigurace a CLI parametrů
│   │   ├── db.rs        # SQLite fronta zpráv s atomickým mazáním po doručení
│   │   ├── state.rs     # AppState a real-time pub-sub router pro aktivní klienty
│   │   ├── worker.rs    # Periodický TTL čistič expirovaných zpráv
│   │   ├── handlers/    # HTTP POST /api/v1/message a WS GET /api/v1/stream
│   │   └── main.rs      # Vstupní bod serveru
├── tester-cli/      # Nástroj pro generování klíčů, testování a automatizovanou E2E verifikaci
│   └── src/main.rs
└── Cargo.toml       # Cargo workspace konfigurace
```

---

## Rychlý start

### 1. Spuštění jednotkových testů

```bash
cargo test --workspace
```

### 2. Spuštění Relay Serveru

```bash
cargo run --bin server
```

Výchozí nastavení: naslouchá na `127.0.0.1:8080` s in-memory SQLite (`sqlite::memory:`).

Pro trvalou SQLite databázi nebo změnu portu nastavte proměnné prostředí:
```bash
SERVER_HOST=127.0.0.1 SERVER_PORT=8080 DATABASE_URL=sqlite://relay.db cargo run --bin server
```

### 3. Spuštění automatizovaného E2E testu

V samostatném terminálu:
```bash
cargo run --bin tester-cli -- e2e-test
```

### 4. Manuální použití `tester-cli`

- **Generování nové identity (Ed25519):**
  ```bash
  cargo run --bin tester-cli -- generate-keys
  ```

- **Připojení a poslech zpráv přes WebSocket:**
  ```bash
  cargo run --bin tester-cli -- listen --private-key-hex <VASE_PRIVATNI_KLIC_HEX>
  ```

- **Odeslání zašifrovaného payloadu:**
  ```bash
  cargo run --bin tester-cli -- send --recipient-hash <CILOVY_PUBKEY_HASH> --payload "BASE64_PAYLOAD" --nonce "NONCE_123"
  ```

---

## Konfigurace Tor Onion Hidden Service

Pro vystavení serveru do sítě Tor přidejte do souboru `/etc/tor/torrc`:

```torrc
HiddenServiceDir /var/lib/tor/tore2ee_service/
HiddenServicePort 80 127.0.0.1:8080
HiddenServiceVersion 3
```

Po restartu Tor démona najdete vaši `.onion` adresu v souboru `/var/lib/tor/tore2ee_service/hostname`.
Klienti se k serveru připojují na adresu `ws://<VASE_ADRESA>.onion/api/v1/stream`.

