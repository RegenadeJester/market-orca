# TASK.md - Market Orca

## 0. Operational rules
- [ ] Kerjakan dulu, baru lapor hasil nyata
- [ ] Kalau ada yang belum selesai, masukkan balik ke TASK.md/PLAN.md
- [ ] Setelah fitur Discord berubah, restart backend dan verifikasi log registrasi

## 1. Discord bot / alerts
### 1.1 Slash command registration
- [ ] Restart backend setelah perubahan Discord
- [ ] Verifikasi log: bot ready
- [ ] Verifikasi log: slash commands registered
- [ ] Verifikasi jumlah command sesuai fitur terbaru
- [ ] Verifikasi command muncul di guild target

### 1.2 DM alerts
- [x] Tambah table subscriber DM
- [x] Tambah slash command subscribe/unsubscribe/list
- [ ] Uji kirim DM alert end-to-end
- [ ] Tambah command admin untuk CRUD user DM tertentu bila dibutuhkan

### 1.3 Alert delivery settings
- [x] Alert channel configurable
- [x] Embed style configurable
- [x] Rich mode configurable
- [ ] Tambah preference granular (favorites only / market specific / critical only)
- [ ] Tambah chart snapshot/image strategy untuk alert

## 2. Market data / realtime
### 2.1 Provider stability
- [x] Cache + throttle provider layer
- [x] Fallback provider layer
- [x] Fix persen abnormal futures/index
- [ ] Provider crypto anti-rate-limit lebih kuat
- [ ] Provider IDX/Indo lebih kaya

### 2.2 Streaming
- [x] Asset SSE stream
- [x] Overview SSE stream
- [ ] Websocket/tick stream native (advanced)
- [ ] Final browser validation chart realtime

## 3. Frontend UX / HCI / WCAG
### 3.1 Usability
- [x] Feedback watchlist jelas
- [x] Toast flow dibenahi
- [x] Dark/light mode
- [x] Data saver mode
- [ ] Font scaling preference
- [ ] Density / compact mode

### 3.2 Accessibility
- [x] Focus visible
- [x] SR-only labels
- [x] aria-live status
- [x] Skip link
- [x] Reduced motion
- [ ] Accessibility audit lanjutan

## 4. PWA / platform
- [x] Manifest baseline
- [x] Service worker baseline
- [ ] PWA advanced caching/offline
- [ ] Health/startup flow supaya service tidak gampang mati

## 5. Immediate next priority
1. [ ] Fix/verify slash command registration end-to-end
2. [ ] Restart backend + check Discord logs
3. [ ] Verify DM alert end-to-end
4. [ ] Font scaling + density mode
5. [ ] Provider crypto stability lanjutan
