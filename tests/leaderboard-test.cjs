const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'streamlined-hf-model-search.html'), 'utf8');
const source = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {innerHTML:'',textContent:'',value:'',dataset:{},style:{},children:[],classList:{add(){},remove(){}},addEventListener(){},
    replaceChildren(){this.children=[];},appendChild(child){this.children.push(child);},querySelector(){return element('tbody');}});
  return elements.get(id);
}
const revision = '9c09a7cae43334062a82cb164f2ef255013dafa2';
const features = ['fullname','Precision','Flagged','IFEval','MMLU-PRO'].map(name=>({name}));
let handler, calls=[];
const live = process.env.LIVE_LEADERBOARD === '1';
const context = vm.createContext({console,TextEncoder,URLSearchParams,AbortController,setTimeout,clearTimeout,requestAnimationFrame:()=>1,
  document:{readyState:'loading',addEventListener(){},getElementById:element,querySelector:selector=>element(selector==='#regex-results tbody'?'tbody':selector),createElement:()=>element(Math.random())},window:{},
  fetch:async url=>{calls.push(url);return live?fetch(url):handler(url);}
});
const expose=`globalThis.api={loadLeaderboard,stopLeaderboardImport,compactLeaderboardRow,leaderboardBenchmarks,benchmarkValue,benchmarkCell,sortRows,normalizeModel,CONFIG,
  rows:_leaderboardRows, results:_searchResults, choose:key=>{_benchmarkKey=key;}, revision:()=>_leaderboardRevision,
  bump:()=>{_fetchGeneration++;},clear:()=>{_leaderboardRows.clear();_leaderboardScoreCache.clear();_leaderboardRevision='';}};`;
vm.runInContext(source.replace(/\}\)\(\);\s*$/,expose+'\n})();'),context);
const api=context.api;
if(!live){api.CONFIG.RATE_WINDOW=1;api.CONFIG.MAX_RETRIES=0;}
function row(id='Org/Plain',value=20,precision='bfloat16') {return {fullname:id,Precision:precision,'Weight type':'Original','Chat Template':true,'Model sha':'a'.repeat(40),eval_name:id+'_evaluation',Flagged:false,'Average ⬆️':value,IFEval:0,'IFEval Raw':0,'MMLU-PRO':30};}
function page(rows,offset=0,total=rows.length,rev=revision,overrides={}) {return {ok:true,status:200,headers:{get:key=>key==='X-Revision'?rev:null},text:async()=>JSON.stringify({features,partial:false,num_rows_total:total,rows:rows.map((row,i)=>({row_idx:offset+i,row,truncated_cells:[]})),...overrides})};}
function status(){return element('leaderboard-status').textContent;}
async function until(predicate){for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw new Error('Condition timeout');}
function reset(){api.clear();calls=[];api.results.length=0;}

