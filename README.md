# TorE2EE Messenger mnau :3

Ultra-bezpečný, decentralizovaně orientovaný a plně anonymní komunikátor fungující výhradně v síti **Tor (Onion v3)** s **End-to-End šifrováním (Signal Protocol / Double Ratchet + X3DH)**, lokální šifrovanou databází (**SQLCipher**), **Multi-Device podporou (Linked Devices & Self-Sync Messages)**, **Background Syncem bez FCM/APNs** a **Zero-Knowledge backend relay serverem v Rustu** kontejnerizovaným v **Docker Compose (Sidecar pattern)**.

---

## 1. Architektura a Bezpečnostní Model

```
 ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 │                                   CLIENT (React Native)                                  │
 │                                                                                          │
 │  ┌─────────────────────────┐   ┌──────────────────────────┐   ┌────────────────────────┐ │
 │  │      UI & Screens       │   │     Orchestrator &       │   │  Signal Crypto Engine  │ │
 │  │ (Cyber Dark Theme, QR,  │◄─►│   OrchestratorContext    │◄─►│  (X3DH, Double Ratchet,│ │
 │  │  ChatList, ChatDetail)  │   │  (Sync, Events, Dispatch)│   │   AEAD Secretbox)      │ │
 │  └─────────────────────────┘   └────────────┬─────────────┘   └───────────┬────────────┘ │
 │                                             │                             │              │
 │  ┌─────────────────────────┐   ┌────────────▼─────────────┐   ┌───────────▼────────────┐ │
 │  │  Background Sync Task   │   │      SQLCipher Store     │   │   Device Link Manager  │ │
 │  │ (Headless 25s, No FCM,  │◄─►│  (Encrypted DB v2,       │◄─►│  (Master-Slave QR,     │ │
 │  │  Periodic Wakeup ~15m)  │   │   Contacts, LinkedDevs)  │   │   Self-Sync Envelopes) │ │
 │  └─────────────────────────┘   └────────────┬─────────────┘   └────────────────────────┘ │
 │                                             │                                            │
 │                                ┌────────────▼─────────────┐                              │
 │                                │     Tor Network Bridge   │                              │
 │                                │  (SOCKS5 RFC 1928, Zero  │                              │
 │                                │   DNS Leak, HTTP + WS)   │                              │
 │                                └────────────┬─────────────┘                              │
 └─────────────────────────────────────────────┼────────────────────────────────────────────┘
                                               │ (All Traffic via SOCKS5 Proxy 127.0.0.1:9050)
                                               ▼
                              ┌──────────────────────────────────┐
                              │     Tor Network (Onion v3)       │
                              └────────────────┬─────────────────┘
                                               │ (Port 80)
                                               ▼
 ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 │                     DOCKER SIDECAR BACKEND ARCHITECTURE (Docker Compose)                 │
 │                                                                                          │
 │  ┌────────────────────────────────────────┐     ┌─────────────────────────────────────┐  │
 │  │      Tor Daemon (osminogin/tor-simple) │     │      Backend Container (Rust Axum)  │  │
 │  │  - Exposes Onion v3 Hidden Service     │────►│  - Listens strictly on 0.0.0.0:3000 │  │
 │  │  - Zero open ports to clearnet         │     │  - NO exposed ports to clearnet     │  │
 │  │  - Directs port 80 -> backend:3000     │     │  - Non-root user `toruser`          │  │
 │  │  - Persistent key volume: tor-keys     │     │  - SQLite volume: backend-data      │  │
 │  └────────────────────────────────────────┘     └─────────────────────────────────────┘  │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Produkční Sestavení Mobilní Aplikace (Android Release APK)

Všechny konfigurační soubory pro Android sestavení jsou připraveny v adresáři `client/android/` (a symlinkovány v `android/`):
- `tore2ee-release-key.keystore` v `android/app/`
- `android/gradle.properties` (s heslem a parametry pro JVM)
- `android/app/build.gradle` (se `signingConfigs.release`)

### Postup kompilace Release APK:

1. **Přejděte do složky Androidu:**
   ```bash
   cd android
   ```

2. **Spusťte sestavení Release balíčku:**
   ```bash
   ./gradlew clean
   ./gradlew assembleRelease
   ```

3. **Výsledný APK soubor:**
   Hotové podepsané produkční APK najdete v:
   ```
   android/app/build/outputs/apk/release/app-release.apk
   ```

4. **Instalace na fyzické zařízení:**
   - Zkopírujte `app-release.apk` do telefonu přes USB kabel / sdílené úložiště.
   - Povolte *Instalaci z neznámých zdrojů*.
   - Nainstalujte a při spuštění povolte oprávnění ke kameře (pro QR skenování) a notifikacím.

---

## 3. Spuštění Backendové Infrastruktury (Docker Compose)

### 1. Spuštění kontejnerů na serveru:
```bash
docker-compose up -d --build
```

### 2. Získání trvalé `.onion` adresy serveru:
```bash
docker-compose exec tor cat /var/lib/tor/hidden_service/hostname
```
*Výstup bude vaše Onion v3 adresa ve formátu `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.onion`.*

### 3. Zobrazení logů:
```bash
# Logy backendu
docker-compose logs -f backend

# Logy Tor démona
docker-compose logs -f tor
```

---

## 4. Testy a Verifikace

### A. Klientská aplikace (React Native / TypeScript)
V adresáři `client/`:
```bash
cd client
npm test
npm run typecheck
```
*42/42 unit a integračních testů napříč 12 sadami prošlo.*

### B. Rust Relay Server
```bash
cargo test --workspace
cargo run --bin tester-cli -- e2e-test
```
