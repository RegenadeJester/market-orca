import { db } from './db.js'

const assets = [
  ['jkse', '^JKSE', 'IHSG / IDX Composite', 'IDX', 'index', 7125, 0.52, 'Indeks gabungan Bursa Efek Indonesia sebagai acuan utama pasar saham domestik.'],
  ['lq45', '^JKLQ45', 'IDX LQ45', 'IDX', 'index', 936, 0.44, 'Indeks saham paling likuid di pasar Indonesia.'],
  ['bbca-jk', 'BBCA.JK', 'Bank Central Asia', 'IDX', 'stock', 10125, 1.42, 'Naik didorong akumulasi asing dan sentimen perbankan defensif.'],
  ['bbri-jk', 'BBRI.JK', 'Bank Rakyat Indonesia', 'IDX', 'stock', 5850, 0.88, 'Bank jumbo tetap menarik saat pasar cari emiten likuid.'],
  ['bmri-jk', 'BMRI.JK', 'Bank Mandiri', 'IDX', 'stock', 6825, 0.76, 'Bank BUMN besar tetap jadi motor indeks perbankan.'],
  ['tlkm-jk', 'TLKM.JK', 'Telkom Indonesia', 'IDX', 'stock', 4210, -0.32, 'Defensif, tapi tetap sensitif pada rotasi dana domestik.'],
  ['asii-jk', 'ASII.JK', 'Astra International', 'IDX', 'stock', 5125, 0.27, 'Siklus otomotif dan komoditas ikut pengaruhi arah harga.'],
  ['icbp-jk', 'ICBP.JK', 'Indofood CBP', 'IDX', 'stock', 11150, 0.21, 'Defensif konsumsi, sering dipakai sebagai penyeimbang portofolio.'],
  ['klbf-jk', 'KLBF.JK', 'Kalbe Farma', 'IDX', 'stock', 1625, -0.18, 'Healthcare defensif, cocok saat risk appetite pasar turun.'],
  ['bbni-jk', 'BBNI.JK', 'Bank Negara Indonesia', 'IDX', 'stock', 6820, 0.55, 'Bank BUMN emiten likuid, sensitif terhadap kebijakan suku bunga dan ekspansi kredit.'],
  ['excl-jk', 'EXCL.JK', 'XL Axiata', 'IDX', 'stock', 2850, 0.42, 'Operator telko dengan potensi pertumbuhan data dan ARPU stabil.'],
  ['indf-jk', 'INDF.JK', 'Indofood Sukses Makmur', 'IDX', 'stock', 8200, 0.30, 'Produsen consumer goods terbesar Indonesia, defensif saat inflasi naik.'],
  ['smgr-jk', 'SMGR.JK', 'Semen Indonesia', 'IDX', 'stock', 4150, -0.65, 'Sektor konstruksi dan infrastruktur, siklusik dan sensitif pada proyek pemerintah.'],
  ['adro-jk', 'ADRO.JK', 'Adaro Energy', 'IDX', 'stock', 2580, 1.12, 'Pertambangan batubara, volatile mengikuti harga energi global.'],
  ['antm-jk', 'ANTM.JK', 'Aneka Tambang (Antam)', 'IDX', 'stock', 1850, 0.78, 'Emas dan nikel, sensitif terhadap harga komoditas global dan permintaan China.'],
  ['aapl', 'AAPL', 'Apple', 'US', 'stock', 214.7, -0.82, 'Turun ringan karena rotasi sektor dan kehati-hatian jelang data ekonomi.'],
  ['nvda', 'NVDA', 'NVIDIA', 'US', 'stock', 911.2, 2.14, 'AI trade masih kuat dan chip stocks jadi pusat perhatian.'],
  ['amd', 'AMD', 'Advanced Micro Devices', 'US', 'stock', 181.3, 1.41, 'Sentimen chip dan AI menopang minat beli.'],
  ['tsla', 'TSLA', 'Tesla', 'US', 'stock', 177.5, -1.11, 'Volatil karena gabungan sentimen growth dan risk appetite.'],
  ['btc-usd', 'BTC-USD', 'Bitcoin', 'CRYPTO', 'crypto', 87350, 3.94, 'Naik dipicu arus masuk risiko dan optimisme institusi.'],
  ['eth-usd', 'ETH-USD', 'Ethereum', 'CRYPTO', 'crypto', 4620, 2.73, 'Altcoin ikut menguat saat sentimen crypto membaik.'],
  ['sol-usd', 'SOL-USD', 'Solana', 'CRYPTO', 'crypto', 188.2, 4.11, 'Momentum tinggi saat minat pada high beta crypto naik.'],
  ['xauusd', 'XAUUSD', 'Gold Spot', 'FOREX', 'forex', 3032.4, 0.55, 'Emas naik karena permintaan safe haven dan pelemahan dolar.'],
  ['eurusd', 'EURUSD=X', 'EUR/USD', 'FOREX', 'forex', 1.082, 0.12, 'Forex bergerak tipis menunggu katalis makro.'],
  ['usdidr', 'IDR=X', 'USD/IDR', 'FOREX', 'forex', 15840, 0.09, 'Rupiah sensitif pada dolar dan arus modal.'],
  ['myridr', 'MYRIDR=X', 'MYR/IDR', 'FOREX', 'forex', 3480, 0.00, 'Malaysian Ringgit to Indonesian Rupiah exchange rate. Sensitif terhadap perbedaan suku bunga dan arus modal regional.'],
  ['sgdidr', 'SGDIDR=X', 'SGD/IDR', 'FOREX', 'forex', 11950, 0.00, 'Singapore Dollar to Indonesian Rupiah exchange rate. Pantau transmisi monetary policy Singapura vs Indonesia.'],
  ['brent', 'BZ=F', 'Brent Oil', 'COMMODITY', 'commodity', 84.5, 0.92, 'Minyak bergerak atas ekspektasi pasokan dan geopolitik.'],
  ['wti', 'CL=F', 'WTI Oil', 'COMMODITY', 'commodity', 80.3, 1.03, 'WTI dipantau sebagai proksi risk dan energi global.']
]

db.prepare('DELETE FROM assets').run()
for (const row of assets) {
  db.prepare(`INSERT INTO assets (slug, symbol, name, market, category, price, change_percent, thesis) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(...row)
  db.prepare(`INSERT INTO asset_settings (asset_slug, threshold_up, threshold_down, watch_enabled, updated_at) VALUES (?, ?, ?, 1, datetime('now')) ON CONFLICT(asset_slug) DO UPDATE SET updated_at=datetime('now')`).run(row[0], row[4] === 'crypto' ? 3 : 2, row[4] === 'crypto' ? -3 : -2)
}

console.log('Seed complete with expanded IDX + global assets')
