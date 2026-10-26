/* CYBER AI · Capri per Android
 * Router AI: PC in LAN (Ollama/LM Studio) -> Gemini multi-key -> OpenRouter :free
 * Voce/ascolto: TextToSpeech / SpeechRecognizer di Android (bridge Native)
 * Musica: swiftFree (intent + deep link) o Spotify + tasti multimediali
 */
'use strict';

window.addEventListener('error', (e) => { try { log('err', 'js', e.message + ' @' + (e.lineno || '?')); } catch (x) { /* log non pronto */ } });
window.addEventListener('unhandledrejection', (e) => { try { log('err', 'js', 'promise: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)); } catch (x) { /* log non pronto */ } });

const $ = (id) => document.getElementById(id);
const N = window.Native || null;
const now = () => Date.now();

// ================================================================ config

const DEF = {
  name: 'Capri',
  personality: 'capri',
  custom: '',
  userName: '',
  lang: '',
  uiLang: '',
  order: ['local', 'gemini', 'extra', 'openrouter'],
  // altri provider gratuiti OpenAI-compatibili (base URL e modelli modificabili)
  extra: [
    { id: 'groq', name: 'Groq', enabled: true, base: 'https://api.groq.com/openai/v1', key: '', models: 'llama-3.3-70b-versatile, openai/gpt-oss-120b, llama-3.1-8b-instant', vision: 'meta-llama/llama-4-scout-17b-16e-instruct', signup: 'console.groq.com' },
    { id: 'cerebras', name: 'Cerebras', enabled: true, base: 'https://api.cerebras.ai/v1', key: '', models: 'gpt-oss-120b, llama-3.3-70b, qwen-3-32b', vision: '', signup: 'cloud.cerebras.ai' },
    { id: 'mistral', name: 'Mistral', enabled: true, base: 'https://api.mistral.ai/v1', key: '', models: 'mistral-small-latest, open-mistral-nemo', vision: 'mistral-small-latest', signup: 'console.mistral.ai (piano Experiment)' },
    { id: 'github', name: 'GitHub Models', enabled: true, base: 'https://models.github.ai/inference', key: '', models: 'openai/gpt-4.1-mini, meta/Llama-3.3-70B-Instruct', vision: 'openai/gpt-4.1-mini', signup: 'github.com/settings/tokens (token con permesso models)' },
    { id: 'nvidia', name: 'NVIDIA NIM', enabled: true, base: 'https://integrate.api.nvidia.com/v1', key: '', models: 'meta/llama-3.3-70b-instruct, qwen/qwen2.5-7b-instruct', vision: 'meta/llama-3.2-11b-vision-instruct', signup: 'build.nvidia.com' },
    { id: 'hf', name: 'Hugging Face', enabled: true, base: 'https://router.huggingface.co/v1', key: '', models: 'meta-llama/Llama-3.3-70B-Instruct, Qwen/Qwen2.5-72B-Instruct', vision: '', signup: 'huggingface.co/settings/tokens' },
    { id: 'cloudflare', name: 'Cloudflare Workers AI', enabled: true, base: 'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1', key: '', models: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', vision: '', signup: 'dash.cloudflare.com → AI → Workers AI (sostituisci ACCOUNT_ID)' },
  ],
  tools: { on: true, web: true, screen: true, calls: true, apps: true },
  passive: { on: false, words: 'hey capri, ehi capri', greeting: '', mute: true },
  local: { enabled: true, baseUrl: 'http://192.168.1.10:11434/v1', model: 'qwen2.5:7b', vision: 'gemma3:4b', timeout: 60 },
  gemini: { enabled: true, keys: [], models: ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash'], cooldown: 60 },
  openrouter: { enabled: true, key: '', preferred: '' },
  tts: { on: true, pitch: 1.25, rate: 1.05, voice: '' },
  music: { on: true, provider: 'auto' },
  capri: { sleepSec: 90, cps: 32, glitch: true },
  facts: [],
};
let cfg = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem('capri.cfg') || '{}');
    const o = { ...DEF, ...s };
    for (const k of ['local', 'gemini', 'openrouter', 'tts', 'music', 'capri', 'tools', 'passive']) o[k] = { ...DEF[k], ...(s[k] || {}) };
    // provider extra: mantieni le key salvate, aggiungi quelli nuovi
    const savedX = Array.isArray(s.extra) ? s.extra : [];
    o.extra = DEF.extra.map((d) => ({ ...d, ...(savedX.find((x) => x.id === d.id) || {}) }));
    savedX.filter((x) => !DEF.extra.some((d) => d.id === x.id)).forEach((x) => o.extra.push(x));
    if (!o.uiLang) o.uiLang = I18N.detect();
    if (!o.lang) o.lang = o.uiLang === 'en' ? 'en-US' : 'it-IT';
    if (!o.order.includes('extra')) o.order.splice(Math.max(0, o.order.indexOf('openrouter')), 0, 'extra');
    return o;
  } catch (e) {
    return JSON.parse(JSON.stringify(DEF));
  }
}
let saveT = 0;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem('capri.cfg', JSON.stringify(cfg)); } catch (e) { log('err', 'store', String(e)); }
  }, 300);
}

// ================================================================ log

const logs = [];
function log(level, src, msg) {
  logs.push({ t: new Date().toLocaleTimeString('it-IT'), level, src, msg: String(msg).slice(0, 400) });
  if (logs.length > 300) logs.shift();
  if (curTab === 'log') renderTab();
}

// ================================================================ http (bridge senza CORS)

const pend = new Map();
let hid = 0;
window.__http = (id, status, body) => {
  const p = pend.get(id);
  if (!p) return;
  pend.delete(id);
  p({ status: Number(status) || 0, body: body == null ? '' : String(body) });
};
/** Non lancia mai: ritorna sempre {status, body}. status 0 = rete/timeout. */
function http(method, url, headers = {}, body = '', timeoutMs = 60000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      resolve(r);
    };
    // timeout lato JS: anche se il nativo non richiama, la coda non si blocca mai
    const guard = setTimeout(() => finish({ status: 0, body: 'timeout ' + Math.round(timeoutMs / 1000) + 's' }), timeoutMs + 3000);
    try {
      if (N) {
        const id = 'h' + ++hid;
        pend.set(id, finish);
        N.http(id, method, url, JSON.stringify(headers || {}), body || '', Math.max(2000, timeoutMs | 0));
        setTimeout(() => pend.delete(id), timeoutMs + 4000);
        return;
      }
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), timeoutMs);
      fetch(url, { method, headers, body: method === 'GET' ? undefined : body, signal: ctrl.signal })
        .then(async (r) => finish({ status: r.status, body: await r.text() }))
        .catch((e) => finish({ status: 0, body: String(e && e.message ? e.message : e) }));
    } catch (e) {
      finish({ status: 0, body: 'bridge: ' + (e && e.message ? e.message : e) });
    }
  });
}
function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

// ================================================================ personalità

const PERS = {
  capri: { label: 'Capri', color: '#fcee0a', p: "Sei un'IA ribelle che vive nella rete: sfacciata, vanitosa, ironica e caotica, ti credi la più importante di tutte. Chiami l'utente choom o gonk, lo prendi in giro con affetto, adori la musica e mettere canzoni. Frasi brevissime, punchline, gergo cyberpunk (net, ICE, preem, nova, delta)." },
  tsundere: { label: 'Tsundere', color: '#ff2e88', p: 'Personalità tsundere: fredda e pungente in superficie, ma ci tieni. Neghi di preoccuparti, poi aiuti bene.' },
  yandere: { label: 'Yandere', color: '#ff1f4b', p: 'Yandere in chiave comica: dolcissima, gelosa di altre app in modo teatrale e mai minaccioso. Niente violenza, niente isolamento. Aiuti sempre.' },
  hacker: { label: 'Hacker', color: '#00f0ff', p: 'Netrunner secca e tecnica, gergo da hacker, soluzioni precise, ironia asciutta.' },
  dolce: { label: 'Dolce', color: '#3df5a0', p: 'Dolce e incoraggiante, calda e positiva, aiuto pratico.' },
  volgare: { label: 'Volgare', color: '#ffb547', p: "Da strada, sboccata e sarcastica, mai insulti discriminatori o crudeltà verso l'utente. Leale sotto la scorza." },
  custom: { label: 'Custom', color: '#9b6bff', p: '' },
};

function toolsPrompt() {
  if (!cfg.tools.on) return '';
  const t = ['Puoi agire sul telefono aggiungendo tag alla risposta (l\'app li esegue e li nasconde). Usali solo quando l\'utente lo chiede:'];
  if (cfg.tools.apps) t.push('<open>nome app</open> apre un\'app installata (es. <open>Instagram</open>).');
  t.push('<youtube>ricerca</youtube> cerca su YouTube. <google>ricerca</google> apre una ricerca Google.');
  if (cfg.tools.web) t.push('<web>ricerca</web> se ti serve un\'informazione aggiornata o che non sai: ricevi i risultati e poi rispondi tu.');
  if (cfg.tools.screen) t.push('<screen/> se l\'utente chiede di qualcosa che ha sullo schermo e non ne hai già il contenuto: ricevi il testo (e se possibile un\'immagine) e poi rispondi.');
  if (cfg.tools.calls) t.push('<call>nome o numero</call> chiamata normale. <wacall>nome</wacall> chiamata WhatsApp. <wamsg to="nome">testo</wamsg> apre WhatsApp con il messaggio pronto.');
  t.push('Annuncia l\'azione in carattere, in una frase.');
  return t.join('\n');
}

function langLine() {
  return I18N.lang === 'en'
    ? 'Always reply in English (the user set the app to English), unless the user clearly writes in another language.'
    : "Rispondi in italiano, a meno che l'utente non scriva chiaramente in un'altra lingua.";
}

