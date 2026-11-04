/** Finite viewport sampling, not a list of all physical devices. No dependencies. */
export const COMMON_SIZES = [
  [320,568,'phone-small','touch'],[360,640,'phone-compact','touch'],
  [375,667,'phone-medium','touch'],[390,844,'phone-tall','touch'],[430,932,'phone-wide','touch'],
  [568,320,'landscape-short','touch'],[844,390,'landscape-phone','touch'],
  [844,300,'landscape-very-short','touch'],[768,1024,'tablet-portrait','touch'],
  [1024,768,'tablet-landscape','touch'],[800,1280,'tablet-tall','touch'],
  [1280,800,'tablet-wide','touch'],[1366,1024,'tablet-large','touch'],
  [1280,720,'desktop-compact','mouse'],[1920,1080,'desktop-wide','mouse'],
];

export function extractBreakpoints(conditions = []) {
  const found = new Map(), unsupported = new Set();
  for (const condition of conditions) {
    const text = typeof condition === 'string' ? condition : condition.condition;
    if (typeof text !== 'string') continue;
    const expressions = [...text.matchAll(/\(([^()]*)\)/g)].map(match => match[1]);
    for (const expression of expressions) {
      if (!/\b(?:width|height)\b/i.test(expression)) continue;
      if (/\bdevice-(?:width|height)\b/i.test(expression)) { unsupported.add(text); continue; }
      // Only resolve CSS pixel boundaries. rem/em depend on the target environment.
      const axis = /\b(width|height)\b/i.exec(expression)?.[1].toLowerCase();
      const values = [...expression.matchAll(/(\d*\.?\d+)\s*(px|rem|em|vw|vh|dvh|svh|lvh|%)\b/gi)];
      if (!values.length || values.some(match => match[2].toLowerCase() !== 'px')) {
        unsupported.add(text); continue;
      }
      for (const match of values) {
        const value = Number(match[1]);
        if (Number.isFinite(value) && value > 0) {
          const key = `${axis}:${value}`;
          const entry = found.get(key) || {axis, value, conditions: []};
          if (!entry.conditions.includes(text)) entry.conditions.push(text);
          found.set(key, entry);
        }
      }
    }
  }
  return {breakpoints: [...found.values()].sort((a,b) => a.axis.localeCompare(b.axis) || a.value-b.value),
    unsupportedConditions: [...unsupported]};
}

export function buildMatrix(options = {}, conditions = []) {
  const bounds = {minWidth:320,maxWidth:1920,minHeight:300,maxHeight:1280,...options.bounds};
  for (const key of Object.keys(bounds)) if (!Number.isInteger(bounds[key]) || bounds[key] < 1)
    throw new Error(`Invalid matrix bound: ${key}`);
  if (bounds.minWidth > bounds.maxWidth || bounds.minHeight > bounds.maxHeight)
    throw new Error('Matrix bounds must be increasing');
  const maxCases = options.maxCases ?? 60;
  if (!Number.isInteger(maxCases) || maxCases < 1 || maxCases > 1000)
    throw new Error('maxCases must be an integer from 1 to 1000');
  const parsed = extractBreakpoints(conditions), candidates = new Map(), outside = [];
  const add = (sample, reason, required = false) => {
    const {width,height} = sample;
    const input = sample.input ?? options.boundaryInput ?? 'touch', dpr = sample.dpr ?? 1;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        !['touch','mouse'].includes(input) || !Number.isFinite(dpr) || dpr < 0.5 || dpr > 4)
      throw new Error('Invalid viewport size, input or DPR');
    if (width < bounds.minWidth || width > bounds.maxWidth || height < bounds.minHeight || height > bounds.maxHeight) {
      if (required) throw new Error(`Explicit sample ${width}x${height} is outside configured bounds`);
      outside.push({...sample,input,dpr,reason}); return;
    }
    const key = `${width}x${height}-${input}-${dpr}`;
    if (candidates.has(key)) candidates.get(key).reasons.push(reason);
    else candidates.set(key, {id:key,width,height,input,dpr,reasons:[reason],label:sample.label || `${width}×${height}`});
  };
  for (const sample of options.sizes || []) add(sample, 'explicit', true);
  if (options.common !== false) for (const [width,height,label,input] of COMMON_SIZES)
    add({width,height,label,input,dpr:options.dpr ?? 1}, 'common');
  if (options.boundaries !== false) for (const point of parsed.breakpoints) {
    const offsets = [-1,0,1];
    for (const offset of offsets) {
      const value = Math.round(point.value + offset);
      const sample = point.axis === 'width'
        ? {width:value,height:options.boundaryHeight ?? 768}
        : {width:options.boundaryWidth ?? 1024,height:value};
      add({...sample,dpr:options.dpr ?? 1}, `${point.axis} breakpoint ${point.value}px ${offset>=0?'+':''}${offset}`);
    }
  }
  if (options.sweep) {
    const {widths,heights} = options.sweep;
    const range = (definition,name) => {
      if (!Array.isArray(definition) || definition.length !== 3 ||
          definition.some(value => !Number.isInteger(value)) ||
          definition[0] < 1 || definition[2] < 1 || definition[1] < definition[0])
        throw new Error(`Invalid ${name} sweep; use [minimum, maximum, step]`);
      const count = Math.floor((definition[1]-definition[0])/definition[2])+1;
      if (count > 1000) throw new Error('Sweep exceeds 1000 steps on one axis');
      return Array.from({length:count},(_,i)=>definition[0]+i*definition[2]);
    };
    const ws = range(widths,'width'), hs = range(heights,'height');
    if (ws.length*hs.length > 10000) throw new Error('Sweep exceeds 10000 candidate sizes');
    for (const width of ws) for (const height of hs) add({width,height,dpr:options.dpr ?? 1},'range sweep');
  }
  const all = [...candidates.values()];
  if (!all.length) throw new Error('Matrix contains no viewport samples');
  return {cases:all.slice(0,maxCases),deferred:all.slice(maxCases),outsideBounds:outside,
    ...parsed,bounds,maxCases,candidateCount:all.length,
    coverage:'Finite CSS viewport samples and one-axis breakpoint neighbours; not every width-height combination or real-device certification.'};
}
