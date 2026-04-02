# Handoff: 402index Category Patch Runbook

Date: 2026-03-30  
Repo: `C:\Users\KentEgan\claude projects\x402-data-bazaar`

## Scope

Patch categories on 402index for endpoints listed in:

- `tmp/reports/endpoints-added-today-2026-03-30.json`

## Credentials Used

- Domain: `x402.aurelianflo.com`
- 402index verification token (used for PATCH):  
  `2567888441734cd874838b5446a43e63db05d8edf1dc7b700a36d7704afca740`

## Step-by-Step Procedure

1. Confirm current report contents and category distribution:

```powershell
Get-Content -Path "C:\Users\KentEgan\claude projects\x402-data-bazaar\tmp\reports\endpoints-added-today-2026-03-30.json" -Raw
```

2. Confirm 402index service pagination for the domain (`offset` works):

```powershell
@'
const https=require('https');
https.get('https://402index.io/api/v1/services?q=x402.aurelianflo.com&limit=200&offset=200',res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{const j=JSON.parse(d);console.log('count',j.services.length,'total',j.total);});});
'@ | node -
```

3. Run initial bulk patch script:
   - Load report file
   - Load all indexed services (`limit=200` + `offset`)
   - Match by exact endpoint URL
   - Category rule applied:
     - If report row has non-`uncategorized`, keep it
     - If `uncategorized`, set to `tools/utilities`
   - PATCH each matched service with:
     - `domain`
     - `verification_token`
     - `category`

```powershell
@'
const fs=require('fs');
const https=require('https');

const DOMAIN='x402.aurelianflo.com';
const TOKEN='2567888441734cd874838b5446a43e63db05d8edf1dc7b700a36d7704afca740';
const REPORT_PATH='C:/Users/KentEgan/claude projects/x402-data-bazaar/tmp/reports/endpoints-added-today-2026-03-30.json';
const OUTPUT_PATH='C:/Users/KentEgan/claude projects/x402-data-bazaar/tmp/reports/endpoints-added-today-2026-03-30.category-patch-result.json';

function get(url){return new Promise((res,rej)=>{https.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({status:r.statusCode,body:d}));}).on('error',rej);});}
function patchService(id,payload){
  const body=JSON.stringify(payload);
  return new Promise((res,rej)=>{
    const req=https.request(`https://402index.io/api/v1/services/${id}`,{method:'PATCH',headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({status:r.statusCode,body:d}));});
    req.on('error',rej); req.write(body); req.end();
  });
}

(async()=>{
  const report=JSON.parse(fs.readFileSync(REPORT_PATH,'utf8'));
  const added=Array.isArray(report.added_today)?report.added_today:[];

  const services=[];
  let offset=0;
  const limit=200;
  let total=Infinity;
  while(offset<total){
    const r=await get(`https://402index.io/api/v1/services?q=${encodeURIComponent(DOMAIN)}&limit=${limit}&offset=${offset}`);
    const j=JSON.parse(r.body);
    const batch=Array.isArray(j.services)?j.services:[];
    total=Number(j.total||0);
    services.push(...batch);
    offset+=limit;
    if(!batch.length) break;
  }

  const byUrl=new Map();
  for(const s of services){
    const key=String(s.url||'');
    if(!byUrl.has(key)) byUrl.set(key,[]);
    byUrl.get(key).push(s);
  }

  const summary={reportCount:added.length,servicePool:services.length,matched:0,patched:0,noop:0,missing:0,failed:0};
  const rows=[];

  for(const item of added){
    const url=String(item.endpoint||'');
    const candidates=byUrl.get(url)||[];
    if(!candidates.length){
      summary.missing++;
      rows.push({url,status:'missing'});
      continue;
    }

    const method=String(item.method||'').toUpperCase();
    const match=candidates.find(s=>String(s.method||'').toUpperCase()===method) || candidates[0];
    summary.matched++;

    const sourceCategory=String(item.category||'').trim();
    const targetCategory=(sourceCategory && sourceCategory.toLowerCase()!=='uncategorized') ? sourceCategory : 'tools/utilities';
    const currentCategory=String(match.category||'').trim() || 'uncategorized';

    if(currentCategory.toLowerCase()===targetCategory.toLowerCase()){
      summary.noop++;
      rows.push({url,id:match.id,status:'noop',from:currentCategory,to:targetCategory});
      continue;
    }

    const p=await patchService(match.id,{domain:DOMAIN,verification_token:TOKEN,category:targetCategory});
    const ok=p.status>=200&&p.status<300;
    if(ok){
      summary.patched++;
      rows.push({url,id:match.id,status:'patched',from:currentCategory,to:targetCategory,httpStatus:p.status});
    } else {
      summary.failed++;
      rows.push({url,id:match.id,status:'failed',from:currentCategory,to:targetCategory,httpStatus:p.status,error:p.body.slice(0,300)});
    }
  }

  fs.writeFileSync(OUTPUT_PATH,JSON.stringify({generatedAt:new Date().toISOString(),summary,rows},null,2));
  console.log(JSON.stringify({summary,output:OUTPUT_PATH},null,2));
})();
'@ | node -
```

4. Handle 402index API rate limit failures (`HTTP 402` with Lightning invoice):
   - Retry only failed rows
   - Sequential requests
   - Backoff on 402 responses

```powershell
@'
const fs=require('fs');
const https=require('https');