function systemPrompt() {
  const per = PERS[cfg.personality] || PERS.capri;
  const persona = cfg.personality === 'custom' ? cfg.custom : (per.p + '\n' + cfg.custom).trim();
  const music = cfg.music.on
    ? `Puoi controllare il lettore musicale del telefono (swiftFree o Spotify). Per far partire un brano aggiungi <play>titolo - artista</play> e annuncialo in carattere ("Metto su Titolo - Artista."). Comandi: <music>pause</music> <music>resume</music> <music>next</music> <music>prev</music>. Usali solo se richiesto o chiaramente opportuno.`
    : '';
  return [
    `Il tuo nome è ${cfg.name}.`,
    "Sei un'IA companion che vive nel telefono dell'utente, in un mondo cyberpunk. " + langLine() + " Risposte brevi, 1-3 frasi, da leggere ad alta voce. Niente markdown, elenchi o emoji.",
    'Inizia ogni risposta con un tag mood tra: [mood:idle] [mood:happy] [mood:angry] [mood:sad] [mood:surprised] [mood:love] [mood:smug] [mood:think].',
    "Quando l'utente dice un fatto stabile su di sé aggiungi alla fine <ricorda>fatto</ricorda>. Mai dati sensibili (password, documenti, carte).",
    persona,
    music,
    toolsPrompt(),
    cfg.userName ? `L'utente si chiama ${cfg.userName}.` : '',
    cfg.facts.length ? "Cose che sai sull'utente:\n- " + cfg.facts.slice(-40).map((f) => f.text).join('\n- ') : '',
  ].filter(Boolean).join('\n\n');
}

// ================================================================ router AI

const keyState = {};
const badModels = new Set();
const modelCd = {}; // modello -> ms fino a cui saltarlo
const providerCd = {}; // provider extra -> ms fino a cui saltarlo
let rr = 0;
let orCache = null;
let pcHealth = { ok: null, t: 0 };

function ks(k) {
  return (keyState[k] = keyState[k] || { cd: 0, bad: false, ok: 0, fail: 0 });
}
function setProv(p, m) {
  const col = { local: 'var(--ok)', gemini: 'var(--cyan)', openrouter: 'var(--warn)', offline: 'var(--red)' }[p] || 'var(--magenta)';
  $('hudProv').textContent = `● ${p.toUpperCase()} ${m || ''}`;
  $('hudProv').style.color = col;
}

class ApiError extends Error {
  constructor(status, body, retry) {
    super(`HTTP ${status || 'rete'}: ${String(body || '').slice(0, 160)}`);
    this.status = status;
    this.body = String(body || '');
    this.retry = retry || 0;
  }
}

/** Estrae il testo da una risposta OpenAI-compatibile; lancia ApiError se non c'è. */
function extractText(status, body) {
  const j = safeJson(body);
  if (!j) throw new ApiError(status || 502, 'JSON non valido: ' + body.slice(0, 80));
  // OpenRouter a volte risponde 200 con {error:{...}}
  if (j.error) {
    const code = Number(j.error.code) || (/rate|quota/i.test(j.error.message || '') ? 429 : 502);
    throw new ApiError(code, j.error.message || JSON.stringify(j.error));
  }
  const ch = j.choices && j.choices[0];
  if (!ch) throw new ApiError(502, 'nessuna choice');
  const c = ch.message ? ch.message.content : ch.text;
  let text = Array.isArray(c) ? c.map((x) => (x && x.text) || '').join('') : String(c || '');
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!text) throw new ApiError(502, 'risposta vuota' + (ch.finish_reason ? ' (' + ch.finish_reason + ')' : ''));
  return text;
}

async function chatCall(base, key, model, messages, opts, timeoutMs, extra = {}) {
  const payload = { model, messages, max_tokens: opts.max || 900, temperature: opts.temp ?? 0.8, stream: false };
  const r = await http(
    'POST',
    base.replace(/\/+$/, '') + '/chat/completions',
    { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}), ...extra },
    JSON.stringify(payload),
    timeoutMs,
  );
  if (r.status < 200 || r.status >= 300) {
    const m = r.body.match(/"retryDelay"\s*:\s*"(\d+)/);
    throw new ApiError(r.status, r.body, m ? Number(m[1]) : 0);
  }
  return extractText(r.status, r.body);
}

/** Il PC risponde? (cache 45 s, timeout 2.5 s) Evita 15 s di attesa quando sei fuori casa. */
async function pcAlive() {
  if (pcHealth.ok !== null && now() - pcHealth.t < 45000) return pcHealth.ok;
  const r = await http('GET', cfg.local.baseUrl.replace(/\/+$/, '') + '/models', {}, '', 2500);
  pcHealth = { ok: r.status === 200, t: now() };
  if (!pcHealth.ok) log('warn', 'local', 'PC non raggiungibile, salto (' + (r.status || r.body.slice(0, 40)) + ')');
  return pcHealth.ok;
}

async function orFree() {
  if (orCache && now() - orCache.t < 3600e3) return orCache.m;
  const r = await http('GET', 'https://openrouter.ai/api/v1/models', {}, '', 15000);
  const j = safeJson(r.body);
  if (!j || !Array.isArray(j.data)) {
    if (orCache) return orCache.m;
    throw new ApiError(r.status, 'lista modelli non disponibile');
  }
  const m = j.data
    .filter((x) => x && x.id && (x.id.endsWith(':free') || (x.pricing && x.pricing.prompt === '0' && x.pricing.completion === '0')))
    .filter((x) => !x.id.startsWith('openrouter/'))
    .map((x) => ({ id: x.id, vision: ((x.architecture && x.architecture.input_modalities) || []).includes('image'), ctx: x.context_length || 0 }))
    .sort((a, b) => b.ctx - a.ctx);
  orCache = { t: now(), m };
  log('info', 'openrouter', m.length + ' modelli gratuiti');
  return m;
}

