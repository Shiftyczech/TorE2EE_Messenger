# Návod na sestavení a instalaci Android Release APK (TorE2EE Messenger)

Tento dokument obsahuje kompletní postup pro vygenerování podpisového klíče, konfiguraci prostředí, kompilaci produkčního APK balíčku a jeho instalaci na fyzické zařízení s optimalizací pro běh Toru.

---

## 1. Vygenerování podpisového klíče (Keystore)

Pokud ještě nemáte vytvořený produkční podpisový klíč (`.keystore`), vygenerujte jej pomocí nástroje `keytool` (součást JDK/OpenJDK).

### Příkaz pro vygenerování klíče:
```bash
keytool -genkeypair -v -storetype PKCS12 -keystore tore2ee-release-key.keystore -alias tore2ee-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

> **Poznámka k parametrům:**
> - `-keystore tore2ee-release-key.keystore`: Název výstupního souboru klíčenky.
> - `-alias tore2ee-key-alias`: Název aliasu klíče v klíčence.
> - `-storetype PKCS12`: Moderní standardní formát úložiště klíčů.
> - `-keyalg RSA -keysize 2048`: 2048bitový RSA šifrovací klíč.
> - `-validity 10000`: Platnost certifikátu na 10 000 dní (~27 let).
>
> Během generování budete vyzváni k zadání hesla keystore (např. `123456` pro testovací prostředí nebo silné heslo pro produkci) a základních identifikačních údajů (Jméno, Organizace, Město, Stát).

---

## 2. Umístění klíče v projektu

Vygenerovaný soubor `tore2ee-release-key.keystore` přesuňte do složky:

```
client/android/app/
```
*(V kořenovém adresáři je dostupná také přes symlink `android/app/tore2ee-release-key.keystore`).*

---

## 3. Konfigurace `android/gradle.properties`

Ověřte nebo doplňte konfiguraci v souboru `client/android/gradle.properties`. Tento soubor definuje alokaci paměti JVM pro kompilátor a parametry keystore, které načítá `android/app/build.gradle`.

```properties
# Alokace paměti pro Gradle daemon (doporučeno min. 4GB pro React Native + C++ buildy)
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=512m

# Cesta k JDK 17 (pokud není nastavena systémová proměnná JAVA_HOME)
org.gradle.java.home=/usr/lib/jvm/java-17-openjdk-amd64

# AndroidX & Jetifier
android.useAndroidX=true
android.enableJetifier=true

# Cílové architektury pro NDK
REACT_NATIVE_ARCHITECTURES=armeabi-v7a,arm64-v8a,x86,x86_64

# Konfigurace Release Keystore
MYAPP_RELEASE_STORE_FILE=tore2ee-release-key.keystore
MYAPP_RELEASE_KEY_ALIAS=tore2ee-key-alias
MYAPP_RELEASE_STORE_PASSWORD=123456
MYAPP_RELEASE_KEY_PASSWORD=123456
```

---

## 4. Spuštění kompilace Release APK

Kompilaci lze spustit několika způsoby:

### Možnost A: Pomocí NPM skriptu z kořenového adresáře nebo složky `client/`
```bash
npm run build:android
```

### Možnost B: Přímo přes Gradle Wrapper
```bash
cd client/android
./gradlew clean
./gradlew assembleRelease
```

### Umístění výsledného APK balíčku:
Po úspěšném dokončení kompilace naleznete podepsaný balíček v:
```
client/android/app/build/outputs/apk/release/app-release.apk
```

---

## 5. Instalace na zařízení a nastavení baterie

### A. Instalace přes ADB (USB ladění)
Ujistěte se, že máte na telefonu povolen režim pro vývojáře a **USB Debugging**.

1. **Instalace pomocí NPM skriptu:**
   ```bash
   npm run install:android
   ```
2. **Nebo přímým příkazem ADB:**
   ```bash
   adb install -r client/android/app/build/outputs/apk/release/app-release.apk
   ```

---

### B. Nastavení neomezené baterie (Bypass Doze Mode pro Tor)
Aby mohl **Tor démon** a **Background Sync** spolehlivě udržovat onion spojení a stahovat zprávy i při zhasnutém displeji, aplikace automaticky detekuje chybějící výjimku z optimalizace baterie.

#### 1. Automatické vyžádání v aplikaci (Doporučeno):
Při prvním spuštění aplikace (na úvodní obrazovce `WelcomeScreen`) se automaticky zobrazí dialog s vysvětlením. Po klepnutí na tlačítko **„Povolit“** se vyvolá nativní Android dialog (`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`), kde uživatel jedním klikem schválí výjimku.

#### 2. Nastavení přes ADB příkazovou řádku (pro vývojáře):
```bash
adb shell dumpsys deviceidle whitelist +com.tore2ee.messenger
```

#### 3. Manuální nastavení v telefonu (záložní možnost):
1. Přejděte do **Nastavení** -> **Aplikace** -> **TorE2EE Messenger**.
2. Vyberte položku **Baterie** (nebo *Využití baterie*).
3. Nastavte profil na **Neomezeno** (*Unrestricted*) namísto *Optimalizováno* (*Optimized*).
4. Deaktivujte volbu **Pozastavit aktivitu v aplikaci, pokud se nepoužívá** (*Pause app activity if unused*).
5. U výrobců jako Xiaomi (MIUI/HyperOS), Samsung (OneUI) nebo Huawei povolte také **Automatické spuštění** (*Autostart / Allow background activity*).

---

## 6. Udělení systémových oprávnění po spuštění

Při prvním spuštění aplikace v telefonu potvrďte:
- **Oznámení (POST_NOTIFICATIONS)** – nutné pro příjem zpráv a foreground service Toru.
- **Fotoaparát (CAMERA)** – nutné pro skenování QR kódů při výměně kontaktů (Contact Exchange) a párování nových zařízení (Device Linking).

