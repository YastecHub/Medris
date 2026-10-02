# Native app shell for WhatsApp-style incoming calls

## Why a native shell is needed
A web app (PWA) can only show an incoming call as a normal notification. It cannot take over the lock screen
or show a full-screen "Answer / Decline" call screen like WhatsApp. That needs OS-level call features:

| Platform | What WhatsApp uses | Needs |
|----------|--------------------|-------|
| Android  | High-priority FCM data message → native service → full-screen-intent call notification (`CallStyle`), foreground service | Native app (Play Store) + Firebase |
| iPhone   | PushKit VoIP push → CallKit call UI | Native app (App Store) + Apple Developer account |

What already works today without a native app (shipped): incoming-call push that stays on screen, vibrates,
expires after 45 s, with **Answer** and **Decline** buttons (Decline works with the app closed), plus the in-app
ringing screen when the app is open.

## Proposed approach
Wrap the existing site in a **Capacitor** shell (the web code stays exactly as it is, loaded from levromart.com), and add a
small native call layer.

### Android (do first)
1. Capacitor Android project `com.levromart.app`, `server.url = https://levromart.com`.
2. Firebase Cloud Messaging. Server sends a **data-only, high-priority** message when a call starts.
3. Native `FirebaseMessagingService` receives it (even when the app is killed) and posts a call notification with
   `fullScreenIntent` + `Notification.CallStyle` (Answer / Decline), ringtone and vibration. Permissions:
   `POST_NOTIFICATIONS`, `USE_FULL_SCREEN_INTENT`, `FOREGROUND_SERVICE_PHONE_CALL`/`MICROPHONE`, `RECORD_AUDIO`.
4. Answer opens the app straight to the call screen (`?answerCall=<id>` handled in `index.html`); Decline calls the
   existing `decline-call` endpoint in `api/notify.js` (already built) without opening the app.
5. Web side: register the device's FCM token in a new `fcm_tokens` table (RLS: owner only) after login.
6. Server side: extend `api/notify.js` (no new Vercel function — the project is at the 12-function limit) to also send FCM
   for `incoming_call` notifications, using a Firebase service-account key stored as a Vercel env var.
7. CI: GitHub Action that builds a signed AAB for the Play Store (keystore as repo secret).

Play Store note: `USE_FULL_SCREEN_INTENT` on Android 14+ is only granted to apps whose core function is calling/alarms;
the app must be declared as a calling app in Play Console.

### iPhone (second)
Capacitor iOS project + PushKit/CallKit plugin; server sends a VoIP push through APNs. Needs an Apple Developer account,
APNs key and a Mac (or a cloud Mac CI runner) to build.

## What I need from you
- Google Play Developer account (one-time US$25) and the app listing name.
- A Firebase project: `google-services.json` for Android and a service-account key (goes into Vercel env, never into git).
- Decision on the package id (suggested `com.levromart.app`) and app icon/splash (the current 512 px icon can be used).
- For iPhone: Apple Developer Program (US$99/year), plus the APNs auth key.
- Someone with Android Studio for the first build and Play upload (or the keystore secret so CI can do it).

## Effort and risk
- Android: roughly 1–2 weeks including Play review. iPhone: roughly 2 more weeks.
- This environment has no Android SDK or Mac, so native code cannot be compiled or run here; it would need to be built and
  tested on a real phone. That is why none of the native code is committed yet.
- Users still have to allow notifications and the phone's "display over other apps / full screen notifications" setting.
