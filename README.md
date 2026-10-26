# Capri AI · Android

Capri come app Android: interfaccia cyberpunk e bolla flottante, con modalità "Hey Capri" e lettura dello schermo. Può aprire app, cercare su YouTube e Google, chiamare (anche su WhatsApp) e controllare la musica (swiftFree o Spotify).
Per il cervello usa il PC in LAN (Ollama), poi Gemini con più key, poi altri provider gratuiti, infine OpenRouter con i modelli `:free`.

Versione desktop (Windows): [CapriAi](https://github.com/gattoautistaico-cpu/CapriAi).

## Struttura
```
app/src/com/cyberai/capri/   MainActivity (WebView + bridge), BubbleService (bolla + Hey Capri),
                             Stt (riconoscimento vocale), ScreenReader (accessibilità), Tools (app, chiamate, WhatsApp)
app/assets/web/              interfaccia: index.html, style.css, app.js (router AI, strumenti, impostazioni)
tc/                          build senza Android SDK: mkapk.py (manifest binario + resources.arsc), build.sh, setup-toolchain.sh
```

## Compilare
Servono soltanto **git** e **JDK 17 o successivo**: niente Android SDK e niente Gradle.
```bash
./build-apk.sh            # -> app/CapriAI.apk (firmato)
./build-apk.sh 400 0.4.0  # versionCode e versionName personalizzati
```
Su Windows lancialo da Git Bash.

### Build automatica su GitHub
Ogni push su `main` compila l'APK: lo trovi in **Actions → build-apk → Artifacts**. Con un tag `v0.4.0` l'APK finisce anche in **Releases**.

Per firmare sempre con la stessa chiave, così gli aggiornamenti si installano sopra la versione precedente:
1. `base64 -w0 release.jks` → copia l'output.
2. Repo → Settings → Secrets and variables → Actions → **New repository secret**, nome `RELEASE_JKS_BASE64`.

Il keystore usa alias `app` e password `android`. **Non** caricare mai il file `.jks` nella repo.

## Limiti
- minSdk 24 (Android 7), targetSdk 29, firma v1.
- La lettura dello schermo richiede di attivare il servizio di accessibilità. Su Android 13 e successivi bisogna prima consentire le "impostazioni con restrizioni" dalle Info app.

## Lingua / Language
L'app è in italiano e in inglese. Al primo avvio la lingua segue quella del telefono. Per cambiarla:
- **Impostazioni → AI → Lingua · Language**, oppure
- il pulsante **IT/EN ⇄** nella barra delle schede.

Cambiano anche la lingua delle risposte, del riconoscimento vocale e della voce.

The app is available in Italian and English. Switch it in **Settings → AI → Lingua · Language** or with the **IT/EN ⇄** button in the tab bar.

## Licenza
Apache License 2.0: vedi [LICENSE](LICENSE) e [NOTICE](NOTICE). © 2026 gattoautistaico-cpu.
I nomi "Capri AI" e "Cyber AI" non sono concessi in licenza (Apache-2.0, sezione 6).
