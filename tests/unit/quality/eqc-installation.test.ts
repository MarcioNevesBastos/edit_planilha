import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const agentsDirectory = join(root, '.github', 'agents');

const workerDefinitions = {
  'eqc-context-architect.agent.md': ['read', 'search'],
  'eqc-complexity-reviewer.agent.md': ['read', 'search', 'execute'],
  'eqc-implementer.agent.md': ['read', 'search', 'edit', 'execute'],
  'eqc-test-engineer.agent.md': ['read', 'search', 'edit', 'execute'],
  'eqc-security-auditor.agent.md': ['read', 'search', 'execute'],
  'eqc-adversarial-reviewer.agent.md': ['read', 'search', 'execute'],
  'eqc-final-evaluator.agent.md': ['read', 'search', 'execute'],
} as const;

function readAgent(name: string): string {
  return readFileSync(join(agentsDirectory, name), 'utf8');
}

function frontmatterValue(content: string, key: string): string {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

describe('EQC installation', () => {
  it('creates the complete agent topology with least-privilege tools', () => {
    const controller = readAgent('engineering-quality-controller.agent.md');

    expect(frontmatterValue(controller, 'name')).toBe('Engineering Quality Controller');
    expect(frontmatterValue(controller, 'user-invocable')).toBe('true');
    expect(frontmatterValue(controller, 'tools')).toContain('agent');
    expect(frontmatterValue(controller, 'tools')).not.toContain('edit');
    for (const name of [
      'EQC Context Architect',
      'EQC Complexity Reviewer',
      'EQC Implementer',
      'EQC Test Engineer',
      'EQC Security Auditor',
      'EQC Adversarial Reviewer',
      'EQC Final Evaluator',
    ]) {
      expect(controller).toContain(`  - ${name}`);
    }

    for (const [filename, tools] of Object.entries(workerDefinitions)) {
      const content = readAgent(filename);
      expect(frontmatterValue(content, 'user-invocable')).toBe('false');
      expect(frontmatterValue(content, 'disable-model-invocation')).toBe('true');
      expect(frontmatterValue(content, 'tools').replaceAll("'", '')).toBe(`[${tools.join(', ')}]`);
      expect(frontmatterValue(content, 'tools')).not.toContain('agent');
    }
  });

  it('configures real project commands without mandatory placeholders', () => {
    const configPath = join(root, '.github', 'quality', 'quality-gate.config.md');
    const config = readFileSync(configPath, 'utf8');

    expect(config).toContain('`npm run build`');
    expect(config).toContain('`npm run typecheck`');
    expect(config).toContain('`npm test`');
    expect(config).toContain('`npm run test:coverage`');
    expect(config).not.toMatch(/<comando real>/);
    expect(config).not.toMatch(/TBD|TODO/);
  });

  it('provides executable quality gate scripts and stop hook support', () => {
    const requiredFiles = [
      '.github/quality/run-quality-gate.sh',
      '.github/quality/run-quality-gate.ps1',
      '.github/quality/stop-quality-gate.sh',
      '.github/quality/stop-quality-gate.ps1',
      '.github/hooks/eqc-quality-gate.json',
      '.github/copilot-instructions.md',
    ];

    for (const path of requiredFiles) {
      expect(existsSync(join(root, path))).toBe(true);
    }
  });
});
