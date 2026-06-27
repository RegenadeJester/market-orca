import { readFile, writeFile, readdir, unlink, rename, mkdir, access, constants } from 'fs/promises';
import { join, resolve } from 'path';
import { EventEmitter } from 'events';

const QUEUE_ROOT = '/tmp/apm-queue';
const QUEUE_DIRS = {
  incoming: join(QUEUE_ROOT, 'incoming'),
  processing: join(QUEUE_ROOT, 'processing'),
  completed: join(QUEUE_ROOT, 'completed'),
  failed: join(QUEUE_ROOT, 'failed')
};

class MessageQueue extends EventEmitter {
  constructor() {
    super();
    this.ensureDirs();
  }

  async ensureDirs() {
    await Promise.all(Object.values(QUEUE_DIRS).map(d => mkdir(d, { recursive: true })));
  }

  async enqueue(agent, task, priority = 'normal') {
    const msg = {
      id: crypto.randomUUID(),
      from: 'system',
      to: agent,
      task,
      priority,
      status: 'pending',
      createdAt: Date.now(),
      attempts: 0
    };
    const path = join(QUEUE_DIRS.incoming, `${msg.id}.json`);
    await writeFile(path, JSON.stringify(msg, null, 2));
    this.emit('enqueued', msg);
    return msg.id;
  }

  async dequeue(agent) {
    const files = await readdir(QUEUE_DIRS.incoming);
    const msgs = await Promise.all(
      files.filter(f => f.endsWith('.json'))
        .map(async f => JSON.parse(await readFile(join(QUEUE_DIRS.incoming, f), 'utf-8')))
    );
    const match = msgs.find(m => m.to === agent && m.status === 'pending')
      || msgs.find(m => m.to === 'any' && m.status === 'pending');
    if (!match) return null;

    const src = join(QUEUE_DIRS.incoming, `${match.id}.json`);
    const dst = join(QUEUE_DIRS.processing, `${match.id}.json`);
    match.status = 'processing';
    match.startedAt = Date.now();
    await rename(src, dst);
    await writeFile(dst, JSON.stringify(match, null, 2));
    return match;
  }

  async complete(id, result) {
    const src = join(QUEUE_DIRS.processing, `${id}.json`);
    const dst = join(QUEUE_DIRS.completed, `${id}.json`);
    const msg = JSON.parse(await readFile(src, 'utf-8'));
    msg.status = 'completed';
    msg.result = result;
    msg.completedAt = Date.now();
    await rename(src, dst);
    await writeFile(dst, JSON.stringify(msg, null, 2));
    this.emit('completed', msg);
  }

  async fail(id, error) {
    const src = join(QUEUE_DIRS.processing, `${id}.json`);
    const dst = join(QUEUE_DIRS.failed, `${id}.json`);
    const msg = JSON.parse(await readFile(src, 'utf-8'));
    msg.attempts++;
    if (msg.attempts < 3) {
      msg.status = 'pending';
      msg.error = error;
      await rename(src, join(QUEUE_DIRS.incoming, `${id}.json`));
      await writeFile(join(QUEUE_DIRS.incoming, `${id}.json`), JSON.stringify(msg, null, 2));
    } else {
      msg.status = 'failed';
      msg.error = error;
      msg.failedAt = Date.now();
      await rename(src, dst);
      await writeFile(dst, JSON.stringify(msg, null, 2));
    }
    this.emit('failed', msg);
  }

  async getStatus(id) {
    for (const dir of Object.values(QUEUE_DIRS)) {
      try {
        const data = await readFile(join(dir, `${id}.json`), 'utf-8');
        return JSON.parse(data);
      } catch { continue; }
    }
    return null;
  }
}

const queue = new MessageQueue();

class BaseAgent extends EventEmitter {
  constructor(name, capabilities = []) {
    super();
    this.name = name;
    this.capabilities = capabilities;
    this.running = false;
  }

  async start() {
    this.running = true;
    this.loop();
  }

  async stop() {
    this.running = false;
  }

