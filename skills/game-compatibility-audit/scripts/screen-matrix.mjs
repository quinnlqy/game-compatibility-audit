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

export const SCREEN_GROUPS = [
  {id:'phone-portrait',label:'手机竖屏',note:'手机竖向参考视口，不对应某个具体型号。'},
  {id:'phone-landscape',label:'手机横屏',note:'手机横向参考视口，包含可用高度较短的场景。'},
  {id:'tablet',label:'平板',note:'平板参考视口，横竖屏都在本组。'},
  {id:'desktop',label:'电脑',note:'电脑窗口参考视口，输入方式单独标注。'},
  {id:'boundary',label:'边界测试',note:'布局切换点和自定义范围采样，不代表某款手机或平板。'},
];
const PRESET_LABELS = {
  'phone-small':['phone-portrait','小尺寸手机竖屏'],
  'phone-compact':['phone-portrait','紧凑手机竖屏'],
  'phone-medium':['phone-portrait','常规手机竖屏'],
  'phone-tall':['phone-portrait','长屏手机竖屏'],
  'phone-wide':['phone-portrait','宽屏手机竖屏'],
  'landscape-short':['phone-landscape','短屏手机横屏'],
  'landscape-phone':['phone-landscape','常规手机横屏'],
  'landscape-very-short':['phone-landscape','极短手机横屏'],
  'tablet-portrait':['tablet','平板竖屏'],
  'tablet-landscape':['tablet','平板横屏'],
  'tablet-tall':['tablet','长屏平板竖屏'],
  'tablet-wide':['tablet','宽屏平板横屏'],
  'tablet-large':['tablet','大尺寸平板横屏'],
  'desktop-compact':['desktop','紧凑电脑窗口'],
  'desktop-wide':['desktop','宽屏电脑窗口'],
};

export function chineseReason(reason) {
  if(reason==='common')return '常见尺寸';
  if(reason==='explicit')return '指定尺寸';
  if(reason==='range sweep')return '范围扫描';
  const match=/^(width|height) breakpoint ([\d.]+)px ([+-]\d+)$/.exec(reason);
  if(match){
    const offset=Number(match[3]);
    return `${match[1]==='width'?'宽度':'高度'}切换点 ${match[2]}像素（${offset===0?'临界值':offset<0?'前'+Math.abs(offset)+'像素':'后'+offset+'像素'}）`;
  }
  return '其他采样来源';
}

/** Group by declared source/preset, never by screen shape alone. Works with old reports. */
export function describeSample(sample) {
  const reasons=sample.reasons||(sample.reason?[sample.reason]:[]);
  const preset=PRESET_LABELS[sample.label] ? sample.label :
    reasons.some(reason=>reason==='common'||reason==='explicit')
      ? COMMON_SIZES.find(([w,h,,input])=>w===sample.width&&h===sample.height&&input===(sample.input||'touch'))?.[2] : null;
  const declared=SCREEN_GROUPS.find(group=>group.id===sample.group);
  if(sample.group&&!declared)throw new Error(`Unknown screen group: ${sample.group}`);
  const group=declared||SCREEN_GROUPS.find(group=>group.id===(preset?PRESET_LABELS[preset][0]:'boundary'));
  let label=sample.label;
  if(PRESET_LABELS[label])label=PRESET_LABELS[label][1];
  if(!label||/^\d+[×x]\d+$/.test(label))label=group.id==='boundary'
    ? reasons.some(reason=>reason.startsWith('height breakpoint'))?'高度边界样本'
      :reasons.some(reason=>reason.startsWith('width breakpoint'))?'宽度边界样本':'自定义尺寸采样'
    :group.label+'参考尺寸';
  return {...sample,group:group.id,groupLabel:group.label,label,
    inputLabel:sample.input==='mouse'?'鼠标':'触摸',
    displayReasons:reasons.map(chineseReason)};
}

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
    else candidates.set(key, {id:key,width,height,input,dpr,reasons:[reason],label:sample.label || `${width}×${height}`,
      ...(sample.group?{group:sample.group}:{})});
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
  const all = [...candidates.values()].map(describeSample);
  if (!all.length) throw new Error('Matrix contains no viewport samples');
  return {cases:all.slice(0,maxCases),deferred:all.slice(maxCases),outsideBounds:outside,
    ...parsed,bounds,maxCases,candidateCount:all.length,
    coverage:'有限视口采样和单轴布局边界检查，未穷尽全部宽高组合，也不代表真实设备验收。'};
}
