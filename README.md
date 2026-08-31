# TorE2EE Messenger

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

### Hlavní bezpečnostní pilíře:
1. **Identita bez účtů:** Žádná telefonní čísla, e-maily ani centrální účty. Identita je deterministicky odvozena z **12/24slovního BIP-39 seedu** do **Ed25519** (pro podpis challenge a identifikaci mailboxu) a **Curve25519** (pro E2EE šifrování).
2. **Zero-Knowledge Backend:** Rust server nezná obsah zpráv, odesílatele ani identitu uživatelů. Zná pouze 64znakový SHA-256 hash veřejného klíče schránky (`recipient_pubkey_hash`) a neprůhledný šifrovaný payload.
3. **End-to-End Šifrování (Signal Protocol / Double Ratchet + X3DH):**
   - **X3DH Asynchronní dohoda klíčů:** Každé zařízení publikuje svůj Signed PreKey a jednorázové One-Time PreKeys.
   - **Double Ratchet:** Asymetrický DH ratchet s Curve25519 efemérními klíči při každé odpovědi (Break-in Recovery) kombinovaný se symetrickým KDF ratchetem pro každou zprávu (Forward Secrecy).
   - **AEAD šifrování:** `tweetnacl.secretbox` (XSalsa20-Poly1305) s okamžitým nulováním klíčů v paměti (`fill(0)`).
4. **Multi-Device podpora (Linked Devices & Self-Sync):**
   - **Párování Master $\leftrightarrow$ Slave:** Sekundární zařízení (PC) vygeneruje efemérní Curve25519 klíč a dočasnou schránku v QR kódu. Mobil (Master) zašifruje provizní balíček a odešle jej přes Tor.
   - **Multi-Recipient Fanout:** Při odeslání zprávy zašifruje odesílatel zprávu samostatně pro všechna propojená zařízení příjemce.
   - **Self-Sync zprávy:** Odesílatel zašifruje kopii zprávy i pro svá vlastní sekundární zařízení (PC / Tablet), která ji uloží jako odeslanou (`isOutgoing = true`).
5. **Kontejnerizace a Izolace (Docker Sidecar Pattern):**
   - Backend nemá žádné mapované porty do clearnetu (`ports:` je záměrně vynecháno).
   - Tor démon jako sidecar kontejner vytváří `.onion` adresu a veškerý provoz směruje interní Docker sítí do backendu na `backend:3000`.
   - Multi-stage Dockerfile sestavuje minimální Debian obraz s neprivilegovaným uživatelem `toruser`.
6. **Strikní Tor Transport (Zero DNS / IP Leak):** Veškerá klientská síťová komunikace je povinně směrována přes lokální SOCKS5 proxy s doménovým adresováním (`ATYP 0x03`).
7. **SQLCipher šifrované lokální úložiště:** Lokální databáze SQLite je šifrována 256bitovým náhodným klíčem z hardwarového Keychainu s automatickými migracemi schématu (v1 a v2).
8. **Zero Push Metadata Leak:** Periodický headless background sync bez FCM a APNs s garancí nepřekročení časového rozpočtu OS.

---

## 2. Spuštění Backendové Infrastruktury (Docker Compose)

### 1. Spuštění kontejnerů:
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

## 3. Struktura Repozitáře

```
├── docker-compose.yml           # Docker Compose orchestrace (Backend + Tor Sidecar)
├── torrc                        # Konfigurace Tor skryté služby (Hidden Service)
├── server/                      # Rust Zero-Knowledge Relay Server (Axum, Tokio, SQLite)
│   ├── Dockerfile               # Multi-stage produkční Dockerfile
│   ├── Cargo.toml               # Konfigurace závislostí a binárky tore2ee-server
│   ├── src/
│   │   ├── auth.rs              # Ed25519 challenge-response a SHA-256 mailbox hashing
│   │   ├── config.rs            # Načítání ENV konfigurace a parametrů
│   │   ├── db.rs                # SQLite fronta s atomickým mazáním po doručení
│   │   ├── state.rs             # AppState a real-time pub-sub router
│   │   ├── worker.rs            # Periodický TTL čistič expirovaných zpráv
│   │   ├── handlers/            # HTTP POST /api/v1/message a WS GET /api/v1/stream
│   │   └── main.rs              # Vstupní bod serveru
├── tester-cli/                  # Testovací CLI pro automatizovanou E2E verifikaci
│   └── src/main.rs
├── client/                      # React Native / TypeScript Klientská Aplikace
│   ├── src/
│   │   ├── identity/            # Správa identity (BIP-39, Ed25519, Curve25519, Keychain)
│   │   ├── network/             # SOCKS5 tunel, TorManager, TorHttpClient, TorWebSocketClient
│   │   ├── crypto/              # Signal Protocol (Double Ratchet + X3DH), ISignalStore
│   │   ├── storage/             # SQLCipher DatabaseManager v2, SqliteSignalStore, Repozitáře
│   │   ├── orchestration/       # ContactExchange (QR URI), AppOrchestrator (Multi-Device dispatch)
│   │   ├── devices/             # DeviceLinkManager (Master-Slave pairing, Self-Sync)
│   │   ├── ui/                  # UI Theme, Context, Komponenty, Obrazovky a RootNavigator
│   │   ├── notifications/       # NotificationManager (@notifee lokální notifikace)
│   │   ├── background/          # BackgroundSyncService, BackgroundSyncTask
│   │   └── index.ts             # Centrální exportní bod klientské knihovny
│   ├── jest.config.js           # Konfigurace testů Jest + ts-jest
│   ├── package.json             # Klientská závislost a skripty
│   └── tsconfig.json            # TypeScript konfigurace se striktní kontrolou
├── Cargo.toml                   # Cargo workspace konfigurace
└── README.md                    # Kompletní dokumentace a architektura projektu
```

---

## 4. Spuštění Testů Klientské Aplikace

V adresáři `client/`:

1. **Spuštění všech testovacích sad (42 unit a integračních testů napříč 12 sadami):**
   ```bash
   cd client
   npm test
   ```

2. **Striktní kontrola typů TypeScriptu:**
   ```bash
   npm run typecheck
   ```
