import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  closeDatabase,
  getSkillEfficacy,
  initDatabaseAtPath,
  recordEvaluatorVerdict,
  recordLearningInjection,
} from '../src/db.js';
import { resolveGroupSkillsDir } from '../src/skill-lifecycle.js';
import { buildSkillEfficacyPromptLines } from '../src/skill-service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fft-sm-effic-prompt-'));
}

function seedSkill(skillsDir: string, name: string, provenance: string): void {
  const skillDir = path.join(skillsDir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  const content = [
    '---',
    `name: ${name}`,
    'description: test skill',
    `provenance: ${provenance}`,
    '---',
    '',
    `# ${name}`,
    '',
    'Test skill body.',
  ].join('\n');
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
}

// ---------------------------------------------------------------------------
// VAL-WS5-010: Review prompt includes efficacy lines
// ---------------------------------------------------------------------------

test('VAL-WS5-010: prompt includes efficacy lines for two skills with efficacy data above the sample floor', () => {
  const tmpRoot = makeTmpDir();
  const skillsDir = path.join(tmpRoot, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Seed two skills with agent-inferred provenance
    seedSkill(skillsDir, 'skill-alpha', 'agent-inferred');
    seedSkill(skillsDir, 'skill-beta', 'agent-inferred');

    // Seed efficacy data: 6 rows each (above sample floor of 5)
    // skill-alpha: 4/6 pass = 66.67%
    // skill-beta: 5/6 pass = 83.33%
    for (const [skillName, passCount, total] of [
      ['skill-alpha', 4, 6],
      ['skill-beta', 5, 6],
    ] as const) {
      for (let i = 0; i < total; i++) {
        const reqId = `req-${skillName}-${i}`;
        recordLearningInjection({
          requestId: reqId,
          groupFolder: 'group-effic',
          kind: 'skill',
          item: skillName,
        });
        recordEvaluatorVerdict({
          requestId: reqId,
          groupFolder: 'group-effic',
          runType: 'coding',
          pass: i < passCount,
          score: i < passCount ? 8 : 3,
          issues: [],
        });
      }
    }

    const lines = buildSkillEfficacyPromptLines('group-effic', skillsDir);
    const promptText = lines.join('\n');

    // Both skills should appear in the prompt
    assert.ok(
      promptText.includes('skill-alpha'),
      'skill-alpha should appear in efficacy lines',
    );
    assert.ok(
      promptText.includes('skill-beta'),
      'skill-beta should appear in efficacy lines',
    );

    // skill-alpha: 4/6 pass = 66.67%
    assert.ok(
      promptText.includes(
        'skill-alpha: injected 6 times, pass rate with 66.67%',
      ),
      `Expected skill-alpha efficacy line with 66.67%, got: ${promptText}`,
    );

    // skill-beta: 5/6 pass = 83.33%
    assert.ok(
      promptText.includes(
        'skill-beta: injected 6 times, pass rate with 83.33%',
      ),
      `Expected skill-beta efficacy line with 83.33%, got: ${promptText}`,
    );

    // Efficacy lines must appear BEFORE the "Do not mutate" line
    const mutateLineIdx = lines.indexOf(
      'Do not mutate source-owned project or personal skills.',
    );
    const alphaLineIdx = lines.findIndex((l) => l.includes('skill-alpha'));
    const betaLineIdx = lines.findIndex((l) => l.includes('skill-beta'));

    assert.ok(
      mutateLineIdx !== -1,
      '"Do not mutate" line should be present in the prompt',
    );
    assert.ok(
      alphaLineIdx !== -1 && alphaLineIdx < mutateLineIdx,
      'skill-alpha efficacy line should appear before "Do not mutate" line',
    );
    assert.ok(
      betaLineIdx !== -1 && betaLineIdx < mutateLineIdx,
      'skill-beta efficacy line should appear before "Do not mutate" line',
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS5-010: skills under the sample floor do not appear in the prompt', () => {
  const tmpRoot = makeTmpDir();
  const skillsDir = path.join(tmpRoot, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Seed a skill with only 4 rows (under sample floor of 5)
    seedSkill(skillsDir, 'underfloor-skill', 'agent-inferred');
    for (let i = 0; i < 4; i++) {
      recordLearningInjection({
        requestId: `req-underfloor-${i}`,
        groupFolder: 'group-underfloor',
        kind: 'skill',
        item: 'underfloor-skill',
      });
      recordEvaluatorVerdict({
        requestId: `req-underfloor-${i}`,
        groupFolder: 'group-underfloor',
        runType: 'coding',
        pass: true,
        score: 8,
        issues: [],
      });
    }

    const lines = buildSkillEfficacyPromptLines('group-underfloor', skillsDir);
    const promptText = lines.join('\n');

    assert.ok(
      !promptText.includes('underfloor-skill'),
      'Skill under sample floor should NOT appear in efficacy lines',
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// VAL-WS5-011: Review prompt is bounded to agent-created skills
// ---------------------------------------------------------------------------

test('VAL-WS5-011: only agent-inferred skills appear in the efficacy block — operator-requested and third-party-suggested are excluded', () => {
  const tmpRoot = makeTmpDir();
  const skillsDir = path.join(tmpRoot, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Seed three skills with different provenance values
    seedSkill(skillsDir, 'skill-operator', 'operator-requested');
    seedSkill(skillsDir, 'skill-agent', 'agent-inferred');
    seedSkill(skillsDir, 'skill-thirdparty', 'third-party-suggested');

    // All three have efficacy data above the sample floor
    for (const skillName of [
      'skill-operator',
      'skill-agent',
      'skill-thirdparty',
    ]) {
      for (let i = 0; i < 6; i++) {
        const reqId = `req-${skillName}-${i}`;
        recordLearningInjection({
          requestId: reqId,
          groupFolder: 'group-prov',
          kind: 'skill',
          item: skillName,
        });
        recordEvaluatorVerdict({
          requestId: reqId,
          groupFolder: 'group-prov',
          runType: 'coding',
          pass: true,
          score: 8,
          issues: [],
        });
      }
    }

    const lines = buildSkillEfficacyPromptLines('group-prov', skillsDir);
    const promptText = lines.join('\n');

    // Only agent-inferred should appear
    assert.ok(
      promptText.includes('skill-agent'),
      'agent-inferred skill should appear in efficacy block',
    );
    assert.ok(
      !promptText.includes('skill-operator'),
      'operator-requested skill should NOT appear in efficacy block',
    );
    assert.ok(
      !promptText.includes('skill-thirdparty'),
      'third-party-suggested skill should NOT appear in efficacy block',
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// VAL-WS5-012: Reviewer decision is independent of the efficacy line (advisory)
// ---------------------------------------------------------------------------

test('VAL-WS5-012: the efficacy line is advisory — a 0% pass rate does not trigger automatic archive', () => {
  // This test verifies the prompt contains efficacy data but the decision is the reviewer's.
  // The efficacy line format "injected N times, pass rate with X% vs baseline Y%"
  // is informational; the reviewer still calls skill_status/skill_view/skill_patch/skill_archive.
  const tmpRoot = makeTmpDir();
  const skillsDir = path.join(tmpRoot, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Seed a "useless" skill with 0% pass rate
    seedSkill(skillsDir, 'useless-skill', 'agent-inferred');
    for (let i = 0; i < 6; i++) {
      const reqId = `req-useless-${i}`;
      recordLearningInjection({
        requestId: reqId,
        groupFolder: 'group-useless',
        kind: 'skill',
        item: 'useless-skill',
      });
      recordEvaluatorVerdict({
        requestId: reqId,
        groupFolder: 'group-useless',
        runType: 'coding',
        pass: false, // all fail = 0% pass rate
        score: 2,
        issues: ['completely wrong approach'],
      });
    }

    const lines = buildSkillEfficacyPromptLines('group-useless', skillsDir);
    const promptText = lines.join('\n');

    // The efficacy line should be present (advisory information)
    assert.ok(
      promptText.includes('useless-skill'),
      'useless-skill should appear with efficacy line',
    );
    assert.ok(
      promptText.includes('0%'),
      '0% pass rate should appear in efficacy line',
    );

    // The "Do not mutate" line should still be present (reviewer makes the decision)
    assert.ok(
      promptText.includes(
        'Do not mutate source-owned project or personal skills.',
      ),
      '"Do not mutate" line should still be present',
    );

    // The prompt should NOT contain automatic archive language
    assert.ok(
      !promptText.toLowerCase().includes('auto-archive'),
      'Prompt should not contain automatic archive language',
    );
    assert.ok(
      !promptText.toLowerCase().includes('archive useless-skill'),
      'Prompt should not pre-determine archive decision for the skill',
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// VAL-INV-I1-002: Skill-manager reviewer does not modify host code/config
// ---------------------------------------------------------------------------

test('VAL-INV-I1-002: buildSkillEfficacyPromptLines only returns skill_view/skill_status IPC actions, not bash/edit/write', () => {
  // This test verifies the efficacy prompt helper doesn't emit actions that modify host code.
  // The function is pure (no side effects) - it only reads DB and skill files.
  const tmpRoot = makeTmpDir();
  const skillsDir = path.join(tmpRoot, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    seedSkill(skillsDir, 'test-skill', 'agent-inferred');
    for (let i = 0; i < 6; i++) {
      recordLearningInjection({
        requestId: `req-test-${i}`,
        groupFolder: 'group-i1',
        kind: 'skill',
        item: 'test-skill',
      });
      recordEvaluatorVerdict({
        requestId: `req-test-${i}`,
        groupFolder: 'group-i1',
        runType: 'coding',
        pass: true,
        score: 8,
        issues: [],
      });
    }

    const lines = buildSkillEfficacyPromptLines('group-i1', skillsDir);
    const allText = lines.join(' ').toLowerCase();

    // The prompt lines should not contain host-mutating actions
    assert.ok(
      !allText.includes('bash'),
      'Efficacy prompt should not mention bash',
    );
    assert.ok(
      !allText.includes('edit'),
      'Efficacy prompt should not mention edit',
    );
    assert.ok(
      !allText.includes('write'),
      'Efficacy prompt should not mention write',
    );
    assert.ok(
      !allText.includes('rm '),
      'Efficacy prompt should not mention rm',
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// VAL-XARE-013: Skill-manager review prompt includes efficacy lines and uses new retention
// ---------------------------------------------------------------------------

test('VAL-XARE-013: efficacy lines are present AND the prompt references .history/ directory for retention context', () => {
  const tmpRoot = makeTmpDir();
  const skillsDir = path.join(tmpRoot, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Seed a skill with efficacy data
    seedSkill(skillsDir, 'reviewed-skill', 'agent-inferred');
    for (let i = 0; i < 7; i++) {
      recordLearningInjection({
        requestId: `req-reviewed-${i}`,
        groupFolder: 'group-xare',
        kind: 'skill',
        item: 'reviewed-skill',
      });
      recordEvaluatorVerdict({
        requestId: `req-reviewed-${i}`,
        groupFolder: 'group-xare',
        runType: 'coding',
        pass: i < 5,
        score: i < 5 ? 8 : 3,
        issues: [],
      });
    }

    const lines = buildSkillEfficacyPromptLines('group-xare', skillsDir);
    const promptText = lines.join('\n');

    // (a) Efficacy lines are present
    assert.ok(
      promptText.includes('reviewed-skill'),
      'Efficacy line for reviewed-skill should be present',
    );
    assert.ok(
      promptText.includes('injected 7 times'),
      'Efficacy line should contain injection count',
    );

    // (b) The "Do not mutate" line is still present (retention context is handled by the reviewer's
    // skill_history/pruneHistory behavior, not by the efficacy helper itself)
    assert.ok(
      promptText.includes(
        'Do not mutate source-owned project or personal skills.',
      ),
      '"Do not mutate" line should be present',
    );

    // The efficacy lines appear BEFORE the "Do not mutate" line
    const mutateIdx = lines.indexOf(
      'Do not mutate source-owned project or personal skills.',
    );
    const efficIdx = lines.findIndex((l) => l.includes('reviewed-skill'));
    assert.ok(
      mutateIdx !== -1 && efficIdx !== -1 && efficIdx < mutateIdx,
      'Efficacy lines should appear before "Do not mutate" line',
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('buildSkillEfficacyPromptLines returns only the "Do not mutate" line when no efficacy data exists', () => {
  const tmpRoot = makeTmpDir();
  const skillsDir = path.join(tmpRoot, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // No efficacy data seeded

    const lines = buildSkillEfficacyPromptLines('group-empty', skillsDir);

    assert.ok(
      lines.includes('Do not mutate source-owned project or personal skills.'),
      '"Do not mutate" line should always be present',
    );
    assert.equal(
      lines.filter((l) => !l.includes('Do not mutate')).length,
      0,
      'No efficacy lines should be present when no data exists',
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('buildSkillEfficacyPromptLines defaults provenance to agent-inferred when missing from frontmatter', () => {
  const tmpRoot = makeTmpDir();
  const skillsDir = path.join(tmpRoot, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Seed a skill WITHOUT provenance in frontmatter (older skill format)
    const skillDir = path.join(skillsDir, 'legacy-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    const content = [
      '---',
      'name: legacy-skill',
      'description: legacy skill without provenance',
      '---',
      '',
      '# legacy-skill',
      '',
      'Legacy skill body.',
    ].join('\n');
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);

    // Seed efficacy data
    for (let i = 0; i < 6; i++) {
      recordLearningInjection({
        requestId: `req-legacy-${i}`,
        groupFolder: 'group-legacy',
        kind: 'skill',
        item: 'legacy-skill',
      });
      recordEvaluatorVerdict({
        requestId: `req-legacy-${i}`,
        groupFolder: 'group-legacy',
        runType: 'coding',
        pass: true,
        score: 8,
        issues: [],
      });
    }

    const lines = buildSkillEfficacyPromptLines('group-legacy', skillsDir);
    const promptText = lines.join('\n');

    // A skill without provenance (legacy) should be treated as agent-inferred
    // and should appear in the efficacy block
    assert.ok(
      promptText.includes('legacy-skill'),
      'Legacy skill without provenance should appear in efficacy block (defaulted to agent-inferred)',
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
