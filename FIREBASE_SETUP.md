# Firebase 設定與 Google／LINE 登入

此靜態網站會在 Firebase Authentication 驗證成功前隱藏行事曆；行程與待辦儲存在 Cloud Firestore，並以 Firebase UID 隔離。

## 設定步驟

1. Firebase Web app 已建立於 1106 專案。`index.html` 透過 `window.DAYFLOW_FIREBASE_CONFIG` 初始化前端 SDK。
2. Authentication → Sign-in method：啟用 Google provider。
3. Authentication 已啟用 LINE OpenID Connect provider `oidc.line`，Issuer 為 `https://access.line.me`。Identity Platform 已升級啟用，專案計費方案仍是 Spark 免費方案；目前 LINE OIDC 配額為每日最多 2 位活躍使用者。
4. LINE Developers 的 LINE Login channel callback URL 設為 Firebase handler：`https://project-1619483796582425528.firebaseapp.com/__/auth/handler`。
5. LINE provider 的 Client ID 和 Client Secret 設定在 Firebase Console。Client Secret 僅保存在 Firebase，切勿放進前端或 Git。前端使用 Firebase provider ID `oidc.line` 並要求 `profile` scope，以取得 LINE 顯示名稱。
6. Authentication → Settings → Authorized domains：確認網站網域 `robby960423-lgtm.github.io` 已加入；本機預覽時也加入 `localhost`。
7. 建立 Cloud Firestore database。將本專案的 `firestore.rules` 套用並發布；規則只允許登入者讀寫自己的 `users/{uid}/plannerItems`。
8. 本機以靜態 HTTP server 預覽（例如 `python -m http.server 8000`），不要直接以 `file://` 開啟。

Firebase web config 中的 apiKey/appId 是用戶端識別值，不是管理員密鑰；實際資料保護由登入驗證與 Firestore Security Rules 負責。切勿把服務帳戶私鑰或 LINE Client Secret 放進前端。
