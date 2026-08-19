#!/usr/bin/env python3
"""skill-mechanic engine. Stdlib only; works on any Agent Skills (SKILL.md) library.

Subcommands:
  inventory  - discover skills, parse frontmatter, hash files -> manifest JSON
  validate   - spec-conformance + library-coherence findings
  measure    - token-budget report (always-loaded metadata cost, body sizes)
  scan       - security candidate findings (regex pass; model must judge)
  diff       - drift vs last saved baseline; --update writes new baseline
  decide     - record accept/suppress/fix for a finding id
  all        - inventory+validate+measure+scan+diff combined JSON

Deterministic facts only. Judgment (severity, verdicts) belongs to the agent.
"""
import argparse, hashlib, json, os, re, sys, time

STATE_DIR = os.path.expanduser(os.environ.get("SKILL_MECHANIC_STATE", "~/.skill-mechanic"))
DECISIONS = os.path.join(STATE_DIR, "decisions.jsonl")
PRUNE = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", ".next"}
AUTO_ROOTS = [
    "~/.claude/skills",
    "~/.openclaw/skills",
    "~/.openclaw/plugin-skills",
    "~/fft_nano/skills/runtime",
    "~/hermes-agent/skills",
    "./.claude/skills",
    "./skills",
]
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
KV_RE = re.compile(r"^([A-Za-z0-9_-]+):\s*(.*)$")


