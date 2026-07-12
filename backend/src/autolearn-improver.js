#!/usr/bin/env node
/**
 * autolearn-improver.js — Autonomous report quality improvement system
 *
 * Continually evaluates Market Orca reports for:
 *   - Language purity (Indo-English mixing)
 *   - Writing quality (readability, structure, signal:noise)
 *   - News accuracy (source freshness, citation coverage)
 *   - Breaking news potential (public reaction signals)
 *   - UI delivery (frontend rendering quality)
 *
 * Usage:
 *   node autolearn-improver.js --evaluate          Score last 7 days of reports
 *   node autolearn-improver.js --evaluate --days=1  Score today's report only
 *   node autolearn-improver.js --evaluate --days=7 --deep  Deep analysis + pattern extraction
 *   node autolearn-improver.js --fix-language       Patch report templates with better ID
 *   node autolearn-improver.js --apply-improvements Apply all pending improvements
 *   node autolearn-improver.js --status             Show current quality trend
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')  // backend/src → project root
const REPORTS_DIR = join(ROOT, 'reports')
const AUTOLEARN_DIR = join(REPORTS_DIR, 'autolearn')
const REPORT_SRC = join(__dirname, 'ai-daily-report.js')

// ---- Config ----
const ALLOWED_ENGLISH = [
  'AI', 'API', 'RAG', 'MCP', 'LLM', 'REST', 'HTTP', 'JSON', 'SQL',
  'FTS', 'SSE', 'CRUD', 'CI/CD', 'QA', 'UI', 'UX', 'JWT', 'OAuth',
  'TLKM', 'BBRI', 'BMRI', 'ASII', 'ADRO', 'ANTM', 'BBNI', 'SMGR', 'INDF', 'EXCL',
  'JKSE', 'JKLQ45', 'IDR', 'USD', 'BTC', 'ETH', 'SOL',
  'NYSE', 'NASDAQ', 'IDX', 'S&P', 'DJI',
  'Node.js', 'SQLite', 'Discord', 'GitHub',
]

const ENGLISH_HEADERS = [
  '## What Changed Today',
  '## Report Quality',
  '## Suggested Alerts',
  '> Vibe check:',
  '> Why it matters:',
  '> Why care:',
  '# Full Drop — AI DAILY REPORT',
]

const ID_REPLACEMENTS = {
  '## What Changed Today': '## Yang Berubah Hari Ini',
  '## Report Quality': '## Kualitas Laporan',
  '## Suggested Alerts': '## Alert yang Disarankan',
  '## Suggested Alerts (Smart Alert Threshold)': '## Alert yang Disarankan (Smart Alert)',
  '## Red Flags': '## Bendera Merah',
  '## Actionable Watchlist': '## Watchlist Prioritas',
  '## Data Status': '## Status Data',
  '> Vibe check:': '> Mood pasar:',
  '> Why it matters:': '> Kenapa penting:',
  '> Why care:': '> Kenapa penting:',
  '# Full Drop — AI DAILY REPORT': '# Laporan Lengkap — AI Daily Report',
  'TL;DR buat yang males baca': 'Ringkasan Eksekutif',
  '**Score:**': '**Skor:**',
  '**Sources:**': '**Sumber:**',
  '**Items:**': '**Item:**',
  '**Duplicates:**': '**Duplikat:**',
  '**Stale:**': '**Kedaluwarsa:**',
  '**Source rotation:**': '**Rotasi Sumber:**',
  'Tidak ada alert candidates dari report hari ini.': 'Tidak ada kandidat alert dari laporan hari ini.',
  'Top Story:': 'Berita Utama:',
  'Kenapa penting:': 'Dampak:',
  'Sentimen pasar:': 'Sentimen Pasar:',
  'Indonesia Pulse:': 'Pulsa Indonesia:',
  'Coverage:': 'Cakupan:',
  'Data belum tersedia:': 'Data belum tersedia:',
}

// ---- Core evaluators ----

function findReportFiles(days) {
  const cutoff = new Date(Date.now() - days * 86400000)
  if (!existsSync(REPORTS_DIR)) return []
  return readdirSync(REPORTS_DIR)
    .filter(f => f.endsWith('.md') && !f.includes('autolearn') && !f.includes('-brief'))
    .map(f => {
      const fp = join(REPORTS_DIR, f)
      const { mtime } = existsSync(fp) ? statSync(fp) : { mtime: new Date(0) }
      return { file: f, path: fp, mtime }
    })
    .filter(({ mtime }) => mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime)
}

function scoreLanguage(text) {
  const lines = text.split('\n')
  let englishSegmentCount = 0
  let totalSegmentCount = 0
  const issues = []
  const seen = new Set()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('<http') || line.startsWith('```')) continue

    // Check section headers
    for (const header of ENGLISH_HEADERS) {
      if (line.startsWith(header) && !seen.has(header)) {
        englishSegmentCount++
        totalSegmentCount++
        seen.add(header)
        issues.push({ line: i + 1, issue: `EN header: "${line.substring(0, 40)}"`, severity: 'medium' })
        break
      }
    }
    totalSegmentCount++
  }

  // Check inline English terms in ID sections — detect by common English vocabulary,
  // NOT by excluding non-allowlisted words (Latin-script Indonesian words also match)
  const COMMON_EN = new Set(['about','after','again','against','all','almost','alone','along','already','also','although','always','among','another','any','anything','around','away','back','become','before','behind','believe','between','billion','both','bring','business','but','buy','call','came','can','capital','case','certain','change','close','company','could','country','course','create','current','cut','day','debt','decline','decrease','demand','did','different','do','does','done','down','during','each','earn','earnings','economy','end','enough','especially','even','every','everything','except','expect','fact','fair','far','fast','feel','few','finance','financial','find','first','focus','force','foreign','found','from','full','further','future','gains','general','given','global','goal','going','good','got','great','growth','half','hand','hard','has','have','headline','help','here','high','hill','hold','home','hope','however','huge','impact','increase','index','industry','inflation','inside','instead','into','invest','investor','issue','just','keep','known','large','last','later','lead','least','less','level','life','likely','little','long','look','lost','low','made','main','major','make','man','many','market','matter','means','measure','might','million','mind','miss','more','most','move','much','must','nation','national','natural','near','nearly','necessary','need','never','new','news','next','night','normal','not','nothing','now','number','offer','off','oil','old','only','open','operate','option','order','other','over','own','part','past','pay','people','percent','period','person','place','plan','play','point','possible','power','price','private','probably','problem','process','produce','product','production','profit','project','property','public','put','rate','reach','read','real','reality','record','reduce','remain','report','result','return','rise','risk','road','run','said','same','save','say','securities','sector','seem','sell','sentiment','series','service','set','share','short','show','significant','similar','since','small','so','some','something','soon','specific','spot','start','state','statement','stock','strong','structure','substantial','suggest','system','take','talk','tall','technology','tell','term','test','than','that','the','their','them','then','there','these','they','thing','think','this','those','though','through','time','total','tough','trade','trading','trillion','turn','two','under','unemployment','unit','until','up','upon','us','used','value','very','volume','wage','wait','want','war','was','watch','way','we','weight','well','were','west','what','whatever','when','where','whether','which','while','who','whole','whose','why','wide','wild','will','win','wind','within','without','wonder','work','worker','world','worth','would','year','yet','you','young','yourself','youth','zero','about','according','across','act','add','administration','admit','adult','affected','age','agency','ago','ahead','aim','air','allow','amount','annual','apparent','approach','appropriate','area','argue','army','assume','authority','available','average','background','bank','base','basis','basis','beat','bed','benefit','big','bit','bottom','break','brief','budget','building','burn','busy','campaign','capacity','carry','catch','cause','center','central','chance','check','choice','claim','clear','clearly','climb','closely','co','cold','collection','column','combine','come','comfort','command','commission','commit','committee','common','communicate','community','complex','concern','concerned','condition','conflict','congress','consider','construction','consumer','continue','control','convince','core','corner','cost','council','count','couple','court','cover','crisis','critical','cross','cup','current','customer','cycle','damage','data','daughter','dead','deal','death','debate','decade','decision','deep','deficit','degree','democrat','department','depend','deputy','describe','design','detail','determine','develop','development','device','die','difference','difficult','dinner','direction','director','discover','discuss','discussion','disease','dog','door','drive','drop','drug','ear','early','earth','east','edge','editor','effect','effective','effort','eight','either','elect','element','else','emerge','emission','emphasis','employee','energy','engage','engine','enjoy','enough','entire','entirely','environment','environmental','episode','equal','equipment','error','escape','establish','estate','estimate','event','eventually','evidence','evil','evolve','exact','exactly','exam','examine','example','executive','exist','existence','expand','expansion','expensive','experiment','expert','explain','explanation','explicitly','explore','exposure','express','expression','extend','extent','extra','extreme','extremely','facility','factor','fail','fairly','fall','familiar','family','famous','fan','fantasy','fashion','feature','feed','fell','female','figure','file','fill','film','final','finally','finance','finger','firm','flat','flip','fly','follow','foot','football','force','forever','forget','form','former','forth','forward','foundation','four','fourth','frame','framework','fresh','front','fruit','fuel','function','fund','fundamental','future','gain','game','garden','gas','gather','gear','gene','generate','generation','gentle','girl','glass','goal','god','gold','golf','govern','governor','grab','grade','gradually','grain','grass','grave','gray','greatly','green','ground','group','growth','guarantee','guard','guess','guest','guide','guilty','guy','habit','half','hall','hang','happen','harsh','hat','hate','head','health','healthy','heart','heat','heavy','helpful','heritage','hidden','highly','himself','historical','history','hit','hole','holiday','holy','honor','horizon','hot','hotel','hour','house','household','housing','huge','hundred','hunt','hurt','husband','ice','idea','identify','identity','ignore','illustrate','image','imagine','immediate','immediately','immigrant','immune','impact','implement','implication','imply','import','impose','impossible','impression','improve','improvement','incident','incorporate','indeed','independently','indicate','individual','industrial','infant','informal','infrastructure','initial','initially','injure','injury','inner','innocent','inquiry','insert','inside','insist','inspire','install','instance','instead','institute','institutional','insurance','integrate','intellectual','intelligence','intend','intense','intention','interest','interior','internal','international','interpretation','interval','intervention','interview','intimate','introduce','introductory','invade','invasion','investigate','investigation','investigator','investment','invisible','involve','island','itself','jet','jewish','journalist','joy','judgment','jump','junior','jury','just','justice','justify','keen','kid','kill','kitchen','knee','knife','knock','know','labor','lack','lady','lake','land','landscape','language','large','largely','laser','later','latter','launch','lawsuit','lawyer','lay','layer','league','lean','leap','learn','least','leather','leave','left','legal','legislation','legislative','legislature','legitimate','lend','lens','lesser','lesson','let','letter','liberal','liberty','license','lie','lifestyle','lift','limitation','limited','link','lip','liquid','list','listen','literally','literary','literature','live','lively','living','load','loan','local','locate','lock','log','logic','logical','long','loose','lot','loud','lovely','low','loyal','luck','lunch','lung','machinery','magazine','mail','mainly','maintain','majority','male','mall','manage','manager','manner','manufacture','manufacturer','margin','mark','mass','massive','master','match','mate','material','math','maximum','mayor','meal','mean','meaningful','measure','mechanism','media','medicine','medium','member','membership','memory','mental','mention','merely','merger','mess','message','metal','middle','mild','military','million','mind','mine','mineral','minimum','minister','minor','minority','minute','mirror','miss','mission','mistake','mix','model','modern','modest','molecular','mom','moment','monitor','monthly','mood','moral','moreover','morning','mortgage','mostly','mother','motion','motivation','mount','mountain','mouse','mouth','movement','multiply','murder','muscle','museum','music','mutual','myself','mystery','narrow','nasty','nation','native','natural','nature','nearby','nearly','neat','neck','negative','neglect','neighbor','neighborhood','neither','nerve','nervous','net','network','neutral','nevertheless','newly','nice','nine','nobody','nod','noise','nomination','nonetheless','nor','normally','note','nothing','notice','notion','novel','nuclear','nurse','nut','obey','object','objective','obligation','observation','observe','obtain','obvious','occasion','occasionally','occupation','occupy','occur','ocean','odd','oddly','offense','offensive','officer','official','online','operate','operation','operator','opinion','opponent','oppose','opposite','opposition','option','orange','ordinary','organ','organic','organization','organize','origin','original','otherwise','ought','outcome','outer','outline','output','outside','overall','overcome','overlook','own','pace','pack','package','page','pain','paint','pair','palace','pale','panel','panic','paper','paragraph','parallel','parent','park','parliament','partially','participate','participation','partly','partner','partnership','party','passage','passenger','passion','passive','patience','patient','pattern','pause','peak','penalty','pension','percent','percentage','perception','perfect','perform','performance','perhaps','period','permanent','permission','permit','personality','perspective','persuade','phase','phenomenon','philosophy','phrase','physical','physician','piano','pick','picture','pie','pile','pilot','pink','pipe','pitch','plain','planet','plant','plate','platform','play','player','pleasure','plenty','pocket','poem','poetry','pole','poll','pollution','pond','pool','poor','pop','popular','population','porch','port','portion','portrait','pose','position','positive','possession','possibility','possibly','post','potato','pot','potential','potentially','pound','pour','poverty','powerful','practical','practice','praise','prayer','predict','prefer','preference','pregnant','preparation','prepare','presence','present','presentation','preserve','presidency','president','presidential','press','pressure','presume','pretend','pretty','prevail','prevent','previous','previously','primarily','primary','prime','prince','princess','principal','principle','print','prior','priority','prison','prisoner','privacy','private','privilege','probe','proceed','produce','producer','product','production','profession','professional','professor','profile','profit','program','progress','project','promise','promote','promotion','prompt','proof','proper','properly','property','proportion','proposal','propose','prospect','protect','protection','protest','proud','prove','provide','province','provision','psychological','psychologist','psychology','public','publish','pull','pump','punch','purchase','pure','pursue','quest','quick','quickly','quiet','quietly','quit','quote','race','racial','radical','rage','rain','raise','range','rank','rapid','rapidly','rare','rarely','rate','rather','ratio','raw','ray','react','reaction','read','reader','readily','reading','reality','realize','rear','reason','reasonable','rebuild','receipt','receive','recent','recently','recognition','recognize','recommend','recommendation','recovery','recruit','red','reduce','ref','refer','reference','reflection','reform','refugee','regard','regarding','regime','region','regional','register','regret','regular','regularly','regulate','regulation','reinforce','reject','relate','relation','relationship','relative','relatively','relax','release','relevant','relief','religion','religious','rely','remain','remaining','remark','remember','remind','remote','removal','remove','rental','repair','repeat','replace','replacement','reply','represent','representation','representative','republic','republican','reputation','request','require','requirement','research','researcher','reserve','resident','resign','resist','resistance','resolution','resolve','resort','resource','respond','response','responsibility','responsible','rest','restore','restrict','restriction','retain','retire','retirement','retreat','return','reveal','revenue','review','revolution','rhythm','rich','ride','rifle','right','ring','rise','river','road','rock','role','roll','romantic','roof','room','root','rope','rose','rough','roughly','round','route','row','rub','ruin','rule','run','rural','rush','sacred','sacrifice','sad','safe','safety','sake','salary','sale','sample','sanction','sand','satellite','satisfaction','satisfy','saturday','sauce','save','savings','scale','scenario','scene','schedule','scheme','scholar','school','science','scientific','scientist','scope','score','scratch','screen','script','search','season','seat','second','secondary','secret','secretary','sector','secure','security','seed','seek','seem','segment','seize','select','selection','senator','senior','sense','sensitive','sentence','separate','sequence','sergeant','series','serious','seriously','serve','service','session','settle','settlement','severe','shadow','shall','shame','shape','share','sharp','sheer','sheet','shelf','shell','shift','shine','ship','shirt','shock','shoe','shoot','shop','shopping','shore','short','shortly','shot','shoulder','shout','show','shower','shut','shy','sick','side','sigh','sight','sign','signal','signature','significance','significant','significantly','silence','silent','silver','similar','similarly','simple','simply','sin','since','sing','singer','single','sir','sister','sit','site','situation','six','size','skill','skin','sky','slave','sleep','slice','slide','slight','slightly','slip','slow','slowly','small','smart','smell','smile','smoke','smooth','snap','snow','so','so-called','soccer','social','society','soft','software','soil','solar','soldier','sole','solely','solid','solution','solve','somebody','somewhat','son','song','soon','sophisticated','sorry','sort','soul','sound','source','south','southern','space','spare','speak','speaker','special','specialist','species','specific','specifically','speech','speed','spend','spirit','split','spokesman','sponsor','sport','spot','spread','spring','square','squeeze','stable','staff','stage','stake','stand','standard','standing','star','stare','start','starting','state','statement','station','statistics','status','steady','steal','steel','steep','stem','step','stick','stiff','still','stock','stomach','stone','stop','storage','store','storm','story','straight','stranger','strategy','stream','street','strength','stress','stretch','strike','string','strip','stroke','strong','strongly','structural','structure','struggle','student','studio','study','stuff','style','subject','submit','subsequent','substance','succeed','success','successful','successfully','suffer','sugar','suggest','suggestion','suit','sum','summary','summit','sun','super','supply','support','supporter','suppose','supposed','sure','surely','surface','surgery','surprise','surprised','surprising','surround','survey','survival','survive','survivor','suspect','suspend','sustain','swallow','swear','sweet','swing','switch','symbol','symptom','sympathy','syndrome','system','table','tale','talent','talk','tall','tank','tape','target','task','taste','tax','taxpayer','teach','teacher','teaching','team','tear','technology','teen','telephone','television','tell','temperature','temporary','ten','tend','tender','tennis','tension','tent','term','terms','terrible','terrific','territory','terrorism','terrorist','test','testimony','testing','text','than','thank','theater','theme','themselves','therapy','thereafter','thereby','therefore','thick','thin','thing','think','thinking','third','thirteen','thirty','thorough','thoroughly','those','though','thought','thousand','threat','threaten','throat','throughout','throw','thus','ticket','tide','till','timber','tiny','tip','tire','tired','title','today','toe','together','tolerance','tomato','tomorrow','tone','tongue','tonight','too','tool','tooth','top','topic','total','totally','touch','tough','tour','tourist','tournament','tower','town','toy','trace','track','trade','tradition','traditional','traffic','tragedy','trail','train','training','transfer','transform','transformation','transition','translate','transportation','trap','trash','travel','treat','treatment','treasure','treaty','trend','trial','tribe','trick','troop','trouble','truck','truly','trust','truth','tube','tune','tunnel','turn','twelve','twenty','twice','twin','twist','type','typical','typically','ugly','ultimate','ultimately','uncertain','uncle','undergo','underground','understand','understanding','undertake','unemployment','unfair','unfortunately','uniform','unify','union','unique','unit','united','universal','universe','university','unknown','unless','unlike','unlikely','until','unusual','upbeat','update','upon','upper','upset','urban','urge','usage','usual','utilize','valley','valuable','variable','variation','variety','various','vast','vehicle','venture','version','veteran','via','victim','victory','view','viewer','violence','violent','virtual','virtually','visible','vision','visitor','vital','voice','volume','volunteer','voter','wage','wait','wake','walk','wall','wander','want','war','warm','warn','warning','warrant','wash','waste','watch','water','wave','way','wealth','weapon','wear','weather','web','website','wedding','week','weekday','weekend','weekly','weight','welcome','welfare','western','wet','whatever','whenever','whereas','wherever','whisper','white','whoever','wild','wildlife','willing','wine','wing','wire','wisdom','wise','wish','within','witness','wolf','wonder','wonderful','wooden','work','worker','working','workshop','worried','worship','worse','worst','worth','worthy','wound','wrap','write','writer','writing','wrong','yard','yeah','yield','yours','yourselves'])
  const idSectionLines = lines.filter(l => !l.startsWith('##') && !l.startsWith('>') && !l.startsWith('```') && l.trim())
  let inlineIssues = 0
  for (const line of idSectionLines) {
    const words = line.split(/\s+/).filter(w => /^[a-zA-Z]+$/.test(w) && w.length > 2)
    for (const word of words) {
      // Skip allowed technical terms and stock tickers
      if (ALLOWED_ENGLISH.includes(word) || ALLOWED_ENGLISH.includes(word.toUpperCase())) continue
      // Only flag if it's a common English word (not Latin-script Indonesian)
      if (COMMON_EN.has(word.toLowerCase())) inlineIssues++
    }
  }

  const totalIdWords = idSectionLines.reduce((s, l) => s + l.split(/\s+/).length, 0)
  const unknownRatio = totalIdWords > 0 ? inlineIssues / totalIdWords : 0
  const inlinePenalty = Math.min(30, Math.round(unknownRatio * 60))
  const score = Math.max(0, Math.round(100 - (englishSegmentCount / Math.max(1, totalSegmentCount) * 100) - inlinePenalty))
  return { score: Math.max(0, Math.min(100, score)), issues }
}

function scoreWriting(text) {
  // Readability: average sentence length, paragraph structure
  const lines = text.split('\n').filter(l => l.trim())
  const contentLines = lines.filter(l => !l.startsWith('>') && !l.startsWith('<') && !l.startsWith('```') && l.trim().length > 20)
  if (contentLines.length === 0) return { score: 50, issues: [{ issue: 'No content to evaluate', severity: 'high' }] }

  const avgLineLen = contentLines.reduce((s, l) => s + l.replace(/\*\*/g, '').length, 0) / contentLines.length
  const hasHeaderCount = lines.filter(l => l.startsWith('##')).length
  const hasBullet = contentLines.filter(l => l.trim().startsWith('-')).length
  const hasActionable = text.includes('✅') || text.includes('⚠️') || text.includes('📌')

  let score = 70
  const issues = []

  if (avgLineLen > 200) { score -= 15; issues.push({ issue: `Lines too long (avg ${Math.round(avgLineLen)} chars)`, severity: 'medium' }) }
  if (avgLineLen < 30) { score -= 10; issues.push({ issue: 'Lines too short (fragments)', severity: 'low' }) }
  if (hasHeaderCount < 4) { score -= 10; issues.push({ issue: `Few sections (${hasHeaderCount})`, severity: 'medium' }) }
  if (hasBullet < 1) { score -= 5; issues.push({ issue: 'No bullet lists', severity: 'low' }) }
  if (!hasActionable) { score -= 5; issues.push({ issue: 'No actionable icons (✅⚠️📌)', severity: 'low' }) }

  // Bonus: good signals
  if (hasHeaderCount >= 8) score += 10
  if (hasBullet >= 10) score += 5
  if (hasActionable) score += 5

  return { score: Math.max(0, Math.min(100, score)), issues }
}

