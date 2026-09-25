import { tokenizeSiebel } from './type-stripper.mjs';

export function collectReferenceSignatures(sources) {
  const signatures = new Map();
  for (const source of sources) for (const declaration of declarations(source))
    if (declaration.refs.length) signatures.set(declaration.name, declaration.refs.map(ref => ref.index));
  return signatures;
}

export function transformSiebelReferences(source, signatures) {
  const tokens = tokenizeSiebel(source), edits = [], declared = declarations(source, tokens);
  for (const declaration of declared) {
    if (!declaration.refs.length || declaration.bodyOpen < 0 || declaration.bodyClose < 0) continue;
    for (const ref of declaration.refs) edits.push({ start: ref.ampStart, end: ref.ampEnd, text: ' ' });
    const locals = declaration.refs.map((ref, ordinal) => ({ ...ref, hidden: `__escript_ref_${ref.index}_${ordinal}` }));
    const prologue = locals.map(ref => `var ${ref.hidden}=${ref.name};${ref.name}=${ref.hidden}.value;`).join('') + 'try{';
    const epilogue = `}finally{${locals.map(ref => `${ref.hidden}.value=${ref.name};`).join('')}}`;
    edits.push({ start: tokens[declaration.bodyOpen].end, end: tokens[declaration.bodyOpen].end, text: prologue });
    edits.push({ start: tokens[declaration.bodyClose].start, end: tokens[declaration.bodyClose].start, text: epilogue });
  }

  const declarationNames = new Set(declared.map(item => item.nameToken));
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i], refIndices = signatures.get(token.value);
    if (token.kind !== 'id' || !refIndices || tokens[i + 1].value !== '(' || declarationNames.has(i)) continue;
    const call = callArguments(tokens, i + 1); if (!call) continue;
    for (const refIndex of refIndices) {
      const argument = call.arguments[refIndex]; if (!argument) continue;
      const raw = source.slice(argument.start, argument.end), expression = raw.trim(); if (!expression) continue;
      const leading = raw.slice(0, raw.indexOf(expression)), trailing = raw.slice(raw.indexOf(expression) + expression.length);
      edits.push({ start: argument.start, end: argument.end, text: `${leading}__escriptMakeRef(()=>(${expression}),__escriptValue=>(${expression}=__escriptValue))${trailing}` });
    }
    i = call.close;
  }
  return applyEdits(source, edits);
}

function declarations(source, suppliedTokens) {
  const tokens = suppliedTokens ?? tokenizeSiebel(source), result = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'id' || tokens[i].value !== 'function' || tokens[i + 1]?.kind !== 'id' || tokens[i + 2]?.value !== '(') continue;
    const nameToken = i + 1, name = tokens[nameToken].value, call = callArguments(tokens, i + 2); if (!call) continue;
    const refs = [];
    for (let index = 0; index < call.arguments.length; index++) {
      const argument = call.arguments[index], inside = tokens.filter(token => token.start >= argument.start && token.end <= argument.end);
      const amp = inside.findIndex(token => token.value === '&');
      if (amp >= 0 && inside[amp + 1]?.kind === 'id') refs.push({ index, name: inside[amp + 1].value, ampStart: inside[amp].start, ampEnd: inside[amp].end });
    }
    let bodyOpen = call.close + 1;
    while (bodyOpen < tokens.length && tokens[bodyOpen].value !== '{' && tokens[bodyOpen].value !== ';') bodyOpen++;
    const bodyClose = tokens[bodyOpen]?.value === '{' ? matching(tokens, bodyOpen, '{', '}') : -1;
    result.push({ name, nameToken, refs, bodyOpen: bodyOpen < tokens.length ? bodyOpen : -1, bodyClose });
  }
  return result;
}

function callArguments(tokens, open) {
  const close = matching(tokens, open, '(', ')'); if (close < 0) return undefined;
  const separators = []; let round = 0, square = 0, curly = 0;
  for (let i = open + 1; i < close; i++) {
    const value = tokens[i].value;
    if (value === '(') round++; else if (value === ')') round--;
    else if (value === '[') square++; else if (value === ']') square--;
    else if (value === '{') curly++; else if (value === '}') curly--;
    else if (value === ',' && !round && !square && !curly) separators.push(i);
  }
  const argumentsList = []; let start = tokens[open].end;
  for (const separator of [...separators, close]) {
    const end = separator === close ? tokens[close].start : tokens[separator].start;
    argumentsList.push({ start, end }); start = tokens[separator].end;
  }
  if (argumentsList.length === 1 && !tokens.some(token => token.start >= argumentsList[0].start && token.end <= argumentsList[0].end)) argumentsList.length = 0;
  return { arguments: argumentsList, close };
}

function matching(tokens, open, opening, closing) {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (tokens[i].value === opening) depth++;
    else if (tokens[i].value === closing && --depth === 0) return i;
  }
  return -1;
}

function applyEdits(source, edits) {
  const ordered = edits.sort((left, right) => right.start - left.start || right.end - left.end);
  let result = source;
  for (const edit of ordered) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}
