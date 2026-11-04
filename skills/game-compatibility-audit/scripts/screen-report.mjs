import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {SCREEN_GROUPS,describeSample} from './screen-matrix.mjs';
import {mountGallery} from './screen-gallery.mjs';

const escape = value => String(value??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cell = value => `"${String(value??'').replaceAll('"','""')}"`;
const md = value => String(value??'').replaceAll('|','\\|').replaceAll('\n',' ');

const ISSUE_NAMES={
  'small-target':'触控区域偏小','small-content-region':'内容显示区偏小','clipped-control':'控件被裁切',
  'hit-obstructed':'点击区域被遮挡','required-element-missing':'关键控件未显示',
  'page-horizontal-overflow':'页面横向溢出','text-overflow':'文字或内容溢出','broken-image':'图片加载失败',
  'zero-canvas':'画布缓冲尺寸为零','collapsed-scrollport':'滚动内容区过矮',
  'viewport-mismatch':'实际视口与指定尺寸不符','runtime-error':'页面运行异常','resource-error':'资源请求失败',
};
function describeIssue(issue){
  let displayDetail='请结合截图与实际操作确认；展开原始技术证据可查看测量和日志。';
  const target=/^([\d.]+)×([\d.]+) CSS px; project target=([\d.]+)/.exec(issue.detail||'');
  const region=/^([\d.]+)×([\d.]+) CSS px; configured minimum=([\d.]+)×([\d.]+)/.exec(issue.detail||'');
  if(target)displayDetail=`当前区域约${target[1]}×${target[2]}像素；项目触控目标为宽高至少${target[3]}像素。`;
  if(region)displayDetail=`当前内容区约${region[1]}×${region[2]}像素；本次审阅要求`+
    [Number(region[3])?`宽度至少${region[3]}像素`:'',Number(region[4])?`高度至少${region[4]}像素`:''].filter(Boolean).join('、')+'。';
  return {...issue,displayName:ISSUE_NAMES[issue.code]||'其他待确认问题',displayDetail,
    priorityLabel:({'P0':'阻断风险','P1':'重点检查','P2':'一般检查'})[issue.priority]||'待确认'};
}

export async function writeScreenReport(output, report) {
  const rows=report.results;
  for(const field of ['cases','deferred','outsideBounds'])report.matrix[field]=report.matrix[field].map(describeSample);
  for(const row of rows){row.case=describeSample(row.case);if(row.probe)row.probe.issues=row.probe.issues.map(describeIssue);}
  report.groups=SCREEN_GROUPS.map(group=>({...group,count:rows.filter(row=>row.case.group===group.id).length}));
  report.displayVersion=2;report.displayUpdatedAt=new Date().toISOString();
  report.engineLabel=report.engine.includes('msedge')?'本地Edge浏览器':report.engine.startsWith('webkit')?'本地WebKit浏览器':
    report.engine.startsWith('firefox')?'本地火狐浏览器':'本地Chromium浏览器';
  report.summary={screens:report.screens.length,cases:rows.length,
    captured:rows.filter(row=>row.screenshot).length,errors:rows.filter(row=>row.status==='error').length,
    casesWithCandidates:rows.filter(row=>row.probe?.issues.length).length,
    candidates:rows.reduce((n,row)=>n+(row.probe?.issues.length||0),0),
    deferred:report.matrix.deferred.length,deviceStatus:'not-tested'};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  const matrixHeader=['样本编号','分组','界面','宽度','高度','像素倍率','输入方式','采样来源','采集状态','候选问题数','截图'];
  const matrixRows=rows.map(row=>[row.case.id,row.case.groupLabel,row.screen.title,row.case.width,row.case.height,row.case.dpr,row.case.inputLabel,
    row.case.displayReasons.join('；'),row.status==='error'?'未完成':'已采集',row.probe?.issues.length??'',row.screenshot||'']);
  await fs.writeFile(path.join(output,'matrix.csv'),'\ufeff'+[matrixHeader,...matrixRows].map(row=>row.map(cell).join(',')).join('\n')+'\n');
  const issuesHeader=['样本编号','分组','界面','检查级别','问题类型','控件','说明','确认状态'];
  const issues=rows.flatMap(row=>(row.probe?.issues||[]).map(issue=>[row.case.id,row.case.groupLabel,row.screen.title,issue.priorityLabel,
    issue.displayName,issue.label,issue.displayDetail,'待人工确认']));
  await fs.writeFile(path.join(output,'issues.csv'),'\ufeff'+[issuesHeader,...issues].map(row=>row.map(cell).join(',')).join('\n')+'\n');
  const lines=[`# ${report.title}`, '',
    `生成时间：${report.createdAt}；环境：本地浏览器 ${report.engine}，不是平台PC模拟器或手机真机。`,
    `共${report.summary.cases}组，截图${report.summary.captured}张，执行失败${report.summary.errors}组，自动候选${report.summary.candidates}条。`,
    `尚未运行的矩阵候选：${report.matrix.deferred.length}；不自动穷尽全部宽高组合。`, '',
    '自动候选需结合截图及真实操作确认；没有候选不等于全部适配通过。滚动可达性、图片美观、Canvas内容和业务动作另行验收。', '',
    ...report.groups.flatMap(group=>{const members=rows.filter(row=>row.case.group===group.id);return members.length?[
      `## ${group.label}（${members.length}组）`,'',group.note,'',
      '| 尺寸与输入 | 界面 | 自动候选 | 执行状态 | 截图 |','| --- | --- | ---: | --- | --- |',
      ...members.map(row=>`| ${row.case.width}×${row.case.height} / ${row.case.inputLabel} / 像素倍率${row.case.dpr}倍 | ${md(row.screen.title)} | ${row.probe?.issues.length??'—'} | ${row.status==='error'?'未完成':'已采集'} | ${row.screenshot?`[查看](${row.screenshot})`:'无'} |`),'']:[];}), '',
    '## 待确认问题', '',...rows.flatMap(row=>[
      ...(row.error?[`- ${row.case.id}：执行未完成：${md(row.error)}`]:[]),
      ...(row.probe?.issues||[]).map(issue=>`- ${row.case.groupLabel} / ${row.case.width}×${row.case.height} / ${md(row.screen.title)} / ${issue.priorityLabel} / ${issue.displayName}：${md(issue.label)}；${md(issue.displayDetail)}`),
    ]), '', '完整观察、资源失败、日志、未运行尺寸、断点和来源指纹见 report.json。'];
  await fs.writeFile(path.join(output,'report.md'),lines.join('\n')+'\n');
  const data=JSON.stringify(report).replace(/</g,'\\u003c');
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(report.title)}</title>
<style>
:root{color-scheme:light;--ink:#263c37;--muted:#64736b;--paper:#f7f5ec;--line:#d9dfd4;--accent:#466951}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.65 system-ui,"Microsoft YaHei",sans-serif}header{padding:34px 4vw 20px;background:#e9eedf;border-bottom:1px solid var(--line)}h1{font-size:30px;margin:0 0 8px;letter-spacing:.02em}p{margin:5px 0}a{color:var(--accent)}.eyebrow{font-size:12px;letter-spacing:.12em;color:var(--muted)}.stats{display:flex;gap:25px;flex-wrap:wrap;margin:20px 0 12px}.stats b{font-size:25px;margin-right:7px}.notice{max-width:1100px;color:var(--muted);font-size:13px}.toolbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:13px 4vw;background:#f7f5ecf5;border-bottom:1px solid var(--line)}select,input,button{font:inherit;color:inherit;background:white;border:1px solid #bccabd;border-radius:7px;padding:7px 11px}button{cursor:pointer}.count{margin-left:auto;color:var(--muted);font-size:13px}main{padding:23px 4vw}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:20px}.card{min-width:0;background:#fffdf6;border:1px solid var(--line);border-radius:10px;overflow:hidden}.shot{height:300px;background:repeating-conic-gradient(#e8e9e1 0% 25%,#eff0e9 0% 50%) 0/18px 18px;display:flex;align-items:center;justify-content:center;cursor:zoom-in;border:0;border-radius:0;padding:10px;width:100%}.shot img{display:block;max-width:100%;max-height:100%;object-fit:contain;box-shadow:0 2px 9px #0002}.body{padding:14px 16px}.size{font-size:20px;font-weight:650}.badge{display:inline-block;padding:2px 7px;font-size:11px;background:#eaf0e4;border-radius:4px;color:#47663e}.warn{background:#fff0cf;color:#805e17}.error{background:#f9ded5;color:#953b28}.sub{font-size:12px;color:var(--muted);word-break:break-word}.issue{font-size:12px;color:#84582b;margin:5px 0 0}.links{display:flex;gap:15px;flex-wrap:wrap;font-size:13px;margin-top:12px}details{margin:20px 0;padding:12px 16px;border:1px solid var(--line);border-radius:8px;background:#fffdf6}summary{cursor:pointer}.empty{padding:50px;color:var(--muted)}dialog{width:min(1400px,97vw);height:95vh;padding:0;border:1px solid var(--line);border-radius:10px;background:var(--paper)}dialog::backdrop{background:#14241ce0}.modal-head{display:flex;align-items:center;gap:9px;padding:12px 18px;border-bottom:1px solid var(--line)}.modal-head strong{flex:1}.modal-content{display:grid;grid-template-columns:minmax(0,1fr) 330px;height:calc(95vh - 66px)}.large{padding:20px;overflow:auto;display:flex;align-items:flex-start;justify-content:center;background:#e9ebe3}.large img{max-width:100%;height:auto;max-height:none}.notes{padding:18px;overflow:auto;font-size:13px}.notes article{padding:10px 0;border-bottom:1px solid var(--line)}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,monospace}@media(max-width:760px){h1{font-size:23px}.modal-content{grid-template-columns:1fr;overflow:auto}.large{min-height:40vh}.notes{overflow:visible}.count{width:100%;margin:0}}

.groups{display:block}.report-group{margin-bottom:40px}.group-heading{margin:4px 0 18px;padding:0 0 10px;border-bottom:1px solid var(--line)}.group-heading h2{font-size:23px;margin:0}.group-heading h2 span{font-size:13px;font-weight:400;color:var(--muted);margin-left:9px}.group-heading p{font-size:13px;color:var(--muted)}.group-tabs{width:100%;display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px}.group-tabs button{font-size:14px;background:#f1f3e9}.group-tabs button[aria-pressed=true]{background:#466951;color:white;border-color:#466951}.category{background:#e5eced;color:#3d5d66}.notes details{margin:10px 0;padding:7px;font-size:12px}
</style><header><div class="eyebrow">屏幕适配检查 · 截图报告</div><h1>${escape(report.title)}</h1><p>${escape(report.description||'指定界面的多尺寸截图与自动候选问题')}</p><div class="stats"><span><b>${report.summary.cases}</b>组样本</span><span><b>${report.summary.captured}</b>张截图</span><span><b>${report.summary.casesWithCandidates}</b>组有候选问题</span><span><b>${report.summary.errors}</b>组执行未完成</span></div><p class="notice">尺寸为网页可用区域。${escape(report.engineLabel)}模拟，未进行手机真机或官方平台PC模拟器验收。自动候选需要人工确认；无候选也不表示操作、Canvas画面和存档已通过。</p><div class="links"><a href="report.json">完整记录</a><a href="matrix.csv">尺寸清单</a><a href="issues.csv">问题清单</a><a href="report.md">文字报告</a></div></header>
<div class="toolbar"><select id="screen"><option value="">全部界面</option></select><select id="state"><option value="">全部状态</option><option value="candidate">有候选问题</option><option value="clear">未见自动候选</option><option value="error">执行未完成</option></select><select id="orientation"><option value="">全部方向</option><option value="portrait">竖屏</option><option value="landscape">横屏</option></select><input id="search" aria-label="筛选尺寸" placeholder="筛选尺寸，例如 390"><span class="count" id="count"></span></div><main><div class="grid" id="grid"></div><details><summary>覆盖范围与尚未运行的尺寸</summary><div id="coverage"></div></details></main><dialog id="preview"><div class="modal-head"><button id="prev">←</button><strong id="caption"></strong><button id="next">→</button><button id="close">关闭</button></div><div class="modal-content"><div class="large" id="large"></div><aside class="notes" id="notes"></aside></div></dialog>
<script type="application/json" id="data">${data}</script><script>(${mountGallery.toString()})();</script></html>`;
  await fs.writeFile(path.join(output,'index.html'),html);
  return report.summary;
}

// Display-only refresh of an existing report. Original screenshots and measurements stay intact.
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [flag,file,...extra]=process.argv.slice(2);
  if(flag!=='--refresh'||!file||extra.length)throw new Error('Usage: node screen-report.mjs --refresh <report.json>');
  const source=path.resolve(file),output=path.dirname(source),report=JSON.parse(await fs.readFile(source,'utf8'));
  if(!Array.isArray(report.results)||!report.matrix||!Array.isArray(report.screens))throw new Error('Not a screen audit report');
  const backup=path.join(output,'report-backups',new Date().toISOString().replace(/[:.]/g,'-'));
  await fs.mkdir(backup,{recursive:true});
  for(const name of ['index.html','report.json','report.md','matrix.csv','issues.csv']){
    try{await fs.copyFile(path.join(output,name),path.join(backup,name));}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const summary=await writeScreenReport(output,report);
  console.log(JSON.stringify({output,backup,groups:report.groups.map(group=>({label:group.label,count:group.count})),...summary}));
}
