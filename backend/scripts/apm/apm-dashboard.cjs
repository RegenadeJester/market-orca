/**
 * APM Dashboard Parser — CJS module for report-server.js
 * Parses MMd.md feature log into structured stats
 */
const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..');
const MMd_PATH = path.resolve(BACKEND, 'MMd.md');

function parseFeatures() {
  if (!fs.existsSync(MMd_PATH)) return [];
  const content = fs.readFileSync(MMd_PATH, 'utf8');
  const features = [];
  const dateSections = content.split(/^## (\d{4}-\d{2}-\d{2}) — Feature #(\d+): (.+)$/m);
  
  for (let i = 1; i < dateSections.length; i += 4) {
    const date = dateSections[i];
    const num = dateSections[i + 1];
    const title = dateSections[i + 2];
    const body = dateSections[i + 3] || '';
    
    const branchMatch = body.match(/Branch:\s*`?(\S+)`?/);
    const prMatch = body.match(/PR #(\d+)/);
    const filesMatch = body.match(/Files:\s*`?([^`]+)`?/);
    const agentsMatch = body.match(/Agents:\s*(.+)/);
    
    features.push({
      date,
      number: parseInt(num),
      title: title.trim(),
      branch: branchMatch ? branchMatch[1].replace(/→.*$/, '').trim() : null,
      pr: prMatch ? parseInt(prMatch[1]) : null,
      files: filesMatch ? filesMatch[1].split(',').map(f => f.trim().replace(/`/g, '')) : [],
      agents: agentsMatch ? parseAgents(agentsMatch[1]) : {}
    });
  }
  return features;
}

function parseAgents(str) {
  const agents = { pm: false, arch: false, dev: false, qa: false, review: false };
  const roles = ['PM', 'Arch', 'Dev', 'QA', 'Review'];
  const keys = ['pm', 'arch', 'dev', 'qa', 'review'];
  for (let i = 0; i < roles.length; i++) {
    if (new RegExp(`\\b${roles[i]}\\s*:\\s*\\w+`).test(str)) {
      agents[keys[i]] = true;
    }
  }
  return agents;
}

function calculateStats(features) {
  if (!features.length) {
    return { totalFeatures: 0, totalFiles: 0, totalBranches: 0, totalPRs: 0, uniqueDates: 0, dailyAverage: '0', dailyCounts: {}, agentParticipation: { pm: 0, arch: 0, dev: 0, qa: 0, review: 0 } };
  }
  
  const dates = [...new Set(features.map(f => f.date))].sort();
  const totalFiles = new Set(features.flatMap(f => f.files || [])).size;
  const totalBranches = features.filter(f => f.branch).length;
  const totalPRs = features.filter(f => f.pr).length;
  
  const dailyCounts = {};
  for (const f of features) {
    dailyCounts[f.date] = (dailyCounts[f.date] || 0) + 1;
  }
  
  const agentCount = { pm: 0, arch: 0, dev: 0, qa: 0, review: 0 };
  for (const f of features) {
    for (const [role, val] of Object.entries(f.agents || {})) {
      if (val) agentCount[role]++;
    }
  }
  
  return {
    totalFeatures: features.length,
    totalFiles,
    totalBranches,
    totalPRs,
    uniqueDates: dates.length,
    dateRange: dates.length >= 2 ? `${dates[0]} → ${dates[dates.length - 1]}` : dates[0] || 'unknown',
    dailyAverage: (features.length / dates.length).toFixed(1),
    dailyCounts,
    agentParticipation: agentCount
  };
}

function main() {
  const features = parseFeatures();
  const stats = calculateStats(features);
  console.log(JSON.stringify({ features, stats }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = { parseFeatures, calculateStats };