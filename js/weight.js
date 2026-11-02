/* =========================================================================
   體重紀錄模組 (整合自獨立的 weight-tracker)
   - 目標計畫 / 判定 / 教練回饋 / 連續達成與徽章 / SVG 圖表 / CSV 備份與合併匯入
   - 資料存在 state.weight (由主程式統一存檔)；身高共用 state.profile.height
   ========================================================================= */
const WT = (() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const pad = (n) => String(n).padStart(2, "0");
  const TAGS = ["早晨空腹", "睡前", "餐後", "運動後", "一般"];
  const LEGACY_KEY = "wt_v1";                              // 舊版獨立體重紀錄 App 的存檔鍵
  const LEGACY_DONE = "fat_loss_pwa_wt_legacy_done";
  const PREV_KEY = "fat_loss_pwa_weight_prev";             // 匯入 / 清除前的快照
  const MIGRATED_NOTE = "飲食版每日體重";                    // 由舊版飲食記錄的「每日體重」轉入的紀錄
  const r1 = (x) => Math.round(x * 10) / 10;
  const f1 = (x) => (x == null || isNaN(x)) ? "–" : (Math.round(x * 10) / 10).toFixed(1);
  const r2 = (x) => Math.round(x * 100) / 100;
  // 體重一律顯示到小數點後兩位 (例：71.25)
  const fw = (x) => (x == null || isNaN(x)) ? "–" : (Math.round(x * 100) / 100).toFixed(2);
  const esc = (x) => String(x == null ? "" : x).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const today = () => ymd(new Date());
  const dn = (s) => { const [y, m, d] = s.split("-"); return Date.UTC(y, m - 1, d) / 864e5; };
  const add = (s, n) => { const d = new Date(s + "T00:00"); d.setDate(d.getDate() + n); return ymd(d); };
  const nowL = () => { const d = new Date(); return ymd(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  let lastId = 0;
  const nid = () => (lastId = Math.max(Date.now() * 1000, lastId + 1));
  const nD = (x) => { const m = String(x || "").trim().match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/); return m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 ? m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]) : ""; };
  const nT = (x) => { const m = String(x || "").trim().match(/^(\d{1,2}):(\d{2})/); return m && +m[1] < 24 && +m[2] < 60 ? pad(+m[1]) + ":" + m[2] : "07:00"; };
  const toast = (m, c, ms) => showToast(m, c, ms);
  const defTag = () => { const h = new Date().getHours(); return h >= 20 || h < 4 ? "睡前" : h < 10 ? "早晨空腹" : "一般"; };

  let S = null;            // = state.weight (永遠就地修改，不重新指派)
  let editId = null;
  let autoOpened = false;
  let impMode = "replace";

  // ---------------------------------------------------------------------
  // 資料清理
  // ---------------------------------------------------------------------
  const DEF = () => ({ cfg: null, rec: [], rem: { on: false, m: "07:30", n: "21:30" }, bg: {} });

  function cleanCfg(c) {
    if (!c || typeof c !== "object") return null;
    const o = { w0: +c.w0, wt: +c.wt, weeks: +c.weeks, cap: +c.cap || .7, band: +c.band || 1, mode: c.mode === "maintain" ? "maintain" : "lose", pm: c.pm === "rate" ? "rate" : "weeks", d0: nD(c.d0) };
    if (!(o.w0 > 20 && o.w0 < 400 && o.wt > 20 && o.wt < 400 && o.weeks > 0 && o.d0)) return null;
    o.hist = (Array.isArray(c.hist) ? c.hist : []).map(h => {
      h = h || {};
      const p = { until: nD(h.until), mode: h.mode === "maintain" ? "maintain" : "lose", w0: +h.w0, wt: +h.wt, weeks: +h.weeks, d0: nD(h.d0), band: +h.band || 1 };
      return p.until && p.d0 && p.w0 > 20 && p.wt > 20 && p.weeks > 0 ? p : null;
    }).filter(Boolean).sort((a, b) => a.until < b.until ? -1 : 1);
    return o;
  }

  function cleanRec(e) {
    if (!e || typeof e !== "object") return null;
    const d = nD(e.d), w = +e.w;
    if (!d || !(w > 20 && w < 400)) return null;
    return { id: Number.isFinite(+e.id) && +e.id > 0 ? +e.id : nid(), d, t: nT(e.t), g: TAGS.includes(e.g) ? e.g : "", w, n: e.n == null ? "" : String(e.n) };
  }

  function normalize(p) {
    const src = p && typeof p === "object" ? p : {};
    const o = Object.assign(DEF(), src);
    o.rec = (Array.isArray(src.rec) ? src.rec : []).map(cleanRec).filter(Boolean);
    o.cfg = cleanCfg(src.cfg);
    o.rem = Object.assign({ on: false, m: "07:30", n: "21:30" }, src.rem && typeof src.rem === "object" ? src.rem : {});
    o.bg = src.bg && typeof src.bg === "object" ? src.bg : {};
    return o;
  }

  function makeRec(d, t, w, g, n) { return cleanRec({ id: nid(), d, t, w, g, n }); }

  // 就地換掉整份體重資料 (保持 state.weight 與 S 為同一個物件)
  function replaceAll(p) {
    dsCache = null;
    const n = normalize(p);
    Object.keys(S).forEach(k => delete S[k]);
    Object.assign(S, n);
  }

  // ---------------------------------------------------------------------
  // 計畫、判定、統計
  // ---------------------------------------------------------------------
  const PF = ["mode", "w0", "wt", "weeks", "d0", "band"];
  function pushHist(old) {
    const h = (old.hist || []).slice();
    if (S.rec.length) { const o = { until: today() }; PF.forEach(k => o[k] = old[k]); h.push(o); }
    return h;
  }
  const planAt = (d) => { const c = S.cfg; for (const h of c.hist || []) if (d < h.until) return h; return c; };
  const dd = () => { const c = S.cfg; return (c.w0 - c.wt) / (c.weeks * 7); };
  const endD = () => add(S.cfg.d0, Math.round(S.cfg.weeks * 7));
  const tg = (d) => { const c = planAt(d); return c.mode === "maintain" ? c.wt : r2(Math.min(c.w0, Math.max(c.wt, c.w0 - (c.w0 - c.wt) / (c.weeks * 7) * (dn(d) - dn(c.d0))))); };
  // 沒有設定目標時回傳 null (不判定)
  const ok = (e) => { const c = S.cfg; if (!c) return null; const p = planAt(e.d); return p.mode === "maintain" ? Math.abs(e.w - p.wt) <= p.band + 1e-9 : e.w <= tg(e.d) + 1e-6; };
  const sorted = () => [...S.rec].sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t));
  function days() { const m = {}; sorted().forEach(e => { (m[e.d] = m[e.d] || []).push(e); }); return m; }

  // ---------------------------------------------------------------------
  // 每日統計、趨勢 (7 日平均) 與狀態判定
  //   單日體重會因水分波動 0.5~1 kg，所以「判定」以 7 日平均 (趨勢) 對照目標線，
  //   單筆只用來上色 (綠/黃/紅)，不單獨決定成敗。
  // ---------------------------------------------------------------------
  const TOL = 0.5;                                  // 自然波動的容忍值 (kg)
  const ST_LABEL = { ahead: "領先", on: "正常", behind: "落後", far: "嚴重落後" };
  const ST_COLOR = { ahead: "#16a34a", on: "#65a30d", behind: "#d97706", far: "#dc2626" };
  let dsCache = null;
  const sv = () => { dsCache = null; return saveState(); };
  const hOk = () => !!(state.profile.heightConfirmed && state.profile.height >= 100);
  const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2);

  function trendIn(o, d) {
    let sm = 0, n = 0;
    for (let i = 0; i < 7; i++) { const x = o[add(d, -i)]; if (x) { sm += x.mean; n++; } }
    return n ? sm / n : null;
  }
  // 狀態：以趨勢體重 vs 當日目標線 (gap 正數 = 落後)
  function statusIn(o, d) {
    const c = S.cfg, tr = trendIn(o, d);
    if (!c || tr == null) return null;
    const p = planAt(d);
    if (p.mode === "maintain") {
      const out = Math.abs(tr - p.wt) - p.band;
      return { trend: tr, target: p.wt, gap: tr - p.wt, st: out <= 0 ? "on" : out <= TOL ? "behind" : "far", maintain: true, band: p.band };
    }
    const target = tg(d), gap = tr - target, wk = (p.w0 - p.wt) / p.weeks, severe = Math.max(1.5, 2 * wk);
    return { trend: tr, target, gap, st: gap <= 0 ? "ahead" : gap <= TOL ? "on" : gap <= severe ? "behind" : "far", days: wk > 0 ? gap / (wk / 7) : 0 };
  }
  function dayStat() {
    if (dsCache) return dsCache;
    const m = days(), o = {};
    for (const d in m) { const a = m[d]; o[d] = { mean: a.reduce((s, e) => s + e.w, 0) / a.length, last: a[a.length - 1], n: a.length }; }
    for (const d in o) { const st = statusIn(o, d); o[d].st = st; o[d].ok = st ? (st.st === "ahead" || st.st === "on") : null; }
    return (dsCache = o);
  }
  const trendAt = (d) => trendIn(dayStat(), d);
  const statusAt = (d) => statusIn(dayStat(), d);

  // 單筆上色：g 綠(達標) / a 黃(在自然波動內) / r 紅(明顯偏離)；沒設目標回傳 null
  function grade(e) {
    const c = S.cfg;
    if (!c) return null;
    const p = planAt(e.d);
    if (p.mode === "maintain") { const out = Math.abs(e.w - p.wt) - p.band; return out <= 1e-9 ? "g" : out <= TOL ? "a" : "r"; }
    const gap = e.w - tg(e.d);
    return gap <= 1e-6 ? "g" : gap <= TOL ? "a" : "r";
  }
  const GRADE_COLOR = { g: "#16a34a", a: "#eab308", r: "#dc2626" };

  function streak(f) {
    const o = dayStat();
    let d = today(), n = 0;
    if (!o[d]) { if (!f) return 0; d = add(d, -1); }
    while (o[d] && o[d].ok) { n++; d = add(d, -1); }
    return n;
  }

  // 近 4 週實測速度 (線性迴歸，含不確定度)；資料太少回傳 null。recentWk / overallWk：正數 = 下降 (kg/週)
  function pace() {
    const c = S.cfg, o = dayStat(), ks = Object.keys(o).sort();
    if (ks.length < 8) return null;
    const last = ks[ks.length - 1], win = ks.filter(k => k >= add(last, -27));
    if (win.length < 8 || dn(last) - dn(win[0]) < 14) return null;
    const x = win.map(dn), y = win.map(k => o[k].mean), n = x.length;
    const mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
    let sxx = 0, sxy = 0;
    x.forEach((v, i) => { sxx += (v - mx) ** 2; sxy += (v - mx) * (y[i] - my); });
    const sl = sxy / sxx;
    let sse = 0;
    x.forEach((v, i) => { sse += (y[i] - (my + sl * (v - mx))) ** 2; });
    const se = Math.sqrt(sse / Math.max(1, n - 2) / sxx);
    const out = { recentWk: -sl * 7, seWk: se * 7, n, overallWk: null };
    if (c) { const el = dn(last) - dn(c.d0), tr = trendIn(o, last); if (el >= 14 && tr != null) out.overallWk = (c.w0 - tr) / el * 7; }
    return out;
  }
  const weeklyPlanPace = () => { const c = S.cfg; return c && c.mode === "lose" ? (c.w0 - c.wt) / c.weeks : 0; };

  // ---------------------------------------------------------------------
  // 教練回饋訊息 (洗牌輪播：用完一輪才會重複)
  // ---------------------------------------------------------------------
  const MO = ['太棒了!今天又贏了自己一次 💪','達標!這就是紀律的力量 🔥','漂亮!曲線正在往下走 📉','做到了,保持這個節奏 🎯','進度領先,今天值得鼓勵自己 🌟','又一次達成!習慣正在養成 ✅','穩穩的!一步一步,終點就在前面 🏁','今天的你,比昨天更接近目標 🚶','數字漂亮,但最漂亮的是你的堅持 👏','目標線被你追上了,繼續保持 📈','每一筆達標,都是在為進度條充電 🔋','不必完美,穩定就是贏 ⭐','今天這筆很扎實,給自己一個讚 👍','你在證明:計畫是可以被做到的 🎉','保持這個步調,不用加速也會到 🐢','好樣的!別忘了喝水、睡飽 💧','一天一點點,累積出大改變 🌱','又往目標靠近一格,感覺不錯吧? 😄','這就是長期主義:不急,但不停 🧭','達成!今晚可以安心睡個好覺 😴','堅持記錄本身就是勝利,今天又加一分 📝','這個數字是你認真生活的證據 ✨','穩定下降中,你的努力有看得見的回報 💚','很棒,下一個目標:明天也來一筆達標 🎯','紀律不是痛苦,是對未來的自己好一點 🌤️','你已經走過這麼多天,別小看自己 🏅','又是一個綠點!圖表越來越好看了 🟢','今天的努力,明天的你會感謝 🙌','不需要拼命,只需要持續,而你正在做到 🚀','目標一天比一天近,繼續穩穩走 🌈'];
  const ML = ['領先超過兩週的進度!照這個節奏,終點比預期更近 🚀','你已經跑在計畫前面了,繼續穩穩走就好 🏃','提早達標看起來很有機會,但不必加速,維持節奏最重要 🐢','領先不是運氣,是這幾天每一次紀錄累積出來的 🌟','進度條大幅領先!記得多喝水、睡飽,別讓身體太累 💧','你已經為自己存下一段緩衝,偶爾一天持平也不用緊張 😌','比計畫快這麼多,先給自己一個大大的讚 👏','領先很多的時候最容易想再衝一把,穩定比速度更重要 ⚖️','照這個速度,目標日可能會提早到來,保持就好 📅','兩週以上的領先,證明你的方法有效,繼續保持 ✅'];
  const MB = ['這數字可不會自己變好,今晚少一口、多走一步 😤','落後目標了,明天的你會感謝現在的決定','別讓目標線跑太遠,現在就開始追 🏃','差一點而已,別找藉口,補回來!','你設定的目標不是玩玩的吧?證明給自己看 🔥','數字說實話:該收斂一下了','今天輸了一局,但比賽還沒結束,明天扳回來 ⚔️','目標線不會等你,追上去 🏃','偷懶的代價會出現在數字上,別讓它變成習慣 ⚠️','這一筆有點高,想想今天哪裡可以調整 🤔','別找藉口,找方法:晚餐清淡一點、飯後散散步 🚶','你當初為什麼開始?想想那個理由 💭','一天落後沒關係,別讓它變成兩天 ⏰','現在還來得及,從下一餐開始調整 🍽️','數字不會評價你,明天再贏回來 💪','目標線在等你,別讓差距越拉越大 📏','給自己一點壓力:明天這個時間,要看到更低的數字 🎯','今天鬆懈了?沒關係,但明天別再鬆 😤','別讓昨天的自己,看輕今天的你 🔥','水腫、鹽分也會影響,但別把它當萬用藉口 🧂','差距還不大,現在補救最划算 🛠️','動起來吧!哪怕只是多走十分鐘 👟','你說過要做到的,現在是兌現的時候 📣','紅點出現了,讓它成為最後一個 🔴','睡好、喝水、少宵夜,三件小事就能拉回來 🌙','別氣餒也別放縱,回到計畫上就好 🧭','再不追,目標日就要追不上了 📅','沒達標不代表失敗,代表該行動了 ⚡','誠實面對數字,是改變的第一步,再來一次 💥','下一筆,把它變成綠點 🟢'];
  const pick = (t, a) => {
    S.bag = S.bag || {};
    let b = S.bag[t];
    if (!b || !b.length) b = S.bag[t] = a.map((_, i) => i).sort(() => Math.random() - .5);
    return a[b.pop() % a.length];
  };

  const badgesDef = () => [["first", "🌱 首次紀錄"], ["s3", "🔥 連續3天"], ["s7", "🏅 連續7天"], ["s14", "🥈 連續14天"], ["s30", "🏆 連續30天"], ["goal", "🎯 達成目標"]];
  function award() {
    const n = streak(true), c = S.cfg || {}, l = sorted(), got = [];
    S.bg = S.bg || {};
    const chk = (id, v) => { if (v && !S.bg[id]) { S.bg[id] = today(); got.push(id); } };
    chk("first", l.length > 0); chk("s3", n >= 3); chk("s7", n >= 7); chk("s14", n >= 14); chk("s30", n >= 30);
    chk("goal", l.length && c.mode === "lose" && l[l.length - 1].w <= c.wt);
    return got;
  }

  // ---------------------------------------------------------------------
  // 新增 / 編輯 / 刪除紀錄
  // ---------------------------------------------------------------------
  function resetForm() {
    editId = null;
    $("#w-fw").value = ""; $("#w-fn").value = "";
    $("#w-ft").value = nowL(); $("#w-fg").value = defTag();
    $("#w-fc2").classList.add("hidden");
    $("#w-fh-text").textContent = "新增紀錄";
  }

  function saveRecord() {
    const w = Math.round(parseFloat($("#w-fw").value) * 100) / 100, t = $("#w-ft").value;
    if (!(w > 20 && w < 400) || !t) return toast("請輸入正確的時間與體重", "#b45309");
    if (Date.parse(t) > Date.now() + 36e5) return toast("不能記錄未來的時間", "#b45309");
    const e = { id: editId || nid(), d: t.slice(0, 10), t: t.slice(11), w, g: $("#w-fg").value, n: $("#w-fn").value };
    const prev = sorted().filter(x => x.id !== e.id && (x.d + x.t) < (e.d + e.t)).pop();
    if (editId && S.rec.some(x => x.id === editId)) S.rec = S.rec.map(x => x.id === editId ? e : x); else S.rec.push(e);
    editId = null;
    sv();
    const g = award();
    sv();

    const c = S.cfg;
    let msg, col;
    if (!c) {
      msg = `已記錄 ${fw(w)} kg。設定目標後，這裡會顯示趨勢判定與教練回饋。`; col = "#2563eb";
    } else {
      const sta = statusAt(e.d), gr = grade(e), pl = planAt(e.d), dpl = (pl.w0 - pl.wt) / (pl.weeks * 7);
      if (!sta) { msg = `已記錄 ${fw(w)} kg。再多記幾天，就能看到 7 日趨勢與判定。`; col = "#2563eb"; }
      else if (sta.maintain) {
        if (sta.st === "on") { msg = `維持得很好：趨勢 ${fw(sta.trend)} kg 在區間內 ✅`; col = "#16a34a"; }
        else { msg = `趨勢 ${fw(sta.trend)} kg 已離開維持區間（${fw(sta.target - sta.band)}~${fw(sta.target + sta.band)}），先把體重帶回區間再放鬆。`; col = sta.st === "far" ? "#dc2626" : "#d97706"; }
      } else if (sta.st === "ahead") {
        const lead = dpl > 0 ? -sta.gap / dpl : 0;
        msg = lead >= 14 ? pick("lead", ML) : pick("ok", MO); col = "#16a34a";
        if (gr !== "g") msg += "(今天這筆偏高屬自然波動，看趨勢就好)";
      } else if (sta.st === "on") {
        msg = `趨勢貼著目標線（差 ${fw(Math.max(0, sta.gap))} kg）。單日偏高不必緊張，但這是邊緣，別放鬆。`; col = "#65a30d";
      } else if (sta.st === "behind") {
        msg = `趨勢落後 ${fw(sta.gap)} kg（約 ${Math.round(sta.days)} 天進度）。接下來 7 天把每日熱量守在目標內，進度追得回來。`; col = "#d97706";
      } else {
        msg = `⚠️ 趨勢落後 ${fw(sta.gap)} kg（約 ${Math.round(sta.days)} 天進度），已明顯偏離計畫。看上方「可行性」，必要時重新規劃。`; col = "#dc2626";
      }
    }
    if (prev && prev.w - e.w > 1.5 && (Date.parse(e.d + "T" + e.t) - Date.parse(prev.d + "T" + prev.t)) < 864e5 * 1.5) {
      msg = "⚠️ 短時間掉太快(多為水分),請放慢並注意補充營養與水分。"; col = "#b45309";
    }
    if (g.length) msg += "  新徽章:" + badgesDef().filter(b => g.includes(b[0])).map(b => b[1]).join(" ");
    S.coach = { m: msg, c: col };
    sv();
    if (typeof updateStorageNote === "function") updateStorageNote(true);
    toast(msg, col, 6000);
    // 還沒設目標時，把剛記的體重帶入「起始體重」欄位 (不覆蓋使用者已輸入的內容)
    if (!S.cfg && !$("#w-w0").value) $("#w-w0").value = String(r2(e.w));
    resetForm();
    render();
    refreshOthers();
  }

  function onListClick(ev) {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.x) {
      if (!confirm("刪除此紀錄?")) return;
      S.rec = S.rec.filter(e => String(e.id) !== b.dataset.x);
      if (String(editId) === b.dataset.x) resetForm();
      sv(); render(); refreshOthers();
    } else if (b.dataset.e) {
      const e = S.rec.find(x => String(x.id) === b.dataset.e);
      if (!e) return;
      editId = e.id;
      $("#w-ft").value = e.d + "T" + e.t; $("#w-fw").value = e.w; $("#w-fn").value = e.n; $("#w-fg").value = e.g || "一般";
      $("#w-fc2").classList.remove("hidden");
      $("#w-fh-text").textContent = "編輯紀錄";
      $("#w-ft").scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  // 體重變動會影響飲食頁 (當日體重)、趨勢、設定的 BMI / TDEE
  function refreshOthers() {
    if (typeof renderDayWeight === "function") renderDayWeight();
    if (typeof renderBodyCard === "function") renderBodyCard();
    if (typeof renderBackupReminder === "function") renderBackupReminder();
  }

  // ---------------------------------------------------------------------
  // 畫面
  // ---------------------------------------------------------------------
  function render() {
    if (!S) return;
    dsCache = null;
    renderKpi(); renderCoach(); renderStreak(); renderList(); drawChart(); renderCsvNote();
  }

  const BMI_COLOR = { "過輕": "#0284c7", "正常範圍": "#16a34a", "過重": "#d97706", "輕度肥胖": "#ea580c", "中度肥胖": "#dc2626", "重度肥胖": "#b91c1c" };
  function bmiChip(w) {
    const h = state.profile.height;
    if (!(w > 0) || !hOk()) return "";
    const b = bmiInfo(w, h);
    return `<div><span class="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[11px] text-white" style="background:${BMI_COLOR[b.label] || "#6b7280"}">${b.label.replace("範圍", "")}</span></div>`;
  }
  const cell = (label, val, extra) => `<div class="text-center"><b class="block text-xl font-bold text-slate-800">${val}</b><span class="text-[11px] text-slate-500">${label}</span>${extra || ""}</div>`;

  let suggestWeeks = 0;

  function stChip(sta) {
    if (!sta) return "";
    const txt = sta.maintain ? (sta.st === "on" ? "區間內" : "離開區間") : (sta.st === "ahead" ? (-sta.gap < 0.05 ? "貼近目標線" : "領先 " + fw(-sta.gap)) : ST_LABEL[sta.st] + " " + fw(sta.gap));
    return `<div><span class="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[11px] text-white" style="background:${ST_COLOR[sta.st]}">${txt}</span></div>`;
  }

  function renderKpi() {
    const c = S.cfg, l = sorted(), last = l[l.length - 1], kp = $("#w-kp"), h = state.profile.height;
    $("#w-tc").textContent = "今日 " + l.filter(e => e.d === today()).length + "/2";
    let fc = "", act = "";
    const bmiCell = (w) => cell("BMI", hOk() && w ? f1(w / ((h / 100) ** 2)) : "–", hOk() ? bmiChip(w) : '<div class="text-[11px] text-slate-400">先到設定填身高</div>');

    if (!c) {
      const tr = trendAt(today()) ?? (last ? last.w : null);
      kp.innerHTML = cell("目前", last ? fw(last.w) + " kg" : "–") + cell("7日趨勢", tr != null ? fw(tr) + " kg" : "–") + bmiCell(last ? last.w : 0);
      $("#w-pb").style.width = "0%";
      fc = '<span class="text-slate-500">尚未設定目標。展開上方「體重目標與計畫」設定後，會顯示每日目標、趨勢判定與進度。</span>';
      if (!autoOpened) { $("#w-sd").open = true; autoOpened = true; }
    } else {
      const sta = statusAt(today()), cur = last ? last.w : c.w0, trend = sta ? sta.trend : cur, t = tg(today());
      const pr = c.w0 === c.wt ? 100 : Math.max(0, Math.min(100, (c.w0 - trend) / (c.w0 - c.wt) * 100));
      kp.innerHTML = [
        ["目前", fw(cur) + " kg"],
        ["7日趨勢", fw(trend) + " kg", stChip(sta)],
        ["今日目標", c.mode === "maintain" ? fw(c.wt - c.band) + "~" + fw(c.wt + c.band) : fw(t) + " kg"],
        ["進度", f1(pr) + "%"],
        ["每日減量", c.mode === "maintain" ? "維持" : f1(weeklyPlanPace() / 7 * 1000) + " g"]
      ].map(a => cell(a[0], a[1], a[2])).join("") + bmiCell(cur);
      $("#w-pb").style.width = pr + "%";

      const parts = [], ok14 = (x) => x;
      if (c.mode === "lose") {
        const remain = trend - c.wt, planWk = weeklyPlanPace(), left = dn(endD()) - dn(today());
        if (remain <= 0) {
          act = '<button id="w-mt" class="w-btn mt-2 text-xs">🎉 趨勢已達標，切換維持模式</button>';
        } else if (last && last.w <= c.wt) {
          parts.push('<div class="text-emerald-600">🎯 今天已到目標體重，再撐幾天，讓 7 日趨勢確認。</div>');
        } else {
          // ① 狀態：我在哪
          if (sta) {
            const lab = sta.st === "ahead" ? `<b style="color:${ST_COLOR.ahead}">領先 ${fw(-sta.gap)} kg</b>（約 ${Math.round(-sta.days)} 天進度）`
              : sta.st === "on" ? `<b style="color:${ST_COLOR.on}">貼近目標線</b>（差 ${fw(Math.max(0, sta.gap))} kg，在自然波動內）`
              : `<b style="color:${ST_COLOR[sta.st]}">${ST_LABEL[sta.st]} ${fw(sta.gap)} kg</b>（約 ${Math.round(sta.days)} 天進度）`;
            parts.push(`<div>① 狀態：${lab} · 趨勢 ${fw(sta.trend)} vs 目標線 ${fw(sta.target)}</div>`);
          } else parts.push('<div class="text-slate-500">① 狀態：最近 7 天沒有紀錄，先記一筆吧。</div>');

          // ② 可行性：原定日期還來不來得及 (只看剩餘公斤與剩餘時間，不受近期雜訊影響)
          let needReplan = false;
          if (left <= 0) {
            suggestWeeks = Math.max(1, Math.ceil(remain / c.cap));
            parts.push(`<div class="text-red-600 font-medium">② 可行性：已超過原定日期 ${-left} 天，距目標還有 ${fw(remain)} kg；以安全速度（${c.cap} kg/週）約需 ${suggestWeeks} 週。</div>`);
            needReplan = true;
          } else {
            const needWk = remain / (left / 7);
            if (needWk <= planWk * 1.15 + 0.03) {
              const lead = sta && sta.st === "ahead" && planWk > 0 ? Math.floor(-sta.days) : 0;
              parts.push(lead >= 14
                ? `<div class="text-emerald-600">② 可行性：✅ 維持計畫速度（每週 ${f2(planWk)} kg）可提早約 ${lead} 天，預計 ${add(today(), Math.ceil(remain / (planWk / 7)))} 達標。不必加速，守住節奏。</div>`
                : `<div class="text-emerald-600">② 可行性：✅ 維持計畫速度（每週 ${f2(planWk)} kg），預計 ${endD()} 達標。</div>`);
            } else if (needWk <= c.cap + 1e-9) {
              parts.push(`<div class="text-amber-700 font-medium">② 可行性：要準時達標，接下來每週需減 ${f2(needWk)} kg（計畫是 ${f2(planWk)}），仍在安全上限 ${c.cap} 內——要比現在更嚴格。</div>`);
            } else {
              suggestWeeks = Math.max(1, Math.ceil(remain / c.cap));
              const earliest = add(today(), Math.ceil(remain / (c.cap / 7))), late = Math.round((dn(earliest) - dn(endD())) / 7 * 10) / 10;
              parts.push(`<div class="text-red-600 font-medium">② 可行性：原定 ${endD()} 已不可行——準時要每週減 ${f2(needWk)} kg，超過安全上限 ${c.cap}。以安全速度最快 ${earliest}（晚約 ${f1(late)} 週）。</div>`);
              needReplan = true;
            }
          }
          if (sta && sta.st === "far" && !needReplan) { suggestWeeks = Math.max(1, Math.ceil(remain / c.cap)); needReplan = true; }
          if (needReplan) act = '<button id="w-rp" class="w-btn-s mt-2 text-xs">依目前趨勢重新規劃</button>';

          // ③ 實測預估：近 4 週速度 + 整體速度，給區間；太不穩就不給日期
          const pc = pace();
          if (!pc) parts.push('<div class="text-slate-500">③ 實測預估：資料累積中（需要約 2 週、至少 8 個有紀錄的日子）。</div>');
          else {
            const cand = [pc.recentWk, pc.overallWk].filter(x => x != null), est = cand.reduce((a, b) => a + b, 0) / cand.length;
            if (est <= 0.05) parts.push(`<div class="text-slate-600">③ 實測預估：近 4 週體重幾乎持平（每週 ${f2(est)} kg），暫不預估日期。</div>`);
            else {
              const dAt = (wk) => wk > 0.05 ? Math.ceil(remain / (wk / 7)) : Infinity;
              const mid = dAt(est), fast = dAt(est + pc.seWk), slow = dAt(est - pc.seWk);
              const lateDays = mid === Infinity ? Infinity : dn(add(today(), mid)) - dn(endD());
              if (mid > 365 || lateDays > 56) parts.push(`<div class="text-slate-600">③ 實測預估：照目前的實測速度（每週 ${f2(est)} kg），會比原定日期晚 8 週以上；這種長期預估不穩定，所以不給日期。先看 ② 的可行性，必要時重新規劃。</div>`);
              else parts.push(`<div class="text-slate-600">③ 實測預估：速度每週 ${f2(est)} kg → 預估 <b>${add(today(), mid)}</b> 達標` + (slow === Infinity || slow > 365 ? `（樂觀 ${add(today(), fast)}；悲觀則無法估計）` : `（區間 ${add(today(), fast)} ~ ${add(today(), slow)}）`) + "</div>");
            }
          }

          // 飲食診斷：落後時，對照近 14 天攝取
          const ds = typeof dietSignal === "function" ? dietSignal(14) : null;
          if (ds && sta && (sta.st === "behind" || sta.st === "far")) {
            parts.push(ds.avg > ds.target + 100
              ? `<div class="text-[11px] text-slate-600">🍽 近 ${ds.days} 天平均攝取 ${ds.avg} kcal，高於目標 ${ds.target}：先從飲食補回來。</div>`
              : `<div class="text-[11px] text-slate-600">🍽 近 ${ds.days} 天平均攝取 ${ds.avg} kcal，有守在目標 ${ds.target} 內，但體重沒跟上：可能是水分波動、漏記或 TDEE 高估，先撐 2 週再評估。</div>`);
          }
        }
      } else {
        const sm = sta ? (sta.st === "on" ? `<span class="text-emerald-600">趨勢 ${fw(sta.trend)} kg 在區間內 ✅</span>` : `<span class="text-amber-700 font-medium">趨勢 ${fw(sta.trend)} kg 已離開區間，請留意</span>`) : "";
        parts.push(`<div>維持區間 ${fw(c.wt - c.band)}~${fw(c.wt + c.band)} kg · ${sm}</div>`);
      }
      fc = parts.join('<div class="h-1.5"></div>');
    }
    $("#w-fc").innerHTML = fc;
    $("#w-act").innerHTML = act;
    if ($("#w-mt")) $("#w-mt").onclick = () => { const hh = pushHist(S.cfg); S.cfg.mode = "maintain"; S.cfg.hist = hh; sv(); fillGoalForm(); render(); };
    if ($("#w-rp")) $("#w-rp").onclick = () => replan(suggestWeeks);
  }

  function renderCoach() {
    const c = S.cfg, e = $("#w-co");
    const t = c ? (c.mode === "maintain" ? "維持區間 " + fw(c.wt - c.band) + "~" + fw(c.wt + c.band) + " kg" : "今日理想目標 " + fw(tg(today())) + " kg") : "尚未設定目標";
    const k = S.coach || { m: "歡迎!設定好目標後，每天早晚各記錄一次，這裡會顯示最近一次的回饋與建議。", c: "#2563eb" };
    e.style.borderLeft = "5px solid " + k.c;
    e.innerHTML = '<div class="text-xs text-slate-500">🧭 教練回饋 · ' + t + '</div><div class="mt-1 text-sm leading-relaxed">' + esc(k.m) + "</div>";
  }

  function renderStreak() {
    const s = streak(), yd = dayStat()[today()] ? 0 : streak(true);
    $("#w-st").innerHTML = '目前連續達成 <b class="text-emerald-600 text-base">' + s + "</b> 天" + (yd ? '<div class="text-[11px] text-slate-500 mt-1">今天還沒記錄，記錄並達成後會接續昨天為止的 ' + yd + " 天</div>" : "");
    $("#w-bd").innerHTML = badgesDef().map(b => `<span class="inline-block px-2.5 py-0.5 m-0.5 rounded-full border text-xs ${S.bg[b[0]] ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-200 text-slate-400"}">${b[1]}</span>`).join("");
  }

  function renderList() {
    const c = S.cfg, fl = $("#w-tf").value, box = $("#w-list");
    const all = [...sorted()].reverse().filter(e => !fl || e.g === fl);
    const rows = all.slice(0, 60);
    if (!rows.length) { box.innerHTML = '<div class="text-center text-xs text-slate-400 py-6">還沒有紀錄</div>'; return; }
    box.innerHTML = rows.map(e => {
      const t = c ? tg(e.d) : NaN, df = e.w - t, gr = grade(e);
      const col = gr === null ? "text-slate-400" : (gr === "g" ? "text-emerald-600" : (gr === "a" ? "text-yellow-600" : "text-red-600"));
      return `
        <div class="py-2.5 border-b border-slate-100 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 items-baseline">
          <div class="font-semibold text-slate-800 text-sm">${e.d.slice(5)} ${e.t}</div>
          <div class="text-right text-lg font-bold text-slate-800">${fw(e.w)}</div>
          <div class="text-xs text-slate-500">${esc(e.g || "")}${c ? " · 今日目標 " + fw(t) : ""}</div>
          <div class="text-right text-sm font-semibold ${col}">${isNaN(df) ? "–" : (df > 0 ? "+" : "") + fw(df)}</div>
          ${e.n ? `<div class="col-span-2 text-xs text-slate-600">${esc(e.n)}</div>` : ""}
          <div class="col-span-2 flex gap-5 text-xs">
            <button data-e="${e.id}" class="text-emerald-700 font-medium py-1.5">編輯</button>
            <button data-x="${e.id}" class="text-red-600 font-medium py-1.5">刪除</button>
          </div>
        </div>`;
    }).join("") + (all.length > 60 ? `<div class="text-center text-[11px] text-slate-400 pt-2">僅顯示最近 60 筆（共 ${all.length} 筆）</div>` : "");
  }

  // ---------------------------------------------------------------------
  // SVG 折線圖 (目標線、7 日平均、達成/未達成點、未記錄日)
  // ---------------------------------------------------------------------
  function drawChart() {
    const svg = $("#w-ch"), c = S.cfg, l = sorted();
    const R = S.rng || (c && c.weeks * 7 > 90 ? "30" : "all");
    document.querySelectorAll("#w-rg button").forEach(b => {
      b.className = "px-3 py-1 rounded-lg text-xs font-medium " + (b.dataset.r === R ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600");
    });
    $("#w-ci").textContent = "";
    if (!c && !l.length) { svg.innerHTML = ""; return; }

    const d0s = c ? c.d0 : l[0].d;
    const W = Math.max(300, Math.round(svg.parentNode.clientWidth) || 640), H = W < 500 ? 250 : 300, L = 44, Rm = 8, T = 10, B = 24;
    const px = dn(d0s), endP = c ? px + Math.round(c.weeks * 7) : px, lastD = l.length ? dn(l[l.length - 1].d) + 1 : 0, mt = !!c && c.mode === "maintain";
    let x0, x1;
    if (R === "all") { x0 = px; x1 = Math.max(endP, lastD, px + 7); } else { x1 = Math.max(dn(today()) + 1, lastD); x0 = x1 - (+R); }
    const xs = (e) => dn(e.d) + (+e.t.slice(0, 2) * 60 + +e.t.slice(3)) / 1440;
    const tv = (v) => Math.max(c.wt, c.w0 - dd() * (v - px));
    const a0 = Math.max(x0, px);
    const lp = c ? [a0].concat(endP > a0 && endP < x1 ? [endP] : [], [x1]) : [];
    const vis = l.filter(e => { const v = xs(e); return v >= x0 && v <= x1; });

    const m = dayStat(), ks = Object.keys(m).sort(), kd = ks.map(dn), ma = [];
    let lo = 0;
    for (let i = 0; i < ks.length; i++) {
      while (kd[lo] <= kd[i] - 7) lo++;
      if (kd[i] >= x0 && kd[i] < x1) { let sm = 0; for (let j = lo; j <= i; j++) sm += m[ks[j]].mean; ma.push([kd[i] + .5, sm / (i - lo + 1)]); }
    }
    const ws = vis.map(e => e.w).concat(ma.map(p => p[1]), mt ? [c.wt - c.band, c.wt + c.band] : lp.map(tv));
    if (!ws.length) { svg.innerHTML = ""; $("#w-ci").textContent = "此區間沒有紀錄"; return; }
    const mn = Math.min(...ws) - .5, mx = Math.max(...ws) + .5;
    const X = (v) => L + (v - x0) / (x1 - x0) * (W - L - Rm), Y = (v) => T + (mx - v) / (mx - mn) * (H - T - B);
    let o = "";
    for (let i = 0; i <= 4; i++) {
      const v = mn + (mx - mn) * i / 4;
      o += `<line x1="${L}" x2="${W - Rm}" y1="${Y(v)}" y2="${Y(v)}" class="c-grid"/><text x="${L - 4}" y="${Y(v) + 4}" font-size="11" text-anchor="end" class="c-mu">${fw(v)}</text>`;
    }
    const step = Math.ceil((x1 - x0) / (W < 500 ? 5 : 8));
    for (let d = x0; d <= x1; d += step) {
      const nearEdge = X(d) > W - 24;   // 靠右邊界的標籤改成靠右對齊，避免被截掉
      o += `<text x="${nearEdge ? W - Rm : X(d)}" y="${H - 8}" font-size="11" text-anchor="${nearEdge ? "end" : "middle"}" class="c-mu">${add(d0s, d - px).slice(5)}</text>`;
    }
    for (let d = a0; d <= Math.min(dn(today()), x1 - 1); d++) {
      if (!m[add(d0s, d - px)]) o += `<line x1="${X(d + .5)}" x2="${X(d + .5)}" y1="${H - B - 6}" y2="${H - B}" stroke="#9ca3af" stroke-width="3"/>`;
    }
    if (mt) o += `<rect x="${L}" y="${Y(c.wt + c.band)}" width="${W - L - Rm}" height="${Math.abs(Y(c.wt - c.band) - Y(c.wt + c.band))}" fill="#16a34a" opacity=".12"/>`;
    else if (c) o += `<polyline points="${lp.map(v => X(v) + "," + Y(tv(v))).join(" ")}" fill="none" stroke="#2563eb" stroke-dasharray="5 4" stroke-width="2"/>`;
    if (ma.length > 1) o += `<polyline points="${ma.map(p => X(p[0]) + "," + Y(p[1])).join(" ")}" fill="none" stroke="#f59e0b" stroke-width="3"/>`;
    vis.forEach(e => {
      const gr = grade(e), col = gr === null ? "#9ca3af" : GRADE_COLOR[gr];
      o += `<circle cx="${X(xs(e))}" cy="${Y(e.w)}" r="${R === "all" && x1 - x0 > 120 ? 3 : (W < 500 ? 5.5 : 4.5)}" fill="${col}" class="c-dot" stroke-width="1.5"><title>${esc(e.d + " " + e.t + " " + (e.g || ""))} ${fw(e.w)}kg</title></circle>`;
    });
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.innerHTML = o;
  }

  // ---------------------------------------------------------------------
  // 目標設定表單
  // ---------------------------------------------------------------------
  function fillGoalForm() {
    const c = S.cfg || {}, l = sorted(), last = l[l.length - 1];
    $("#w-md").value = c.mode || "lose";
    $("#w-w0").value = c.w0 || (last ? last.w : "");
    $("#w-wt").value = c.wt || "";
    $("#w-wk").value = c.weeks ? Math.round(c.weeks * 10) / 10 : "";
    $("#w-pm").value = c.pm || (c.weeks ? "weeks" : "rate");
    $("#w-cap").value = c.cap || 0.7;
    $("#w-d0").value = c.d0 || today();
    $("#w-bn").value = c.band || 1;
    $("#w-rm").checked = !!S.rem.on; $("#w-r1").value = S.rem.m; $("#w-r2").value = S.rem.n;
    previewPlan();
  }

  function readGoalForm() {
    const c = { w0: +$("#w-w0").value, wt: +$("#w-wt").value, cap: +$("#w-cap").value || .7, d0: $("#w-d0").value || today(), band: +$("#w-bn").value || 1, mode: $("#w-md").value, pm: $("#w-pm").value };
    const loss = c.w0 - c.wt;
    c.weeks = c.pm === "rate" ? (loss > 0 ? loss / c.cap : 0) : +$("#w-wk").value;
    return c;
  }

  function warns(c, rate) {
    const w = [], h = state.profile.height, bmi = hOk() ? c.wt / ((h / 100) ** 2) : 99;
    if (rate > c.cap + 1e-9) w.push("每週需減 " + fw(rate) + " kg，超過安全上限 " + c.cap + " kg/週");
    if (rate > c.w0 * .01) w.push("超過每週體重 1%");
    if (bmi < 18.5) w.push("目標體重 BMI " + f1(bmi) + " 低於 18.5");
    return w;
  }

  function previewPlan() {
    const mt = $("#w-md").value === "maintain", r = $("#w-pm").value === "rate";
    $("#w-gp").style.display = mt ? "none" : "";
    $("#w-gc").style.display = mt || !r ? "none" : "";
    $("#w-gw").style.display = mt || r ? "none" : "";
    $("#w-gb").style.display = mt ? "" : "none";
    $("#w-lw").textContent = mt ? "要維持的體重 kg" : "目標體重 kg";
    const b = +$("#w-bn").value || 1, t = +$("#w-wt").value;
    $("#w-mh").innerHTML = mt
      ? "維持模式:達標後用來守住體重。以「目標體重」為中心，落在 ± 區間內的紀錄都算達成" + (t > 20 ? "(目前設定:<b>" + fw(t - b) + " ~ " + fw(t + b) + " kg</b>)" : "(例如目標 65、區間 ±1 → 64~66 kg 算達成)") + "；高於上限會提醒，低於下限也不算達成，避免瘦過頭。圖上以綠色帶狀區間顯示。此模式不需要設定期間或每週速率。"
      : "減重模式:依起始體重、目標體重與期間，算出一條逐日下降的目標線，每次紀錄 ≤ 當天目標就算達成。達標後，這頁會出現按鈕讓你切換到維持模式。";
    const c = readGoalForm(), el = $("#w-cs");
    if (c.mode !== "lose" || !(c.w0 > 20 && c.wt > 20 && c.wt < c.w0 && c.weeks > 0)) { el.innerHTML = ""; return; }
    const rate = (c.w0 - c.wt) / c.weeks, w = warns(c, rate);
    el.innerHTML = "試算:共 <b>" + f1(c.weeks) + "</b> 週(" + Math.round(c.weeks * 7) + " 天)，每週 <b>" + fw(rate) + " kg</b>，每日約 <b>" + f1(rate / 7 * 1000) + " g</b>，預計 <b>" + add(c.d0, Math.round(c.weeks * 7)) + "</b> 達標" + (w.length ? '<div class="text-amber-700 mt-1">⚠️ ' + w.join(";") + "</div>" : "");
  }

  function saveGoal() {
    const c = readGoalForm();
    if (c.mode === "maintain" && !(c.weeks > 0)) c.weeks = 1;
    if (!(c.w0 > 20 && c.wt > 20 && c.weeks > 0)) return toast("請填寫完整資料", "#b45309");
    if (c.mode === "lose" && c.wt >= c.w0) return toast("目標體重需低於起始體重(或改用維持模式)", "#b45309");
    const w = c.mode === "lose" ? warns(c, (c.w0 - c.wt) / c.weeks) : [];
    if (w.length && !confirm("安全提醒:\n" + w.join("\n") + "\n\n仍要儲存嗎?")) return;
    c.hist = S.cfg ? (S.cfg.mode !== c.mode ? pushHist(S.cfg) : (S.cfg.hist || [])) : [];
    S.cfg = c;
    sv();
    toast("設定已儲存", "#16a34a");
    $("#w-sd").open = false;
    render();
    refreshOthers();
  }

  function replan(sug) {
    const c = S.cfg, l = sorted();
    if (!l.length) return;
    const sta = statusAt(today()), start = sta ? sta.trend : l[l.length - 1].w;
    const minW = Math.max(1, Math.ceil((start - c.wt) / c.cap));
    const v = prompt("重新規劃：從趨勢體重 " + fw(start) + " kg 起算，預計幾週達標?\n(依安全上限建議至少 " + minW + " 週)", sug || minW);
    if (!v || !(+v > 0)) return;
    S.cfg = { ...c, hist: pushHist(c), w0: r2(start), d0: today(), weeks: +v, pm: "weeks" };
    sv(); fillGoalForm(); render(); refreshOthers();
    toast("已重新規劃目標", "#16a34a");
  }

  // ---------------------------------------------------------------------
  // CSV 備份 / 匯入 / 合併 / 還原 / 清除
  // ---------------------------------------------------------------------
  const q = (x) => '"' + String(x == null ? "" : x).replace(/"/g, '""') + '"';
  const csvText = () => "\ufeffdate,time,tag,weight,note\n" +
    ["#config,,,," + q(JSON.stringify(Object.assign({}, S.cfg || {}, { h: state.profile.height })))]
      .concat(sorted().map(e => [e.d, e.t, q(e.g), e.w, q(e.n)].join(","))).join("\n");

  function download(name, text, mime) {
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: mime }));
      a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 999);
    } catch (e) {}
  }
  function markExported() { S.lastExp = Date.now(); sv(); renderCsvNote(); }
  function backupCsv() { markExported(); download("weight-backup-" + today() + ".csv", csvText(), "text/csv"); }

  async function shareCsv() {
    const f = new File([csvText()], "weight-backup-" + today() + ".csv", { type: "text/csv" });
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: "體重備份" }); markExported(); toast("備份已送出", "#16a34a"); }
      catch (e) { if (e.name !== "AbortError") { toast("分享失敗，改為下載", "#b45309"); backupCsv(); } }
    } else { toast("此瀏覽器不支援檔案分享(需 HTTPS)，改為下載", "#b45309"); backupCsv(); }
  }

  const snap = () => { try { localStorage.setItem(PREV_KEY, JSON.stringify({ rec: S.rec, cfg: S.cfg, bg: S.bg, coach: S.coach, rem: S.rem, rng: S.rng, t: Date.now() })); } catch (e) {} };
  const readSnap = () => { try { return JSON.parse(localStorage.getItem(PREV_KEY) || "null"); } catch (e) { return null; } };

  function renderCsvNote() {
    const l = sorted(), b = $("#w-un"), p = readSnap();
    b.classList.toggle("hidden", !p);
    if (p) b.textContent = "還原上次匯入/清除前的體重資料(" + new Date(p.t).toLocaleString() + "，共 " + p.rec.length + " 筆)";
    $("#w-cn").textContent = l.length ? "目前共 " + l.length + " 筆體重紀錄(" + l[0].d + " ~ " + l[l.length - 1].d + ")" : "目前沒有體重紀錄";
    $("#w-le").textContent = S.lastExp ? "上次匯出體重 CSV:" + new Date(S.lastExp).toLocaleString() : "尚未匯出過體重 CSV";
    $("#w-legacy").classList.toggle("hidden", !legacySource());
  }

  function parseCsv(t) {
    const r = []; let a = [], f = "", u = false;
    t = t.replace(/^\ufeff/, "");
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (u) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else u = false; } else f += c; }
      else if (c === '"') u = true;
      else if (c === ",") { a.push(f); f = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; a.push(f); f = ""; r.push(a); a = []; }
      else f += c;
    }
    if (f !== "" || a.length) { a.push(f); r.push(a); }
    return r;
  }

  async function onImportFile(ev) {
    const f = ev.target.files[0];
    if (!f) return;
    try {
      const r = parseCsv(await f.text()).filter(a => a.length > 1 || a[0]);
      const h = r.shift().map(x => x.trim().toLowerCase()), ix = (n) => h.indexOf(n);
      if (ix("date") < 0 || ix("weight") < 0) throw new Error("format");
      let cfg = null, hh = 0, bad = 0;
      const rs = [];
      r.forEach(a => {
        const d0 = (a[ix("date")] || "").trim();
        if (d0 === "#config") { try { const raw = JSON.parse(a[ix("note")]); cfg = cleanCfg(raw); hh = +raw.h || 0; } catch (e) {} return; }
        const d = nD(d0), w = +a[ix("weight")], g0 = ix("tag") < 0 ? "" : (a[ix("tag")] || "").trim();
        if (d && w > 20 && w < 400) rs.push({ id: nid(), d, t: nT(a[ix("time")]), g: TAGS.includes(g0) ? g0 : "", w, n: ix("note") < 0 ? "" : (a[ix("note")] || "") });
        else bad++;
      });
      const hc = cfg && cfg.w0;
      if (!rs.length && !hc) throw new Error("empty");

      if (impMode === "merge") {
        const key = (e) => e.d + " " + e.t, have = new Map(S.rec.map(e => [key(e), e])), nw = [];
        let dup = 0, diff = 0;
        rs.forEach(e => { const k = key(e), o = have.get(k); if (o) { dup++; if (o.w !== e.w) diff++; } else { have.set(k, e); nw.push(e); } });
        if (!nw.length && !(hc && !S.cfg)) { toast("沒有需要新增的紀錄(重複 " + dup + " 筆)", "#b45309"); ev.target.value = ""; return; }
        if (!confirm("合併匯入:新增 " + nw.length + " 筆;略過重複 " + dup + " 筆" + (diff ? "(其中 " + diff + " 筆體重不同，保留目前版本)" : "") + (bad ? ";無效 " + bad + " 列" : "") + "。\n現有紀錄不會被刪除。確定?")) { ev.target.value = ""; return; }
        snap();
        S.rec = S.rec.concat(nw);
        if (hc && !S.cfg) S.cfg = cfg;
        award(); sv(); fillGoalForm(); render(); refreshOthers();
        toast("已合併,新增 " + nw.length + " 筆", "#16a34a");
      } else {
        if (!confirm("匯入 " + rs.length + " 筆紀錄" + (hc ? "與目標設定" : "") + (bad ? "(略過 " + bad + " 列無效資料)" : "") + "。\n⚠️ 目前 " + S.rec.length + " 筆體重紀錄將被全部覆蓋(之後可用「還原」按鈕復原)。確定?")) { ev.target.value = ""; return; }
        snap();
        S.rec = rs;
        if (hc) S.cfg = cfg;
        if (hh >= 100 && hh <= 230) state.profile.height = hh;
        S.bg = {};
        award(); sv(); fillGoalForm(); render(); refreshOthers();
        toast("匯入完成", "#16a34a");
      }
    } catch (e) { toast("檔案格式錯誤", "#dc2626"); }
    ev.target.value = "";
  }

  function restoreSnap() {
    const p = readSnap();
    if (!p || !confirm("還原到 " + new Date(p.t).toLocaleString() + " 的體重資料(" + p.rec.length + " 筆)?目前資料會換成可再還原的快照。")) return;
    snap();
    S.rec = p.rec; S.cfg = p.cfg; S.bg = p.bg || {}; S.coach = p.coach; if (p.rem) S.rem = p.rem; S.rng = p.rng;
    sv(); fillGoalForm(); render(); refreshOthers();
    toast("已還原", "#16a34a");
  }

  function wipe(all) {
    const n = S.rec.length;
    if (all) {
      if ((prompt("這會刪除全部體重紀錄、目標設定與提醒設定(目前 " + n + " 筆紀錄)。\n清除前會自動下載 CSV 備份，之後也可按「還原」復原。\n(飲食紀錄與食材庫不受影響)\n確定請輸入「重置」:") || "").trim() !== "重置") return;
    } else {
      if (!n) return toast("目前沒有體重紀錄可清除", "#b45309");
      if (!confirm("要清除全部 " + n + " 筆體重紀錄嗎?\n(目標設定與提醒會保留，飲食紀錄不受影響)\n清除前會自動下載 CSV 備份。")) return;
    }
    if (n || S.cfg) backupCsv();
    snap();
    if (all) replaceAll({ lastExp: S.lastExp, intro: S.intro });
    else { S.rec = []; S.bg = {}; S.coach = null; }
    editId = null;
    sv(); fillGoalForm(); resetForm(); render(); refreshOthers();
    toast(all ? "已重置體重資料" : "已清除 " + n + " 筆紀錄(可按「還原」復原)", "#16a34a");
  }

  // ---------------------------------------------------------------------
  // 舊版獨立「體重紀錄」App (同一網站 localStorage 的 wt_v1) → 合併進來
  // ---------------------------------------------------------------------
  function legacySource() {
    try { const p = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null"); return p && typeof p === "object" && Array.isArray(p.rec) ? p : null; }
    catch (e) { return null; }
  }

  function mergeLegacy(p) {
    const n = normalize(p);
    const legacyDays = new Set(n.rec.map(e => e.d));
    // 舊版飲食記錄的「每日體重」若同一天已有實際量測紀錄，就以實際量測為準
    S.rec = S.rec.filter(e => !(e.n === MIGRATED_NOTE && legacyDays.has(e.d)));
    const have = new Set(S.rec.map(e => e.d + " " + e.t));
    const nw = n.rec.filter(e => !have.has(e.d + " " + e.t));
    S.rec = S.rec.concat(nw);
    if (!S.cfg && n.cfg) S.cfg = n.cfg;
    S.bg = S.bg || {};
    Object.keys(n.bg).forEach(k => { if (!S.bg[k]) S.bg[k] = n.bg[k]; });
    if (!S.coach && n.coach) S.coach = n.coach;
    if (n.lastExp && !S.lastExp) S.lastExp = n.lastExp;
    if (n.intro) S.intro = 1;
    if (!S.rem.on && n.rem && n.rem.on) S.rem = n.rem;
    if (n.rng && !S.rng) S.rng = n.rng;
    const lh = p.cfg && +p.cfg.h;
    if (lh >= 100 && lh <= 230 && state.profile.height === 168) state.profile.height = lh;
    award();
    return nw.length;
  }

  function legacyAuto() {
    if (localStorage.getItem(LEGACY_DONE)) return;
    try { localStorage.setItem(LEGACY_DONE, "1"); } catch (e) {}
    const p = legacySource();
    if (!p) return;
    const n = mergeLegacy(p);
    sv();
    if (n) setTimeout(() => toast("已把舊版「體重紀錄」的 " + n + " 筆資料合併進來(原資料仍保留在舊版)", "#16a34a", 7000), 400);
  }

  function legacyManual() {
    const p = legacySource();
    if (!p) return toast("找不到舊版體重紀錄資料", "#b45309");
    if (!confirm("要把舊版體重紀錄(同一網站的 wt_v1)合併進來嗎?\n只會補上缺少的紀錄，不會刪除或修改現有紀錄。")) return;
    snap();
    const n = mergeLegacy(p);
    sv(); fillGoalForm(); render(); refreshOthers();
    toast("已合併,新增 " + n + " 筆", "#16a34a");
  }

  // ---------------------------------------------------------------------
  // 提醒通知 (僅在頁面開啟時觸發)
  // ---------------------------------------------------------------------
  async function notify(t, b) {
    try { new Notification(t, { body: b, icon: "icons/icon-192.png" }); return; } catch (e) {}
    try { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.showNotification(t, { body: b, icon: "icons/icon-192.png", badge: "icons/icon-192.png" }); } catch (e) {}
  }

  async function onReminderChange(ev) {
    S.rem = { on: $("#w-rm").checked, m: $("#w-r1").value, n: $("#w-r2").value };
    if (S.rem.on && "Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    sv();
    if (ev.target.id === "w-rm" && S.rem.on && "Notification" in window && Notification.permission === "granted") notify("提醒已開啟", "到設定的時間會提醒你(需保持頁面開啟)");
  }

  let lastRemind = "";
  function startReminderTimer() {
    setInterval(() => {
      if (!S.rem.on || !("Notification" in window) || Notification.permission !== "granted") return;
      const d = new Date(), hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
      if ((hm === S.rem.m || hm === S.rem.n) && lastRemind !== today() + hm) {
        lastRemind = today() + hm;
        notify("該量體重了", hm === S.rem.m ? "晨起量一下,記錄今天的起點" : "睡前量一下,收個尾");
      }
    }, 20000);
  }

  // ---------------------------------------------------------------------
  // 對外介面 (給飲食頁、趨勢、設定使用)
  // ---------------------------------------------------------------------
  function latest() { const l = sorted(), e = l[l.length - 1]; return e ? { w: e.w, date: e.d } : null; }
  function dayMean(ds) { const a = dayStat()[ds]; return a ? r2(a.mean) : null; }
  function dayInfo(ds) {
    const a = days()[ds];
    if (!a) return null;
    const mean = a.reduce((s, e) => s + e.w, 0) / a.length;
    return { mean: r2(mean), n: a.length, last: a[a.length - 1], grade: grade(a[a.length - 1]), status: statusAt(ds) };
  }
  // 近 4 週實測速度 (kg/週，負數表示下降)；資料不足回傳 null
  function slopePerWeek() { const p = pace(); return p ? -p.recentWk : null; }
  // 體重計畫換算的每日熱量缺口 (僅減重模式)
  function planDeficit() {
    const c = S && S.cfg;
    if (!c || c.mode !== "lose" || !(c.weeks > 0) || !(c.w0 > c.wt)) return null;
    const perWeek = (c.w0 - c.wt) / c.weeks;
    return { perWeek, perDay: perWeek * 7700 / 7 };
  }

  // 合併體重紀錄 (完整 CSV 合併匯入用)：以「日期+時間」判斷重複，只補缺少的；dry=true 只試算不寫入
  function merge(p, dry) {
    const key = (e) => e.d + " " + e.t, have = new Map(S.rec.map(e => [key(e), e])), nw = [];
    let dup = 0, diff = 0;
    ((p && p.rec) || []).forEach(e => { const k = key(e), o = have.get(k); if (o) { dup++; if (o.w !== e.w) diff++; } else { have.set(k, e); nw.push(e); } });
    const cfgAdopt = !!(p && p.cfg && !S.cfg);
    if (!dry) {
      snap();
      S.rec = S.rec.concat(nw);
      if (cfgAdopt) S.cfg = p.cfg;
      award(); sv();
    }
    return { add: nw.length, dup, diff, cfgAdopt };
  }

  function openEntry(ds) {
    switchTab("tab-weight");
    resetForm();
    $("#w-ft").value = ds && ds < today() ? ds + "T07:30" : nowL();
    $("#w-fw").focus();
  }

  function show(id, on) { const e = document.getElementById(id); if (e) e.classList.toggle("hidden", !on); }

  function init() {
    S = state.weight;
    $("#w-fs").addEventListener("click", saveRecord);
    $("#w-fc2").addEventListener("click", resetForm);
    $("#w-list").addEventListener("click", onListClick);
    $("#w-tf").addEventListener("change", renderList);
    $("#w-sv").addEventListener("click", saveGoal);
    ["w-w0", "w-wt", "w-wk", "w-cap", "w-d0", "w-bn", "w-md", "w-pm"].forEach(i => { const e = document.getElementById(i); e.oninput = previewPlan; e.onchange = previewPlan; });
    document.querySelectorAll("#w-rg button").forEach(b => b.onclick = () => { S.rng = b.dataset.r; sv(); drawChart(); });
    $("#w-ch").addEventListener("click", (ev) => { const c = ev.target.closest("circle"); $("#w-ci").textContent = c ? c.textContent : ""; });
    $("#w-sh").addEventListener("click", shareCsv);
    $("#w-ec").addEventListener("click", backupCsv);
    $("#w-im").addEventListener("click", () => { impMode = "replace"; $("#w-if").click(); });
    $("#w-mg").addEventListener("click", () => { impMode = "merge"; $("#w-if").click(); });
    $("#w-if").addEventListener("change", onImportFile);
    $("#w-un").addEventListener("click", restoreSnap);
    $("#w-cl").addEventListener("click", () => wipe(false));
    $("#w-rs").addEventListener("click", () => wipe(true));
    $("#w-legacy").addEventListener("click", legacyManual);
    ["w-rm", "w-r1", "w-r2"].forEach(i => document.getElementById(i).addEventListener("change", onReminderChange));
    $("#w-ok1").addEventListener("click", () => { S.intro = 1; sv(); show("modal-intro", false); });
    let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (!$("#tab-weight").classList.contains("hidden")) drawChart(); }, 150); });

    legacyAuto();
    fillGoalForm();
    resetForm();
    render();
    startReminderTimer();
    if (!S.intro && !(state.setup && !state.setup.done)) show("modal-intro", true);
  }

  return { init, normalize, replaceAll, merge, render, makeRec, latest, dayMean, dayInfo, slopePerWeek, planDeficit, openEntry, fillGoalForm, MIGRATED_NOTE, TAGS };
})();
