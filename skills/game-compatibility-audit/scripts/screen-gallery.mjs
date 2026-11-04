/** Browser-only renderer, embedded by function serialization to avoid nested escaping. */
export function mountGallery() {
  const D=JSON.parse(document.getElementById('data').textContent);
  const $=selector=>document.querySelector(selector);
  const E=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const groups=D.groups,results=D.results,rank=groups.map(group=>group.id);
  let shown=[],current=0,selectedGroup='';
  for(const screen of D.screens){
    const option=document.createElement('option');option.value=screen.id;option.textContent=screen.title;$('#screen').append(option);
  }
  const tabs=document.createElement('div');tabs.className='group-tabs';tabs.setAttribute('aria-label','屏幕分组');
  tabs.innerHTML=[{id:'',label:'全部分组'},...groups].map(group=>
    `<button type="button" data-group="${E(group.id)}" aria-pressed="${group.id===''?'true':'false'}">${E(group.label)}</button>`).join('');
  document.querySelector('.toolbar').prepend(tabs);
  function status(row){return row.status==='error'?'执行未完成':row.probe?.issues.length?`候选 ${row.probe.issues.length} 条`:'未见自动候选';}
  function card(row,index){
    const sample=row.case,issues=row.probe?.issues||[];
    return `<article class="card"><button class="shot" data-i="${index}" aria-label="放大截图">${row.screenshot?`<img loading="lazy" src="${E(row.screenshot)}" alt="${E(row.screen.title+' '+sample.width+'×'+sample.height)}">`:'未取得截图'}</button>
      <div class="body"><div class="size">${sample.width} × ${sample.height}</div>
      <span class="badge category">${E(sample.groupLabel)}</span> <span class="badge ${row.status==='error'?'error':issues.length?'warn':''}">${status(row)}</span>
      <p>${E(row.screen.title)}</p><div class="sub">${E(sample.label)}</div><div class="sub">${E(sample.inputLabel)} · 像素倍率 ${sample.dpr}倍</div>
      <div class="sub">${E(sample.displayReasons.join(' / '))}</div>
      ${row.error?'<p class="issue">界面采集未完成，放大查看原始记录。</p>':issues.slice(0,2).map(issue=>`<p class="issue">${E(issue.label)} · ${E(issue.displayName)}</p>`).join('')}</div></article>`;
  }
  function matchesFilters(row){
    const mode=$('#state').value,orientation=$('#orientation').value;
    const query=$('#search').value.trim();
    const text=[row.case.width+'x'+row.case.height,row.case.groupLabel,row.case.label,...row.case.displayReasons].join(' ');
    return (!$('#screen').value||row.screen.id===$('#screen').value)&&
      (!mode||(mode==='candidate'?!!row.probe?.issues.length:mode==='error'?row.status==='error':row.status!=='error'&&!row.probe?.issues.length))&&
      (!orientation||(orientation==='portrait'?row.case.height>=row.case.width:row.case.width>row.case.height))&&text.includes(query);
  }
  function render(){
    const filtered=results.filter(matchesFilters);
    shown=filtered.filter(row=>!selectedGroup||row.case.group===selectedGroup)
      .sort((a,b)=>rank.indexOf(a.case.group)-rank.indexOf(b.case.group));
    for(const button of tabs.querySelectorAll('button')){
      const group=groups.find(group=>group.id===button.dataset.group);
      const count=group?filtered.filter(row=>row.case.group===group.id).length:filtered.length;
      button.textContent=(group?.label||'全部分组')+'（'+count+'）';
      button.setAttribute('aria-pressed',String(button.dataset.group===selectedGroup));
    }
    $('#count').textContent=`显示 ${shown.length} / ${results.length} 组`;
    $('#grid').className='groups';
    $('#grid').innerHTML=groups.map(group=>{
      const members=shown.map((row,index)=>({row,index})).filter(item=>item.row.case.group===group.id);
      if(!members.length)return '';
      return `<section class="report-group" data-category="${E(group.id)}"><div class="group-heading"><h2>${E(group.label)} <span>${members.length}组</span></h2><p>${E(group.note)}</p></div><div class="grid">${members.map(item=>card(item.row,item.index)).join('')}</div></section>`;
    }).join('')||'<p class="empty">当前筛选没有样本</p>';
    document.querySelectorAll('[data-i]').forEach(button=>button.onclick=()=>openShot(Number(button.dataset.i)));
  }
  function openShot(index){
    if(!shown.length)return;
    current=(index+shown.length)%shown.length;const row=shown[current],sample=row.case;
    $('#caption').textContent=`${sample.groupLabel} · ${row.screen.title} · ${sample.width}×${sample.height} · ${sample.inputLabel}`;
    $('#large').innerHTML=row.screenshot?`<img src="${E(row.screenshot)}" alt="界面完整截图">`:'无截图';
    const details=(row.probe?.issues||[]).map(issue=>
      `<article><b>${E(issue.label)}</b><p>${E(issue.priorityLabel+' · '+issue.displayName)}</p><p>${E(issue.displayDetail)}</p><details><summary>原始技术证据</summary><pre>${E(issue.selector+'\n'+issue.code+'\n'+issue.detail)}</pre></details></article>`).join('');
    $('#notes').innerHTML=`<b>${status(row)}</b><p>自动候选尚未人工确认。</p><p>${E(sample.label)} · ${E(sample.displayReasons.join(' / '))}</p>`+
      (row.error?`<details><summary>原始采集错误</summary><pre>${E(row.error)}</pre></details>`:'')+details+
      `<h4>滚动与检查观察</h4><p>${row.probe?.observations.length||0}项需实际输入核对</p><h4>运行与资源记录</h4>`+
      (row.pageErrors?.length||row.resourceErrors?.length?`<pre>${E(JSON.stringify({'页面异常':row.pageErrors,'资源异常':row.resourceErrors},null,2))}</pre>`:'<p>本次采集未记录到异常。</p>');
    if(!$('#preview').open)$('#preview').showModal();
  }
  for(const button of tabs.querySelectorAll('button'))button.onclick=()=>{selectedGroup=button.dataset.group;render();};
  $('#close').onclick=()=>$('#preview').close();$('#prev').onclick=()=>openShot(current-1);$('#next').onclick=()=>openShot(current+1);
  for(const id of ['screen','state','orientation','search'])$('#'+id).addEventListener('input',render);
  document.addEventListener('keydown',event=>{if($('#preview').open&&event.key==='ArrowRight')openShot(current+1);if($('#preview').open&&event.key==='ArrowLeft')openShot(current-1);});
  $('#coverage').textContent=`有效采样候选 ${D.matrix.candidateCount}；本轮计划 ${D.matrix.cases.length}；达到数量上限后未运行 ${D.matrix.deferred.length}；范围外 ${D.matrix.outsideBounds.length}；未解析条件 ${D.matrix.unsupportedConditions.length}。有限视口与单轴边界采样，未穷尽全部尺寸组合。`+
    (D.matrix.deferred.length?' 未运行尺寸：'+D.matrix.deferred.map(sample=>sample.width+'×'+sample.height).join('、'):'');
  render();
}