function scoreAccuracy(text) {
  const issues = []
  let score = 80

  // Check for stale data warnings
  if (text.includes('data stale') || text.includes('Data belum tersedia')) {
    score -= 20
    issues.push({ issue: 'Contains stale/missing data indicators', severity: 'high' })
  }

  // Check citation count (URLs per item ratio)
  const urls = (text.match(/https?:\/\/[^\s\n>]+/g) || []).length
  const items = (text.match(/^\d+\.\s+\[/gm) || []).length
  if (items > 0 && urls < items) {
    score -= 10
    issues.push({ issue: `Citations incomplete (${urls} URLs for ${items} items)`, severity: 'medium' })
  }

  // Check source count
  const sourceMatch = text.match(/\*\*Sumber:\*\*\s+(\d+)/)
  if (sourceMatch) {
    const sourceCount = parseInt(sourceMatch[1])
    if (sourceCount < 3) {
      score -= 15
      issues.push({ issue: `Low source diversity: ${sourceCount} sources`, severity: 'high' })
    }
  }

  return { score: Math.max(0, Math.min(100, score)), issues }
}

function scoreBreaking(text) {
  const issues = []
  let score = 50

  // Check for fresh items (< 1h)
  const freshMentions = (text.match(/fresh\s*<\s*1h/gi) || []).length
  if (freshMentions > 0) {
    score += freshMentions * 10
    issues.push({ issue: `${freshMentions} breaking items (fresh <1h)`, severity: 'info' })
  }

  // Check for price anomaly section signals
  if (text.includes('Anomali') || text.includes('⚠️')) score += 15

  // Check for high-impact keywords
  const impactWords = ['crash', 'surge', 'plunge', 'moon', 'ban', 'launch', 'scandal', 'lawsuit', 'SEC', 'Fed', 'rate', 'war', 'crisis']
  const impactCount = impactWords.filter(w => text.toLowerCase().includes(w)).length
  score += impactCount * 5

  return { score: Math.max(0, Math.min(100, score)), issues }
}

function scoreUI(text) {
  const issues = []
  let score = 70

  // Check for HTML markers (if exists)
  if (text.includes('<div') || text.includes('<p>') || text.includes('class=')) {
    score += 10
  }

  // Markdown structure check
  const hasHeadings = text.includes('## ')
  const hasBold = text.includes('**')
  const hasLinks = text.includes('http')
  const hasLists = text.startsWith('1.') || text.includes('\n- ')

  if (!hasHeadings) { score -= 20; issues.push({ issue: 'No markdown headings', severity: 'high' }) }
  if (!hasBold) { score -= 5; issues.push({ issue: 'No bold text', severity: 'low' }) }
  if (!hasLinks) { score -= 10; issues.push({ issue: 'No links/citations', severity: 'medium' }) }
  if (!hasLists) { score -= 5; issues.push({ issue: 'No lists', severity: 'low' }) }

  return { score: Math.max(0, Math.min(100, score)), issues }
}

function scoreValue(userLang = 'Bahasa Indonesia') {
  // Dummy for now: checks user_context mentions
  let score = 70
  const issues = []

  return { score, issues }
}

// ---- Autolearn pipeline ----

function evaluateReport(content, file) {
  const lang = scoreLanguage(content)
  const writing = scoreWriting(content)
  const accuracy = scoreAccuracy(content)
  const breaking = scoreBreaking(content)
  const ui = scoreUI(content)
  const value = scoreValue()

  const total = Math.round(
    lang.score * 0.25 +
    writing.score * 0.20 +
    accuracy.score * 0.20 +
    breaking.score * 0.15 +
    ui.score * 0.10 +
    value.score * 0.10
  )

  return {
    report: file,
    date: new Date().toISOString(),
    total,
    dimensions: { lang, writing, accuracy, breaking, ui, value },
    improvementPriority: getPriority(lang, writing, accuracy, breaking, ui),
  }
}

function getPriority(...scorers) {
  const lows = scorers.filter(s => s.score < 50)
  if (lows.length > 2) return 'CRITICAL'
  if (lows.length > 0) return 'HIGH'
  if (scorers.some(s => s.score < 70)) return 'MEDIUM'
  return 'LOW'
}

function generateImprovementPlan(evaluations) {
  // Aggregate issues across evaluations
  const allIssues = []
  for (const ev of evaluations) {
    for (const [dim, data] of Object.entries(ev.dimensions)) {
      for (const issue of data.issues) {
        allIssues.push({ ...issue, dimension: dim, report: ev.report })
      }
    }
  }

  // Rank by frequency
  const freq = {}
  for (const issue of allIssues) {
    const key = issue.issue
    if (!freq[key]) freq[key] = { count: 0, dimensions: new Set(), reports: new Set(), severity: issue.severity }
    freq[key].count++
    freq[key].dimensions.add(issue.dimension)
    freq[key].reports.add(issue.report)
    if (issue.severity === 'high') freq[key].severity = 'high'
  }

  const sorted = Object.entries(freq)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([issue, data]) => ({
      issue,
      count: data.count,
      severity: data.severity,
      spread: data.reports.size,
      dimensions: [...data.dimensions],
    }))

  return sorted
}

