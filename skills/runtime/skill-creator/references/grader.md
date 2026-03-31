# Evaluation Grader

## Overview

The grader runs after a subagent completes a task. It checks the output against the eval's assertions and produces a structured grading result.

## Grading Process

1. **Locate eval metadata**: Read `eval_metadata.json` for the eval's assertions
2. **Check each assertion**: Based on the assertion `type`, perform the check
3. **Collect evidence**: Record what was found (or not found) for each check
4. **Write results**: Save to `grading.json` with `passed`/`failed` per assertion
5. **Update benchmark**: Aggregate results into `benchmark.json`

## Assertion Checking

### file_exists
```typescript
import { existsSync } from 'fs';

function checkFileExists(assertion: { path: string }): { passed: boolean; evidence: string } {
  const exists = existsSync(assertion.path);
  return {
    passed: exists,
    evidence: exists
      ? `Found ${assertion.path} (${statSync(assertion.path).size} bytes)`
      : `File not found: ${assertion.path}`,
  };
}
```

### file_contains
```typescript
import { readFileSync } from 'fs';

function checkFileContains(assertion: { path: string; content: string[] }): { passed: boolean; evidence: string } {
  const fileContent = readFileSync(assertion.path, 'utf-8');
  const missing = assertion.content.filter(s => !fileContent.includes(s));
  return {
    passed: missing.length === 0,
    evidence: missing.length === 0
      ? `All ${assertion.content.length} strings found`
      : `Missing: ${missing.join(', ')}. Found: ${assertion.content.filter(s => fileContent.includes(s)).join(', ')}`,
  };
}
```

### output_contains
Check the subagent's stdout/output text for required strings. Same logic as `file_contains` but operates on the captured output text.

### file_not_contains
Inverse of `file_contains`. Asserts that specified strings are NOT present in the file.

### json_schema
```typescript
function checkJsonSchema(assertion: { path: string; schema: object }): { passed: boolean; evidence: string } {
  const data = JSON.parse(readFileSync(assertion.path, 'utf-8'));
  // Use ajv or similar for full schema validation
  // For basic checks, verify required keys exist
  const requiredKeys = Object.keys(assertion.schema);
  const missing = requiredKeys.filter(k => !(k in data));
  return {
    passed: missing.length === 0,
    evidence: missing.length === 0
      ? `All ${requiredKeys.length} keys present`
      : `Missing keys: ${missing.join(', ')}`,
  };
}
```

### custom
Cannot be automatically graded. Record the check description and mark as `passed: null` (requires manual review).

## Grading Output

```json
{
  "eval_id": 0,
  "eval_name": "process-csv-data",
  "configuration": "with_skill",
  "timestamp": "2024-01-15T10:30:00Z",
  "expectations": [
    {
      "text": "Output file exists",
      "passed": true,
      "evidence": "Found output/result.csv (1.2KB)"
    },
    {
      "text": "Contains required columns",
      "passed": false,
      "evidence": "Missing: profit_margin. Found: date, revenue"
    }
  ]
}
```

## Pass Rate Calculation

```typescript
function calculatePassRate(grading: GradingResult): number {
  const graded = grading.expectations.filter(e => e.passed !== null);
  if (graded.length === 0) return 0;
  return graded.filter(e => e.passed).length / graded.length;
}
```

## Benchmark Aggregation

After grading all evals for a configuration, aggregate into `benchmark.json`:

```typescript
function aggregateResults(evals: EvalResult[]): AggregateStats {
  const passRates = evals.map(e => e.pass_rate);
  const tokens = evals.map(e => e.total_tokens);
  const durations = evals.map(e => e.duration_ms);

  return {
    mean_pass_rate: mean(passRates),
    stddev_pass_rate: stddev(passRates),
    mean_tokens: mean(tokens),
    stddev_tokens: stddev(tokens),
    mean_duration_ms: mean(durations),
    stddev_duration_ms: stddev(durations),
  };
}
```

## Error Handling

- If a file assertion references a file that doesn't exist, mark as `passed: false` with evidence explaining the file was not found
- If the subagent produced no output, all `output_contains` assertions fail
- If `eval_metadata.json` is missing, skip grading and log a warning
- If `timing.json` is missing, use 0 for token counts and duration
