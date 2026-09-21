//seltra-web/backend/tmp-debug-hero-gate.js
//This file is used to debug the hero gate logic. It extracts the mapCallbackMissingKey function from the hero-nav-builder.agent.ts file and tests it against a sample source code.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'src/ai/agents/hero-nav-builder.agent.ts'), 'utf8');
const re = /function mapCallbackMissingKey\(code: string\): boolean \{([\s\S]*?)\n  \}/;
const m = src.match(re);
if (!m) {
  console.error('NO MATCH');
  process.exit(1);
}
const fnBody = m[1];
const fn = new Function('return function mapCallbackMissingKey(code){' + fnBody + '\n  };')();
const source = `function StorefrontHero(props) {
  return React.createElement('div', { className: 'seltra-hero-media' }, React.createElement('h1', null, props.store.displayName), props.products.map(p => React.createElement('div', null, React.createElement('span', { key: p.id }, p.name))))
}`;
console.log('mapCallbackMissingKey returned:', fn(source));
const callbackStart = source.indexOf('.map(');
const pStart = callbackStart + 5;
let p = pStart;
let depth = 1;
while (p < source.length && depth > 0) {
  const c = source[p];
  if (c === '(') depth++;
  else if (c === ')') depth--;
  else if (c === '"' || c === "'" || c === '`') {
    const qChar = c;
    p++;
    while (p < source.length && source[p] !== qChar) {
      if (source[p] === '\\') p += 2;
      else p++;
    }
  } else if (c === '/') {
    if (source[p + 1] === '/') {
      p += 2;
      while (p < source.length && source[p] !== '\n') p++;
    } else if (source[p + 1] === '*') {
      p += 2;
      while (p + 1 < source.length && !(source[p] === '*' && source[p + 1] === '/')) p++;
      p += 2;
      continue;
    }
  }
  p++;
}
const callback = source.slice(callbackStart, p);
console.log('callback:', callback);
const hasKeyProp = /\bkey\s*[:=]\s*/.test(callback) || /props?\.key\b/.test(callback);
const hasCreateElement = /React\.createElement\s*\(/.test(callback);
const rootCreateIdx = callback.indexOf('React.createElement(');
console.log('hasKeyProp:', hasKeyProp, 'hasCreateElement:', hasCreateElement, 'rootCreateIdx:', rootCreateIdx);
if (rootCreateIdx !== -1) {
  let q = rootCreateIdx + 'React.createElement('.length;
  let depth2 = 1;
  while (q < callback.length && depth2 > 0) {
    const c = callback[q];
    if (c === '(') depth2++;
    else if (c === ')') depth2--;
    else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      q++;
      while (q < callback.length && callback[q] !== quote) {
        if (callback[q] === '\\') q += 2;
        else q++;
      }
    } else if (c === '/') {
      if (callback[q + 1] === '/') {
        q += 2;
        while (q < callback.length && callback[q] !== '\n') q++;
      } else if (callback[q + 1] === '*') {
        q += 2;
        while (q + 1 < callback.length && !(callback[q] === '*' && callback[q + 1] === '/')) q++;
        q += 2;
        continue;
      }
    }
    q++;
  }
  const rootCall = callback.slice(rootCreateIdx, q);
  console.log('rootCall:', rootCall);
  const rootKeyPresent = /React\.createElement\s*\(\s*['"][^'\"]+['"]\s*,\s*\{[^}]*\bkey\s*[:=]/.test(rootCall);
  console.log('rootKeyPresent:', rootKeyPresent);
}
