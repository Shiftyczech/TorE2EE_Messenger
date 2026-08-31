# TorE2EE Messenger

Ultra-bezpečný, decentralizovaně orientovaný a plně anonymní komunikátor fungující výhradně v síti **Tor (Onion v3)** s **End-to-End šifrováním (Signal Protocol / Double Ratchet + X3DH)**, lokální šifrovanou databází (**SQLCipher**), **Multi-Device podporou (Linked Devices & Self-Sync Messages)**, **Background Syncem bez FCM/APNs** a **Zero-Knowledge backend relay serverem v Rustu**.

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
                                               │
                                               ▼
 ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 │                         BACKEND: Zero-Knowledge Relay (Rust)                            │
 │                                                                                          │
 │  ┌─────────────────────────┐   ┌──────────────────────────┐   ┌────────────────────────┐ │
 │  │   WebSocket Stream      │   │  Ed25519 Auth Challenge  │   │   SQLite TTL Queue     │ │
 │  │  (GET /api/v1/stream)   │◄─►│   (Cryptographic Nonce   │◄─►│  (Atomic delete on     │ │
 │  │  Real-time Delivery     │   │     Verification)        │   │   delivery, Auto-purge)│ │
 │  └─────────────────────────┘   └──────────────────────────┘   └────────────────────────┘ │
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
5. **Strikní Tor Transport (Zero DNS / IP Leak):** Veškerá síťová komunikace (HTTP POST pro odesílání i WebSocket pro příjem) je povinně směrována přes lokální SOCKS5 proxy s doménovým adresováním (`ATYP 0x03`).
6. **SQLCipher šifrované lokální úložiště:** Lokální databáze SQLite je šifrována 256bitovým náhodným klíčem z hardwarového Keychainu s automatickými migracemi schématu (v1 a v2).
7. **Zero Push Metadata Leak:** Periodický headless background sync bez FCM a APNs s garancí nepřekročení časového rozpočtu OS.

---

## 2. Přehled Implementovaných Fází a Modulů

### Fáze 1: Rust Zero-Knowledge Relay Server & Tester CLI (Dokončeno)
- **`server/`:** Asynchronní HTTP a WebSocket server postavený na `axum` a `tokio`.
  - `auth.rs`: Ed25519 detached challenge signing a SHA-256 mailbox hashing.
  - `db.rs`: SQLite fronta zpráv s atomickým mazáním zprávy v transakci ihned po doručení.
  - `worker.rs`: Pravidelný úklid expirovaných zpráv podle TTL (výchozí 14 dní).
  - `handlers/`: `POST /api/v1/message` (Blind drop) a `GET /api/v1/stream` (WebSocket odběr).
- **`tester-cli/`:** Automatizovaný testovací nástroj pro generování identit a spouštění E2E testů (`cargo run --bin tester-cli -- e2e-test`).

---

### Fáze 2: Klientská Aplikace (React Native / TypeScript) (Dokončeno)
- **Milník 2.1: Modul Identity (`client/src/identity/`):** `IdentityManager.ts` (BIP-39, Ed25519, Curve25519, Keychain).
- **Milník 2.2: Tor Bridge & Síťový Klient (`client/src/network/`):** `Socks5Tunnel.ts`, `TorManager.ts`, `TorHttpClient.ts`, `TorWebSocketClient.ts`.
- **Milník 2.3: E2EE Engine (`client/src/crypto/`):** `CryptoEngine.ts` (Double Ratchet + X3DH), `ISignalStore.ts`, `InMemorySignalStore.ts`.
- **Milník 2.4: Lokální Šifrovaná Databáze (`client/src/storage/`):** `DatabaseManager.ts` (SQLCipher), `SqliteSignalStore.ts`, `ContactRepository.ts`, `MessageRepository.ts`.
- **Milník 2.5: Výměna Klíčů a Orchestrace (`client/src/orchestration/`):** `ContactExchange.ts` (QR URI validace), `AppOrchestrator.ts`.
- **Milník 2.6: UI/UX, Navigace a React State Management (`client/src/ui/`):** `theme.ts` (Cyber Dark Mode), `OrchestratorContext.tsx`, znovupoužitelné komponenty (`TorStatusBadge`, `MessageBubble`, `ContactListItem`...) a obrazovky (`Welcome`, `SeedDisplay`, `RestoreSeed`, `ChatList`, `Chat`, `Profile`, `Scanner`).

