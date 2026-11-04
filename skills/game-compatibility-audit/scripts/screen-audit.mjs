#!/usr/bin/env node
/** Screen sampling CLI. Requires the target project's Playwright, not game dependencies. */
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {buildMatrix} from './screen-matrix.mjs';
import {discoverMedia,probeScreen} from './screen-probe.mjs';
import {writeScreenReport} from './screen-report.mjs';

const digest = value=>createHash('sha256').update(value).digest('hex');
const inside=(child,parent)=>child===parent||child.startsWith(parent+path.sep);
const safeUrl=value=>{const u=new URL(value);return u.origin+u.pathname+(u.search?'?[query omitted]':'');};
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
  if(args[i]==='--help'){console.log('node screen-audit.mjs --config screen.json --out <new-directory> [--serve <static-root>] [--project <project-root>] [--playwright <index.mjs>] [--engine chromium|webkit|firefox] [--channel msedge] [--matrix-only]');process.exit(0)}
  if(args[i]==='--matrix-only'){options.matrixOnly=true;continue}
  const keys={'--config':'config','--out':'out','--serve':'serve','--project':'project','--playwright':'playwright','--engine':'engine','--channel':'channel'};
  if(!keys[args[i]]||!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Unknown or missing argument: ${args[i]}`);
  options[keys[args[i]]]=args[++i];
}
if(!options.config||!options.out)throw new Error('Provide --config and a new --out directory. See --help.');
const configPath=path.resolve(options.config),configDir=path.dirname(configPath),configBytes=await fs.readFile(configPath);
const config=JSON.parse(configBytes),output=path.resolve(options.out),engine=options.engine||config.engine||'chromium';
if(!['chromium','webkit','firefox'].includes(engine))throw new Error('Unsupported browser engine');
if(!Array.isArray(config.screens)||!config.screens.length)throw new Error('config.screens must specify at least one interface');
const ids=new Set();
for(const screen of config.screens){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(screen.id||'')||ids.has(screen.id))throw new Error('Each screen needs a unique safe id');
  if(typeof screen.url!=='string')throw new Error('Each screen needs a url (or a path when --serve is used)');
  ids.add(screen.id);
  for(const action of screen.actions||[]){
    if(!['activate','click','tap','waitFor','press'].includes(action.type)||typeof action.selector!=='string')
      throw new Error('Only explicit locator activate/click/tap/waitFor/press actions are supported');
  }
}
const timeout=config.timeoutMs??20000;
if(!Number.isFinite(timeout)||timeout<100||timeout>180000)throw new Error('timeoutMs must be 100..180000');
const conditions=[...(config.breakpointConditions||[])],sourceFiles=[];
for(const relative of config.cssSources||[]){
  const file=path.resolve(configDir,relative),bytes=await fs.readFile(file),text=bytes.toString('utf8');
  sourceFiles.push({path:relative,sha256:digest(bytes)});
  for(const match of text.matchAll(/@media\s*([^{}]+)\{/g))conditions.push(match[1].trim());
}
let staticRoot,server,origin,browser;
const artifacts=[];
if(options.serve){
  staticRoot=await fs.realpath(path.resolve(options.serve));
  if(inside(output,staticRoot))throw new Error('Report output must be outside the served artifact');
  const walk=async dir=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name);
    if(entry.isSymbolicLink())throw new Error('Served artifact must not contain links');
    if(entry.isDirectory())await walk(file);
    else if(entry.isFile()){const bytes=await fs.readFile(file);artifacts.push({path:path.relative(staticRoot,file).split(path.sep).join('/'),bytes:bytes.length,sha256:digest(bytes)});}
  }};
  await walk(staticRoot);artifacts.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.mkdir(output); // Deliberately refuses to overwrite an existing report.
await fs.mkdir(path.join(output,'screenshots'));
let adapter;
if(config.adapter){
  const file=path.resolve(configDir,config.adapter),bytes=await fs.readFile(file);
  sourceFiles.push({path:config.adapter,sha256:digest(bytes)});
  adapter=await import(pathToFileURL(file).href);
}
const report={schemaVersion:1,title:config.title||'界面屏幕尺寸检查',description:config.description||'',
  createdAt:new Date().toISOString(),engine:engine+(options.channel?`/${options.channel}`:''),
  configSha256:digest(configBytes),sourceFiles,
  artifact:staticRoot?{kind:'served-directory',files:artifacts,sha256:digest(JSON.stringify(artifacts))}:null,
  screens:config.screens.map(screen=>({id:screen.id,title:screen.title||screen.id,url:screen.url.startsWith('http')?safeUrl(screen.url):screen.url})),
  environment:'Fresh isolated desktop-browser contexts; input and DPR are emulation settings. No physical phone or official platform simulator.',
  results:[],discovery:[]};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.mp3':'audio/mpeg','.wav':'audio/wav','.gif':'image/gif','.ico':'image/x-icon'};
async function startServer(){
  server=http.createServer(async(req,res)=>{try{
    const u=new URL(req.url,'http://local'),decoded=decodeURIComponent(u.pathname);
    const file=path.resolve(staticRoot,'.'+decoded+(decoded.endsWith('/')?'index.html':''));
    if(!inside(file,staticRoot)){res.writeHead(403).end();return}
    const real=await fs.realpath(file);
    if(!inside(real,staticRoot)||(await fs.stat(real)).isDirectory()){res.writeHead(403).end();return}
    res.setHeader('Content-Type',types[path.extname(real).toLowerCase()]||'application/octet-stream');
    res.setHeader('Cache-Control','no-store');res.end(await fs.readFile(real));
  }catch{res.writeHead(404).end()}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
}
async function playwright(){
  const explicit=options.playwright||process.env.PLAYWRIGHT_MODULE;
  if(explicit)return import(pathToFileURL(path.resolve(explicit)).href);
  const project=path.resolve(options.project||configDir);
  const require=createRequire(path.join(project,'package.json'));
  let resolved;
  try{resolved=require.resolve('playwright')}catch{try{resolved=require.resolve('@playwright/test')}catch{
    throw new Error('No Playwright in the target project. Supply --project or --playwright; this tool does not install browser dependencies automatically.');
  }}
  return import(pathToFileURL(resolved).href);
}
async function contextFor(sample){return browser.newContext({viewport:{width:sample.width,height:sample.height},
  deviceScaleFactor:sample.dpr,hasTouch:sample.input==='touch',
  ...(engine==='chromium'?{isMobile:sample.input==='touch'}:{})});}
async function prepare(page,context,screen,sample,phase){
  page.setDefaultTimeout(timeout);
  const url=screen.url.startsWith('http')?screen.url:origin?new URL(screen.url,origin).href:null;
  if(!url)throw new Error('Relative screen URLs require --serve');
  if(config.safeArea){
    const {variables={},top=0,bottom=0,left=0,right=0}=config.safeArea;
    await page.addInitScript(({variables,values})=>{
      const apply=()=>{for(const [axis,key]of Object.entries(variables)){
        if(!/^--[\w-]+$/.test(key))throw new Error('Safe-area variables must be CSS custom properties');
        document.documentElement.style.setProperty(key,`${values[axis]||0}px`);
      }};
      if(document.documentElement)apply();else document.addEventListener('DOMContentLoaded',apply,{once:true});
    },{variables,values:{top,bottom,left,right}});
  }
  await page.goto(url,{waitUntil:'load',timeout});
  if(screen.root)await page.locator(screen.root).first().waitFor({state:'visible'});
  await adapter?.prepare?.({page,context,screen,sample,phase});
  for(const action of screen.actions||[]){
    const locator=page.locator(action.selector).first();
    if(action.type==='waitFor')await locator.waitFor({state:action.state||'visible'});
    else if(action.type==='press')await locator.press(action.key||'Enter');
    else if(action.type==='activate')await locator[sample.input==='touch'?'tap':'click']();
    else await locator[action.type]();
  }
  if(screen.readySelector)await page.locator(screen.readySelector).first().waitFor({state:'visible'});
  await page.evaluate(async limit=>{
    const bounded=promise=>Promise.race([promise,new Promise(resolve=>setTimeout(resolve,limit))]);
    await bounded(document.fonts?.ready||Promise.resolve());
    await bounded(Promise.all([...document.images].filter(image=>image.getClientRects().length).map(image=>{
      if(image.complete)return Promise.resolve();return new Promise(resolve=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',resolve,{once:true})});
    })));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  },Math.min(timeout,5000));
  await adapter?.settle?.({page,context,screen,sample,phase});
}
try{
  if(options.matrixOnly){
    report.matrix=buildMatrix(config.matrix,conditions);
    await fs.writeFile(path.join(output,'matrix.json'),JSON.stringify(report.matrix,null,2)+'\n');
    console.log(JSON.stringify({matrixOnly:true,cases:report.matrix.cases.length,deferred:report.matrix.deferred.length,output}));
  }else{
    if(staticRoot)await startServer();
    const pw=await playwright();
    browser=await pw[engine].launch({headless:true,...(options.channel?{channel:options.channel}:{})});
    const discoverSample={width:1024,height:768,input:'touch',dpr:1};
    for(const screen of config.screens){
      const context=await contextFor(discoverSample);
      try{
        const page=await context.newPage();
        await prepare(page,context,screen,discoverSample,'discovery');
        const media=await page.evaluate(discoverMedia);conditions.push(...media.conditions);
        report.discovery.push({screen:screen.id,status:'collected',...media});
      }catch(error){report.discovery.push({screen:screen.id,status:'error',error:error.message})}
      finally{await context.close()}
    }
    report.matrix=buildMatrix(config.matrix,conditions);
    const total=report.matrix.cases.length*config.screens.length;
    for(const sample of report.matrix.cases)for(const screen of config.screens){
      const row={screen:{id:screen.id,title:screen.title||screen.id},case:sample,status:'collected',pageErrors:[],resourceErrors:[]};
      const context=await contextFor(sample);let page;
      try{
        page=await context.newPage();page.on('pageerror',error=>row.pageErrors.push(error.message));
        page.on('response',response=>{if(response.status()>=400&&!response.url().endsWith('/favicon.ico'))row.resourceErrors.push({url:safeUrl(response.url()),status:response.status()})});
        page.on('requestfailed',request=>row.resourceErrors.push({url:safeUrl(request.url()),failure:request.failure()?.errorText}));
        await prepare(page,context,screen,sample,'capture');
        row.probe=await page.evaluate(probeScreen,{root:screen.root,checks:screen.checks,maxElements:config.maxElements});
        if(Math.abs(row.probe.viewport.width-sample.width)>1||Math.abs(row.probe.viewport.height-sample.height)>2)
          row.probe.issues.push({code:'viewport-mismatch',label:'实际布局视口与指定尺寸不一致',selector:'html',
            detail:`Requested ${sample.width}×${sample.height}, actual ${row.probe.viewport.width}×${row.probe.viewport.height}; check viewport meta and browser emulation`,priority:'P1',status:'candidate-needs-review'});
        if(row.pageErrors.length)row.probe.issues.push({code:'runtime-error',label:'页面运行错误',selector:'window',detail:row.pageErrors.join('\n'),priority:'P1',status:'candidate-needs-review'});
        if(row.resourceErrors.length)row.probe.issues.push({code:'resource-error',label:'资源请求失败',selector:'network',detail:JSON.stringify(row.resourceErrors),priority:'P2',status:'candidate-needs-review'});
      }catch(error){row.status='error';row.error=error.message}
      finally{
        if(page){try{row.screenshot=`screenshots/${screen.id}-${sample.id}.png`;await page.screenshot({path:path.join(output,row.screenshot),fullPage:false,animations:'disabled',timeout});}
          catch(error){row.screenshot=null;row.screenshotError=error.message;row.status='error'}}
        report.results.push(row);
        await context.close();
        await writeScreenReport(output,report);
        console.log(`[${report.results.length}/${total}] ${screen.id} ${sample.id}: ${row.status}; candidates=${row.probe?.issues.length??'unknown'}`);
      }
    }
    const summary=await writeScreenReport(output,report);
    console.log(JSON.stringify({output,...summary}));
    if(summary.errors)process.exitCode=2;
  }
}finally{
  if(browser)await browser.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
}