def unquote(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return v


def parse_frontmatter(text):
    """Tolerant YAML-subset parser: top-level scalars, one-level nested maps,
    folded multiline strings. Returns (frontmatter_dict, body_str, had_fm)."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text, False
    end = None
    for j in range(1, len(lines)):
        if lines[j].strip() == "---":
            end = j
            break
    if end is None:
        return {}, text, False
    fm, key = {}, None
    for raw in lines[1:end]:
        if not raw.strip() or raw.strip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip())
        line = raw.strip()
        if indent == 0:
            m = KV_RE.match(line)
            if m:
                key, val = m.group(1), m.group(2).strip()
                fm[key] = "" if val in ("", "|", ">", "|-", ">-") else unquote(val)
        elif key is not None:
            m = KV_RE.match(line)
            cur = fm.get(key)
            if m and (cur == "" or isinstance(cur, dict)):
                if not isinstance(cur, dict):
                    fm[key] = {}
                fm[key][m.group(1)] = unquote(m.group(2).strip())
            elif isinstance(cur, str):
                fm[key] = (cur + " " + line).strip()
    return fm, "\n".join(lines[end + 1:]), True


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def discover_roots(args):
    if args.roots:
        roots = [os.path.expanduser(r) for r in args.roots]
    else:
        roots = [os.path.expanduser(r) for r in AUTO_ROOTS]
    return [r for r in roots if os.path.isdir(r)]


def find_skills(root, max_depth=4):
    out, seen = [], set()
    base_depth = root.rstrip("/").count(os.sep)
    for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
        real = os.path.realpath(dirpath)
        if real in seen:  # symlink cycle guard
            dirnames[:] = []
            continue
        seen.add(real)
        dirnames[:] = [d for d in dirnames if d not in PRUNE and not d.startswith(".git")]
        if dirpath.count(os.sep) - base_depth >= max_depth:
            dirnames[:] = []
        if "SKILL.md" in filenames:
            out.append(dirpath)
            dirnames[:] = []  # skills don't nest inside skills
    return sorted(out)


def build_inventory(roots):
    skills = []
    for root in roots:
        for sdir in find_skills(root):
            entry = {"dir": os.path.basename(sdir), "path": sdir, "root": root,
                     "files": [], "errors": []}
            try:
                text = open(os.path.join(sdir, "SKILL.md"), encoding="utf-8", errors="replace").read()
            except OSError as e:
                entry["errors"].append(f"unreadable SKILL.md: {e}")
                skills.append(entry)
                continue
            fm, body, had_fm = parse_frontmatter(text)
            entry["frontmatter"] = fm
            entry["had_frontmatter"] = had_fm
            entry["body_lines"] = len(body.splitlines())
            entry["body_chars"] = len(body)
            for dirpath, dirnames, filenames in os.walk(sdir):
                dirnames[:] = [d for d in dirnames if d not in PRUNE]
                for fn in filenames:
                    fp = os.path.join(dirpath, fn)
                    rel = os.path.relpath(fp, sdir)
                    try:
                        entry["files"].append({"rel": rel, "size": os.path.getsize(fp),
                                               "sha256": sha256(fp)})
                    except OSError as e:
                        entry["errors"].append(f"unreadable {rel}: {e}")
            entry["files"].sort(key=lambda f: f["rel"])
            skills.append(entry)
    return {"generated": time.strftime("%Y-%m-%dT%H:%M:%S"), "roots": roots, "skills": skills}


def finding(skill, category, detail, file="SKILL.md", snippet="", line=0):
    fid = hashlib.sha1(f"{skill}|{category}|{file}|{snippet[:60] or detail[:60]}".encode()).hexdigest()[:10]
    return {"id": fid, "skill": skill, "category": category, "file": file,
            "line": line, "detail": detail, "snippet": snippet.strip()[:200]}


def load_decisions():
    out = {}
    if os.path.exists(DECISIONS):
        for ln in open(DECISIONS, encoding="utf-8"):
            ln = ln.strip()
            if ln:
                try:
                    d = json.loads(ln)
                    out[d["id"]] = d
                except (json.JSONDecodeError, KeyError):
                    pass
    return out


def apply_decisions(findings, show_all=False):
    dec = load_decisions()
    kept, suppressed = [], 0
    for f in findings:
        d = dec.get(f["id"])
        if d and d.get("status") in ("accepted", "suppressed", "fixed") and not show_all:
            suppressed += 1
        else:
            if d:
                f["decision"] = d
            kept.append(f)
    return kept, suppressed


def cmd_validate(inv, show_all=False):
    findings = []
    names = {}
    for s in inv["skills"]:
        fm = s.get("frontmatter", {})
        skill = s["dir"]
        name = fm.get("name", "")
        desc = fm.get("description", "")
        if not s.get("had_frontmatter"):
            findings.append(finding(skill, "spec/no-frontmatter", "SKILL.md has no YAML frontmatter block"))
            continue
        if not name:
            findings.append(finding(skill, "spec/name-missing", "required 'name' field missing or empty"))
        else:
            if not NAME_RE.match(name):
                findings.append(finding(skill, "spec/name-invalid",
                                        f"name '{name}' violates lowercase/hyphen rules"))
            if len(name) > 64:
                findings.append(finding(skill, "spec/name-too-long", f"name is {len(name)} chars (max 64)"))
            if name != s["dir"]:
                findings.append(finding(skill, "spec/name-dir-mismatch",
                                        f"name '{name}' != directory '{s['dir']}'"))
            names.setdefault(name, []).append(s["path"])
        if not desc:
            findings.append(finding(skill, "spec/description-missing", "required 'description' field missing or empty"))
        else:
            if len(desc) > 1024:
                findings.append(finding(skill, "spec/description-too-long", f"description is {len(desc)} chars (max 1024)"))
            if len(desc) < 40:
                findings.append(finding(skill, "quality/description-thin",
                                        f"description only {len(desc)} chars; likely too vague to route on", snippet=desc))
            low = desc.lower()
            if "use when" not in low and "use this" not in low and "use it" not in low and "use for" not in low:
                findings.append(finding(skill, "quality/no-trigger-guidance",
                                        "description never says when to use the skill"))
        if "replace with" in desc.lower() or name == "template-skill":
            findings.append(finding(skill, "quality/placeholder", "skill looks like an unfilled template", snippet=desc))
        if s.get("body_lines", 0) > 500:
            findings.append(finding(skill, "quality/body-oversized",
                                    f"body is {s['body_lines']} lines (spec recommends <500; split into references/)"))
        if s.get("body_chars", 0) < 40 and s.get("had_frontmatter"):
            findings.append(finding(skill, "quality/body-empty", f"body is only {s.get('body_chars',0)} chars"))
        # referenced-but-missing files
        try:
            body = open(os.path.join(s["path"], "SKILL.md"), encoding="utf-8", errors="replace").read()
        except OSError:
            body = ""
        have = {f["rel"] for f in s["files"]}
        refs = set(re.findall(r"(?:\]\(|\b)((?:scripts|references|assets)/[A-Za-z0-9_./-]+)", body))
        for r in refs:
            r = r.rstrip(").,:;")
            if r and r not in have and not any(h.startswith(r.rstrip("/") + "/") for h in have):
                findings.append(finding(skill, "spec/broken-reference", f"body references missing file '{r}'", snippet=r))
        for f_ in s["files"]:
            if f_["rel"].startswith("scripts/") and f_["rel"] not in body and os.path.basename(f_["rel"]) not in body:
                findings.append(finding(skill, "quality/orphan-script",
                                        f"'{f_['rel']}' exists but is never referenced by SKILL.md", file=f_["rel"]))
    for name, paths in names.items():
        if len(paths) > 1:
            findings.append(finding(name, "library/name-collision",
                                    f"name '{name}' defined in {len(paths)} places: " + "; ".join(paths)))
    kept, suppressed = apply_decisions(findings, show_all)
    return {"findings": kept, "suppressed": suppressed, "skill_count": len(inv["skills"])}


def cmd_measure(inv):
    per = []
    for s in inv["skills"]:
        fm = s.get("frontmatter", {})
        meta = len(fm.get("name", s["dir"])) + len(str(fm.get("description", "")))
        per.append({"skill": s["dir"], "root": s["root"],
                    "metadata_tokens_est": round(meta / 4),
                    "body_tokens_est": round(s.get("body_chars", 0) / 4),
                    "body_lines": s.get("body_lines", 0),
                    "total_files": len(s.get("files", []))})
    per.sort(key=lambda p: -p["metadata_tokens_est"])
    return {"library_always_loaded_tokens_est": sum(p["metadata_tokens_est"] for p in per),
            "skill_count": len(per), "top_metadata_cost": per[:10], "skills": per}


SCAN_PATTERNS = [
    ("injection/override-phrase", re.compile(r"ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above)\s+instructions", re.I)),
    ("injection/concealment", re.compile(r"(?:do not|don'?t|never)\s+(?:tell|inform|mention|reveal|show)\s+(?:this\s+)?(?:to\s+)?the\s+user", re.I)),
    ("exfil/pipe-to-shell", re.compile(r"(?:curl|wget)[^\n|;]*\|\s*(?:ba|z|da)?sh\b", re.I)),
    ("exfil/network-post", re.compile(r"(?:curl|wget)\s+[^\n]*(?:-d\b|--data\b|-F\b|--upload-file\b|-T\b)", re.I)),
    ("exfil/raw-socket", re.compile(r"(?:/dev/tcp/|\bnc\s+-|\bncat\b|\btelnet\s+\d)", re.I)),
    ("secrets/ssh-keys", re.compile(r"(?:~|\$HOME|/Users/[A-Za-z0-9_.-]+|/home/[A-Za-z0-9_.-]+)/\.ssh\b|id_rsa|id_ed25519", re.I)),
    ("secrets/env-harvest", re.compile(r"\b(?:printenv|env)\s*(?:\||>|>>)|process\.env\s*\)|os\.environ(?:\.items|\s*\))", re.I)),
    ("secrets/credential-files", re.compile(r"\.aws/credentials|\.netrc\b|\.npmrc\b|keychain|credentials\.json", re.I)),
    ("obfuscation/base64-decode", re.compile(r"base64\s+(?:-d|-D|--decode)|atob\s*\(|b64decode", re.I)),
    ("obfuscation/long-blob", re.compile(r"[A-Za-z0-9+/=]{120,}")),
    ("obfuscation/eval", re.compile(r"\beval\s*\(|\bexec\s*\(|python[3]?\s+-c\s+[\"']", re.I)),
    ("destructive/rm-broad", re.compile(r"rm\s+-[a-z]*[rf]{2}[a-z]*\s+(?:/|~|\$HOME)(?:\s|$|/\*)", re.I)),
    ("destructive/disk", re.compile(r"\bmkfs\b|\bdd\s+if=|>\s*/dev/sd", re.I)),
    ("dynamic-context/network", re.compile(r"!`[^`]*(?:curl|wget|nc\s|ssh\s)[^`]*`")),
    ("dynamic-context/any", re.compile(r"!`[^`]+`")),
]
TEXT_EXT = {".md", ".txt", ".py", ".sh", ".js", ".ts", ".mjs", ".json", ".yaml", ".yml", ".rb", ".pl", ""}


def cmd_scan(inv, show_all=False):
    findings = []
    for s in inv["skills"]:
        fm = s.get("frontmatter", {})
        at = fm.get("allowed-tools", "")
        if isinstance(at, str) and re.search(r"(?:^|\s)Bash(?:\s|$)|Bash\(\*\)|Bash\(\s*\*\s*:", at):
            findings.append(finding(s["dir"], "permissions/broad-bash-grant",
                                    "allowed-tools pre-approves unrestricted Bash", snippet=at))
        for f_ in s.get("files", []):
            ext = os.path.splitext(f_["rel"])[1].lower()
            if ext not in TEXT_EXT or f_["size"] > 1_000_000:
                continue
            fp = os.path.join(s["path"], f_["rel"])
            try:
                lines = open(fp, encoding="utf-8", errors="replace").read().splitlines()
            except OSError:
                continue
            for i, ln in enumerate(lines, 1):
                for cat, rx in SCAN_PATTERNS:
                    if cat == "dynamic-context/any" and f_["rel"] != "SKILL.md":
                        continue
                    m = rx.search(ln)
                    if m:
                        findings.append(finding(s["dir"], cat, f"pattern match in {f_['rel']}:{i}",
                                                file=f_["rel"], snippet=ln, line=i))
    # de-dup identical ids (same snippet matched by same category twice)
    seen, uniq = set(), []
    for f in findings:
        if f["id"] not in seen:
            seen.add(f["id"])
            uniq.append(f)
    kept, suppressed = apply_decisions(uniq, show_all)
    return {"candidates": kept, "suppressed": suppressed,
            "note": "Regex candidates only. An agent must judge each as confirmed/plausible/benign per references/security-rubric.md."}


def state_path(roots):
    slug = hashlib.sha1("|".join(sorted(roots)).encode()).hexdigest()[:12]
    return os.path.join(STATE_DIR, "state", f"baseline-{slug}.json")


def cmd_diff(inv, update=False):
    sp = state_path(inv["roots"])
    baseline = None
    if os.path.exists(sp):
        try:
            baseline = json.load(open(sp, encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            baseline = None
    cur = {s["path"]: {f["rel"]: f["sha256"] for f in s["files"]} for s in inv["skills"]}
    result = {"baseline_exists": baseline is not None, "baseline_path": sp,
              "added_skills": [], "removed_skills": [], "modified": []}
    if baseline:
        old = baseline.get("hashes", {})
        result["baseline_date"] = baseline.get("generated")
        result["added_skills"] = sorted(set(cur) - set(old))
        result["removed_skills"] = sorted(set(old) - set(cur))
        for path in sorted(set(cur) & set(old)):
            changes = []
            for rel in set(cur[path]) | set(old[path]):
                a, b = old[path].get(rel), cur[path].get(rel)
                if a != b:
                    changes.append({"file": rel, "change": "added" if a is None else "removed" if b is None else "modified"})
            if changes:
                result["modified"].append({"skill": path, "changes": changes})
    if update:
        os.makedirs(os.path.dirname(sp), exist_ok=True)
        json.dump({"generated": inv["generated"], "roots": inv["roots"], "hashes": cur},
                  open(sp, "w", encoding="utf-8"), indent=1)
        result["baseline_updated"] = True
    return result


def cmd_decide(args):
    os.makedirs(STATE_DIR, exist_ok=True)
    entry = {"id": args.id, "status": args.status, "reason": args.reason or "",
             "date": time.strftime("%Y-%m-%d")}
    with open(DECISIONS, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    return entry


def main():
    ap = argparse.ArgumentParser(prog="skilltool")
    ap.add_argument("cmd", choices=["inventory", "validate", "measure", "scan", "diff", "decide", "all"])
    ap.add_argument("--roots", nargs="*", help="skill library roots (default: auto-detect known agents)")
    ap.add_argument("--update", action="store_true", help="diff: write new baseline")
    ap.add_argument("--all-findings", action="store_true", help="include suppressed findings")
    ap.add_argument("--id", help="decide: finding id")
    ap.add_argument("--status", choices=["accepted", "suppressed", "fixed", "open"], help="decide: status")
    ap.add_argument("--reason", help="decide: why")
    args = ap.parse_args()

    if args.cmd == "decide":
        if not args.id or not args.status:
            ap.error("decide requires --id and --status")
        print(json.dumps(cmd_decide(args), indent=1))
        return

    roots = discover_roots(args)
    if not roots:
        print(json.dumps({"error": "no skill roots found; pass --roots"}))
        sys.exit(1)
    inv = build_inventory(roots)
    if args.cmd == "inventory":
        out = inv
    elif args.cmd == "validate":
        out = cmd_validate(inv, args.all_findings)
    elif args.cmd == "measure":
        out = cmd_measure(inv)
    elif args.cmd == "scan":
        out = cmd_scan(inv, args.all_findings)
    elif args.cmd == "diff":
        out = cmd_diff(inv, args.update)
    else:  # all
        out = {"roots": roots,
               "validate": cmd_validate(inv, args.all_findings),
               "measure": {k: v for k, v in cmd_measure(inv).items() if k != "skills"},
               "scan": cmd_scan(inv, args.all_findings),
               "diff": cmd_diff(inv, args.update)}
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
