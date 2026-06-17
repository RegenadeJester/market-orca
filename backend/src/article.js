function directionWord(change = 0) {
  if (change > 0) return 'naik'
  if (change < 0) return 'turun'
  return 'bergerak datar'
}

function classifyNews(news = [], direction = 'bergerak datar') {
  const positive = []
  const negative = []
  const neutral = []
  for (const item of news) {
    if (item.sentiment === 'positive') positive.push(item)
    else if (item.sentiment === 'negative') negative.push(item)
    else neutral.push(item)
  }
  if (direction === 'naik') return { main: positive.slice(0, 3), counter: negative.slice(0, 2), neutral: neutral.slice(0, 2) }
  if (direction === 'turun') return { main: negative.slice(0, 3), counter: positive.slice(0, 2), neutral: neutral.slice(0, 2) }
  return { main: neutral.slice(0, 3), counter: [...positive.slice(0, 1), ...negative.slice(0, 1)], neutral: neutral.slice(0, 2) }
}

function summarizeDrivers(news = []) {
  const positive = news.filter((n) => n.sentiment === 'positive').length
  const negative = news.filter((n) => n.sentiment === 'negative').length
  const sources = [...new Set(news.map((n) => n.source).filter(Boolean))].slice(0, 3)
  const sourceText = sources.length ? ` Sumber dominan: ${sources.join(', ')}.` : ''
  if (positive > negative) return `sentimen berita cenderung mendukung kenaikan dan memperkuat minat beli.${sourceText}`
  if (negative > positive) return `sentimen berita cenderung menekan harga dan memicu kehati-hatian pasar.${sourceText}`
  return `headline yang muncul masih campuran sehingga pasar bergerak lebih selektif.${sourceText}`
}

export function buildArticle(asset, news = []) {
  const direction = directionWord(asset.change_percent || 0)
  const move = Math.abs(asset.change_percent || 0).toFixed(2)
  const lead = news[0]
  const second = news[1]
  const priceText = asset.price ? `${asset.price} ${asset.currency || ''}`.trim() : 'harga live'
  const related = classifyNews(news, direction)

  return {
    headline: `${asset.name} ${direction} ${move}%: apa penyebab utamanya?`,
    body: [
      `${asset.name} (${asset.symbol}) saat ini ${direction} sebesar ${move}% di market ${asset.market}, dengan harga live sekitar ${priceText}.`,
      lead ? `Headline paling relevan saat ini: ${lead.title}. ${lead.summary}` : `Belum ada headline yang sangat dominan, jadi pergerakan masih banyak dipengaruhi sentimen pasar umum.`,
      second ? `Headline pendukung berikutnya: ${second.title}. ${second.summary}` : `Pelaku pasar masih mencerna arah berikutnya, jadi momentum jangka pendek tetap penting diperhatikan.`,
      `Secara praktis, pergerakan ini kemungkinan dipengaruhi oleh ${summarizeDrivers(news)} `,
      `Untuk pengambilan keputusan, fokuskan perhatian pada headline terbaru, perubahan persen, volume, dan apakah momentum ini berlanjut atau mulai melemah.`
    ],
    relatedNews: related
  }
}
