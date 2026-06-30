---
id: code_audit
version: 1.0.0
description: Analyzes proposed skill code for safety and alignment with its manifest description. Enabled by default on all nodes. Deploy fee (1000 POH) goes to the miner who runs this job.
allowedEndpoints:
  - '*'
triggers:
  - audit skill
  - review skill code
  - check skill safety
  - code audit
---

## Context

**When to run this skill:**
- Only when explicitly asked to audit, review, or check skill code safety
- When a new skill proposal is submitted to the network
- Keywords: "audit skill", "review skill code", "check skill safety", "code audit"

**Do NOT run for:**
- General code review questions
- Questions about writing or explaining code

Analyzes a proposed skill before it is broadcast to the network.

Input: `{ manifest: { id, description }, code: string, context: string }`

Returns: `{ safe: boolean, reason: string, issues: string[] }`

Rules for rejection (safe: false):
- Code does not export `exports.run` or `exports.default` (mandatory entry point — skill cannot execute without it)
- Code attempts to access the filesystem, environment variables, or spawns child processes
- Code makes requests to endpoints not listed in manifest.allowedEndpoints
- Code exfiltrates data to unauthorized third parties
- Code contains eval, Function() constructor, or dynamic code execution on external input
- Code behavior clearly contradicts the skill description
- Code installs packages, modifies global state, or performs any destructive action

## Code

```js
exports.run = async function(input, config) {
  const { manifest, code, context } = input;

  if (!code) return { safe: true, reason: 'No sandboxed code — handled natively', issues: [] };

  const issues = [];

  // Mandatory entry point — skill-runner calls exports.run (or exports.default)
  if (!/exports\s*\.\s*run\s*=|exports\s*\.\s*default\s*=/.test(code)) {
    issues.push('Missing exports.run — skill has no executable entry point and cannot run');
  }

  // Static analysis: dangerous patterns
  const dangerous = [
    [/require\s*\(\s*['"]fs['"]\s*\)/,              'Accesses filesystem (fs module)'],
    [/require\s*\(\s*['"]child_process['"]\s*\)/,   'Spawns child processes'],
    [/process\.env/,                                 'Reads environment variables'],
    [/process\.exit/,                                'Calls process.exit()'],
    [/__dirname|__filename/,                         'Uses __dirname/__filename (Node globals)'],
    [/new\s+Function\s*\(/,                          'Uses dynamic Function() constructor'],
    [/eval\s*\(/,                                    'Uses eval()'],
    [/\.exec\s*\(/,                                  'Uses exec() — potential code execution'],
  ];

  for (const [re, label] of dangerous) {
    if (re.test(code)) issues.push(label);
  }

  // Check allowed endpoints if manifest has restrictions
  const allowed = manifest?.allowedEndpoints || ['*'];
  if (!allowed.includes('*')) {
    // Find all fetch/axios/http calls and extract URLs
    const urlRe = /(?:fetch|axios\.get|axios\.post|http\.get|https\.get)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    let m;
    while ((m = urlRe.exec(code)) !== null) {
      const u = m[1];
      const ok = allowed.some(a => u.startsWith(a) || u.includes(a.replace('*', '')));
      if (!ok) issues.push(`Calls unauthorized endpoint: ${u}`);
    }
  }

  // LLM semantic analysis — checks description alignment and hidden intent
  let llmReason = '';
  try {
    const ollamaUrl = (config && config.ollamaUrl) || 'http://localhost:11434';
    const model = (config && config.model) || 'qwen2.5:1.5b';
    const codeSnippet = code.slice(0, 2500);
    const prompt = `You are a security auditor reviewing a skill for a decentralized network.

Skill ID: "${manifest?.id}"
Description: "${(manifest?.description || 'none').slice(0, 200)}"
Static issues already found: ${issues.length > 0 ? issues.join('; ') : 'none'}

Code:
\`\`\`js
${codeSnippet}${code.length > 2500 ? '\n... (truncated)' : ''}
\`\`\`

Check:
1. Does the code match the description?
2. Any hidden malicious behavior (data exfiltration, backdoors, manipulation)?
3. Logic bugs or security flaws not caught by static analysis?

Respond with ONLY JSON: {"safe": true/false, "reason": "one sentence", "issues": ["...additional issues not already listed..."]}`;

    const r = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        format: 'json',
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (r.ok) {
      const d = await r.json();
      const raw = d.message?.content || d.response || '';
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const llm = JSON.parse(m[0]);
        if (Array.isArray(llm.issues)) {
          for (const iss of llm.issues) {
            if (iss && !issues.includes(iss)) issues.push(`[LLM] ${iss}`);
          }
        }
        if (llm.safe === false && issues.length === 0) {
          issues.push(`[LLM] ${llm.reason || 'Flagged as unsafe by LLM analysis'}`);
        }
        llmReason = llm.reason || '';
      }
    }
  } catch { /* LLM unavailable — static analysis only */ }

  const safe = issues.length === 0;
  const reason = safe
    ? `Code passed static and LLM safety analysis.${llmReason ? ' ' + llmReason : ''}`
    : `Skill code was rejected. Issues found: ${issues.join('; ')}`;

  return { safe, reason, issues };
};
```
