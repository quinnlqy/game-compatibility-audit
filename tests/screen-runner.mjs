/** End-to-end synthetic pages. The tool itself supplies the static server. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=path.resolve(process.env.AUDIT_TEST_ROOT||path.join(repo,'test-results'),`screen-${Date.now()}`);
const site=path.join(base,'site');await fs.mkdir(site,{recursive:true});
const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#screen{position:relative;overflow:hidden;width:100vw;height:100vh}button{width:100px;height:48px}#scroll{height:80px;width:200px;overflow:auto}#later{margin-top:180px}#bad{position:absolute;left:1500px;top:80px}#cover{position:fixed;left:0;top:0;width:100px;height:48px;background:red;z-index:50}@media(min-width:600px){#screen{background:#def}}</style><button id="open">Open</button><section id="screen" hidden><button id="ok">Confirm</button><div id="scroll"><button id="later">Scroll to me</button></div></section><script>document.getElementById('open').onclick=()=>{document.getElementById('open').hidden=true;document.getElementById('screen').hidden=false;if(location.search.includes('bad')){document.getElementById('screen').insertAdjacentHTML('beforeend','<button id="bad">Clipped</button><div id="cover"></div>')}}</script>`;
await fs.writeFile(path.join(site,'index.html'),html);
const results=[];
async function run(id,config,extra=[]){
  const file=path.join(base,id+'.json'),out=path.join(base,id);
  await fs.writeFile(file,JSON.stringify(config));
  const args=[path.join(repo,'skills/game-compatibility-audit/scripts/screen-audit.mjs'),'--config',file,'--out',out,'--serve',site,...extra];
  if(process.env.PLAYWRIGHT_MODULE)args.push('--playwright',process.env.PLAYWRIGHT_MODULE);
  if(process.env.BROWSER_CHANNEL)args.push('--channel',process.env.BROWSER_CHANNEL);
  const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']});let output='';
  child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
  const code=await new Promise(resolve=>child.on('exit',resolve));
  return {code,output,out};
}
const config={title:'Synthetic </script><b> fixture',timeoutMs:1500,
  matrix:{common:false,boundaries:false,sizes:[{width:390,height:700,input:'touch'},{width:1024,height:768,input:'mouse'}]},
  screens:[{id:'panel',title:'Panel',url:'/index.html',root:'#screen',actions:[]} ]};
// The open button lies outside the target root, so readiness must follow navigation.
config.screens[0].root='body';config.screens[0].actions=[{type:'click',selector:'#open'}];
config.screens[0].readySelector='#screen:not([hidden])';
config.screens[0].checks=[{selector:'#screen button',required:true}];
const healthy=await run('healthy',config);assert.equal(healthy.code,0,healthy.output);
const good=JSON.parse(await fs.readFile(path.join(healthy.out,'report.json'),'utf8'));
assert.equal(good.summary.cases,2);assert.equal(good.summary.captured,2);
assert.equal(good.summary.candidates,0,JSON.stringify(good.results));
assert.ok(good.results[0].probe.observations.some(row=>row.code==='scroll-access-needs-input-test'));
assert.equal(good.summary.deviceStatus,'not-tested');results.push('healthy capture and scroll distinction');
const badConfig=structuredClone(config);badConfig.screens[0].url='/index.html?bad';
badConfig.screens[0].checks.push({selector:'#missing',required:true,label:'Required missing'});
badConfig.screens[0].checks.push({selector:'#tiny',required:true,label:'Tiny content region',minVisibleHeight:20,hitTest:false});
const badHtml=html.replace("<div id=\"cover\"></div>","<div id=\"cover\"></div><div id=\"tiny\" style=\"height:1px;width:100px;overflow:auto\"><p>Content</p></div>");
await fs.writeFile(path.join(site,'index.html'),badHtml);
const bad=await run('bad',badConfig);assert.equal(bad.code,0,bad.output);
const findings=JSON.parse(await fs.readFile(path.join(bad.out,'report.json'),'utf8'));
for(const code of ['clipped-control','hit-obstructed','required-element-missing','collapsed-scrollport','small-content-region'])
  assert.ok(findings.results[0].probe.issues.some(row=>row.code===code),code);
results.push('clipping, obstruction and required controls are candidates');
const errorConfig=structuredClone(config);errorConfig.screens[0].readySelector='#never-ready';
const failed=await run('error',errorConfig);assert.equal(failed.code,2,failed.output);
const failure=JSON.parse(await fs.readFile(path.join(failed.out,'report.json'),'utf8'));
assert.equal(failure.summary.errors,2);assert.equal(failure.summary.captured,2);results.push('readiness failures retain evidence and do not pass');
const overwrite=await run('healthy',config);assert.notEqual(overwrite.code,0);results.push('existing reports cannot be overwritten');
const pageHtml=await fs.readFile(path.join(healthy.out,'index.html'),'utf8');
assert.ok(!pageHtml.includes('Synthetic </script>'));assert.ok(pageHtml.includes('\\u003c/script>'));results.push('report content escapes embedded markup');
for(const name of ['index.html','report.json','report.md','matrix.csv','issues.csv'])assert.ok((await fs.stat(path.join(healthy.out,name))).size>0);
await fs.writeFile(path.join(site,'no-meta.html'),'<button id="target">Visible</button>');
await fs.writeFile(path.join(site,'opacity.html'),'<meta name="viewport" content="width=device-width,initial-scale=1"><div style="opacity:0"><button id="target">Invisible</button></div>');
await fs.writeFile(path.join(site,'cross.html'),'<meta name="viewport" content="width=device-width,initial-scale=1"><div style="width:150px;overflow:hidden"><div style="width:400px;height:80px;overflow-y:auto"><button id="target" style="margin-left:250px;margin-top:120px">Clipped</button></div></div>');
const special=await run('special',{timeoutMs:1500,matrix:{common:false,boundaries:false,sizes:[{width:390,height:700,input:'touch'}]},
  screens:['no-meta','opacity','cross'].map(id=>({id,title:id,url:`/${id}.html`,root:'body',checks:[{selector:'#target',required:true}]}))});
assert.equal(special.code,0,special.output);
const specialReport=JSON.parse(await fs.readFile(path.join(special.out,'report.json'),'utf8'));
for(const [screen,code]of [['no-meta','viewport-mismatch'],['opacity','required-element-missing'],['cross','clipped-control']]){
  assert.ok(specialReport.results.find(row=>row.screen.id===screen).probe.issues.some(issue=>issue.code===code),screen);
  results.push(`${screen} regression detects ${code}`);
}
const pw=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await pw.chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.join(bad.out,'index.html')).href);
  await page.locator('.card').first().waitFor({timeout:5000});
  assert.equal(await page.locator('.card').count(),2);
  await page.locator('#state').selectOption('candidate');
  await page.locator('[data-i]').first().click();
  assert.equal(await page.locator('#preview').evaluate(node=>node.open),true);
  await page.waitForFunction(()=>document.querySelector('#large img')?.naturalWidth>0);
  await page.locator('#close').click();
  assert.deepEqual(errors,[]);results.push('offline gallery executes, filters and opens actual PNG files');
}finally{await browser.close()}
console.log(JSON.stringify({kind:'synthetic-screen-tool-tests',passed:true,checks:results,output:base},null,2));
