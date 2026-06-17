# Trusted / Priority Web Sources

Market Orca search prioritizes these, but can still return other web results.

## Official / regulatory
- idx.co.id — IDX/BEI
- bi.go.id — Bank Indonesia
- ojk.go.id — OJK
- sec.gov — SEC
- federalreserve.gov — Federal Reserve
- nasdaq.com
- nyse.com

## Indonesia market / finance
- kontan.co.id
- bisnis.com
- cnbcindonesia.com
- katadata.co.id
- detik.com

## Global market / finance
- reuters.com
- bloomberg.com
- cnbc.com
- marketwatch.com
- ft.com
- wsj.com
- barrons.com
- investing.com
- tradingview.com
- seekingalpha.com
- investopedia.com
- fool.com

## Crypto / DeFi
- coindesk.com
- cointelegraph.com
- decrypt.co
- theblock.co
- bankless.com
- defillama.com

## Dev / AI / technical
- github.com
- huggingface.co
- techcrunch.com
- theverge.com
- technologyreview.com
- arstechnica.com
- wired.com
- venturebeat.com
- zdnet.com
- semianalysis.com

## Security
- bleepingcomputer.com
- krebsonsecurity.com
- darkreading.com

## Research / papers
- arxiv.org
- paperswithcode.com
- openreview.net

## Forum / community / blogs
- reddit.com
- news.ycombinator.com
- medium.com
- substack.com
- dev.to
- stackoverflow.com
- stratechery.com
- platformer.news

## Policy
- Priority sources get higher score.
- Non-priority web can still be searched/returned.
- Crawl worker only crawls allowed domains by default to reduce SSRF and junk ingestion.
- Private IP, localhost, non-http(s) are blocked.
- crawl4ai focuses on text extraction; fallback fetch+clean HTML is allowed.
- Forum/blog sources are useful but lower confidence than official/wire sources.


## Added 2026-05-30 — Marketing, Coding, Journals, Thesis/Open Repository

### Marketing / Growth / Ads
- Google Ads/Analytics/Support/Developers, Meta/Facebook Business, Instagram Business, TikTok Business/Ads, LinkedIn Business
- HubSpot, Semrush, Ahrefs, Moz, Search Engine Land, Think with Google, WordStream, Backlinko, Neil Patel
- SproutSocial, Hootsuite, Buffer, Later, SocialMediaExaminer, Content Marketing Institute
- Hotjar, Mixpanel, Amplitude, Segment, Intercom, Salesforce, Klaviyo
- HBR, McKinsey, BCG, Bain, Gartner, Forrester, Statista, Similarweb

### Coding / Open Source / Dev Docs
- GitHub, GitHub Docs/Blog, GitLab, Bitbucket, SourceForge
- MDN, web.dev, W3C, StackOverflow/StackExchange
- npm, PyPI, crates.io, Go, Rust, Python, Node, Bun, Deno, TypeScript
- Docker, Kubernetes, CNCF, Helm, Prometheus, Grafana, Nginx
- PostgreSQL, SQLite, MySQL, Redis, Elastic
- React, Vue, Astro, Vite, Tailwind, Svelte, Next, Nuxt, Hono, Drizzle, Prisma
- Ollama, MCP, OpenAI docs, Anthropic docs, Google AI docs, Perplexity docs

### Journals / Open Research
- arXiv, Semantic Scholar, DOAJ, CORE, PubMed/NCBI, PLOS, bioRxiv, medRxiv
- OSF, Zenodo, Figshare, Harvard Dataverse
- MDPI, Frontiers, Nature, Springer, ScienceDirect, IEEE, ACM, SSRN

### Skripsi / Thesis / Indonesian Repositories
- Garuda Kemdikbud, RAMA Repository, Neliti, OneSearch, Perpusnas
- Repository UGM, UI, ITB, UNAIR, IPB, ITS, UNPAD, USU, UNDIP eprints, Binus
- SINTA and university journal portals when open/public

### Data Sources
- data.go.id, data.gov, World Bank, IMF, BIS, Kaggle, Dataverse, Figshare, Zenodo

Policy: use open/public pages only. No paywall bypass, no CAPTCHA bypass, no private repository scraping.