(async()=>{
  if(live){
    api.results.push({model:{id:'0-hero/Matter-0.2-7B-DPO',benchmarks:[]},snippet:''});
    await api.loadLeaderboard();
    assert(api.rows.size>1000,status());
    const scores=api.leaderboardBenchmarks('0-hero/Matter-0.2-7B-DPO');
    assert(scores.length>=7);
    const average=scores.find(score=>score.label.includes('Average'));
    assert.equal(average.value,8.90636130175029);
    console.log(JSON.stringify({live:true,repositories:api.rows.size,revision:api.revision(),requests:calls.length,exampleAverage:average.value,status:status()}));
    return;
  }
  assert.equal(api.compactLeaderboardRow({...row(),Flagged:true}),null);
  assert.equal(api.compactLeaderboardRow({...row(),fullname:'<a href=x>Org/Plain</a>'}),null);
  assert.equal(api.compactLeaderboardRow({...row(),Flagged:undefined}),null);
  assert.equal(api.compactLeaderboardRow({...row(),'Average ⬆️':NaN}).scores['Average ⬆️'],undefined);
  const sourceRow=row();sourceRow.Model='<script>alert(1)</script>';
  assert(!JSON.stringify(api.compactLeaderboardRow(sourceRow)).includes('<script>'));
  console.log('PASS: allowlisted numeric scores; flagged, malformed and HTML-only identities excluded');

  reset();
  api.results.push({model:{id:'Org/Plain',benchmarks:[]},snippet:''});
  handler=url=>new URL(url).searchParams.get('offset')==='0'?page([row()],0,2):page([row('Org/Other',40)],1,2);
  await api.loadLeaderboard();
  assert.equal(api.rows.size,2);
  assert.equal(api.revision(),revision);
  assert.equal(calls.length,2);
  const scores=api.leaderboardBenchmarks('Org/Plain');
  assert(scores.length>=4);
  const average=scores.find(s=>s.label.includes('Average'));
  api.choose(average.key);
  assert.equal(api.benchmarkValue({id:'Org/Plain',benchmarks:[]}),20);
  assert.equal(api.benchmarkValue({id:'Org/Plain-GGUF',benchmarks:[]}),null);
  assert.equal(api.benchmarkValue({id:'org/plain',benchmarks:[]}),null);
  assert.equal(api.sortRows([{id:'Org/Plain-GGUF'},{id:'Org/Plain'},{id:'Org/Other'}],'benchmarkScore',false).map(x=>x.id).join(','),'Org/Other,Org/Plain,Org/Plain-GGUF');
  assert.match(api.benchmarkCell({id:'Org/Plain'}),/evaluatedModelRevision/);
  assert.match(api.benchmarkCell({id:'Org/Plain'}),/historical/);
  await api.loadLeaderboard();
  assert.equal(calls.length,2);
  console.log('PASS: paginated atomic import, exact-ID/no-inheritance matching, source context, sorting and session cache');

  reset();
  handler=()=>page([row(),row('Org/Plain',30),row('Org/Plain',50,'float16')]);
  await api.loadLeaderboard();
  const variants=api.leaderboardBenchmarks('Org/Plain');
  api.choose(variants.find(s=>s.label.includes('Average')&&s.label.includes('bfloat16')).key);
  assert.equal(api.benchmarkValue({id:'Org/Plain'}),null);
  const float=variants.find(s=>s.label.includes('Average')&&s.label.includes('float16')&&!s.label.includes('bfloat16'));
  api.choose(float.key);
  assert.equal(api.benchmarkValue({id:'Org/Plain'}),50);
  console.log('PASS: conflicting runs are not cherry-picked and precisions remain separate');

  for(const badPage of [page([row()],0,1,''),page([row()],0,1,revision,{partial:true}),page([row()],0,10001),page([row()],0,1,revision,{features:[]}),page([row()],0,2,revision,{rows:[]}),page([row()],0,1,revision,{rows:[{row_idx:1,row:row(),truncated_cells:[]}]})]){
    reset();handler=()=>badPage;await api.loadLeaderboard();assert.equal(api.rows.size,0);assert.match(status(),/failed:/);
  }
  reset();handler=url=>new URL(url).searchParams.get('offset')==='0'?page([row()],0,2):page([row('Org/Other')],1,2,'b'.repeat(40));
  await api.loadLeaderboard();assert.equal(api.rows.size,0);assert.match(status(),/revision changed/);
  console.log('PASS: invalid schema, pagination, truncated/incomplete exports and changed/missing revisions fail without partial scores');

  for(const mode of ['stop','generation']){
    reset();let release;
    handler=()=>new Promise(resolve=>{release=()=>resolve(page([row()]));});
    const importing=api.loadLeaderboard();await until(()=>!!release);
    if(mode==='stop')api.stopLeaderboardImport();else api.bump();
    release();await importing;assert.equal(api.rows.size,0);assert.equal(element('leaderboard-load').disabled,false);assert.match(status(),/stopped/);
  }
  reset();handler=()=>({ok:false,status:503,headers:{get:()=>null}});
  await api.loadLeaderboard();assert.equal(api.rows.size,0);assert.match(status(),/failed:/);
  handler=()=>page([row()]);await api.loadLeaderboard();assert.equal(api.rows.size,1);
  console.log('PASS: stop, generation changes, network failure and successful retry');
  console.log('All leaderboard tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
