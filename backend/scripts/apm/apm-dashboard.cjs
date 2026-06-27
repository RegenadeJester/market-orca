/**
 * APM Dashboard Parser — CJS module for report-server.js
 * Parses MMd.md feature log into structured stats
 * 
 * Handles format: ## YYYY-MM-DD — Feature #N: Title
 * Multiple features per date are delimited by "- **Pain point:**" blocks
 */
const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..', '..');
const MMd_PATH = path.resolve(BACKEND, '..', 'MMd.md');

function readLines() {
  if (!fs.existsSync(MMd_PATH)) return [];
  const content = fs.readFileSync(MMd_PATH, 'utf8');
  return content.split('\n');
}

function parseFeatures() {
  const lines = readLines();
  if (!lines.length) return [];

  const features = [];
  let currentDate = null;
  let currentFeature = null;
  let inFeature = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Date header: ## YYYY-MM-DD — Feature #N: Title
    const dateMatch = line.match(/^##\s*(\d{4}-\d{2}-\d{2})\s*[—–-]?\s*(?:(?:Feature\s*#?(\d+))?[:\s]*)?(.+)?$/);
    if (dateMatch) {
      // Save previous feature
      if (currentFeature) features.push(currentFeature);

      currentDate = dateMatch[1];
      currentFeature = {
        date: currentDate,
        number: dateMatch[2] ? parseInt(dateMatch[2]) : null,
        title: (dateMatch[3] || 'Untitled').trim(),
        painPoints: [],
        files: [],
        deliverables: [],
        branch: null,
        pr: null,
        agents: {},
        sections: []
      };
      inFeature = true;
      continue;
    }

    if (!inFeature || !currentFeature) continue;

    // Branch: `feat/xxx` → PR #N ✅ merged
    const branchMatch = line.match(/`?(\S+?)`?\s*→\s*PR\s*#?(\d+)/);
    if (branchMatch && !line.match(/^- `/)) {
      currentFeature.branch = branchMatch[1].trim();
      currentFeature.pr = parseInt(branchMatch[2]);
      continue;
    }

    // Files:
    const filesMatch = line.match(/^\s*-\s*\*\*Files?:?\*\*\s*`?(.+?)`?$/);
    if (filesMatch) {
      currentFeature.files.push(
        ...filesMatch[1].split(',').map(f => f.trim().replace(/`/g, ''))
      );
      continue;
    }

    // Pain point:
    const painMatch = line.match(/^\s*-\s*\*\*Pain point:\*\*\s*(.+)/);
    if (painMatch) {
      currentFeature.painPoints.push(painMatch[1]);
      continue;
    }

    // Deliverable:
    const delMatch = line.match(/^\s*-\s*\*\*Deliverable:\*\*\s*(.+)/);
    if (delMatch) {
      currentFeature.deliverables.push(delMatch[1]);
      continue;
    }

    // Branch: (standalone)
    const branchOnly = line.match(/^\s*-\s*\*\*Branch:\*\*\s*`?(\S+?)`?/);
    if (branchOnly && !currentFeature.branch) {
      currentFeature.branch = branchOnly[1].trim();
      continue;
    }

    // Section headers inside feature
    const subSection = line.match(/^\s*##\s+/);
    if (subSection) {
      currentFeature = null;
      inFeature = false;
    }
  }

  // Save last feature
  if (currentFeature) features.push(currentFeature);

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
  const filesSet = new Set();
  features.filter(f => f.files).forEach(f => (f.files || []).forEach(ff => filesSet.add(ff.replace(/`/g, ''))));
  const totalFiles = filesSet.size;
  const totalBranches = features.filter(f => f.branch).length;
  const totalPRs = features.filter(f => f.pr).length;

  const dailyCounts = {};
  for (const f of features) {
    dailyCounts[f.date] = (dailyCounts[f.date] || 0) + 1;
  }

  const agentCount = { pm: 0, arch: 0, dev: 0, qa: 0, review: 0 };

  return {
    totalFeatures: features.length,
    totalFiles,
    totalBranches,
    totalPRs,
    uniqueDates: dates.length,
    dateRange: dates.length >= 2 ? `${dates[0]} → ${dates[dates.length - 1]}` : dates[0] || 'unknown',
    dailyAverage: dates.length ? (features.length / dates.length).toFixed(1) : '0',
    dailyCounts,
    agentParticipation: agentCount,
    featuresByDate: dates.map(d => ({
      date: d,
      count: dailyCounts[d] || 0,
      features: features.filter(f => f.date === d).map(f => ({ number: f.number, title: f.title, branch: f.branch, pr: f.pr }))
    }))
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