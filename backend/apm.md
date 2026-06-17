# Market Orca APM — Advanced RAG Report Roadmap

## 2026-05-27 — Search + Retrieval + RAG Report Engine
- **Problem**: report market raw LLM gampang halu, klaim tidak traceable, export rawan bocor.
- **Flow**: question → query rewrite → search/crawl → retrieve chunks → rerank → report with citations → fact-check → export guard.
- **Stack MVP**: SQLite FTS5, `crawl4ai-lite` fetch cleaner, Express API, PDF/MD export guard.
- **Later**: sqlite-vss/LanceDB/Qdrant, embeddings local/Ollama/OpenAI-compatible, reranker, cron crawler.

## Agent Roles
1. **PM**: tentukan user goal, format report, acceptance criteria.
2. **Market Analyst**: validasi news/price/catalyst/risk.
3. **RAG Architect**: query rewrite, chunking, FTS/vector/rerank.
4. **Crawler Engineer**: crawl4ai, robots/respect, timeout, dedupe.
5. **Data Engineer**: schema, ingestion, retention, provenance.
6. **Prompt Engineer**: source-grounded prompt, citation policy.
7. **Fact Checker**: unsupported claim detector, stale data marker.
8. **Security/RBAC**: sensitivity, signed URL, watermark, audit.
9. **PDF/Export Engineer**: MD/PDF/HTML with citations.
10. **QA Engineer**: retrieval relevance, citation coverage, regression.
11. **SFT Dataset Curator**: JSONL instruction tuning data Indonesian.
12. **Ops/Cron Owner**: scheduled crawl, report refresh, health checks.

## Acceptance Criteria
- Report selalu punya citations atau jelas `data belum cukup`.
- Search result menampilkan quote + source URL.
- RAG run tersimpan di `rag_report_runs`.
- Citation tersimpan di `rag_citations`.
- Dataset generator output JSONL valid.
- Export tetap lewat permission guard.

## API
- `POST /api/rag/ingest` manual/url ingest.
- `GET /api/rag/search?q=...`
- `POST /api/reports/rag-generate`
- `POST /api/datasets/indonesian-jsonl`
