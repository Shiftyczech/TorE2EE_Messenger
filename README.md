# TorE2EE Messenger

Ultra-bezpečný, decentralizovaně orientovaný a plně anonymní komunikátor fungující výhradně v síti **Tor (Onion v3)** s **End-to-End šifrováním (Signal Protocol / Double Ratchet + X3DH)**, lokální šifrovanou databází (**SQLCipher**) a **Zero-Knowledge backend relay serverem v Rustu**.

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
 │  ┌─────────────────────────┐   ┌────────────▼─────────────┐               │              │
 │  │    Identity Manager     │   │      SQLCipher Store     │◄──────────────┘              │
 │  │  (BIP-39, Ed25519 Sign, │   │  (Encrypted DB, Messages,│                              │
 │  │   Curve25519, Keychain) │   │   Contacts, SignalStore) │                              │
 │  └─────────────────────────┘   └──────────────────────────┘                              │
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
2. **Zero-Knowledge Backend:** Rust server nezná obsah zpráv, odesílatele ani identitu uživatelů. Zná pouze 64znakový SHA-256 hash veřejného klíče příjemce (`recipient_pubkey_hash`) a neprůhledný šifrovaný payload.
3. **End-to-End Šifrování (Signal Protocol / Double Ratchet + X3DH):**
   - **X3DH Asynchronní dohoda klíčů:** Každý uživatel publikuje Signed PreKey a dávku jednorázových One-Time PreKeys.
   - **Double Ratchet:** Asymetrický DH ratchet s Curve25519 efemérními klíči při každé odpovědi (Break-in Recovery) kombinovaný se symetrickým KDF ratchetem pro každou zprávu (Forward Secrecy).
   - **AEAD šifrování:** `tweetnacl.secretbox` (XSalsa20-Poly1305) s okamžitým nulováním klíčů v paměti (`fill(0)`).
   - **Out-of-Order Handling:** Bezpečné ukládání přeskočených klíčů pro zprávy doručené mimo pořadí.
4. **Strikní Tor Transport (Zero DNS / IP Leak):** Veškerá síťová komunikace (HTTP POST pro odesílání i WebSocket pro příjem) je povinně směrována přes lokální SOCKS5 proxy s doménovým adresováním (`ATYP 0x03`). Nesmí dojít k žádnému clearnet úniku.
5. **SQLCipher šifrované lokální úložiště:** Lokální databáze SQLite je šifrována 256bitovým náhodným klíčem uloženým výhradně v hardwarovém `react-native-keychain`. Databáze neběží v prostém textu a veškeré dotazy jsou striktně parametrizované (`?`).
6. **Out-of-Band výměna kontaktů:** Kompaktní QR kód / URI (`tore2ee://contact?v=1&d=...`) s kryptografickou validací Ed25519 podpisu Signed PreKey.

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

### Fáze 2: Klientská Aplikace (React Native / TypeScript)

#### Milník 2.1: Modul Identity (`client/src/identity/`)
- `IdentityManager.ts`: Generování a obnova BIP-39 mnemonic, odvození Ed25519 a Curve25519 klíčů, výpočet mailbox hashe, podepisování výzev a hardwarová integrace s `react-native-keychain`.

#### Milník 2.2: Tor Bridge & Síťový Klient (`client/src/network/`)
- `Socks5Tunnel.ts`: Nízkoúrovňová implementace SOCKS5 RFC 1928 soketového tunelu s doménovým adresováním eliminující úniky DNS dotazů.
- `TorManager.ts`: Správce životního cyklu Tor démona s hlášením průběhu bootstrapu (0–100 %).
- `TorHttpClient.ts`: Tunelovaný HTTP klient pro blind-drop odesílání zpráv.
- `TorWebSocketClient.ts`: Tunelovaný WebSocket klient s automatickou Ed25519 challenge-response autentizací, ping keep-alive a exponenciálním auto-reconnectem.

