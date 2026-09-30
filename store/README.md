# FileHop — Google Play kit

Everything the Play Console asks for, in the order it asks. Replace `YOUR_SUPPORT_EMAIL` and `YOUR_PRIVACY_POLICY_URL` before submitting.

## Graphics (`store/play/`)

| Play Console field | File | Spec |
| --- | --- | --- |
| App icon | `play/icon-512.png` | 512×512 PNG, no transparency |
| Feature graphic | `play/feature-graphic.png` | 1024×500 PNG |
| Phone screenshots | `play/screenshots/*.png` | 1080×1920 (9:16), 2–8 required |

To refresh the screenshots, capture new raw screens and rebuild:

```bash
adb exec-out screencap -p > store/raw/send.png
```

```bash
powershell -ExecutionPolicy Bypass -File store/make-store-images.ps1
```

The best screenshots to add: the Send screen with a phone listed, the "accept files?" prompt, and a transfer in progress with its speed.

## Store listing

**App name** (30 max)
```
FileHop: Share Files Offline
```

**Short description** (80 max)
```
Send photos, videos, apps and any file to a nearby phone. No internet needed.
```

**Full description** (4000 max)
```
FileHop sends files straight from one phone to another nearby phone. No internet, no mobile data, no account and no size limit.

Pick photos, videos, music, PDFs, APKs or any other file, tap a nearby phone, and the files hop across in seconds. The other person just taps Receive and accepts.

WORKS WITHOUT A SHARED WI-FI
• On the same Wi-Fi? FileHop uses it for top speed.
• No shared network? FileHop connects the two phones directly with Wi-Fi Direct. Just keep Wi-Fi turned on. No need to join a network.

WHY FILEHOP
• Any file type, any size: videos, apps, whole folders of photos
• No internet or mobile data used
• No sign-up, no ads, no tracking
• Every transfer needs the receiver's OK, so nobody can push files to you
• Live progress and speed for every transfer
• Received files are saved to Downloads/FileHop

HOW IT WORKS
1. Open FileHop on both phones.
2. On the receiving phone, tap Receive.
3. On the sending phone, tap Send, choose files and tap the other phone.
4. The receiver accepts, and the files arrive.

PRIVATE BY DESIGN
Files go directly between the two phones. They never pass through a server, and FileHop collects no data.

FileHop currently runs on Android phones and tablets with Wi-Fi.
```

**Category:** Tools
**Tags:** File transfer, File sharing, Offline
**Contact email:** YOUR_SUPPORT_EMAIL
**Privacy policy URL:** YOUR_PRIVACY_POLICY_URL (host `store/privacy-policy.html`, see below)

## App content

**Privacy policy.** Play requires a public URL. `store/privacy-policy.html` is a ready page. The quickest free host is GitHub Pages: put it in a public repo as `index.html` and turn on Pages. Fill in your support email first.

**Ads:** No, the app doesn't contain ads.

**App access:** All functionality is available without special access (no login).

**Content rating (IARC questionnaire):** Category *Utility, Productivity, Communication or Other*. Answer No to violence, sexual content, language, drugs and gambling. For "Does the app allow users to interact or exchange content?", answer **Yes**: users can send files to each other, unmoderated. Expect a rating around *Everyone / 3+*, possibly with a "Users Interact" note.

**Target audience:** 13+ (or 18+). Don't include under-13 age groups; that pulls in the Families policy.

**News app:** No. **COVID-19 app:** No. **Government app:** No. **Financial features:** None.

**Data safety**
- Does your app collect or share any of the required user data types? **No.**
  FileHop has no server. Files and device names move only between two phones, directly, when the user starts a transfer and the receiver accepts. The developer and third parties never receive them.
- Is all user data encrypted in transit? Not asked once you answer "No" above. If a reviewer asks, the honest answer is that transfers rely on Wi-Fi/WPA2 link security, and the app adds no encryption of its own.
- Can users request data deletion? Not applicable (nothing is collected).

Read Google's current definition of "collection" before submitting. If you later add analytics, crash reporting or ads, this section must change.

**Permissions reviewers may ask about**
| Permission | Why | Declaration form? |
| --- | --- | --- |
| `NEARBY_WIFI_DEVICES` (flag `neverForLocation`) | Wi-Fi Direct discovery and connect on Android 13+ | No |
| `ACCESS_FINE_LOCATION` / `COARSE` (maxSdk 32) | Android requires it for Wi-Fi Direct on 12 and below; foreground only | No (background location isn't used) |
| `WRITE_EXTERNAL_STORAGE` (maxSdk 28) | Save to Downloads on Android 9 and below | No |
| `WAKE_LOCK`, Wi-Fi/network state | Keep transfers running with the screen on | No |

## Release checklist

1. **Create an upload keystore.** Without one, release builds are signed with the debug key and Play rejects them. Run this yourself; it asks for passwords. Back up the keystore file and passwords somewhere safe: losing them means you can't ship updates.
   ```bash
   npm run android:keystore
   ```
2. **Build the App Bundle.** The `.aab` goes to `build-output/`.
   ```bash
   npm run android:aab
   ```
3. **Bump versions for every upload:** `versionCode` (must increase) and `versionName` in `android/app/build.gradle`.
4. In Play Console, create the app, enrol in **Play App Signing** (default), fill in the sections above, and upload the `.aab`.
5. **Test first.** New personal developer accounts must run a closed test with at least 12 testers for 14 days before a production release. Use the Internal testing track for quick checks on your own phones.
6. **Target API:** the app targets SDK 36, which meets Play's current requirement.

Check that no other app on Play already uses the name "FileHop" in a way that could conflict before you publish.