function patchReportTemplate() {
  // Apply language fixes directly to ai-daily-report.js
  if (!existsSync(REPORT_SRC)) return { applied: 0, errors: ['ai-daily-report.js not found'] }

  let code = readFileSync(REPORT_SRC, 'utf-8')
  let applied = 0
  const errors = []

  for (const [en, id] of Object.entries(ID_REPLACEMENTS)) {
    const count = (code.match(new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
    if (count > 0) {
      code = code.replaceAll(en, id)
      applied++
    }
  }

  writeFileSync(REPORT_SRC, code, 'utf-8')
  return { applied, errors }
}

// ---- Main ----

async function main() {
  const args = process.argv.slice(2)
  const days = parseInt(args.find(a => a.startsWith('--days='))?.split('=')[1] || '7')
  const isDeep = args.includes('--deep')
  const isDryRun = args.includes('--dry-run')
  const isFixLanguage = args.includes('--fix-language')

  if (!existsSync(AUTOLEARN_DIR)) mkdirSync(AUTOLEARN_DIR, { recursive: true })

  if (isFixLanguage) {
    console.log('🔧 Patching report templates with Indonesian translations...')
    const result = patchReportTemplate()
    if (result.errors.length) {
      console.error('❌ Errors:', result.errors.join(', '))
    } else {
      console.log(`✅ ${result.applied} replacements applied to ai-daily-report.js`)
    }
    return
  }

  // ---- Evaluate reports ----
  if (args.includes('--evaluate') || args.includes('--status')) {
    const reports = findReportFiles(days)
    if (reports.length === 0) {
      console.log(`No reports found in last ${days} days`)
      return
    }

    console.log(`📊 Evaluating ${reports.length} reports from last ${days} days...\n`)

    const evaluations = reports.map(({ file, path }) => {
      const content = readFileSync(path, 'utf-8')
      return evaluateReport(content, file)
    })

    // Summary
    const avg = evals => Math.round(evals.reduce((s, e) => s + e.total, 0) / evals.length)
    const worst = evals => evals.reduce((w, e) => e.total < w.total ? e : w, evals[0])
    const best = evals => evals.reduce((b, e) => e.total > b.total ? e : b, evals[0])

    console.log('═══════════════════════════════════════')
    console.log(`  Overall: ${avg(evaluations)}/100  (${evaluations.length} reports)`)
    console.log(`  Best:    ${best(evaluations).total}/100 — ${best(evaluations).report}`)
    console.log(`  Worst:   ${worst(evaluations).total}/100 — ${worst(evaluations).report}`)
    console.log('═══════════════════════════════════════\n')

    for (const ev of evaluations) {
      console.log(`  ${ev.report}: ${ev.total}/100 [${ev.improvementPriority}]`)
      for (const [dim, data] of Object.entries(ev.dimensions)) {
        const bar = '█'.repeat(Math.floor(data.score / 10)) + '░'.repeat(Math.max(0, 10 - Math.floor(data.score / 10)))
        console.log(`    ${dim.padEnd(10)} ${bar} ${data.score}/100`)
      }
      console.log()
    }

    if (isDeep || evaluations.length > 2) {
      const improvements = generateImprovementPlan(evaluations)
      console.log(`\n📋 Top Improvements Needed:\n`)
      improvements.slice(0, 10).forEach((imp, i) => {
        console.log(`  ${i + 1}. [${imp.severity.toUpperCase()}] (×${imp.count}) ${imp.issue}`)
        if (imp.dimensions.length) console.log(`     Affects: ${imp.dimensions.join(', ')}`)
      })

      // Save evaluation
      if (!isDryRun) {
        const evalFile = join(AUTOLEARN_DIR, `evaluation-${new Date().toISOString().slice(0, 10)}.json`)
        const improvementsFile = join(AUTOLEARN_DIR, `improvements-${new Date().toISOString().slice(0, 10)}.md`)

        writeFileSync(evalFile, JSON.stringify({
          generated: new Date().toISOString(),
          reportsExamined: reports.length,
          days,
          averageScore: avg(evaluations),
          evaluations,
          improvements,
        }, null, 2), 'utf-8')

        writeFileSync(improvementsFile, [
          `# Improvement Plan — ${new Date().toISOString().slice(0, 10)}`,
          '',
          `**Score:** ${avg(evaluations)}/100 over ${reports.length} reports`,
          '',
          '## Priority Items',
          ...improvements.slice(0, 15).map((imp, i) =>
            `- [${imp.severity.toUpperCase()}] **${imp.issue}** (×${imp.count}, ${imp.spread} reports)`
          ),
          '',
          '## Dimension Breakdown',
          ...['lang', 'writing', 'accuracy', 'breaking', 'ui', 'value'].map(d => {
            const avgScore = Math.round(evaluations.reduce((s, e) => s + e.dimensions[d]?.score || 0, 0) / evaluations.length)
            const avgIssues = Math.round(evaluations.reduce((s, e) => s + (e.dimensions[d]?.issues?.length || 0), 0) / evaluations.length)
            return `- **${d}:** avg ${avgScore}/100 (${avgIssues} avg issues)`
          }),
          '',
          `## Reports Evaluated`,
          ...evaluations.map(e => `- ${e.report}: ${e.total}/100 [${e.improvementPriority}]`),
          '',
          `_Generated by autolearn-improver.js_`,
        ].join('\n'), 'utf-8')

        console.log(`\n💾 Saved: ${evalFile}`)
        console.log(`💾 Saved: ${improvementsFile}`)
      }
    }
  }

  if (args.includes('--status')) {
    const evalsDir = AUTOLEARN_DIR
    if (!existsSync(evalsDir)) {
      console.log('No evaluations yet. Run --evaluate first.')
      return
    }
    const files = readdirSync(evalsDir).filter(f => f.startsWith('evaluation')).sort()
    if (files.length === 0) {
      console.log('No evaluations found.')
      return
    }
    const last = JSON.parse(readFileSync(join(evalsDir, files[files.length - 1]), 'utf-8'))
    console.log(`📊 Last evaluation: ${files[files.length - 1]}`)
    console.log(`   Score: ${last.averageScore}/100 over ${last.reportsExamined} reports`)
    console.log(`   Top priority: ${last.improvements?.[0]?.issue || 'none'}`)
  }
}

main().catch(console.error)