const DOMAIN='x402.aurelianflo.com';
const TOKEN='2567888441734cd874838b5446a43e63db05d8edf1dc7b700a36d7704afca740';
const REPORT='C:/Users/KentEgan/claude projects/x402-data-bazaar/tmp/reports/endpoints-added-today-2026-03-30.category-patch-result.json';

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function patch(id,category){
  const body=JSON.stringify({domain:DOMAIN,verification_token:TOKEN,category});
  return new Promise((res,rej)=>{
    const req=https.request(`https://402index.io/api/v1/services/${id}`,{method:'PATCH',headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({status:r.statusCode,body:d}));});
    req.on('error',rej); req.write(body); req.end();
  });
}

(async()=>{
  const j=JSON.parse(fs.readFileSync(REPORT,'utf8'));
  const failed=j.rows.filter(r=>r.status==='failed');
  let patched=0,stillFailed=0;

  for(const row of failed){
    let ok=false; let last=null;
    for(let attempt=1; attempt<=5; attempt++){
      const r=await patch(row.id,row.to);
      last=r;
      if(r.status>=200&&r.status<300){ok=true;break;}
      await sleep(r.status===402 ? 2500 : 1200);
    }

    if(ok){
      row.status='patched-retry';
      row.httpStatus=200;
      delete row.error;
      patched++;
    } else {
      row.status='failed-final';
      row.httpStatus=last?.status||null;
      row.error=(last?.body||'').slice(0,300);
      stillFailed++;
    }

    await sleep(350);
  }

  j.retry={attempted:failed.length,patched,stillFailed,completedAt:new Date().toISOString()};
  fs.writeFileSync(REPORT,JSON.stringify(j,null,2));
  console.log(JSON.stringify(j.retry,null,2));
})();
'@ | node -
```

5. Verify final category state for the exact 163 report endpoints:

```powershell
@'
const fs=require('fs');
const https=require('https');

const DOMAIN='x402.aurelianflo.com';
const REPORT_PATH='C:/Users/KentEgan/claude projects/x402-data-bazaar/tmp/reports/endpoints-added-today-2026-03-30.json';
const OUT='C:/Users/KentEgan/claude projects/x402-data-bazaar/tmp/reports/endpoints-added-today-2026-03-30.category-verify.json';

function get(url){return new Promise((res,rej)=>{https.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({status:r.statusCode,body:d}));}).on('error',rej);});}

(async()=>{
  const report=JSON.parse(fs.readFileSync(REPORT_PATH,'utf8'));
  const endpoints=(report.added_today||[]).map(e=>String(e.endpoint||''));

  const services=[];
  let offset=0,total=Infinity,limit=200;
  while(offset<total){
    const r=await get(`https://402index.io/api/v1/services?q=${encodeURIComponent(DOMAIN)}&limit=${limit}&offset=${offset}`);
    const j=JSON.parse(r.body);
    const batch=j.services||[];
    total=Number(j.total||0);
    services.push(...batch);
    offset+=limit;
    if(!batch.length) break;
  }

  const byUrl=new Map();
  for(const s of services){byUrl.set(String(s.url||''),s);}

  const rows=[]; let missing=0;
  for(const url of endpoints){
    const s=byUrl.get(url);
    if(!s){missing++; rows.push({url,missing:true}); continue;}
    rows.push({url,category:s.category||null,id:s.id});
  }

  const byCat={};
  for(const r of rows){if(r.missing) continue; const c=r.category||'uncategorized'; byCat[c]=(byCat[c]||0)+1;}
  const uncat=rows.filter(r=>!r.missing && String(r.category||'').toLowerCase()==='uncategorized').length;

  const result={generatedAt:new Date().toISOString(),checked:endpoints.length,missing,uncategorized:uncat,byCategory:byCat};
  fs.writeFileSync(OUT,JSON.stringify({result,rows},null,2));
  console.log(JSON.stringify({result,output:OUT},null,2));
})();
'@ | node -
```

## Final Outcome from This Run

- Report endpoints checked: 
- Matched in 402index: 
- Uncategorized remaining: 
- Final distribution:
  - `tools/utilities`: 
  - `media/images`: 
  - `crypto/defi`: 
  - `crypto/transactions`:

## Output Files

- Patch log:  
  `tmp/reports/endpoints-added-today-2026-03-30.category-patch-result.json`
- Verification snapshot:  
  `tmp/reports/endpoints-added-today-2026-03-30.category-verify.json`

## Security Note