---

### Fáze 3: Pokročilé Mobilní Funkce a Produkční Zabezpečení

#### Milník 3.1: Background Sync & Local Notifications (`client/src/background/`, `client/src/notifications/`) (Dokončeno)
- `NotificationManager.ts`: Správa nativních lokálních notifikací `@notifee/react-native` s vysokou prioritou, vibracemi a podporou `privacyMode`.
- `BackgroundSyncService.ts`: Headless background synchronizační worker s přísným časovým limitem (max 25s) a `Promise.race()` timeoutem (20s) pro bezpečný Tor bootstrap.
- `BackgroundSyncTask.ts`: Registrace headless úlohy pro `react-native-background-fetch`.

#### Milník 3.2: Multi-Device Podpora & Párování Zařízení (`client/src/devices/`) (Dokončeno)
- `DeviceLinkManager.ts`: Kryptografické párování Master (Mobil) a Slave (PC) přes efemérní klíče a QR kód bez úniku metadat na server.
- `DatabaseManager.ts` (Migrace v2): Tabulka `own_linked_devices` a sloupec `linked_devices` v kontaktech.
- `AppOrchestrator.ts`: Multi-Recipient distribuce zpráv všem zařízením příjemce a automatické odesílání Self-Sync zpráv vlastním sekundárním zařízením.

---

## 3. Struktura Repozitáře

```
├── server/                      # Rust Zero-Knowledge Relay Server (Axum, Tokio, SQLite)
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
│   ├── package.json             # Klientské závislosti a skripty
│   └── tsconfig.json            # TypeScript konfigurace se striktní kontrolou
├── Cargo.toml                   # Cargo workspace konfigurace
└── README.md                    # Dokumentace a architektura projektu
```

---

## 4. Spuštění a Verifikace

### A. Klientská aplikace (React Native / TypeScript)

V adresáři `client/`:

1. **Spuštění všech testovacích sad (42 unit a integračních testů napříč 12 sadami):**
   ```bash
   cd client
   npm test
   ```
   *Pokrývá: IdentityManager, SOCKS5 tunel, Tor HttpClient/WebSocket, Double Ratchet E2EE, SQLCipher persistenci v2, ContactExchange QR ověřování, AppOrchestrator, UI komponenty, NotificationManager, BackgroundSyncService, DeviceLinkManager a Multi-Device Self-Sync.*

2. **Striktní kontrola typů TypeScriptu:**
   ```bash
   npm run typecheck
   ```

---

### B. Backend Relay Server a Tester CLI (Rust)

1. **Spuštění jednotkových testů Rust serveru:**
   ```bash
   cargo test --workspace
   ```

2. **Spuštění Relay Serveru:**
   ```bash
   cargo run --bin server
   ```
   *Výchozí konfigurace: `127.0.0.1:8080` s in-memory SQLite.*

3. **Spuštění automatizovaného E2E testu v Rustu:**
   ```bash
   cargo run --bin tester-cli -- e2e-test
   ```

---

## 5. Konfigurace Tor Onion Hidden Service

Pro nasazení serveru do živé sítě Tor přidejte do souboru `/etc/tor/torrc`:

```torrc
HiddenServiceDir /var/lib/tor/tore2ee_service/
HiddenServicePort 80 127.0.0.1:8080
HiddenServiceVersion 3
```

Po restartu Tor démona (`systemctl restart tor`) získáte svou `.onion` adresu v souboru `/var/lib/tor/tore2ee_service/hostname`.
Klienti se připojují výhradně přes tuto adresu:
- **WebSocket stream:** `ws://<VASE_ADRESA>.onion/api/v1/stream`
- **HTTP POST:** `http://<VASE_ADRESA>.onion/api/v1/message`
