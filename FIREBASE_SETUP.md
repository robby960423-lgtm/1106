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

## AI 助手（Firebase AI Logic）

AI 助手程式已接入 Gemini Developer API 的 `gemini-3.8-flash`，三個功能都只會讀取精簡的行程／待辦資料；新增項目與待辦排程需在面板按下確認後才寫入 Firestore。Firebase AI Logic 於 2026-11-02 起自動強制 App Check，因此目前若尚未設定下列 App Check 資料，AI 會維持停用；Firebase 專案無需連結 Cloud Billing 即可使用 Gemini Developer API 免費方案，但模型額度有限。

1. Firebase Console → AI Services → AI Logic，按「Get started」，選 Gemini Developer API 並完成引導設定。此流程會啟用所需 API，並強制 AI Logic 的 App Check。
2. 為網站 Web app 設定 App Check 的 reCAPTCHA Enterprise provider：建立 score-based Web key（只填正式網站網域 `robby960423-lgtm.github.io`，不要把 localhost 加進正式 key），再到 Firebase Console → Security → App Check → Apps 將正確的 Web app 註冊到此 provider。專案內不同 Firebase Web app 的註冊狀態各自獨立。
3. 將剛才的 reCAPTCHA Enterprise site key 填入 `index.html` 的 `window.DAYFLOW_APPCHECK_SITE_KEY`。這是公開 site key，不是 secret；不要把 debug token 或服務帳戶憑證放入前端或 Git。
4. 本機開發時，使用單獨的 App Check debug provider/token，並只在 Firebase Console 登記該 debug token；不可把 debug token 部署到正式網站。詳見 [Firebase AI Logic 開始使用](https://firebase.google.com/docs/ai-logic/get-started?platform=web) 與 [App Check reCAPTCHA Enterprise 網頁設定](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)。

Firebase web config 中的 apiKey/appId 是用戶端識別值，不是管理員密鑰；實際資料保護由登入驗證與 Firestore Security Rules 負責。切勿把服務帳戶私鑰或 LINE Client Secret 放進前端。
