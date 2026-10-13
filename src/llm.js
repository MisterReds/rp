// Клиент нейросети. Поддерживаются:
//  - provider "openai": любой OpenAI-совместимый API (OpenAI, Qwen/DashScope, DeepSeek, OpenRouter, Ollama, LM Studio, vLLM);
//  - provider "anthropic": Anthropic Messages API (Claude).
// Настройки: раздел "llm" в project.json и/или переменные окружения LLM_PROVIDER, LLM_BASE_URL, LLM_MODEL, LLM_API_KEY.
'use strict';

function llmConfig(project = {}) {
  const c = project.llm || {};
  const provider = process.env.LLM_PROVIDER || c.provider || 'openai';
  const cfg = {
    provider,
    baseUrl: (process.env.LLM_BASE_URL || c.base_url || (provider === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1')).replace(/\/$/, ''),
    model: process.env.LLM_MODEL || c.model,
    apiKey: process.env.LLM_API_KEY || (c.api_key_env ? process.env[c.api_key_env] : '') || '',
    temperature: c.temperature ?? 0.4,
    maxTokens: c.max_tokens || 8000,
    jsonMode: c.json_mode ?? true,
    timeoutMs: (c.timeout_sec || 300) * 1000,
  };
  if (!cfg.model) throw new Error('Не задана модель: укажите llm.model в project.json или переменную LLM_MODEL');
  return cfg;
}

async function chat(cfg, system, messages) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    if (cfg.provider === 'anthropic') {
      const r = await fetch(`${cfg.baseUrl}/messages`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: cfg.model, max_tokens: cfg.maxTokens, temperature: cfg.temperature, system, messages }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(`Anthropic API ${r.status}: ${JSON.stringify(j).slice(0, 500)}`);
      return j.content.filter(x => x.type === 'text').map(x => x.text).join('');
    }
    const body = { model: cfg.model, temperature: cfg.temperature, max_tokens: cfg.maxTokens, messages: [{ role: 'system', content: system }, ...messages] };
    if (cfg.jsonMode) body.response_format = { type: 'json_object' };
    const headers = { 'content-type': 'application/json' };
    if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
    const r = await fetch(`${cfg.baseUrl}/chat/completions`, { method: 'POST', signal: ctrl.signal, headers, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(`LLM API ${r.status}: ${JSON.stringify(j).slice(0, 500)}`);
    return j.choices[0].message.content;
  } finally { clearTimeout(timer); }
}

// Достать JSON из ответа (модели иногда оборачивают его в ``` или добавляют текст)
function extractJson(text) {
  const t = String(text).replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('в ответе нет JSON-объекта');
  return JSON.parse(t.slice(a, b + 1));
}

// Запрос с проверкой: если check() вернул ошибки, модель получает их и исправляет ответ
async function askValidated(cfg, system, user, check, { attempts = 4, log = console.log } = {}) {
  const messages = [{ role: 'user', content: user }];
  let last = '';
  for (let i = 1; i <= attempts; i++) {
    let errors;
    let data = null;
    try {
      last = await chat(cfg, system, messages);
      data = extractJson(last);
      errors = check(data);
    } catch (e) { errors = [e.message]; }
    if (!errors.length) return data;
    log(`    попытка ${i}: ${errors.length} замечаний — ${errors.slice(0, 3).join(' | ')}`);
    messages.push({ role: 'assistant', content: last || '(пустой ответ)' });
    messages.push({ role: 'user', content: `Ответ не прошёл проверку. Исправь ВСЕ замечания и верни полный исправленный JSON целиком:\n- ${errors.join('\n- ')}` });
  }
  throw new Error(`Нейросеть не дала корректный ответ за ${attempts} попыток`);
}

module.exports = { llmConfig, chat, extractJson, askValidated };
