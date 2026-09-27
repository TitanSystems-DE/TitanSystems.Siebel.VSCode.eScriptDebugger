/**
 * Removes ST eScript type annotations without changing source length or line
 * positions. Strings, comments, templates and regular expressions are opaque.
 */
export function stripSiebelTypes(source) {
  const tokens = tokenizeSiebel(source), ranges = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind === 'id' && ['var', 'let', 'const'].includes(token.value)) {
      markVariableTypes(tokens, index + 1, ranges);
    } else if (token.kind === 'id' && token.value === 'function') {
      markFunctionTypes(tokens, index, ranges);
    }
  }
  if (!ranges.length) return source;
  // split('') keeps UTF-16 indexing identical to the scanner and V8 inspector.
  const chars = source.split('');
  for (const [start, end] of ranges) for (let i = start; i < end; i++) if (chars[i] !== '\r' && chars[i] !== '\n') chars[i] = ' ';
  return chars.join('');
}

function markVariableTypes(tokens, start, ranges) {
  let round = 0, square = 0, curly = 0, declaratorStart = true;
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    if (declaratorStart && token.kind === 'id') {
      if (tokens[i + 1]?.value === ':') markType(tokens, i + 1, ranges);
      declaratorStart = false;
    }
    if (token.value === '(') round++; else if (token.value === ')') { if (!round && !square && !curly) return i - 1; round--; }
    else if (token.value === '[') square++; else if (token.value === ']') square--;
    else if (token.value === '{') curly++; else if (token.value === '}') { if (!round && !square && !curly) return i - 1; curly--; }
    else if (!round && !square && !curly && token.value === ',') declaratorStart = true;
    else if (!round && !square && !curly && (token.value === ';' || token.value === 'in' || token.value === 'of')) return i;
  }
  return tokens.length - 1;
}

function markFunctionTypes(tokens, functionIndex, ranges) {
  let open = functionIndex + 1;
  if (tokens[open]?.kind === 'id') open++;
  if (tokens[open]?.value !== '(') return;
  let depth = 0, parameterStart = true, close = open;
  for (let i = open + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.value === '(' || token.value === '[' || token.value === '{') depth++;
    else if (token.value === ')' && depth === 0) { close = i; break; }
    else if (token.value === ')' || token.value === ']' || token.value === '}') depth--;
    if (parameterStart && depth === 0 && token.kind === 'id') {
      if (tokens[i + 1]?.value === ':') markType(tokens, i + 1, ranges);
      parameterStart = false;
    }
    if (depth === 0 && token.value === ',') parameterStart = true;
  }
  if (tokens[close + 1]?.value === ':') markType(tokens, close + 1, ranges);
}

function markType(tokens, colonIndex, ranges) {
  let end = colonIndex + 1;
  if (tokens[end]?.kind !== 'id') return;
  end++;
  while (tokens[end]?.value === '.' && tokens[end + 1]?.kind === 'id') end += 2;
  while (tokens[end]?.value === '[' && tokens[end + 1]?.value === ']') end += 2;
  ranges.push([tokens[colonIndex].start, tokens[end - 1].end]);
}

export function tokenizeSiebel(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i], next = source[i + 1];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && next === '/') { i += 2; while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') { i += 2; while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++; i = Math.min(source.length, i + 2); continue; }
    if (c === '"' || c === "'" || c === '`') { i = skipQuoted(source, i, c); continue; }
    if (c === '/' && startsRegex(tokens.at(-1))) { i = skipRegex(source, i); continue; }
    if (/[A-Za-z_$]/.test(c)) {
      const start = i++; while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) i++;
      tokens.push({ kind: 'id', value: source.slice(start, i), start, end: i }); continue;
    }
    if (/[0-9]/.test(c)) { const start = i++; while (i < source.length && /[A-Za-z0-9_.]/.test(source[i])) i++; tokens.push({ kind: 'number', value: source.slice(start, i), start, end: i }); continue; }
    tokens.push({ kind: 'punct', value: c, start: i, end: ++i });
  }
  return tokens;
}

function skipQuoted(source, start, quote) {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (source[i++] === quote) break;
  }
  return i;
}

function startsRegex(previous) {
  if (!previous) return true;
  if (previous.kind === 'id') return ['return', 'throw', 'case', 'delete', 'typeof', 'void', 'new', 'in', 'of', 'else', 'do'].includes(previous.value);
  return ['(', '[', '{', '=', ':', ',', ';', '!', '?', '&', '|', '+', '-', '*', '%', '^', '~'].includes(previous.value);
}

function skipRegex(source, start) {
  let i = start + 1, inClass = false;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (source[i] === '[') inClass = true;
    else if (source[i] === ']') inClass = false;
    else if (source[i] === '/' && !inClass) { i++; break; }
    i++;
  }
  while (i < source.length && /[A-Za-z]/.test(source[i])) i++;
  return i;
}
