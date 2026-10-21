import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const model = process.env.OPENAI_MODEL || 'gpt-6-luna';
const maxDailyCalls = Math.max(1, Number(process.env.MAX_DAILY_CALLS || 20));
const inputPrice = Number(process.env.PRICE_INPUT_PER_M || 0.10);
const outputPrice = Number(process.env.PRICE_OUTPUT_PER_M || 0.50);
const apiKey = process.env.OPENAI_API_KEY || '';
const openai = apiKey && apiKey !== 'cole_sua_chave_aqui' ? new OpenAI({apiKey,timeout:25000,maxRetries:0}) : null;
const dataDir = path.join(__dirname, 'data');
const logFile = path.join(dataDir, 'events.jsonl');
fs.mkdirSync(dataDir, {recursive:true});
const events = [];
if (fs.existsSync(logFile)) {
  for (const line of fs.readFileSync(logFile,'utf8').split('\n').filter(Boolean)) {
    try { const item=JSON.parse(line); if(item && item.ts) events.push(item); } catch {}
  }
}
let inFlight = 0;
function save(item){ events.push(item);fs.appendFileSync(logFile,JSON.stringify(item)+'\n'); }
function dayKey(d=new Date()){ return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d); }
function todayEvents(){ const day=dayKey();return events.filter(e=>dayKey(new Date(e.ts))===day); }
function stats(){
 const today=todayEvents();const ok=today.filter(e=>e.ok);const sorted=ok.map(e=>e.ms).sort((a,b)=>a-b);
 const sum=k=>today.reduce((a,e)=>a+(Number(e[k])||0),0);
 const cost=today.reduce((a,e)=>a+(Number(e.cost)||0),0);
 const recent=events.slice(-60);
 const last=events.at(-1);
 return {model,ready:!!openai,dailyLimit:maxDailyCalls,usedToday:today.length,remaining:Math.max(0,maxDailyCalls-today.length),calls:today.length,success:ok.length,errors:today.length-ok.length,inputTokens:sum('input'),outputTokens:sum('output'),estimatedCost:cost,avgLatency:ok.length?Math.round(sorted.reduce((a,b)=>a+b,0)/ok.length):0,p95Latency:sorted.length?sorted[Math.ceil(sorted.length*.95)-1]:0,lastLatency:last?.ms||0,lastStatus:last?(last.ok?'online':'error'):'idle',inFlight,events:recent.slice().reverse().map(e=>({id:e.id,ts:e.ts,ok:e.ok,model:e.model,ms:e.ms,input:e.input,output:e.output,cost:e.cost,error:e.error||null,preview:e.preview||''})),trend:makeTrend(today)};
}
function makeTrend(today){ const now=Date.now();const bins=Array.from({length:20},(_,i)=>({t:i,requests:0,tokens:0,errors:0})); for(const e of today){ const delta=now-new Date(e.ts).getTime(); const i=19-Math.floor(delta/(3*60*1000));if(i>=0&&i<20){ bins[i].requests++;bins[i].tokens+=(e.input||0)+(e.output||0);if(!e.ok)bins[i].errors++; }}return bins; }
app.use(express.json({limit:'12kb'}));
app.use(express.static(path.join(__dirname,'public')));
app.get('/api/health',(req,res)=>res.json({ok:true,configured:!!openai,model}));
app.get('/api/metrics',(req,res)=>res.json(stats()));

let consumoOLEDCache = null;
let consumoOLEDAtualizadoEm = 0;
let consultaOLEDPendente = null;

async function obterConsumoOLED() {
  const agora = Date.now();

  // Reutiliza os dados durante 60 segundos
  if (
    consumoOLEDCache &&
    agora - consumoOLEDAtualizadoEm < 60000
  ) {
    return consumoOLEDCache;
  }

  // Evita consultas duplicadas
  if (consultaOLEDPendente) {
    return consultaOLEDPendente;
  }

  consultaOLEDPendente = (async () => {
    const porta = process.env.PORT || 3000;

    const response = await fetch(
      `http://127.0.0.1:${porta}/api/org-usage`,
      { signal: AbortSignal.timeout(15000) }
    );

    if (!response.ok) {
      throw new Error(`Organizacao HTTP ${response.status}`);
    }

    const dados = await response.json();

    if (!dados.enabled) {
      throw new Error("Consumo global indisponivel");
    }

    consumoOLEDCache = dados;
    consumoOLEDAtualizadoEm = Date.now();

    return dados;
  })();

  try {
    return await consultaOLEDPendente;
  } finally {
    consultaOLEDPendente = null;
  }
}

