# 積木減脂（飲食 × 體重） — Android App

用 [Capacitor](https://capacitorjs.com) 把同一份網頁（`index.html`）包成 APK。網頁版（GitHub Pages）和 App 共用同一份程式碼，不需要維護兩套。

## 備份在 App 裡怎麼運作

備份層是一個介面（`js/backup.js` 的 `window.Backup`），依環境選一種實作：

| 環境 | 實作 | 行為 |
|---|---|---|
| Android App | `NativeBackup` | 每次修改後自動寫到「文件／DietWeightTracker」：`diet-weight_latest.json` ＋ 當日檔（保留 7 天）。不用選資料夾、不會過期授權 |
| 瀏覽器 | `WebBackup` | 只能手動下載或分享 |

- 備份內容就是原本的「完整 JSON 備份」（飲食、體重、食材庫、範本、設定），可用「匯入完整JSON」還原。
- 自動備份成功就算「已備份」，所以 App 裡不會再出現「超過 7 天沒備份」的提醒。完全沒有紀錄時不會備份，避免「清除 App 資料」後的空白資料蓋掉還沒還原的檔案。
- App 啟動時也會備份一次；寫入失敗時首頁會出現橫幅。
- 「匯出完整JSON」「分享完整CSV」「體重 CSV 分享」在 App 裡會叫出系統分享選單（可傳到雲端硬碟、LINE）；各種「下載」按鈕則存進同一個資料夾。

**重新安裝 App 後**：舊檔案還在「文件／DietWeightTracker」，但新安裝的 App 讀不到，請用「匯入完整JSON」自己選檔還原。若新安裝寫不進同名舊檔，會自動改寫成帶識別碼的檔名（例如 `diet-weight_latest_ab12.json`）。**清除 App 資料後請先還原再記錄**，否則新記的第一筆會覆蓋當天的備份檔（前幾天的日期檔還在）。

另外 `android:allowBackup` 是開的，系統會把 App 資料備份到你的 Google 帳號（換手機時自動還原），只當保底，不要只靠它。

**和其他 App 共用簽章金鑰**：同一把 keystore 可以簽多個 App，這個專案的 GitHub secrets 內容和智慧記帳、油耗保養一樣即可。appId 是 `io.github.z88487561.dietweighttracker`，三個 App 可以同時安裝。

**已知限制**：體重提醒用的是網頁通知（`Notification`），Android 的 WebView 不支援，所以 App 裡「量體重提醒」不會跳通知。需要的話可以另外改用 Capacitor 的 LocalNotifications 外掛。

## 第一次設定簽章金鑰（重要，先做）

APK 要用**同一把金鑰**簽，之後的新版本才能直接覆蓋安裝。沒有固定金鑰就沒辦法更新，只能先解除安裝，**所有紀錄會跟著消失**。

```bash
keytool -genkeypair -v -keystore release.keystore -alias ledger \
  -keyalg RSA -keysize 2048 -validity 10000
# 金鑰密碼請和儲存庫密碼設成一樣
base64 -w0 release.keystore      # macOS：base64 -i release.keystore
```

到 GitHub 儲存庫 → Settings → Secrets and variables → Actions，新增四個 secret：

- `ANDROID_KEYSTORE_BASE64`：上面 base64 的輸出
- `ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_PASSWORD`：密碼
- `ANDROID_KEY_ALIAS`：`ledger`（沿用智慧記帳的金鑰就維持這個別名）

`release.keystore` 請另外備份到安全的地方（不要放進儲存庫）。弄丟就無法更新 App。

## 用 GitHub Actions 建置

1. 到儲存庫 Actions → **Build Android APK** → Run workflow（或推 `v1.0.0` 之類的標籤，會自動建立 Release 並附上 APK）。
2. 跑完後在該次執行的 Artifacts 下載 `diet-weight-apk`，把 APK 傳到手機安裝（第一次要允許「安裝未知來源應用程式」）。
3. 改了 `index.html` 等網頁檔推上 `main`，也會自動重建。

## 本機建置

需要 Node 22、JDK 21、Android Studio（或 Android SDK）。

```bash
npm ci
npm run sync          # 複製網頁到 www/ 並同步進 android/
cd android && ./gradlew assembleDebug
# 或  npm run android:open  用 Android Studio 開啟
```

## 版本號

`package.json` 的 `version` 是顯示用的版本名稱；`versionCode` 由 CI 的執行編號自動遞增。

## 實機測試清單（還沒在真機上跑過，請逐項確認）

1. 記一筆飲食或體重 → 用檔案管理員確認「文件／DietWeightTracker」出現 `diet-weight_latest.json` 與當日檔，設定頁的備份說明沒有警告。
2. 設定 → 「匯出完整JSON」「分享完整CSV」「下載完整CSV」、體重頁的「分享／下載體重 CSV」都能用；CSV 用 Excel 開啟中文不亂碼。
3. 清除 App 資料後，用「匯入完整JSON」選 `diet-weight_latest.json` 能完整還原（飲食、體重、食材庫、範本、設定都在）。
4. 解除安裝再用同一把金鑰簽的 APK 重裝 → 還原後繼續記錄，確認沒有出現備份失敗的橫幅。
5. 左右滑動換頁、深色模式、圖表（Chart.js）在 WebView 裡的顯示。
6. Android 10 以下、Android 11～12 的機器若有，各測一次寫入（權限行為不同）。
