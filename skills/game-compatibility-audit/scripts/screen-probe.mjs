/** Serialize into the page. Findings are candidates; no business actions are performed. */
export function discoverMedia() {
  const conditions = [], inaccessible = [];
  const walk = rules => { for (const rule of rules) {
    if (rule.constructor.name === 'CSSMediaRule') conditions.push(rule.conditionText);
    if (rule.cssRules) walk(rule.cssRules);
  } };
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules); } catch { inaccessible.push(sheet.href || 'inline stylesheet'); }
  }
  return {conditions:[...new Set(conditions)],inaccessible};
}

export function probeScreen(options) {
  const root = document.querySelector(options.root || 'body');
  if (!root) throw new Error(`Target root not found: ${options.root}`);
  const viewport = {width:innerWidth,height:innerHeight,dpr:devicePixelRatio};
  const rect = node => { const r=node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
  const visible = node => {
    const style = getComputedStyle(node), r = node.getBoundingClientRect();
    if(node.closest('[hidden],[inert]')||style.visibility==='hidden'||style.display==='none'||r.width<=0||r.height<=0)return false;
    for(let current=node;current;current=current.parentElement)if(Number(getComputedStyle(current).opacity)===0)return false;
    return true;
  };
  const issues = [], observations = [], inspected = [];
  const issue = (code,label,selector,detail,priority='P1') => issues.push({code,label,selector,detail,priority,status:'candidate-needs-review'});
  const rootRect=rect(root);
  if (document.documentElement.scrollWidth > innerWidth+2)
    issue('page-horizontal-overflow','页面横向溢出','html',`scrollWidth=${document.documentElement.scrollWidth}; viewport=${innerWidth}`);
  const checks = options.checks || [{selector:'button,a[href],input,select,textarea,[role="button"],[role="tab"]'}];
  let count=0;
  for (const check of checks) {
    const nodes = [...root.querySelectorAll(check.selector)];
    if (root.matches(check.selector)) nodes.unshift(root);
    const shown = nodes.filter(visible);
    if (check.required && !shown.length)
      issue('required-element-missing',check.label||'指定控件未显示',check.selector,'No visible matching element');
    for (const node of shown) {
      if (++count > (options.maxElements || 160)) break;
      const r=rect(node), nodeLabel=node.getAttribute('aria-label')||node.textContent?.trim().slice(0,70)||node.tagName;
      const label=check.label?(check.label+(shown.length>1?' · '+nodeLabel:'')):nodeLabel;
      const ancestors=[]; let parent=node.parentElement;
      while(parent && parent!==document.documentElement) {
        const style=getComputedStyle(parent), pr=rect(parent);
        ancestors.push({node:parent,r:pr,x:style.overflowX,y:style.overflowY,
          sx:parent.scrollWidth>parent.clientWidth+2,sy:parent.scrollHeight>parent.clientHeight+2});
        parent=parent.parentElement;
      }
      const clips = ancestors.map(a=>({...a,
        clippedX:/hidden|clip|auto|scroll/.test(a.x)&&(r.x<a.r.x-2||r.right>a.r.right+2),
        clippedY:/hidden|clip|auto|scroll/.test(a.y)&&(r.y<a.r.y-2||r.bottom>a.r.bottom+2)}))
        .filter(a=>a.clippedX||a.clippedY);
      const offX=r.x < -2 || r.right > innerWidth+2,offY=r.y < -2 || r.bottom > innerHeight+2;
      const offscreen=offX||offY,clipX=clips.find(a=>a.clippedX),clipY=clips.find(a=>a.clippedY);
      const bodyStyle=getComputedStyle(document.body);
      const canX=clipX?(clipX.sx&&/auto|scroll/.test(clipX.x)):
        document.documentElement.scrollWidth>innerWidth+2&&!/hidden|clip/.test(bodyStyle.overflowX);
      const canY=clipY?(clipY.sy&&/auto|scroll/.test(clipY.y)):
        document.documentElement.scrollHeight>innerHeight+2&&!/hidden|clip/.test(bodyStyle.overflowY);
      const scrollable = !((clipX||offX)&&!canX) && !((clipY||offY)&&!canY);
      let access='visible';
      if (offscreen || clips.length) {
        access=scrollable?'scroll-reachable-unverified':'clipped';
        if(scrollable) observations.push({code:'scroll-access-needs-input-test',label,selector:check.selector,rect:r});
        else issue('clipped-control',label,check.selector,JSON.stringify({rect:r,viewport,ancestorClipping:clips.length}));
      }
      const enabled = !node.matches(':disabled') && node.getAttribute('aria-disabled')!=='true';
      const samples = [[.5,.5],[.2,.2],[.8,.2],[.2,.8],[.8,.8]];
      let sampled=0,hits=0;
      if(access==='visible' && enabled && check.hitTest!==false) for(const [fx,fy] of samples){
        const x=r.x+r.width*fx,y=r.y+r.height*fy;
        if(x<0||y<0||x>=innerWidth||y>=innerHeight)continue;
        sampled++;
        const at=document.elementFromPoint(x,y);
        if(at&&(at===node||node.contains(at)))hits++;
      }
      if(sampled&&hits<sampled) issue('hit-obstructed',label,check.selector,
        `${hits}/${sampled} sampled points hit the element; actual click/touch is still required`);
      if(check.minTargetSize && enabled && (r.width<check.minTargetSize||r.height<check.minTargetSize))
        issue('small-target',label,check.selector,`${r.width.toFixed(1)}×${r.height.toFixed(1)} CSS px; project target=${check.minTargetSize}`, 'P2');
      if((check.minVisibleHeight&&r.height<check.minVisibleHeight)||(check.minVisibleWidth&&r.width<check.minVisibleWidth))
        issue('small-content-region',label,check.selector,`${r.width.toFixed(1)}×${r.height.toFixed(1)} CSS px; configured minimum=${check.minVisibleWidth||0}×${check.minVisibleHeight||0}`);
      if(check.textOverflow && (node.scrollWidth>node.clientWidth+2||node.scrollHeight>node.clientHeight+2))
        issue('text-overflow',label,check.selector,'Text/content exceeds client bounds; intentional scrolling/truncation needs review','P2');
      inspected.push({label,selector:check.selector,rect:r,access,enabled,sampled,hits});
    }
  }
  // A scrollable region smaller than one text line cannot be assumed usable.
  // Keep this a candidate: Canvas-only strips or intentional controls need human review.
  for(const node of [root,...root.querySelectorAll('*')]){
    if(node.closest('[hidden],[inert]'))continue;
    const style=getComputedStyle(node),r=rect(node);
    if(style.display==='none'||style.visibility==='hidden'||!node.getClientRects().length||r.width<=0)continue;
    const font=parseFloat(style.fontSize)||16,line=parseFloat(style.lineHeight)||font*1.2;
    if(/auto|scroll/.test(style.overflowY)&&node.scrollHeight>node.clientHeight+2&&r.height<line)
      issue('collapsed-scrollport','滚动内容区不足一行高',node.id?'#'+node.id:node.tagName.toLowerCase(),
        `visibleHeight=${r.height.toFixed(1)} CSS px; computed readable line≈${line.toFixed(1)}; actual input/visual review required`);
  }
  const brokenImages=[...root.querySelectorAll('img')].filter(node=>visible(node)&&node.complete&&node.naturalWidth===0)
    .map(node=>({alt:node.alt,source:node.getAttribute('src')}));
  for(const image of brokenImages) issue('broken-image',image.alt||'图片加载失败','img',image.source||'Empty image source');
  const canvases=[...root.querySelectorAll('canvas')].filter(visible).map(node=>({rect:rect(node),width:node.width,height:node.height}));
  for(const canvas of canvases)if(!canvas.width||!canvas.height)issue('zero-canvas','画布缓冲尺寸为零','canvas',JSON.stringify(canvas));
  return {viewport,rootRect,issues,observations,inspected,canvases,brokenImages,
    truncated:count>(options.maxElements||160),
    limits:'DOM geometry/hit samples only; does not prove real actions, text aesthetics, GPU pixels, storage or real-device support.'};
}
