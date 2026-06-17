# PLAN.md - Market Orca

## Goal
Bangun dashboard market yang realtime, usable, ringan, dan punya Discord bot/alert yang benar-benar kepakai.

## Working flow
1. Ambil 1 blok kerja nyata
2. Edit file yang perlu
3. Build/check/restart
4. Verifikasi hasil
5. Baru lapor DONE/BELUM/NEXT

## Current phases

### Phase A - Core stabilization
Status: mostly done
- Provider layer lebih stabil
- SSE Home/Asset/Terminal ada
- Chart lightweight-charts ada
- UI desktop/mobile sudah dirombak
- Alert/toast/news/watchlist sudah usable

### Phase B - Discord bot expansion
Status: ongoing
Sub-steps:
1. Bot presence native baseline ✅
2. Slash command baseline ✅
3. DM subscriber model ✅
4. Slash command CRUD DM subscriber ✅
5. Restart + verify registration/logs ⏳
6. End-to-end DM alert test ⏳
7. Preferences granular ⏳

### Phase C - UX/HCI/WCAG polish
Status: ongoing
Sub-steps:
1. Focus/labels/live regions ✅
2. Skip link ✅
3. Reduced motion ✅
4. Theme/data-saver ✅
5. Font scaling ⏳
6. Density mode ⏳
7. Accessibility review lanjutan ⏳

### Phase D - Advanced realtime/platform
Status: pending
Sub-steps:
1. Better crypto provider resilience ⏳
2. Better IDX/Indo provider coverage ⏳
3. Native websocket/tick stream ⏳
4. PWA advanced/offline ⏳

## Immediate execution order
1. Fix slash command registration verification
2. Restart backend and verify logs
3. Test DM alert flow
4. Continue UX controls (font scaling + density)
5. Continue provider improvements
