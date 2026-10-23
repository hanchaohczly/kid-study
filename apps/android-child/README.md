# Kid Study Android Child

Android tablet client for the child and parent learning workflows.

## Included

- Child PIN login with an encrypted HttpOnly session cookie
- Parent mode protected by password or device biometric authentication
- Today's objective and subjective training
- Persistent handwriting canvas for subjective-question scratch work
- Three-level hints with duplicate-action protection
- Offline startup, draft recovery, cached tasks, and local completion markers
- Pending answer queue synchronized by WorkManager with idempotent replay
- Child task completion and parent-side verification with weekly report
- Child-safe wrong-book review without answer keys or explanations
- AI Passport deep links for training, tasks, and wrong-book views
- Landscape tablet navigation and compact-screen fallback

## Deep links

```text
kidstudy://passport/training
kidstudy://passport/tasks
kidstudy://passport/wrong-book
```

## Run

1. Start the existing API/Web stack on the Mac at port `8080`.
2. Open this directory in Android Studio.
3. Install Android SDK 35 when prompted.
4. Run the `app` configuration on a tablet emulator.
5. Keep the default service URL `http://10.0.2.2:8080/api/`.

For a physical tablet, use `http://<Mac-LAN-IP>:8080/api/` and ensure the tablet
and Mac are on the same network.

## Command line

```bash
export JAVA_HOME=/path/to/jdk-21
export ANDROID_HOME=$HOME/Library/Android/sdk
sh gradlew testDebugUnitTest assembleDebug
```

The debug APK is generated at:

`app/build/outputs/apk/debug/app-debug.apk`