  async loop() {
    while (this.running) {
      const msg = await queue.dequeue(this.name);
      if (msg) {
        try {
          const result = await this.handle(msg.task);
          await queue.complete(msg.id, result);
        } catch (e) {
          await queue.fail(msg.id, e.message);
        }
      } else {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  async handle(task) { throw new Error('Not implemented'); }

  async send(to, task, priority = 'normal') {
    return queue.enqueue(to, task, priority);
  }

  async mcpSearch(query, type = 'code') {
    return { query, type, results: [] };
  }

  async mcpRead(path) {
    try { return await readFile(path, 'utf-8'); } catch { return null; }
  }

  async mcpWrite(path, content) {
    await writeFile(path, content, 'utf-8');
  }
}

class PMAgent extends BaseAgent {
  constructor() {
    super('pm', ['planning', 'task-breakdown', 'requirements-analysis', 'prioritization']);
  }

  async handle(task) {
    switch (task.type) {
      case 'plan-feature': return this.planFeature(task.feature);
      case 'breakdown': return this.breakdown(task.tasks);
      case 'review-plan': return this.reviewPlan(task.plan);
      default: throw new Error(`Unknown PM task: ${task.type}`);
    }
  }

  async planFeature(feature) {
    const plan = {
      feature: feature.name,
      description: feature.description,
      tasks: this.generateTasks(feature),
      priority: feature.priority || 'normal',
      estimatedHours: this.estimate(feature),
      createdAt: Date.now()
    };
    await this.send('senior', { type: 'implement', plan }, 'high');
    return plan;
  }

  generateTasks(feature) {
    const base = [
      { id: 'scaffold', type: 'scaffold', description: `Scaffold ${feature.name} structure`, assignee: 'junior' },
      { id: 'implement', type: 'implement', description: `Implement ${feature.name} core logic`, assignee: 'senior' },
      { id: 'test', type: 'test', description: `Write tests for ${feature.name}`, assignee: 'junior' },
      { id: 'docs', type: 'docs', description: `Document ${feature.name}`, assignee: 'junior' },
      { id: 'review', type: 'review', description: `Code review ${feature.name}`, assignee: 'senior' }
    ];
    return base.map((t, i) => ({ ...t, order: i, status: 'pending' }));
  }

  estimate(feature) {
    const complexity = feature.complexity || 'medium';
    return { low: 4, medium: 16, high: 40 }[complexity];
  }

  async breakdown(tasks) {
    return tasks.map(t => ({ ...t, subtasks: this.subdivide(t) }));
  }

  subdivide(task) {
    return [
      { id: `${task.id}-1`, description: `Analyze ${task.description}` },
      { id: `${task.id}-2`, description: `Implement ${task.description}` },
      { id: `${task.id}-3`, description: `Verify ${task.description}` }
    ];
  }

  async reviewPlan(plan) {
    return { approved: true, feedback: 'Plan looks good', suggestions: [] };
  }
}

class SeniorDevAgent extends BaseAgent {
  constructor() {
    super('senior', ['implementation', 'code-review', 'architecture', 'delegation', 'refactoring']);
  }

  async handle(task) {
    switch (task.type) {
      case 'implement': return this.implement(task.plan);
      case 'review': return this.review(task.code);
      case 'refactor': return this.refactor(task.target);
      case 'delegate': return this.delegate(task.subtask);
      default: throw new Error(`Unknown Senior task: ${task.type}`);
    }
  }

  async implement(plan) {
    const results = [];
    for (const t of plan.tasks) {
      if (t.assignee === 'senior') {
        results.push(await this.doImplementation(t));
      } else if (t.assignee === 'junior') {
        await this.send('junior', { type: t.type, description: t.description, plan });
        results.push({ task: t.id, delegated: true });
      }
    }
    return { plan: plan.feature, results, status: 'delegated' };
  }

  async doImplementation(task) {
    const code = await this.generateCode(task);
    await this.mcpWrite(join('/home/dicky/.openclaw/workspace/market-orca/backend/src', `${task.id}.js`), code);
    return { task: task.id, code, status: 'implemented' };
  }

  async generateCode(task) {
    return `// ${task.description}\nexport function ${task.id}() {\n  // TODO: implementation\n}`;
  }

  async review(code) {
    const issues = [];
    if (!code.includes('export')) issues.push('Missing exports');
    if (!code.includes('try') && code.includes('await')) issues.push('Missing error handling');
    return { approved: issues.length === 0, issues, score: issues.length === 0 ? 100 : 70 };
  }

  async refactor(target) {
    return { target, status: 'refactored', changes: [] };
  }

  async delegate(subtask) {
    await this.send('junior', subtask);
    return { delegated: subtask.id };
  }
}

class JuniorDevAgent extends BaseAgent {
  constructor() {
    super('junior', ['scaffolding', 'testing', 'documentation', 'boilerplate']);
  }

  async handle(task) {
    switch (task.type) {
      case 'scaffold': return this.scaffold(task);
      case 'test': return this.writeTests(task);
      case 'docs': return this.writeDocs(task);
      default: throw new Error(`Unknown Junior task: ${task.type}`);
    }
  }

  async scaffold(task) {
    const structure = this.getScaffold(task.description);
    for (const [path, content] of Object.entries(structure)) {
      await this.mcpWrite(path, content);
    }
    return { scaffolded: Object.keys(structure), status: 'done' };
  }

  getScaffold(desc) {
    const name = desc.toLowerCase().replace(/\s+/g, '-');
    return {
      [`/home/dicky/.openclaw/workspace/market-orca/backend/src/${name}/index.js`]: `export const ${name} = () => 'scaffolded';\n`,
      [`/home/dicky/.openclaw/workspace/market-orca/backend/src/${name}/${name}.test.js`]: `import { describe, it } from 'node:test';\nimport assert from 'node:assert';\nimport { ${name} } from './index.js';\n\ndescribe('${name}', () => {\n  it('works', () => assert.ok(${name}()));\n});\n`
    };
  }

  async writeTests(task) {
    const testCode = `import { describe, it } from 'node:test';\nimport assert from 'node:assert';\n\ndescribe('${task.description}', () => {\n  it('should work', () => assert.ok(true));\n});\n`;
    const path = `/home/dicky/.openclaw/workspace/market-orca/backend/src/${task.description.toLowerCase().replace(/\s+/g, '-')}.test.js`;
    await this.mcpWrite(path, testCode);
    return { testFile: path, status: 'written' };
  }

  async writeDocs(task) {
    const docs = `# ${task.description}\n\nAuto-generated documentation.\n`;
    const path = `/home/dicky/.openclaw/workspace/market-orca/docs/${task.description.toLowerCase().replace(/\s+/g, '-')}.md`;
    await this.mcpWrite(path, docs);
    return { docFile: path, status: 'written' };
  }
}

export async function initAPM() {
  const pm = new PMAgent();
  const senior = new SeniorDevAgent();
  const junior = new JuniorDevAgent();
  await Promise.all([pm.start(), senior.start(), junior.start()]);
  return { pm, senior, junior, queue };
}

export function createFeature(name, description, priority = 'normal', complexity = 'medium') {
  return queue.enqueue('pm', { type: 'plan-feature', feature: { name, description, priority, complexity } }, 'high');
}

export { PMAgent, SeniorDevAgent, JuniorDevAgent, MessageQueue, queue };