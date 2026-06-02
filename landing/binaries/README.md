# Static Binaries for the Landing Page

This folder contains files that are served **directly** from the landing page.

## Android Wallet

Place the built Android APK here:

```
landing/binaries/poh-miner-wallet.apk
```

Once the file is here:

- The "Download Android Wallet (.apk)" button on the landing will link to it relatively.
- It will work when:
  - Running locally: `npm run serve:landing` (or the node script)
  - Deployed via `./scripts/deploy-landing.sh`
  - Published to IPFS via `./scripts/publish-to-ipfs.sh`

## How to build the APK (PoH Wallet with branding + full i18n + src/ structure)

From the `poh-miner-wallet` directory:

```bash
cd ../poh-miner-wallet

# Recommended (EAS Build - produces preview APK for sideloading):
npm run build:android          # uses "preview" profile -> internal APK
# or for production AAB:
# npm run build:android:prod

# After build completes in EAS dashboard, download the .apk artifact
# and place it here as:
#   landing/binaries/poh-miner-wallet.apk
```

The `eas.json` defines the profiles; `app.json` + `assets/icon.png` etc. ensure "PoH Wallet" name and logo.

Local alternative (if you have Android SDK set up):
```bash
npm run prebuild
cd android
./gradlew assembleRelease   # or assembleDebug
# then find the .apk under app/build/outputs/...
```

Then copy/rename the APK into `landing/binaries/poh-miner-wallet.apk` so that
`publish-to-ipfs.sh` and `deploy-landing.sh` will include it.

## Other files

You can also drop other static assets here (future Windows/Mac installers, etc.) if you want one-click downloads served directly from the landing without external links.