#### Milník 2.3: E2EE Engine (Signal Protocol / Double Ratchet + X3DH) (`client/src/crypto/`)
- `CryptoEngine.ts`: Kompletní implementace X3DH klíčové dohody ($DH_1, DH_2, DH_3, DH_4$), Master Secret HKDF-SHA256, asymetrického a symetrického Double Ratchetu a správy zpráv doručených mimo pořadí.
- `ISignalStore.ts` & `InMemorySignalStore.ts`: Modulární rozhraní a in-memory adaptér pro správu kryptografického stavu.

#### Milník 2.4: Lokální Šifrovaná Databáze (`client/src/storage/`)
- `DatabaseManager.ts`: Správa šifrované databáze SQLCipher s 256bitovým klíčem v Keychain, WAL režimem a verzovanými migracemi schématu v1.
- `SqliteSignalStore.ts`: Persistentní SQLite adaptér implementující `ISignalStore` pro ukládání relací, Signed PreKeys a One-Time PreKeys.
- `ContactRepository.ts` & `MessageRepository.ts`: Repozitáře pro správu adresáře kontaktů a dešifrované historie zpráv.

#### Milník 2.5: Výměna Klíčů a Orchestrace Zpráv (`client/src/orchestration/`)
- `ContactExchange.ts`: Kompaktní Base64/URI formát pro QR kódy s Ed25519 kryptografickou kontrolou integrity Signed PreKey proti MITM útokům.
- `AppOrchestrator.ts`: Centrální kontroler sjednocující síťové klienty, kryptografický engine a šifrované úložiště do událostmi řízeného systému pro UI.

#### Milník 2.6: UI/UX, Navigace a React State Management (`client/src/ui/`)
- `theme.ts`: Moderní kyberbezpečnostní Dark Mode paleta (`#0D1117`, `#161B22`, akcent `#10B981`).
- `OrchestratorContext.tsx`: Reaktivní React Context a hook `useOrchestrator()` propojující UI přímo s orchestrátorem bez zasekávání UI vlákna.
- `components/`: Znovupoužitelné komponenty (`TorStatusBadge`, `MessageBubble`, `ContactListItem`, `ScreenContainer`, `Button`, `Input`).
- `screens/`:
  - `WelcomeScreen.tsx`: Vytvoření / obnova identity.
  - `SeedDisplayScreen.tsx`: Mřížka 12 slov seedu s bezpečnostním varováním a potvrzením.
  - `RestoreSeedScreen.tsx`: Zadání seedu pro obnovení.
  - `ChatListScreen.tsx`: Seznam konverzací s živým indikátorem stavu Toru a FAB pro skenování.
  - `ChatScreen.tsx`: Aktivní chat s real-time odesíláním a příjmem bublin zpráv.
  - `ProfileScreen.tsx`: Zobrazení vlastního QR kódu (`exportContactUri`) a bezpečné odhlášení.
  - `ScannerScreen.tsx`: Hledáček pro skenování QR kódu / vložení URI kontaktu.
- `RootNavigator.tsx`: Stavová navigace přepínající mezi Onboardingem a Hlavní aplikací podle existence identity v Keychain.

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
│   │   ├── storage/             # SQLCipher DatabaseManager, SqliteSignalStore, Repozitáře
│   │   ├── orchestration/       # ContactExchange (QR URI), AppOrchestrator
│   │   ├── ui/                  # UI Theme, Context, Komponenty, Obrazovky a RootNavigator
│   │   │   ├── components/      # TorStatusBadge, MessageBubble, ContactListItem, Button...
│   │   │   ├── context/         # OrchestratorContext, useOrchestrator hook
│   │   │   ├── navigation/      # RootNavigator
│   │   │   ├── screens/         # Welcome, SeedDisplay, RestoreSeed, ChatList, Chat, Profile, Scanner
│   │   │   └── theme.ts         # Dark Mode kyberbezpečnostní paleta
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

1. **Spuštění všech testovacích sad (34 unit a integračních testů):**
   ```bash
   cd client
   npm test
   ```
   *Pokrývá: IdentityManager, SOCKS5 tunel, Tor HttpClient/WebSocket, Double Ratchet E2EE, SQLCipher persistenci, ContactExchange QR ověřování, AppOrchestrator integrační simulaci a UI komponenty.*

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
