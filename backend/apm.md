# APM — Automated Product Management

**Prompt:** Daily APM execution. Candle akan implement 3 fitur nyata untuk Market Orca hari ini (bukan 5 — fokus, bukan quantity).

## Aturan Main:
1. Analisis codebase Market Orca (backend/src/, frontend/src/) — cari pain point nyata
2. Brainstorm 3 fitur konkret yang:
   - Bisa selesai dalam 1-2 jam
   - Memberi value langsung (bukan placeholder)
   - Tidak meninggalkan state rusak
3. Untuk SETIAP fitur: branch → implement → commit → merge. Jangan tinggalkan branch menggantung.
4. Update MMd.md setelah selesai
5. Prioritaskan: kualitas report, akurasi data, UX Discord, automation, performance

## Flow:
1. Baca codebase → identifikasi 3 pain point
2. Buat branch: feature/<nama-pendek>
3. Implementasi + test (sendiri)
4. Commit + merge
5. Lanjut fitur berikutnya
6. Update MMd.md
7. laporan: apa yang dibuat, file diubah, kenapa

JANGAN analysis paralysis. 15 menit analisis, 45 menit implementasi per fitur.
