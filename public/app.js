
const el = id => document.getElementById(id);
const fmt = n => Number(n || 0).toLocaleString('pt-BR');

let lastData = null;
let orgUsage = null;
let ultimaConsultaOrganizacao = 0;
let consultaOrganizacaoEmAndamento = false;

const INTERVALO_ORGANIZACAO_MS = 60000;

function drawTrend(data) {
  const cvs = el('chart');
  const dpr = window.devicePixelRatio || 1;
  const w = cvs.clientWidth;
  const h = 225;

  cvs.width = w * dpr;
  cvs.height = h * dpr;

  const ctx = cvs.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const left = 20, right = 8, top = 18, bottom = 12;
  const rows = data || [];
  const max = Math.max(2, ...rows.map(v => v.requests));

  ctx.strokeStyle = '#283249';
  ctx.lineWidth = 1;

  for (let i = 0; i < 5; i++) {
    const y = top + (h - top - bottom) * i / 4;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(w - right, y);
    ctx.stroke();
  }

  const bw = (w - left - right) / Math.max(1, rows.length);

  rows.forEach((r, i) => {
    const bh = (r.requests / max) * (h - top - bottom);
    const x = left + i * bw + bw * 0.2;

    ctx.fillStyle = '#686fe8';
    ctx.fillRect(x, h - bottom - bh, bw * 0.6, bh);

    if (r.errors) {
      ctx.fillStyle = '#e979a4';
      ctx.fillRect(
        x,
        h - bottom - bh,
        bw * 0.6,
        (r.errors / max) * (h - top - bottom)
      );
    }
  });
}

function atualizarCardsConsumo() {
  if (!lastData) return;

  // Prioriza dados globais quando estiverem disponiveis
  const input = orgUsage
    ? orgUsage.inputTokens
    : lastData.inputTokens;

  const output = orgUsage
    ? orgUsage.outputTokens
    : lastData.outputTokens;

  const total = orgUsage
    ? orgUsage.totalTokens
    : input + output;

  const custo = orgUsage
    ? orgUsage.costUSD
    : lastData.estimatedCost;

  el('tokens').textContent = fmt(total);
  el('tin').textContent = fmt(input);
  el('tout').textContent = fmt(output);
  el('cost').textContent =
    '$' + Number(custo || 0).toFixed(6);
}

function refreshUI(s) {
  lastData = s;

  el('model').textContent = s.model;

  el('avg').textContent = fmt(s.avgLatency);
  el('p95').textContent = fmt(s.p95Latency);

  // Tokens e custos locais ou globais
  atualizarCardsConsumo();

  el('errors').textContent = s.errors;

  el('rate').textContent = s.calls
    ? (100 * s.success / s.calls).toFixed(1) + '%'
    : '—';

  el('remaining').textContent =
    `${s.remaining} chamadas restantes hoje`;

  const badge = el('healthbadge');

  badge.textContent = !s.ready
    ? 'SEM CHAVE'
    : s.inFlight
      ? 'BUSY'
      : s.lastStatus.toUpperCase();

  el('healthNum').textContent = !s.ready
    ? 'SETUP'
    : s.lastStatus === 'error'
      ? 'ERROR'
      : s.inFlight
        ? 'BUSY'
        : s.lastStatus === 'online'
          ? 'OK'
          : 'IDLE';

  el('healthNum').style.color =
    s.lastStatus === 'error'
      ? '#f3919a'
      : '#4bdfbb';

  const alert = el('alert');
  alert.hidden = !!s.ready;
  alert.textContent =
    'Adicione OPENAI_API_KEY no arquivo .env e reinicie o servidor.';

  el('logs').innerHTML = s.events.length
    ? s.events.slice(0, 9).map(e => `
      <div class="logitem">
        <span>${new Date(e.ts).toLocaleTimeString('pt-BR')}</span>
        <span class="${e.ok ? 'pillok' : 'pillerr'}">
          ● ${e.ok ? '200 OK' : 'ERROR'}
        </span>
        <span>${fmt(e.ms)} ms</span>
        <span>${fmt((e.input || 0) + (e.output || 0))}</span>
      </div>
    `).join('')
    : '<div class="empty">Aguardando requisições...</div>';

  el('updated').textContent =
    new Date().toLocaleTimeString('pt-BR');

  drawTrend(s.trend);
}

async function atualizarConsumoOrganizacao() {
  const agora = Date.now();

  // Evita consultas simultaneas ou muito frequentes
  if (
    consultaOrganizacaoEmAndamento ||
    agora - ultimaConsultaOrganizacao <
      INTERVALO_ORGANIZACAO_MS
  ) {
    return;
  }

  ultimaConsultaOrganizacao = agora;
  consultaOrganizacaoEmAndamento = true;

  try {
    const response = await fetch('/api/org-usage', {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const dados = await response.json();

    if (!dados.enabled) {
      throw new Error(
        dados.error || 'Consulta indisponivel'
      );
    }

    orgUsage = {
      inputTokens: Number(dados.inputTokens || 0),
      outputTokens: Number(dados.outputTokens || 0),
      totalTokens: Number(
        dados.totalTokens ??
        ((dados.inputTokens || 0) +
         (dados.outputTokens || 0))
      ),
      costUSD: Number(dados.costUSD || 0)
    };

    atualizarCardsConsumo();

  } catch (erro) {
    // Mantem os ultimos dados validos
    console.warn(
      'Consumo da organizacao:',
      erro.message
    );
  } finally {
    consultaOrganizacaoEmAndamento = false;
  }
}

async function fetchMetrics() {
  try {
    const r = await fetch('/api/metrics', {
      cache: 'no-store'
    });

    if (!r.ok) {
      throw new Error('API indisponível');
    }

    refreshUI(await r.json());

  } catch (e) {
    el('alert').hidden = false;
    el('alert').textContent = e.message;
  }

  // Consulta organizacao no maximo 1 vez/minuto
  await atualizarConsumoOrganizacao();
}

el('send').addEventListener('click', async () => {
  const prompt = el('prompt').value.trim();

  if (!prompt) {
    el('result').textContent =
      'Digite um prompt antes de enviar.';
    return;
  }

  el('send').disabled = true;
  el('result').textContent =
    'Consultando OpenAI...';

  try {
    const r = await fetch('/api/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt })
    });

    const j = await r.json();

    el('result').textContent = r.ok
      ? j.answer
      : j.error || 'Erro desconhecido';

  } catch (e) {
    el('result').textContent = String(e);
  } finally {
    el('send').disabled = false;
    await fetchMetrics();
  }
});

window.addEventListener('resize', () => {
  if (lastData) {
    drawTrend(lastData.trend);
  }
});

fetchMetrics();
setInterval(fetchMetrics, 2500);
