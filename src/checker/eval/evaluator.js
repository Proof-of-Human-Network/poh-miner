'use strict';

const vm = require('vm');

function normalize(expr, lang) {
  let js = expr.trim();
  switch ((lang || 'js').toLowerCase()) {
    case 'php':
      js = js.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, '$1');
      js = js.replace(/(?<![<>!=])={2}(?!=)/g, '===');
      js = js.replace(/!={1}(?!=)/g, '!==');
      break;
    case 'go':
      js = js.replace(/\bnil\b/g, 'null');
      js = js.replace(/(?<![<>!=])={2}(?!=)/g, '===');
      js = js.replace(/!={1}(?!=)/g, '!==');
      break;
    case 'rust':
      js = js.replace(/\bas\s+[a-z0-9]+/g, '');
      js = js.replace(/(?<![<>!=])={2}(?!=)/g, '===');
      js = js.replace(/!={1}(?!=)/g, '!==');
      break;
    case 'java':
      js = js.replace(/\(\s*(?:int|long|double|float|short|byte|char|boolean|String|Object)\s*\)/g, '');
      js = js.replace(/(?<![<>!=])={2}(?!=)/g, '===');
      js = js.replace(/!={1}(?!=)/g, '!==');
      break;
    default:
      break;
  }
  return js;
}

function makeSandboxValue(val, lang) {
  if (typeof val !== 'bigint') return val;
  return lang === 'js' ? val : Number(val);
}

function evaluate(expression, vars, lang = 'js') {
  const jsExpr = normalize(expression, lang);
  const sandbox = {};
  for (const [key, val] of Object.entries(vars)) {
    sandbox[key] = Array.isArray(val)
      ? val.map(v => makeSandboxValue(v, lang))
      : makeSandboxValue(val, lang);
  }
  const ctx = vm.createContext(sandbox);
  try {
    const raw = vm.runInContext(jsExpr, ctx, { timeout: 2000 });
    return Boolean(raw);
  } catch (err) {
    throw new Error(`Expression evaluation failed: ${err.message}\n  Expr: ${jsExpr}`);
  }
}

module.exports = { evaluate, normalize };
