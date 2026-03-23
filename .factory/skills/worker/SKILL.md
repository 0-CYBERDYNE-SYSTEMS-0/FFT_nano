---
name: worker
description: General purpose worker for OSS release readiness tasks
---

# Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

All features in this mission use this worker type.

## Required Skills

None required - all verification is CLI-based.

## Work Procedure

### For each assigned feature:

1. **Read the feature description** from features.json
2. **Verify preconditions** are met before starting
3. **Execute the verification steps** as specified
4. **Run the verification commands** and capture output
5. **Update validation-state.json** with pass/fail for each assertion

### Backup Feature (backup-old-repo):

```bash
git clone --mirror https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git ~/fft_nano_backup.git
ls -la ~/fft_nano_backup.git
```

### Force Push Feature (force-push-clean-state):

```bash
git push --force origin main
git log --oneline origin/main
```

### Verification Features:

Always run the specified verification commands and report results.

### Final Verification (final-verification):

```bash
# Fresh clone test
cd /tmp
rm -rf fft_nano_fresh_test
git clone https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git fft_nano_fresh_test
cd fft_nano_fresh_test
npm install
npm run secret-scan
npm test
npm run release-check
```

## Example Handoff

```json
{
  "salientSummary": "Completed backup of old repo to ~/fft_nano_backup.git (mirror clone successful). Force pushed clean state to origin/main. Remote now shows limited clean history.",
  "whatWasImplemented": "Mirror backup created at ~/fft_nano_backup.git. Force push completed.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "git clone --mirror https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git ~/fft_nano_backup.git", "exitCode": 0, "observation": "Mirror created successfully"},
      {"command": "git push --force origin main", "exitCode": 0, "observation": "Force push succeeded"}
    ],
    "interactiveChecks": []
  },
  "tests": {"added": []},
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- If backup fails
- If force push fails
- If verification commands fail
- If any assertions cannot be verified