app.get('/api/oled', async (req, res) => {
  const s = stats();
  const last = s.events[0];

  let input = s.inputTokens;
  let output = s.outputTokens;
  let cost = s.estimatedCost;
  let source = 'local';

  try {
    const org = await obterConsumoOLED();

    input = org.inputTokens;
    output = org.outputTokens;
    cost = org.costUSD;
    source = 'organization';

  } catch (error) {
    console.warn('OLED:', error.message);

    // Mantem dados locais se a consulta global falhar
  }

  res.json({
    model: s.model.replace(/^gpt-/, '').substring(0, 16),
    status: !s.ready
      ? 'NO KEY'
      : s.inFlight
        ? 'BUSY'
        : s.lastStatus === 'error'
          ? 'ERROR'
          : s.lastStatus === 'idle'
            ? 'IDLE'
            : 'ONLINE',
    calls: s.calls,
    limit: s.dailyLimit,
    latency: s.lastLatency,
    input,
    output,
    errors: s.errors,
    cost,
    source,
    latest: last?.preview || ''
  });
});

app.post('/api/ask',async(req,res)=>{
 const prompt=typeof req.body?.prompt==='string'?req.body.prompt.trim():'';
 if(!prompt || prompt.length>1500) return res.status(400).json({error:'Digite uma pergunta entre 1 e 1500 caracteres.'});
 if(!openai) return res.status(503).json({error:'Configure sua OPENAI_API_KEY no .env.'});
 if(todayEvents().length+inFlight>=maxDailyCalls) return res.status(429).json({error:'Limite diario local de requisicoes atingido.'});
 const start=Date.now(); const id=crypto.randomUUID().slice(0,8);inFlight++;
 try {
  const response=await openai.responses.create({model,input:prompt,max_output_tokens:250,store:false});
  const answer=response.output_text?.trim()||'A API nao retornou texto visivel.';
  const input=Number(response.usage?.input_tokens||0),output=Number(response.usage?.output_tokens||0);
  const cost=(input*inputPrice+output*outputPrice)/1e6;
  const item={id,ts:new Date().toISOString(),ok:true,model,ms:Date.now()-start,input,output,cost,preview:answer.replace(/\s+/g,' ').slice(0,130)};
  save(item);res.json({answer,request:item});
 }catch(err){
  const item={id,ts:new Date().toISOString(),ok:false,model,ms:Date.now()-start,input:0,output:0,cost:0,error:String(err.status||err.code||'ERR')+': '+String(err.message||'Erro').slice(0,130),preview:''};
  save(item);res.status(err.status&&err.status>=400&&err.status<600?err.status:502).json({error:'Falha na API: '+item.error});
 }finally{inFlight--;}
});

app.get("/api/org-usage", async (req, res) => {
  const adminKey = process.env.OPENAI_ADMIN_KEY;

  if (!adminKey || adminKey === "sua_chave_administrativa_aqui") {
    return res.status(503).json({
      enabled: false,
      error: "Configure OPENAI_ADMIN_KEY no .env"
    });
  }

  // Inicio do dia em UTC
  const now = new Date();
  const startTime = Math.floor(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    ) / 1000
  );

  async function consultarAPI(path) {
    let url = new URL(`https://api.openai.com/v1/${path}`);

    url.searchParams.set("start_time", startTime);
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("limit", "1");

    let resultados = [];

    // Suporte a paginacao
    for (let pagina = 0; pagina < 20; pagina++) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${adminKey}`
        }
      });

      if (!response.ok) {
        throw new Error(
          `OpenAI HTTP ${response.status}`
        );
      }

      const dados = await response.json();

      resultados.push(...(dados.data || []));

      if (!dados.has_more || !dados.next_page) {
        break;
      }

      url.searchParams.set("page", dados.next_page);
    }

    return resultados;
  }

  try {
    const [usage, costs] = await Promise.all([
      consultarAPI("organization/usage/completions"),
      consultarAPI("organization/costs")
    ]);

    let inputTokens = 0;
    let outputTokens = 0;
    let requests = 0;
    let costUSD = 0;

    for (const bucket of usage) {
      for (const item of bucket.results || []) {
        inputTokens += item.input_tokens || 0;
        outputTokens += item.output_tokens || 0;
        requests += item.num_model_requests || 0;
      }
    }

    for (const bucket of costs) {
      for (const item of bucket.results || []) {
        if (item.amount?.currency === "usd") {
          costUSD += item.amount.value || 0;
        }
      }
    }

    res.json({
      enabled: true,
      period: "today_utc",
      source: "openai_organization",
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      requests,
      costUSD
    });

  } catch (error) {
    console.error("Erro org usage:", error.message);

    res.status(502).json({
      enabled: false,
      error: error.message
    });
  }
});

app.listen(port,'0.0.0.0',()=>console.log(`LLM Control Center: http://localhost:${port} | Modelo ${model} | Chave ${openai?'configurada':'AUSENTE'}`));