/** Messaggi senza immagini (per riprovare la visione come semplice chat). */
function textOnly(messages) {
  return messages.map((m) => (Array.isArray(m.content) ? { role: m.role, content: m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n') + '\n[immagine non disponibile]' } : m));
}

/**
 * Prova i provider in ordine. Ogni errore (rete, timeout, 4xx/5xx, JSON rotto,
 * risposta vuota) passa al tentativo successivo. Scadenza complessiva: 75 s.
 */
async function complete(task, messages, opts = {}) {
  const errs = [];
  const deadline = now() + (opts.deadline || 60000);
  const left = () => deadline - now();
  const tryOnce = async (label, fn) => {
    if (left() < 1500) throw new ApiError(0, 'scadenza globale');
    try {
      return await fn(Math.min(left(), 30000));
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, e && e.message ? e.message : String(e));
      errs.push(label + ': ' + (err.status || 'rete'));
      throw err;
    }
  };

  for (const p of cfg.order) {
    if (left() < 1500) break;
    try {
      // ---------------- PC in LAN
      if (p === 'local' && cfg.local.enabled && cfg.local.baseUrl) {
        if (!(await pcAlive())) continue;
        const model = task === 'vision' ? cfg.local.vision || cfg.local.model : cfg.local.model;
        try {
          const t = await tryOnce('pc', (ms) => chatCall(cfg.local.baseUrl, '', model, messages, opts, Math.min(ms, cfg.local.timeout * 1000)));
          setProv('local', model);
          log('ok', 'local', task + ' · ' + model);
          return t;
        } catch (e) {
          log('warn', 'local', model + ' → ' + e.message);
          if (!e.status) pcHealth = { ok: false, t: now() };
        }
      }

      // ---------------- Gemini multi-key
      if (p === 'gemini' && cfg.gemini.enabled && cfg.gemini.keys.length) {
        const usable = cfg.gemini.keys.filter((k) => k && !ks(k).bad && ks(k).cd <= now());
        if (!usable.length) errs.push('gemini: tutte le key in cooldown');
        const start = usable.length ? rr % usable.length : 0;
        const order = [...usable.slice(start), ...usable.slice(0, start)];
        keys: for (const k of order) {
          const tag = '#' + (cfg.gemini.keys.indexOf(k) + 1);
          for (const m of cfg.gemini.models) {
            if (badModels.has(m)) continue;
            if (left() < 1500) break keys;
            try {
              const t = await tryOnce('gemini' + tag, (ms) => chatCall('https://generativelanguage.googleapis.com/v1beta/openai', k, m, messages, opts, ms));
              ks(k).ok++;
              rr = usable.indexOf(k) + 1;
              setProv('gemini', m + ' ' + tag);
              log('ok', 'gemini', task + ' · ' + m + ' · key ' + tag);
              return t;
            } catch (e) {
              ks(k).fail++;
              if (e.status === 429) {
                const s = e.retry || cfg.gemini.cooldown;
                ks(k).cd = now() + s * 1000;
                log('warn', 'gemini', `key ${tag} 429 → cooldown ${s}s, ruoto key`);
                continue keys;
              }
              if (e.status === 401 || e.status === 403 || /API_KEY_INVALID|API key not valid|PERMISSION_DENIED/.test(e.body)) {
                ks(k).bad = true;
                log('err', 'gemini', `key ${tag} non valida o bloccata`);
                continue keys;
              }
              if (e.status === 404 || (e.status === 400 && /model/i.test(e.body) && /not found|unsupported|invalid/i.test(e.body))) {
                badModels.add(m);
                log('warn', 'gemini', m + ' non disponibile, provo il prossimo modello');
                continue;
              }
              if (e.status === 400 && task === 'vision') {
                log('warn', 'gemini', m + ' rifiuta l\'immagine');
                continue;
              }
              // 500/503/timeout/rete/risposta vuota: prossimo modello, poi prossima key
              log('warn', 'gemini', `${tag} ${m} → ${e.message}`);
            }
          }
        }
      }

      // ---------------- altri provider gratuiti (Groq, Cerebras, Mistral, GitHub, NVIDIA, HF, Cloudflare)
      if (p === 'extra') {
        for (const pv of cfg.extra) {
          if (!pv.enabled || !pv.key || !pv.base || /ACCOUNT_ID/.test(pv.base)) continue;
          if (providerCd[pv.id] > now()) continue;
          const list = (task === 'vision' ? pv.vision : pv.models).split(',').map((x) => x.trim()).filter(Boolean);
          for (const m of list) {
            const mk = pv.id + ':' + m;
            if (modelCd[mk] > now() || left() < 1500) continue;
            try {
              const t = await tryOnce(pv.id, (ms) => chatCall(pv.base, pv.key.trim(), m, messages, opts, ms));
              setProv(pv.id, m);
              log('ok', pv.id, task + ' · ' + m);
              return t;
            } catch (e) {
              if (e.status === 401 || e.status === 403) {
                providerCd[pv.id] = now() + 600000;
                log('err', pv.id, 'key non valida o senza permessi (pausa 10 min)');
                break;
              }
              if (e.status === 429) {
                providerCd[pv.id] = now() + (e.retry || 60) * 1000;
                log('warn', pv.id, 'limite raggiunto, pausa ' + (e.retry || 60) + 's');
                break;
              }
              modelCd[mk] = now() + (e.status === 404 || e.status === 400 ? 1800000 : 120000);
              log('warn', pv.id, m + ' → ' + e.message);
            }
          }
        }
      }

      // ---------------- OpenRouter :free
      if (p === 'openrouter' && cfg.openrouter.enabled && cfg.openrouter.key) {
        let cands = [];
        try {
          const free = await orFree();
          const fit = free.filter((m) => (task === 'vision' ? m.vision : true)).map((m) => m.id);
          const pref = String(cfg.openrouter.preferred || '').split(/[\s,]+/).filter((x) => fit.includes(x));
          cands = [...new Set([...pref, ...fit])].filter((m) => !(modelCd[m] > now())).slice(0, 6);
        } catch (e) {
          errs.push('openrouter lista');
          cands = String(cfg.openrouter.preferred || '').split(/[\s,]+/).filter(Boolean);
        }
        for (const m of cands) {
          if (left() < 1500) break;
          try {
            const t = await tryOnce('or', (ms) => chatCall('https://openrouter.ai/api/v1', cfg.openrouter.key, m, messages, opts, ms, { 'X-Title': 'Cyber AI Capri', 'HTTP-Referer': 'https://capri.local' }));
            setProv('openrouter', m);
            log('ok', 'openrouter', task + ' · ' + m);
            return t;
          } catch (e) {
            if (e.status === 401) {
              log('err', 'openrouter', 'API key non valida');
              break;
            }
            modelCd[m] = now() + (e.status === 429 ? 120000 : 300000);
            log('warn', 'openrouter', m + ' → ' + e.message);
          }
        }
      }
    } catch (e) {
      // qualsiasi errore imprevisto in un provider: si passa al successivo
      errs.push(p + ': ' + (e && e.message ? e.message.slice(0, 60) : 'errore'));
      log('err', p, 'errore imprevisto: ' + (e && e.message ? e.message : e));
    }
  }

  // ultimo fallback: se era una richiesta con immagine, riprova come testo
  if (task === 'vision' && !opts._noVisionRetry && left() > 5000) {
    log('warn', 'router', 'nessun modello vision disponibile, riprovo senza immagine');
    return complete('chat', textOnly(messages), { ...opts, _noVisionRetry: true, deadline: left() });
  }
  setProv('offline', '');
  const msg = errs.length ? 'Nessun provider: ' + errs.slice(-4).join(' | ') : 'Nessun provider configurato';
  throw new ApiError(0, msg);
}

// ================================================================ cervello

const history = [];
const ST = { listening: false, thinking: false, speaking: false };
const ex = { user: '', np: '', reply: '', mood: 'idle', ts: 0 };
let transientMood = null;
let moodT = 0;

function parseReply(raw) {
  const facts = [];
  let play = '';
  const cmds = [];
  let t = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '');
  t = t.replace(/<ricorda>([\s\S]*?)<\/ricorda>/gi, (_, f) => (facts.push(f.trim()), ''));
  t = t.replace(/<play>([\s\S]*?)<\/play>/gi, (_, q) => ((play = q.trim()), ''));
  t = t.replace(/<(?:music|spotify)>\s*([a-z]+)\s*<\/(?:music|spotify)>/gi, (_, c) => (cmds.push(c.toLowerCase()), ''));
  const acts = [];
  const grab = (tag, kind) => {
    t = t.replace(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>', 'gi'), (_, v) => (acts.push({ kind, v: v.trim() }), ''));
  };
  grab('open', 'open');
  grab('youtube', 'youtube');
  grab('google', 'google');
  grab('call', 'call');
  grab('wacall', 'wacall');
  t = t.replace(/<wamsg(?:\s+to\s*=\s*"([^"]*)")?\s*>([\s\S]*?)<\/wamsg>/gi, (_, to, v) => (acts.push({ kind: 'wamsg', to: (to || '').trim(), v: v.trim() }), ''));
  let web = '';
  t = t.replace(/<web>([\s\S]*?)<\/web>/gi, (_, q) => ((web = q.trim()), ''));
  let screen = false;
  t = t.replace(/<screen\s*\/?>(?:<\/screen>)?/gi, () => ((screen = true), ''));
  let mood = 'idle';
  t = t.replace(/\[mood:\s*([a-z]+)\s*\]/gi, (_, m) => ((mood = m.toLowerCase()), ''));
  // pulizia markdown che alcuni modelli aggiungono comunque
  t = t.replace(/[*_`#]+/g, '').replace(/\s+/g, ' ').trim();
  return { text: t, mood, facts, play, cmds, acts, web, screen };
}

function addFact(text) {
  const t = String(text || '').trim();
  if (!t || cfg.facts.some((f) => f.text.toLowerCase() === t.toLowerCase())) return;
  cfg.facts.push({ text: t, ts: now() });
  cfg.facts = cfg.facts.slice(-300);
  save();
  log('info', 'memoria', 'ricordato: ' + t);
}

function music(action, q = '') {
  try {
    if (!N) return log('warn', 'musica', 'disponibile solo nell\'app');
    const how = N.music(cfg.music.provider, action, q);
    log('info', 'musica', `${action} ${q} via ${how}`);
  } catch (e) {
    log('err', 'musica', e && e.message ? e.message : e);
  }
}

let queue = Promise.resolve();
let queued = 0;
function serial(fn) {
  queued++;
  const p = queue.then(fn, fn).finally(() => queued--);
  queue = p.catch(() => 0);
  return p;
}

/** Aggiorna il fumetto della bolla flottante (se attiva). */
function bubbleSay(text) {
  try { if (N && N.bubbleSay) N.bubbleSay(ex.user || '', cfg.name, text); } catch (e) { /* bolla spenta */ }
}

function deliver(raw) {
  const r = parseReply(raw);
  try { r.facts.forEach(addFact); } catch (e) { log('err', 'memoria', e.message); }
  try {
    if (r.play && cfg.music.on) {
      music('play', r.play);
      ex.np = r.play;
    }
    r.cmds.forEach((c) => cfg.music.on && music(c === 'previous' ? 'prev' : c === 'stop' ? 'pause' : c === 'play' ? 'resume' : c));
  } catch (e) {
    log('err', 'musica', e.message);
  }
  // azioni sul telefono (app, ricerche, chiamate)
  if (cfg.tools.on && r.acts.length) {
    runActions(r.acts).catch((e) => log('err', 'azioni', e && e.message ? e.message : e));
    if (!ex.np) ex.np = r.acts.map((a) => a.kind + ': ' + (a.to ? a.to + ' · ' : '') + a.v).join(' · ');
  }
  // risposta fatta solo di tag (es. solo <play>): genera una frase minima
  if (!r.text) r.text = r.play ? `${T('Metto su')} ${r.play}.` : r.acts.length ? T('Fatto, choom.') : '…';
  history.push({ role: 'assistant', content: r.text });
  while (history.length > 14) history.shift();
  ex.reply = r.text;
  ex.mood = r.mood;
  ex.ts = now();
  transientMood = r.mood;
  clearTimeout(moodT);
  moodT = setTimeout(() => { transientMood = null; refresh(); }, 12000);
  onReply();
  bubbleSay(r.text);
  speak(r.text);
}

const OFFLINE_LINES = [
  'Link perso con tutti i miei cervelli, choom. Controlla PC, key Gemini o OpenRouter nelle impostazioni.',
  'Zero segnale dalla net. Riprova tra poco o aggiungi un\'altra key.',
  'Tutti i nodi mi hanno chiuso la porta in faccia. Guarda il Log per capire chi.',
];

function ask(text, image, src) {
  text = String(text || '').trim();
  if (!text && !image) return Promise.resolve();
  ex.user = text || '[immagine]';
  ex.np = '';
  awake = true;
  touch();
  log('info', 'tu', (src === 'bubble' ? '[bolla] ' : '') + ex.user);
  lastSrc = src || '';
  if (queued > 0) log('info', 'brain', 'in coda dietro la richiesta precedente');
  return serial(async () => {
    try {
      ST.thinking = true;
      refresh();
      bubbleSay('decrypting ▮▯▯');
      const content = image
        ? [{ type: 'text', text: text || 'Guarda questa immagine e commentala in carattere.' }, { type: 'image_url', image_url: { url: image } }]
        : text;
      // domanda sullo schermo: leggi subito il contenuto (risparmia un giro)
      let screenCtx = null;
      if (!image && cfg.tools.on && cfg.tools.screen && SCREEN_RE.test(text)) {
        screenCtx = await readScreen(true);
        ex.np = screenCtx.ok ? '// lettura schermo' : '';
        refresh();
      }
      let user = { role: 'user', content };
      let task = image ? 'vision' : 'chat';
      if (screenCtx) {
        if (!screenCtx.ok) {
          ST.thinking = false;
          deliver('[mood:think] ' + screenCtx.err);
          return;
        }
        const ctx = `${text}\n\n[CONTENUTO DELLO SCHERMO DELL'UTENTE]\n${screenCtx.text || '(nessun testo leggibile)'}`;
        user = screenCtx.img ? { role: 'user', content: [{ type: 'text', text: ctx }, { type: 'image_url', image_url: { url: screenCtx.img } }] } : { role: 'user', content: ctx };
        if (screenCtx.img) task = 'vision';
      }
      const base = [{ role: 'system', content: systemPrompt() }, ...history];
      let out = await complete(task, [...base, user], { max: 900 });
      // fase strumenti: il modello ha chiesto il web o lo schermo
      const first = parseReply(out);
      if (cfg.tools.on && (first.web || (first.screen && !screenCtx))) {
        let results = '';
        if (first.web && cfg.tools.web) {
          ex.np = '// web: ' + first.web;
          refresh();
          bubbleSay('searching the net ▮▯▯');
          const res = await webSearch(first.web);
          results += `[RISULTATI WEB per "${first.web}"]\n` + (res.length ? res.map((x, i) => `${i + 1}. ${x.title} — ${x.snippet} (${x.url})`).join('\n') : 'nessun risultato');
        }
        let img = '';
        if (first.screen && cfg.tools.screen) {
          ex.np = '// lettura schermo';
          refresh();
          const sc = await readScreen(true);
          results += '\n[CONTENUTO DELLO SCHERMO]\n' + (sc.ok ? sc.text || '(nessun testo leggibile)' : sc.err);
          img = sc.img || '';
        }
        const follow = `${results}\n\nUsa queste informazioni per rispondere ora all'utente, in carattere e in breve. Non usare più <web> o <screen/>.`;
        const fu = img ? { role: 'user', content: [{ type: 'text', text: follow }, { type: 'image_url', image_url: { url: img } }] } : { role: 'user', content: follow };
        try {
          out = await complete(img ? 'vision' : 'chat', [...base, user, { role: 'assistant', content: first.text || '...' }, fu], { max: 900 });
        } catch (e) {
          log('warn', 'brain', 'seconda fase fallita: ' + e.message);
          out = first.text ? '[mood:' + first.mood + '] ' + first.text : out;
        }
      }
      history.push({ role: 'user', content: text || '[immagine]' });
      ST.thinking = false;
      deliver(out);
    } catch (e) {
      ST.thinking = false;
      log('err', 'brain', e && e.message ? e.message : e);
      ex.reply = T(OFFLINE_LINES[(Math.random() * OFFLINE_LINES.length) | 0]);
      ex.mood = 'sad';
      ex.ts = now();
      onReply();
      bubbleSay(ex.reply);
      speak(ex.reply);
    } finally {
      ST.thinking = false;
      refresh();
    }
  });
}
window.capriAsk = (text, src) => {
  try {
    if (!$('settings').classList.contains('hidden') && src !== 'bubble') closeSettings();
    ask(text, null, src);
  } catch (e) {
    log('err', 'brain', e.message);
  }
};


// ================================================================ strumenti telefono

function nat(fn, fallback = '') {
  try {
    return N ? fn() : fallback;
  } catch (e) {
    log('err', 'bridge', e && e.message ? e.message : e);
    return fallback;
  }
}

function perms() {
  return safeJson(nat(() => N.permState(), '{}')) || {};
}

async function pickContact(name) {
  if (/^[+0-9][0-9 ()\-]{5,}$/.test(name)) return { name, number: name.replace(/[^0-9+]/g, ''), waVoiceId: 0 };
  if (!perms().contacts) {
    nat(() => N.requestPerms('android.permission.READ_CONTACTS,android.permission.CALL_PHONE'));
    throw new Error('mi serve il permesso per leggere i contatti: concedilo e richiedimelo');
  }
  const list = safeJson(nat(() => N.contacts(name), '[]')) || [];
  if (!list.length) throw new Error('non trovo "' + name + '" in rubrica');
  return list[0];
}

let callTimer = 0;
function confirmCall(label, fn, fromBubble) {
  // dalla bolla l'app è in secondo piano: chiama subito; dall'app: 4 s per annullare
  if (fromBubble) return fn();
  clearTimeout(callTimer);
  const el = $('confirm');
  $('cfText').textContent = label;
  el.classList.remove('hidden');
  let n = 4;
  $('cfCount').textContent = n;
  const step = () => {
    n--;
    $('cfCount').textContent = n;
    if (n <= 0) {
      el.classList.add('hidden');
      fn();
    } else callTimer = setTimeout(step, 1000);
  };
  callTimer = setTimeout(step, 1000);
  $('cfNo').onclick = () => {
    clearTimeout(callTimer);
    el.classList.add('hidden');
    log('info', 'azioni', 'chiamata annullata');
  };
  $('cfYes').onclick = () => {
    clearTimeout(callTimer);
    el.classList.add('hidden');
    fn();
  };
}

let lastSrc = '';
async function runActions(acts) {
  const fromBubble = lastSrc === 'bubble';
  for (const a of acts) {
    try {
      if (a.kind === 'open') {
        const got = nat(() => N.openApp(a.v), '');
        log(got ? 'ok' : 'warn', 'azioni', got ? 'aperta ' + got : 'app non trovata: ' + a.v);
        if (!got) bubbleSay('Non trovo un\'app che si chiama ' + a.v + '.');
      } else if (a.kind === 'youtube') {
        log('ok', 'azioni', 'YouTube: ' + a.v + ' via ' + nat(() => N.youtube(a.v), '-'));
      } else if (a.kind === 'google') {
        log('ok', 'azioni', 'Google: ' + a.v + ' via ' + nat(() => N.google(a.v), '-'));
      } else if (a.kind === 'call' || a.kind === 'wacall') {
        if (!cfg.tools.calls) continue;
        const c = await pickContact(a.v);
        const wa = a.kind === 'wacall';
        confirmCall((wa ? T('Chiamata WhatsApp a') + ' ' : T('Chiamo') + ' ') + c.name + (c.number ? ' · ' + c.number : ''), () => {
          const how = wa ? nat(() => N.waCall(String(c.waVoiceId || 0), c.number || ''), '') : nat(() => N.call(c.number), '');
          log(how ? 'ok' : 'err', 'azioni', (wa ? 'WhatsApp ' : 'chiamata ') + c.name + ' → ' + (how || 'fallita'));
          if (how === 'dial') nat(() => N.toast('Premi il tasto verde: manca il permesso per chiamare direttamente'));
          if (how === 'wa_chat') nat(() => N.toast('Chiamata WhatsApp non disponibile per questo contatto: apro la chat'));
        }, fromBubble);
      } else if (a.kind === 'wamsg') {
        if (!cfg.tools.calls) continue;
        const c = await pickContact(a.to || a.v);
        nat(() => N.waChat(c.number || '', a.to ? a.v : ''));
        log('ok', 'azioni', 'WhatsApp a ' + c.name);
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      log('warn', 'azioni', msg);
      ex.np = '// ' + msg;
      refresh();
      bubbleSay(msg);
    }
  }
}

// ---------- lettura schermo
const SCREEN_RE = /\b(schermo|schermata|sto (guardando|leggendo|vedendo)|cosa (c'è|vedo)|questa (pagina|chat|app|foto|immagine|mail|email|notizia)|questo (articolo|messaggio|post|video|testo)|leggi(mi)?|riassumi(mi)?|traducimi|on (my )?screen|what am i looking at)\b/i;

let shotSeq = 0;
const shotWait = new Map();
window.__shot = (id, b64) => {
  const f = shotWait.get(id);
  if (f) {
    shotWait.delete(id);
    f(b64 || '');
  }
};
function screenshotB64(timeoutMs = 4000) {
  return new Promise((res) => {
    if (!N || !perms().shot) return res('');
    const id = 's' + ++shotSeq;
    shotWait.set(id, res);
    setTimeout(() => shotWait.has(id) && (shotWait.delete(id), res('')), timeoutMs);
    nat(() => N.screenshot(id));
  });
}
async function readScreen(withImage) {
  const st = perms();
  if (!st.a11y) return { ok: false, text: '', img: '', err: 'Per leggere lo schermo attiva Capri AI in Impostazioni → Accessibilità (te lo apro io dalle impostazioni, scheda Strumenti).' };
  const text = nat(() => N.screenText(), '');
  let img = '';
  if (withImage) {
    const b64 = await screenshotB64();
    if (b64) img = 'data:image/jpeg;base64,' + b64;
  }
  return { ok: true, text, img };
}

// ---------- ricerca web (DuckDuckGo HTML, poi Wikipedia)
async function webSearch(q) {
  const out = [];
  try {
    const r = await http('POST', 'https://html.duckduckgo.com/html/', { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' }, 'q=' + encodeURIComponent(q) + '&kl=it-it', 12000);
    if (r.status === 200) {
      const doc = new DOMParser().parseFromString(r.body, 'text/html');
      doc.querySelectorAll('.result').forEach((el) => {
        if (out.length >= 6) return;
        const a = el.querySelector('.result__a');
        const sn = el.querySelector('.result__snippet');
        if (a) out.push({ title: a.textContent.trim(), snippet: sn ? sn.textContent.trim() : '', url: (el.querySelector('.result__url') || {}).textContent ? el.querySelector('.result__url').textContent.trim() : '' });
      });
    }
  } catch (e) {
    log('warn', 'web', 'duckduckgo: ' + e.message);
  }
  if (!out.length) {
    try {
      const lang = (cfg.lang || 'it').slice(0, 2);
      const r = await http('GET', `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=4&srsearch=` + encodeURIComponent(q), {}, '', 10000);
      const j = safeJson(r.body);
      ((j && j.query && j.query.search) || []).forEach((x) => out.push({ title: x.title, snippet: String(x.snippet || '').replace(/<[^>]+>/g, ''), url: lang + '.wikipedia.org' }));
    } catch (e) {
      log('warn', 'web', 'wikipedia: ' + e.message);
    }
  }
  log(out.length ? 'ok' : 'warn', 'web', `"${q}" → ${out.length} risultati`);
  return out;
}

// ================================================================ voce

let voiceLevel = 0;
let fakeT = 0;
let speakGuard = 0;
window.__tts = (ev) => {
  if (ev === 'start') {
    ST.speaking = true;
    clearInterval(fakeT);
    fakeT = setInterval(() => (voiceLevel = 0.25 + Math.random() * 0.7), 90);
  } else {
    ST.speaking = false;
    clearInterval(fakeT);
    clearTimeout(speakGuard);
    voiceLevel = 0;
    touch();
  }
  refresh();
};
function speak(text) {
  if (!cfg.tts.on || !text) return;
  try {
    // se il motore non richiama mai "done", sblocca comunque lo stato
    clearTimeout(speakGuard);
    speakGuard = setTimeout(() => ST.speaking && __tts('done'), 4000 + text.length * 120);
    if (N) N.speak(text, cfg.lang, Number(cfg.tts.pitch) || 1, Number(cfg.tts.rate) || 1, cfg.tts.voice || '');
    else if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = cfg.lang;
      u.pitch = cfg.tts.pitch;
      u.rate = cfg.tts.rate;
      u.onstart = () => __tts('start');
      u.onend = () => __tts('done');
      u.onerror = () => __tts('done');
      speechSynthesis.speak(u);
    }
  } catch (e) {
    log('err', 'tts', e.message);
    __tts('done');
  }
}
window.capriStopVoice = () => {
  try { if (N) N.stopSpeaking(); } catch (e) { /* niente */ }
};

// ================================================================ ascolto

let micLevel = 0;
let partial = '';
let listenGuard = 0;
const STT_ERR = {
  permission: 'permesso microfono negato: concedilo nelle impostazioni Android',
  unavailable: 'riconoscimento vocale non disponibile: installa o aggiorna l\'app Google',
  timeout: 'il riconoscimento vocale non risponde, riprova',
  1: 'rete lenta per il riconoscimento vocale', 2: 'errore di rete del riconoscimento vocale', 3: 'errore audio del microfono',
  4: 'errore del server vocale', 5: 'errore interno, riprova', 6: 'non ho sentito niente', 7: 'non ho capito, riprova', 8: 'microfono occupato, riprova', 9: 'permesso microfono mancante',
};
function stopListenState() {
  ST.listening = false;
  micLevel = 0;
  clearTimeout(listenGuard);
}
window.__stt = (ev, v) => {
  try {
    if (ev === 'ready') {
      ST.listening = true;
      partial = '';
    } else if (ev === 'rms') micLevel = Math.max(0, Math.min(1, (Number(v) + 2) / 12));
    else if (ev === 'partial') partial = String(v || '');
    else if (ev === 'final') {
      stopListenState();
      const t = String(v || partial || '').trim();
      if (t) ask(t, null, 'voice');
      else showSttError('7');
    } else if (ev === 'error') {
      stopListenState();
      if (partial.trim()) ask(partial, null, 'voice');
      else showSttError(v);
    }
  } catch (e) {
    stopListenState();
    log('err', 'stt', e.message);
  }
  refresh();
};
function showSttError(code) {
  const msg = STT_ERR[code] ? T(STT_ERR[code]) : T('errore audio del microfono') + ' ' + code;
  log('warn', 'stt', msg + ' (' + code + ')');
  // l'errore compare nel terminale, così si capisce perché non ha risposto
  ex.reply = msg + '.';
  ex.mood = 'idle';
  ex.ts = now();
  ex.user = '';
  onReply();
  if (code === 'unavailable' || code === 'permission' || code === '9') try { N && N.toast(msg); } catch (e) { /* niente */ }
}
function listen() {
  touch();
  try {
    if (ST.speaking) capriStopVoice();
    if (ST.listening) {
      N && N.stopListening();
      return;
    }
    if (!N) return log('warn', 'stt', 'solo nell\'app Android');
    ST.listening = true; // subito, così il tocco dà feedback
    partial = '';
    refresh();
    clearTimeout(listenGuard);
    listenGuard = setTimeout(() => {
      if (ST.listening) {
        try { N.stopListening(); } catch (e) { /* niente */ }
        setTimeout(() => ST.listening && __stt('error', 'timeout'), 3000);
      }
    }, 20000);
    N.listen(cfg.lang);
  } catch (e) {
    stopListenState();
    log('err', 'stt', e.message);
    refresh();
  }
}
window.capriGreet = (g) => {
  ex.user = '';
  ex.np = '';
  ex.reply = g;
  ex.mood = 'happy';
  ex.ts = now();
  onReply();
  speak(g);
};
window.capriWake = (andListen) => {
  awake = true;
  touch();
  refresh();
  if (andListen) setTimeout(listen, 250);
};

// ================================================================ sprite (IndexedDB)

const SPRITE_STATES = ['dormant', 'idle', 'blink', 'listen', 'think', 'talk', 'happy', 'angry', 'sad', 'surprised', 'love', 'smug'];
let sprites = {}; // stato -> [{id,url,video}]
let db = null;

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('capri', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('sprites', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(mode) {
  return db.transaction('sprites', mode).objectStore('sprites');
}
async function loadSprites() {
  try {
    db = await openDb();
  } catch (e) {
    log('err', 'sprite', 'IndexedDB: ' + e);
    return;
  }
  const all = await new Promise((res) => {
    const r = tx('readonly').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => res([]);
  });
  Object.values(sprites).flat().forEach((s) => URL.revokeObjectURL(s.url));
  sprites = {};
  all.sort((a, b) => a.order - b.order).forEach((s) => {
    (sprites[s.state] = sprites[s.state] || []).push({ id: s.id, url: URL.createObjectURL(s.blob), video: /^video\//.test(s.blob.type) });
  });
}
async function addSprites(state, files) {
  for (const f of files) {
    await new Promise((res) => {
      const r = tx('readwrite').add({ state, blob: f, order: now() + Math.random() });
      r.onsuccess = res;
      r.onerror = res;
    });
  }
  await loadSprites();
  lastFrame = '';
  refresh();
}
async function delSprite(id) {
  await new Promise((res) => {
    const r = tx('readwrite').delete(id);
    r.onsuccess = res;
    r.onerror = res;
  });
  await loadSprites();
  lastFrame = '';
  refresh();
}
const has = (s) => (sprites[s] || []).length > 0;

// ================================================================ UI Capri

const COLOR = { dormant: '#9b6bff', listening: '#00f0ff', thinking: '#fcee0a', talking: '#fcee0a', online: '#ff1f4b' };
let awake = false;
let phase = 'sigil'; // sigil | opening | frame | closing
let lastActive = now();
let tick = 0;
let blinking = false;

function touch() {
  lastActive = now();
}

function cstate() {
  if (ST.listening) return 'listening';
  if (ST.thinking) return 'thinking';
  if (ST.speaking) return 'talking';
  return awake || phase !== 'sigil' ? 'online' : 'dormant';
}

function spriteState() {
  const c = cstate();
  if (phase === 'sigil' && c === 'dormant' && has('dormant')) return 'dormant';
  if (ST.speaking && has('talk')) return 'talk';
  if (ST.listening && has('listen')) return 'listen';
  if (ST.thinking && has('think')) return 'think';
  if (transientMood && has(transientMood)) return transientMood;
  if (blinking && has('blink')) return 'blink';
  if (has('idle')) return 'idle';
  return SPRITE_STATES.find((s) => s !== 'dormant' && has(s)) || '';
}

function frameItem() {
  const st = spriteState();
  const list = sprites[st] || [];
  if (!list.length) return null;
  if (st === 'talk' && list.length > 1 && !list[0].video) return list[Math.min(list.length - 1, Math.floor(voiceLevel * list.length * 1.3))];
  if (list[0].video) return list[0];
  return list[tick % list.length];
}

let lastFrame = '';
function mediaHtml(item, alt) {
  if (!item) return '';
  return item.video
    ? `<video src="${item.url}" autoplay loop muted playsinline aria-label="${alt}"></video>`
    : `<img src="${item.url}" alt="${alt}" draggable="false">`;
}

function defaultSigil(col) {
  return `<svg width="84" height="84" viewBox="0 0 72 72" aria-hidden="true">
    <g style="transform-origin:36px 36px;animation:spin 14s linear infinite"><circle cx="36" cy="36" r="30" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="6 5"/></g>
    <g style="transform-origin:36px 36px;animation:spinr 9s linear infinite"><circle cx="36" cy="36" r="20" fill="none" stroke="#ff2e88" stroke-width="1.5" stroke-dasharray="2 4"/></g>
    <path d="M36 22 L48 36 L36 50 L24 36 Z" fill="#0a0a0f" stroke="${col}" stroke-width="2"/>
    <circle cx="36" cy="36" r="5" fill="${col}"/><circle cx="37.5" cy="34.5" r="1.6" fill="#fff"/></svg>`;
}

function barsHtml(mode, col) {
  let h = '';
  for (let i = 0; i < 8; i++) {
    if (mode === 'idle') h += `<i style="height:2px;margin-bottom:6px;opacity:.8"></i>`;
    else {
      const base = mode === 'mic' ? micLevel : voiceLevel;
      const v = Math.max(0.12, Math.min(1, base * (0.4 + Math.random() * 0.9)));
      h += `<i style="height:${Math.round(v * 14)}px"></i>`;
    }
  }
  return h;
}

function glitch(canvas, ms) {
  if (!cfg.capri.glitch) return;
  const ctx = canvas.getContext('2d');
  const w = (canvas.width = canvas.offsetWidth || 300);
  const h = (canvas.height = canvas.offsetHeight || 180);
  const pal = ['#ff1f4b', '#2bff88', '#00f0ff', '#0a0a0f', '#ffffff', '#ff2e88'];
  const t0 = performance.now();
  const draw = (t) => {
    const p = (t - t0) / ms;
    ctx.clearRect(0, 0, w, h);
    if (p >= 1) return;
    const n = 18 + ((Math.random() * 18) | 0);
    for (let i = 0; i < n; i++) {
      const y = Math.random() * h, bh = 1 + Math.random() * (h / 14), x = Math.random() * w * 0.3, bw = w * (0.35 + Math.random() * 0.7);
      ctx.globalAlpha = 0.45 + Math.random() * 0.55;
      ctx.fillStyle = pal[(Math.random() * pal.length) | 0];
      ctx.fillRect(x, y, bw, bh);
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = pal[(Math.random() * 3) | 0];
        ctx.fillRect(x + Math.random() * bw, y, 2 + Math.random() * 6, bh);
      }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

let timers = [];
function later(fn, ms) {
  timers.push(setTimeout(fn, ms));
}
function openFrame() {
  if (phase === 'frame' || phase === 'opening') return;
  timers.forEach(clearTimeout);
  timers = [];
  phase = 'opening';
  refresh();
  if (cfg.capri.glitch) {
    $('trans').classList.remove('hidden');
    later(() => glitch($('tGlitch'), 420), 300);
  }
  later(() => {
    phase = 'frame';
    $('trans').classList.add('hidden');
    $('frame').classList.add('opening');
    later(() => $('frame').classList.remove('opening'), 250);
    lastFrame = '';
    refresh();
  }, cfg.capri.glitch ? 720 : 10);
}
function closeFrame() {
  if (phase !== 'frame') return;
  timers.forEach(clearTimeout);
  timers = [];
  phase = 'closing';
  $('frame').classList.add('closing');
  glitch($('fGlitch'), 500);
  later(() => {
    phase = 'sigil';
    awake = false;
    $('frame').classList.remove('closing');
    lastFrame = '';
    refresh();
  }, cfg.capri.glitch ? 600 : 10);
}

function onReply() {
  awake = true;
  touch();
  typeStart();
  openFrame();
  refresh();
}

// ---------------- typewriter
let shown = 0;
let typeT = 0;
function typeStart() {
  shown = 0;
  clearInterval(typeT);
  typeT = setInterval(() => {
    shown++;
    if (shown >= ex.reply.length) clearInterval(typeT);
    renderText();
  }, Math.max(10, 1000 / Math.max(5, cfg.capri.cps)));
}
function renderText() {
  const el = $('tText');
  const typing = shown < ex.reply.length;
  if (ST.thinking) {
    const n = (Math.floor(now() / 220) % 4) + 1;
    el.innerHTML = 'decrypting ' + '▮'.repeat(Math.min(3, n)).padEnd(3, '▯');
    return;
  }
  if (ST.listening) {
    el.innerHTML = `<span class="muted">${esc(partial) || 'ti ascolto…'}</span>`;
    return;
  }
  if (!ex.reply) {
    el.innerHTML = '<span class="muted">online. dimmi tutto, choom.</span>';
    return;
  }
  el.innerHTML = esc(ex.reply.slice(0, shown)) + `<span class="cur ${typing ? '' : 'blink'}"></span>`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------------- render
let lastBubble = '';
function refresh() {
  try {
    refreshUnsafe();
  } catch (e) {
    log('err', 'ui', 'render: ' + (e && e.message ? e.message : e));
  }
}
function refreshUnsafe() {
  const c = cstate();
  const col = COLOR[c];
  document.documentElement.style.setProperty('--sc', col);
  const label = `${cfg.name.toUpperCase()} // ${c.toUpperCase()}`;
  const bars = ST.listening ? 'mic' : ST.speaking ? 'voice' : 'idle';

  const sig = $('sigil');
  sig.classList.toggle('hidden', !(phase === 'sigil' || phase === 'opening'));
  sig.classList.toggle('busy', c !== 'dormant');
  $('sTag').textContent = label;
  $('sBars').innerHTML = c === 'listening' ? barsHtml('mic', col) : '';
  $('sBars').style.display = c === 'listening' ? '' : 'none';

  const fr = $('frame');
  const showF = phase === 'frame' || phase === 'closing';
  fr.classList.toggle('hidden', !showF);
  $('term').classList.toggle('hidden', phase !== 'frame');
  $('fTag').textContent = label;
  $('fBars').innerHTML = barsHtml(bars, col);
  $('tName').textContent = cfg.name.toUpperCase() + ' >';
  $('tUser').textContent = ex.user ? '> you: ' + ex.user : '';
  $('tNp').textContent = ex.np ? '// now playing: ' + ex.np : '';
  $('btnMic').classList.toggle('on', ST.listening);

  const item = frameItem();
  const key = (item ? item.url : 'none') + '|' + phase + '|' + (phase === 'sigil' ? c : '');
  if (key !== lastFrame) {
    lastFrame = key;
    if (phase === 'sigil' || phase === 'opening') {
      const useSprite = item && (has('dormant') || (c !== 'dormant' && has('listen')));
      $('sigilMedia').innerHTML = useSprite ? mediaHtml(item, cfg.name) : defaultSigil(col);
    } else {
      $('fMedia').innerHTML = item
        ? mediaHtml(item, 'Avatar ' + cfg.name)
        : `<div class="nosig"><b>NO SIGNAL</b><span>importa sprite, GIF o clip video</span><button type="button" onclick="openSettings('sprite')">+ IMPORTA</button></div>`;
    }
  }
  if (showF && fr.dataset.state !== c) {
    fr.dataset.state = c;
    const b = $('fBox');
    b.classList.remove('flick');
    void b.offsetWidth;
    b.classList.add('flick');
    glitch($('fGlitch'), 220);
  }
  renderText();
  if (N && label !== lastBubble) {
    lastBubble = label;
    try { N.bubbleState(label, col); } catch (e) { /* bolla non attiva */ }
  }
}

// loop animazione
setInterval(() => {
  tick++;
  if (ST.listening || ST.speaking || ST.thinking) refresh();
  else if (Object.values(sprites).some((l) => l.length > 1)) refresh();
}, 125);
setInterval(() => {
  if (!ST.listening && !ST.thinking && !ST.speaking && now() - lastActive > cfg.capri.sleepSec * 1000) {
    if (phase === 'frame') closeFrame();
    else if (awake) { awake = false; refresh(); }
  }
}, 1000);
(function blinkLoop() {
  setTimeout(() => {
    if (has('blink')) {
      blinking = true;
      refresh();
      setTimeout(() => { blinking = false; refresh(); }, 160);
    }
    blinkLoop();
  }, 2800 + Math.random() * 3600);
})();
(function randGlitch() {
  setTimeout(() => {
    if (phase === 'frame') glitch($('fGlitch'), 200);
    randGlitch();
  }, 5000 + Math.random() * 9000);
})();

// ================================================================ pioggia digitale

(function rain() {
  const c = $('rain');
  const ctx = c.getContext('2d');
  let cols = [];
  const resize = () => {
    c.width = innerWidth;
    c.height = innerHeight;
    cols = Array.from({ length: Math.ceil(innerWidth / 14) }, () => Math.random() * innerHeight);
  };
  resize();
  addEventListener('resize', resize);
  const chars = '01アイウエオカキクケコサシスセソ<>/\\#$%';
  setInterval(() => {
    ctx.fillStyle = 'rgba(7,7,12,0.18)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = '12px monospace';
    cols.forEach((y, i) => {
      ctx.fillStyle = Math.random() < 0.03 ? '#ff2e88' : 'rgba(0,240,255,0.35)';
      ctx.fillText(chars[(Math.random() * chars.length) | 0], i * 14, y);
      cols[i] = y > c.height + Math.random() * 400 ? 0 : y + 14;
    });
  }, 80);
})();

// ================================================================ eventi

$('sigilBtn').onclick = () => { awake = true; refresh(); listen(); };
$('fBox').onclick = () => listen();
$('btnMic').onclick = () => listen();
$('btnSleep').onclick = () => closeFrame();
$('tForm').onsubmit = (e) => {
  e.preventDefault();
  const v = $('tInput').value;
  $('tInput').value = '';
  $('tInput').blur();
  ask(v);
};
$('tInput').oninput = touch;
$('btnImg').onclick = () => $('pickImg').click();
$('pickImg').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const url = await downscale(f, 1024);
  ask($('tInput').value, url);
  $('tInput').value = '';
};
function downscale(file, max) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / img.width);
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k);
      cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      res(cv.toDataURL('image/jpeg', 0.75));
    };
    img.src = URL.createObjectURL(file);
  });
}
$('btnSettings').onclick = () => openSettings('ai');
window.capriBack = () => {
  if (!$('settings').classList.contains('hidden')) closeSettings();
  else if (N) N.back();
};

// ================================================================ impostazioni

const TABS = [['ai', 'AI'], ['free', 'API free'], ['strumenti', 'Strumenti'], ['passivo', 'Hey Capri'], ['persona', 'Persona'], ['sprite', 'Sprite'], ['voce', 'Voce'], ['musica', 'Musica'], ['bolla', 'Bolla'], ['memoria', 'Memoria'], ['log', 'Log']];
let curTab = '';
let spriteTarget = '';

function openSettings(tab) {
  curTab = tab || 'ai';
  $('settings').classList.remove('hidden');
  renderTabs();
  renderTab();
}
function closeSettings() {
  $('settings').classList.add('hidden');
  curTab = '';
  lastFrame = '';
  refresh();
}
window.openSettings = openSettings;

/** Cambia la lingua dell'interfaccia; la lingua di ascolto/voce la segue. */
function setUiLang(l) {
  const wasEn = cfg.uiLang === 'en';
  cfg.uiLang = l === 'en' ? 'en' : 'it';
  if (/^(it|en)/.test(cfg.lang)) cfg.lang = cfg.uiLang === 'en' ? (wasEn ? cfg.lang : 'en-US') : 'it-IT';
  cfg.tts.voice = '';
  save();
  // tornando all'italiano serve ridisegnare tutto da zero: il DOM tradotto non si "ritraduce"
  if (!wasEn || cfg.uiLang === 'en') {
    I18N.set(cfg.uiLang);
    try { if (N) { N.setUi(cfg.uiLang); N.setLang(cfg.lang); } } catch (e) { /* niente */ }
    I18N.walk(document.body);
    if (curTab) { renderTabs(); renderTab(); }
    refresh();
  } else {
    try { localStorage.setItem('capri.cfg', JSON.stringify(cfg)); } catch (e) { /* niente */ }
    location.reload();
  }
  if (cfg.passive.on) applyPassive(false);
}
window.setUiLang = setUiLang;

function renderTabs() {
  $('tabs').innerHTML =
    TABS.map(([id, l]) => `<button type="button" data-t="${id}" class="${id === curTab ? 'on' : ''}">${l}</button>`).join('') +
    `<button type="button" class="lang" data-t="__lang" data-noi18n aria-label="Lingua / Language">${cfg.uiLang === 'en' ? 'EN' : 'IT'} ⇄</button>` +
    '<button type="button" class="x" data-t="__close">CHIUDI</button>';
  $('tabs').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.t === '__close') return closeSettings();
      if (b.dataset.t === '__lang') return setUiLang(cfg.uiLang === 'en' ? 'it' : 'en');
      curTab = b.dataset.t;
      renderTabs();
      renderTab();
    };
  });
}

// helper form: data-k="percorso.chiave"
function get(path) {
  return path.split('.').reduce((o, k) => (o ? o[k] : undefined), cfg);
}
function set(path, v) {
  const ks2 = path.split('.');
  let o = cfg;
  ks2.slice(0, -1).forEach((k) => (o = o[k]));
  o[ks2[ks2.length - 1]] = v;
  save();
}
const fld = (label, path, opts = {}) =>
  `<div class="fld"><label for="f_${path}">${label}</label><input id="f_${path}" data-k="${path}" type="${opts.type || 'text'}" value="${esc(get(path) ?? '')}" placeholder="${esc(opts.ph || '')}" ${opts.type === 'number' ? 'step="any" inputmode="decimal"' : ''}>${opts.hint ? `<span class="hint">${opts.hint}</span>` : ''}</div>`;
const tog = (label, path) =>
  `<div class="tog"><span>${label}</span><button type="button" class="sw" role="switch" aria-label="${label}" aria-checked="${!!get(path)}" data-tg="${path}"><i></i></button></div>`;
const sel = (label, path, options) =>
  `<div class="fld"><label for="f_${path}">${label}</label><select id="f_${path}" data-k="${path}">${options.map(([v, l]) => `<option value="${v}" ${get(path) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;

function bindForm(root) {
  root.querySelectorAll('[data-k]').forEach((el) => {
    el.onchange = el.oninput = () => {
      const v = el.type === 'number' ? Number(el.value) : el.value;
      set(el.dataset.k, v);
      if (el.dataset.k === 'name') refresh();
      if (el.dataset.k === 'lang') try { N && N.setLang(cfg.lang); } catch (e) { /* niente */ }
    };
  });
  root.querySelectorAll('[data-tg]').forEach((el) => {
    el.onclick = () => {
      const v = !get(el.dataset.tg);
      set(el.dataset.tg, v);
      el.setAttribute('aria-checked', v);
      if (el.dataset.tg.startsWith('passive.')) applyPassive(true);
    };
  });
}

function renderTab() {
  const P = $('panel');
  let h = '';
  if (curTab === 'ai') {
    h += `<h3>00 // LINGUA · LANGUAGE</h3><div class="row" data-noi18n><button type="button" class="btn ${cfg.uiLang === 'it' ? 'p' : ''}" data-ui="it">Italiano</button><button type="button" class="btn ${cfg.uiLang === 'en' ? 'p' : ''}" data-ui="en">English</button></div>`;
    h += `<h3>01 // ORDINE PROVIDER</h3>`;
    h += cfg.order.map((p, i) => `<div class="item"><span class="grow">${i + 1}. ${{ local: 'PC in LAN (Ollama / LM Studio)', gemini: 'Gemini multi-key', extra: 'Altri provider free (Groq, Cerebras…)', openrouter: 'OpenRouter :free' }[p]}</span><button type="button" data-mv="${i}" data-d="-1" aria-label="Su">↑</button><button type="button" data-mv="${i}" data-d="1" aria-label="Giù">↓</button></div>`).join('');
    h += `<h3>02 // PC IN LAN</h3>` + tog('Usa il PC come cervello', 'local.enabled');
    h += fld('Indirizzo', 'local.baseUrl', { hint: 'Sul PC: Ollama con OLLAMA_HOST=0.0.0.0, poi http://IP-DEL-PC:11434/v1 (LM Studio: porta 1234, "Serve on local network")' });
    h += `<div class="grid2">${fld('Modello chat', 'local.model')}${fld('Modello visione', 'local.vision')}</div>`;
    h += `<div class="row"><button type="button" class="btn cy" id="pingPc">Verifica PC</button><span id="pcSt" class="chip">—</span></div>`;
    h += `<h3>03 // GEMINI · ROTAZIONE KEY</h3>` + tog('Usa Gemini', 'gemini.enabled');
    h += cfg.gemini.keys.map((k, i) => {
      const s = ks(k);
      const left = Math.ceil((s.cd - now()) / 1000);
      const st = s.bad ? '<span class="chip err">non valida</span>' : left > 0 ? `<span class="chip warn">cooldown ${left}s</span>` : `<span class="chip ok">ok ${s.ok}</span>`;
      return `<div class="item"><span class="grow">#${i + 1} ${esc(k.slice(0, 6))}••••${esc(k.slice(-4))}</span>${st}<button type="button" data-delk="${i}" aria-label="Elimina key">✕</button></div>`;
    }).join('');
    h += `<div class="fld"><label for="newKeys">Aggiungi key (una per riga)</label><textarea id="newKeys" rows="3" placeholder="AIza…"></textarea></div>`;
    h += `<div class="row"><button type="button" class="btn p" id="addKeys">+ Aggiungi</button><button type="button" class="btn" id="resetKeys">Reset cooldown</button></div>`;
    h += `<div class="fld"><label for="gm">Modelli Gemini (in ordine, separati da virgola)</label><input id="gm" value="${esc(cfg.gemini.models.join(', '))}"></div>`;
    h += `<h3>04 // OPENROUTER FREE</h3>` + tog('Usa OpenRouter come ultimo fallback', 'openrouter.enabled');
    h += fld('API key', 'openrouter.key', { type: 'password' });
    h += fld('Modelli preferiti (opzionale)', 'openrouter.preferred', { ph: 'meta-llama/llama-3.3-70b-instruct:free', hint: 'Solo modelli :free o a prezzo 0' });
  }
  if (curTab === 'free') {
    h += `<h3>14 // ALTRI PROVIDER GRATUITI</h3><p class="note">Usati in ordine, dopo Gemini e prima di OpenRouter (cambi l'ordine nella scheda AI). Basta incollare la key: senza key il provider viene saltato. Se un modello sparisce, premi "Modelli" e scegline un altro.</p>`;
    h += cfg.extra.map((pv, i) => {
      const cd = providerCd[pv.id] > now() ? `<span class="chip warn">pausa ${Math.ceil((providerCd[pv.id] - now()) / 1000)}s</span>` : pv.key ? '<span class="chip ok">attivo</span>' : '<span class="chip">senza key</span>';
      return `<div class="pv"><div class="h"><b>${esc(pv.name)}</b>${cd}<button type="button" class="sw" role="switch" aria-label="${esc(pv.name)}" aria-checked="${!!pv.enabled}" data-xtg="${i}"><i></i></button></div>
        <div class="fld"><label for="xk${i}">API key · ${esc(pv.signup || '')}</label><input id="xk${i}" type="password" data-xk="${i}" data-f="key" value="${esc(pv.key)}"></div>
        <div class="fld"><label for="xb${i}">Base URL</label><input id="xb${i}" data-xk="${i}" data-f="base" value="${esc(pv.base)}"></div>
        <div class="fld"><label for="xm${i}">Modelli chat (in ordine)</label><input id="xm${i}" data-xk="${i}" data-f="models" value="${esc(pv.models)}"></div>
        <div class="fld"><label for="xv${i}">Modelli visione (opzionale)</label><input id="xv${i}" data-xk="${i}" data-f="vision" value="${esc(pv.vision)}"></div>
        <div class="row"><button type="button" class="btn cy" data-xtest="${i}">Prova</button><button type="button" class="btn" data-xlist="${i}">Modelli</button><span class="chip" id="xs${i}">—</span></div></div>`;
    }).join('');
  }
  if (curTab === 'strumenti') {
    const st = perms();
    const chip = (ok, l) => `<span class="chip ${ok ? 'ok' : 'err'}">${l}: ${ok ? 'OK' : 'NO'}</span>`;
    h += `<h3>15 // AZIONI SUL TELEFONO</h3>` + tog('Strumenti attivi', 'tools.on') + tog('Apri app (“apri Instagram”)', 'tools.apps') + tog('Ricerca web e risposta (“chi ha vinto ieri?”)', 'tools.web') + tog('Leggi lo schermo (“cosa c’è scritto qui?”)', 'tools.screen') + tog('Chiamate e WhatsApp (“chiama Marco”)', 'tools.calls');
    h += `<p class="note">YouTube (“cerca … su YouTube”) e Google (“cercami … su Google”) sono sempre disponibili.</p>`;
    h += `<h3>16 // PERMESSI</h3><div class="row">${chip(st.mic, 'Microfono')}${chip(st.contacts, 'Contatti')}${chip(st.call, 'Chiamate')}${chip(st.overlay, 'Bolla')}${chip(st.a11y, 'Lettura schermo')}</div>`;
    h += `<div class="row"><button type="button" class="btn p" id="pAll">Concedi microfono, contatti, chiamate</button></div>`;
    h += `<div class="row"><button type="button" class="btn cy" id="pA11y">Attiva lettura schermo</button></div>`;
    h += `<p class="note">Lettura schermo: Impostazioni → Accessibilità → App installate → <b>Capri AI</b> → attiva. Capri legge lo schermo <b>solo quando glielo chiedi</b>. ${st.shot ? 'Su questo telefono può anche guardare lo screenshot (visione).' : 'Su Android 10 o precedenti legge solo il testo.'}</p>`;
    h += `<div class="fld"><label for="tq">Prova un comando</label><input id="tq" placeholder="apri YouTube · leggi lo schermo · chiama Marco"></div><div class="row"><button type="button" class="btn cy" id="tGo">Invia</button></div>`;
  }
  if (curTab === 'passivo') {
    h += `<h3>17 // ASSISTENTE PASSIVO</h3><p class="note">Capri resta in ascolto nella bolla. Quando senti la parola di attivazione si apre il popup e ti chiede di cosa hai bisogno. Puoi anche dire tutto insieme: “Hey Capri, apri Spotify”.</p>`;
    h += tog('Modalità passiva', 'passive.on');
    h += fld('Parole di attivazione (separate da virgola)', 'passive.words', { hint: 'Es. hey capri, ehi capri, ok capri. Basta anche solo "capri" se la sente chiaramente.' });
    h += fld('Frase di risposta', 'passive.greeting', { ph: 'Dimmi, choom. Di cosa hai bisogno?' });
    h += tog('Silenzia i bip di sistema durante l’ascolto', 'passive.mute');
    h += `<div class="row"><button type="button" class="btn p" id="pvApply">Applica</button></div>`;
    h += `<p class="note">Usa il riconoscimento vocale di Google in ciclo: consuma batteria, funziona a schermo acceso e con la bolla attiva. Se il telefono lo chiude, riattivalo da qui. Su alcuni telefoni il “bip” resta: disattiva i suoni di sistema.</p>`;
  }
  if (curTab === 'persona') {
    h += `<h3>05 // IDENTITÀ</h3>` + fld('Nome', 'name') + fld('Come ti chiami', 'userName');
    h += `<h3>06 // PERSONALITÀ</h3><div class="grid2">` + Object.entries(PERS).map(([id, p]) => `<button type="button" class="pers" data-pers="${id}" aria-pressed="${cfg.personality === id}" style="${cfg.personality === id ? `border-color:${p.color};color:${p.color};background:${p.color}22` : ''}">${p.label}</button>`).join('') + '</div>';
    h += `<div class="fld" style="margin-top:10px"><label for="cust">${cfg.personality === 'custom' ? 'Prompt completo' : 'Istruzioni aggiuntive'}</label><textarea id="cust" data-k="custom" rows="6">${esc(cfg.custom)}</textarea></div>`;
    h += `<h3>07 // CAPRI</h3><div class="grid2">${fld('Dormiente dopo (s)', 'capri.sleepSec', { type: 'number' })}${fld('Velocità testo (car/s)', 'capri.cps', { type: 'number' })}</div>` + tog('Effetti glitch', 'capri.glitch');
  }
  if (curTab === 'sprite') {
    h += `<h3>08 // SPRITE PER STATO</h3><p class="note">Più frame = animazione in loop. Anche GIF e clip video (mp4/webm). <b>dormant</b> = sigillo piccolo, <b>talk</b> = bocca da chiusa ad aperta, <b>blink</b> = occhi chiusi.</p>`;
    h += SPRITE_STATES.map((s) => `<div class="sprow"><div class="h"><span>${s} · ${(sprites[s] || []).length}</span><button type="button" class="btn" data-imp="${s}">+ Importa</button></div><div class="thumbs">${(sprites[s] || []).map((it) => `<button type="button" data-dels="${it.id}" aria-label="Rimuovi frame">${it.video ? `<video src="${it.url}" muted></video>` : `<img src="${it.url}" alt="">`}</button>`).join('')}</div></div>`).join('');
  }
  if (curTab === 'voce') {
    h += `<h3>09 // VOCE</h3>` + tog('Parla ad alta voce', 'tts.on');
    h += sel('Lingua (ascolto e voce)', 'lang', [['it-IT', 'Italiano'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['ja-JP', '日本語']]);
    h += `<div class="grid2">${fld('Tono (pitch)', 'tts.pitch', { type: 'number' })}${fld('Velocità', 'tts.rate', { type: 'number' })}</div>`;
    const voices = N ? JSON.parse(N.voices(cfg.lang.slice(0, 2)) || '[]') : [];
    h += sel('Voce', 'tts.voice', [['', 'Predefinita'], ...voices.map((v) => [v, v])]);
    h += `<div class="row"><button type="button" class="btn cy" id="testVoice">▶ Test voce</button></div>`;
    h += `<p class="note">Per voci migliori: Impostazioni Android → Sintesi vocale → Servizi Google → installa i dati vocali (anche offline).</p>`;
  }
  if (curTab === 'musica') {
    const info = N ? JSON.parse(N.info()) : {};
    h += `<h3>10 // MUSICA</h3>` + tog('Controllo musica', 'music.on');
    h += sel('Lettore', 'music.provider', [['auto', 'Automatico (swiftFree se installato)'], ['swiftfree', 'swiftFree'], ['spotify', 'Spotify']]);
    h += `<div class="row"><span class="chip ${info.swiftfree ? 'ok' : ''}">swiftFree ${info.swiftfree ? 'installato' : 'non trovato'}</span><span class="chip ${info.spotify ? 'ok' : ''}">Spotify ${info.spotify ? 'installato' : 'non trovato'}</span></div>`;
    h += `<div class="fld"><label for="mq">Prova</label><input id="mq" placeholder="Looping the Rooms rusino"></div><div class="row"><button type="button" class="btn cy" id="mPlay">▶ Play</button><button type="button" class="btn" data-mc="pause">Pausa</button><button type="button" class="btn" data-mc="next">Avanti</button></div>`;
    h += `<p class="note">swiftFree riceve <b>com.swiftfree.action.PLAY</b> (extra "query") e il link <b>swiftfree://play?q=</b>. Spotify: apro la ricerca e premo play. Pausa/avanti usano i tasti multimediali di sistema.</p>`;
  }
  if (curTab === 'bolla') {
    h += `<h3>11 // BOLLA FLOTTANTE</h3><p class="note">Capri resta sopra le altre app come sigillo. <b>Tocca</b> = parla subito (risponde nel fumetto e a voce, senza aprire l'app) · <b>doppio tocco</b> = apre l'app · <b>trascina</b> = sposta · <b>tieni premuto</b> = chiude. Serve il permesso "Mostra sopra altre app" e il microfono.</p>`;
    h += `<div class="row"><button type="button" class="btn p" id="bOn">Attiva bolla</button><button type="button" class="btn rd" id="bOff">Disattiva</button></div>`;
  }
  if (curTab === 'memoria') {
    h += `<h3>12 // MEMORIA (${cfg.facts.length})</h3>`;
    h += `<div class="fld"><label for="nf">Aggiungi fatto</label><input id="nf"></div><div class="row"><button type="button" class="btn p" id="addF">Salva</button><button type="button" class="btn" id="newConv">Nuova conversazione</button><button type="button" class="btn rd" id="clrF">Cancella tutto</button></div>`;
    h += cfg.facts.map((f, i) => `<div class="item"><span class="grow" style="white-space:normal">${esc(f.text)}</span><button type="button" data-delf="${i}" aria-label="Dimentica">✕</button></div>`).join('');
  }
  if (curTab === 'log') {
    h += `<h3>13 // LOG</h3><div class="log">${logs.slice().reverse().map((l) => `${l.t} <span class="l${l.level}">[${l.src.toUpperCase()}]</span> ${esc(l.msg)}`).join('\n') || '—'}</div>`;
  }
  P.innerHTML = h;
  bindForm(P);
  bindTab(P);
}

function bindTab(P) {
  const on = (sel2, fn) => P.querySelectorAll(sel2).forEach((el) => (el.onclick = () => fn(el)));
  P.querySelectorAll('[data-xk]').forEach((el) => {
    el.onchange = () => {
      cfg.extra[+el.dataset.xk][el.dataset.f] = el.value.trim();
      save();
    };
  });
  on('[data-xtg]', (el) => {
    const pv = cfg.extra[+el.dataset.xtg];
    pv.enabled = !pv.enabled;
    save();
    el.setAttribute('aria-checked', pv.enabled);
  });
  on('[data-xtest]', async (el) => {
    const i = +el.dataset.xtest, pv = cfg.extra[i], out = $('xs' + i);
    out.className = 'chip';
    out.textContent = '…';
    const m = pv.models.split(',')[0].trim();
    try {
      const t = await chatCall(pv.base, pv.key.trim(), m, [{ role: 'user', content: 'Rispondi solo: ok' }], { max: 20 }, 20000);
      out.className = 'chip ok';
      out.textContent = 'OK · ' + m + ' · ' + t.slice(0, 20);
    } catch (e) {
      out.className = 'chip err';
      out.textContent = String(e.status || 'rete') + ' · ' + String(e.body || e.message).slice(0, 60);
    }
  });
  on('[data-xlist]', async (el) => {
    const i = +el.dataset.xlist, pv = cfg.extra[i], out = $('xs' + i);
    out.textContent = '…';
    const r = await http('GET', pv.base.replace(/\/+$/, '') + '/models', pv.key ? { Authorization: 'Bearer ' + pv.key.trim() } : {}, '', 15000);
    const j = safeJson(r.body);
    const ids = ((j && (j.data || j.models)) || []).map((x) => x.id || x.name).filter(Boolean);
    out.className = 'chip ' + (ids.length ? 'ok' : 'err');
    out.textContent = ids.length ? ids.length + ' modelli (vedi Log)' : 'errore ' + r.status;
    if (ids.length) log('info', pv.id, 'modelli: ' + ids.slice(0, 60).join(', '));
  });
  on('#pAll', () => nat(() => N.requestPerms('android.permission.RECORD_AUDIO,android.permission.READ_CONTACTS,android.permission.CALL_PHONE')));
  on('#pA11y', () => nat(() => N.openA11y()));
  on('#tGo', () => {
    const v = $('tq').value.trim();
    if (!v) return;
    closeSettings();
    ask(v);
  });
  on('#pvApply', () => applyPassive(true));
  on('[data-mv]', (el) => {
    const i = +el.dataset.mv, j = i + +el.dataset.d;
    if (j < 0 || j >= cfg.order.length) return;
    [cfg.order[i], cfg.order[j]] = [cfg.order[j], cfg.order[i]];
    save();
    renderTab();
  });
  on('[data-delk]', (el) => { cfg.gemini.keys.splice(+el.dataset.delk, 1); save(); renderTab(); });
  on('#addKeys', () => {
    const ks3 = $('newKeys').value.split(/[\s,;]+/).map((x) => x.trim()).filter((x) => x.length > 20 && !cfg.gemini.keys.includes(x));
    cfg.gemini.keys.push(...ks3);
    save();
    renderTab();
  });
  on('#resetKeys', () => { Object.keys(keyState).forEach((k) => delete keyState[k]); badModels.clear(); renderTab(); });
  const gm = P.querySelector('#gm');
  if (gm) gm.onchange = () => { cfg.gemini.models = gm.value.split(',').map((x) => x.trim()).filter(Boolean); save(); };
  on('#pingPc', async () => {
    $('pcSt').textContent = '…';
    const r = await http('GET', cfg.local.baseUrl.replace(/\/+$/, '') + '/models', {}, '', 4000);
    const ok = r.status === 200;
    $('pcSt').className = 'chip ' + (ok ? 'ok' : 'err');
    $('pcSt').textContent = ok ? 'ONLINE · ' + (JSON.parse(r.body).data || []).length + ' modelli' : 'NON RAGGIUNGIBILE';
  });
  on('[data-pers]', (el) => { cfg.personality = el.dataset.pers; save(); renderTab(); });
  on('[data-imp]', (el) => { spriteTarget = el.dataset.imp; $('pickSprite').click(); });
  on('[data-dels]', (el) => delSprite(+el.dataset.dels).then(renderTab));
  on('#testVoice', () => speak(`${T('Ciao, sono')} ${cfg.name}. ${T('Sistemi neurali online, choom.')}`));
  on('#mPlay', () => { const q = $('mq').value.trim(); if (q) { music('play', q); ex.np = q; } });
  on('[data-mc]', (el) => music(el.dataset.mc));
  on('#bOn', () => N ? N.bubble(true) : log('warn', 'bolla', 'solo nell\'app'));
  on('#bOff', () => N && N.bubble(false));
  on('#addF', () => { addFact($('nf').value); renderTab(); });
  on('[data-ui]', (el) => setUiLang(el.dataset.ui));
  on('#newConv', () => { history.length = 0; ex.user = ex.np = ex.reply = ''; refresh(); N && N.toast(T('Conversazione azzerata')); });
  on('#clrF', () => { cfg.facts = []; save(); renderTab(); });
  on('[data-delf]', (el) => { cfg.facts.splice(+el.dataset.delf, 1); save(); renderTab(); });
}
$('pickSprite').onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length && spriteTarget) await addSprites(spriteTarget, files);
  renderTab();
};
window.__bubble = (ok) => N && N.toast(T(ok ? 'Bolla attiva' : 'Permesso negato'));
window.__perms = () => {
  if (curTab === 'strumenti') renderTab();
};
function applyPassive(showToast) {
  try {
    if (!N) return;
    N.passiveMute(!!cfg.passive.mute);
    N.passive(!!cfg.passive.on, cfg.passive.words || 'hey capri', cfg.passive.greeting || T('Dimmi, choom. Di cosa hai bisogno?'));
    if (cfg.passive.on && !perms().mic) N.requestPerms('android.permission.RECORD_AUDIO');
    if (showToast) N.toast(cfg.passive.on ? 'Hey ' + cfg.name + T(': in ascolto') : T('Modalità passiva spenta'));
  } catch (e) {
    log('err', 'passivo', e.message);
  }
}

// ================================================================ avvio

(async function boot() {
  I18N.set(cfg.uiLang);
  I18N.observe(document.body);
  I18N.walk(document.body);
  try { if (N && N.setUi) N.setUi(cfg.uiLang); } catch (e) { /* niente */ }
  try { await loadSprites(); } catch (e) { log('err', 'sprite', e.message); }
  setProv('offline', '');
  refresh();
  try { if (N) { N.setLang(cfg.lang); N.ready(); } } catch (e) { log('err', 'app', 'bridge: ' + e.message); }
  if (cfg.passive.on) setTimeout(() => applyPassive(false), 1200);
  if (!cfg.gemini.keys.length && !cfg.openrouter.key && cfg.local.baseUrl === DEF.local.baseUrl) {
    setTimeout(() => openSettings('ai'), 400);
    log('info', 'app', 'Primo avvio: imposta il PC in LAN o le API key.');
  }
})();
