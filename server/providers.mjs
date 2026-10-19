import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

export const PROTOCOLS = ['chat-completions', 'openai-responses', 'anthropic'];
const SYSTEM = '你是一位严谨、友好的项目协作助手。使用用户的语言回答。你没有执行命令或修改本地文件的能力，不要声称已经执行了这些操作。';
export const protocolOf = provider => provider.protocol || 'chat-completions';
export const providerClient = (provider, key) => {
  const options = { apiKey: key || 'local', baseURL: provider.baseUrl, maxRetries: 0, timeout: 120000 };
  // The Anthropic SDK otherwise inherits a Claude CLI token intended for another provider.
  return protocolOf(provider) === 'anthropic' ? new Anthropic({ ...options, authToken: null, defaultHeaders: { Authorization: null } }) : new OpenAI({ ...options, organization: null, project: null });
};
export const isProviderError = error => error instanceof OpenAI.APIError || error instanceof Anthropic.APIError;

export async function listProviderModels(provider, client) {
  const result = await client.models.list();
  let models = result.data.map(item => item.id).filter(item => typeof item === 'string');
  if (provider.id === 'openai' && protocolOf(provider) === 'openai-responses') models = models.filter(model => /^(gpt-|o\d)/.test(model) && !/(?:audio|realtime|transcribe|tts|image|embedding)/.test(model));
  return [...new Set(models)].slice(0, 200);
}

export async function* streamProvider({ provider, client, model, history, thinking, signal }) {
  const protocol = protocolOf(provider);
  if (protocol === 'openai-responses') {
    const extra = thinking && provider.thinking ? { reasoning: { effort: 'high', summary: 'auto' } } : {};
    const stream = await client.responses.create({ model, instructions: SYSTEM, input: history, store: false, stream: true, max_output_tokens: 8192, ...extra }, { signal });
    let completed = false;
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') yield { content: event.delta || '' };
      if (event.type === 'response.reasoning_summary_text.delta') yield { reasoning: event.delta || '' };
      if (event.type === 'response.completed' || event.type === 'response.incomplete') {
        completed = true;
        yield { usage: event.response.usage, finishReason: event.type === 'response.incomplete' ? 'length' : 'stop' };
      }
      if (event.type === 'response.failed' || event.type === 'error') throw Object.assign(new Error('Upstream response failed'), { status: 502 });
    }
    if (!completed && !signal?.aborted) throw Object.assign(new Error('Upstream stream ended prematurely'), { status: 502 });
    return;
  }
  if (protocol === 'anthropic') {
    const extra = thinking && provider.thinking ? { thinking: { type: 'adaptive' } } : {};
    const stream = await client.messages.create({ model, system: SYSTEM, messages: history, max_tokens: 8192, stream: true, ...extra }, { signal });
    let completed = false;
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') yield { content: event.delta.text };
        if (event.delta.type === 'thinking_delta') yield { reasoning: event.delta.thinking };
      }
      if (event.type === 'message_start') yield { usage: event.message.usage };
      if (event.type === 'message_delta') yield { usage: event.usage, finishReason: event.delta.stop_reason === 'max_tokens' ? 'length' : event.delta.stop_reason };
      if (event.type === 'message_stop') completed = true;
      if (event.type === 'error') throw Object.assign(new Error('Upstream message failed'), { status: 502 });
    }
    if (!completed && !signal?.aborted) throw Object.assign(new Error('Upstream stream ended prematurely'), { status: 502 });
    return;
  }
  const extra = provider.thinking ? { thinking: { type: thinking ? 'enabled' : 'disabled' } } : {};
  const stream = await client.chat.completions.create({ model, messages: [{ role: 'system', content: SYSTEM }, ...history], stream: true, stream_options: { include_usage: true }, max_tokens: 8192, ...extra }, { signal });
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta || {};
    yield { content: delta.content || '', reasoning: delta.reasoning_content || '', usage: chunk.usage, finishReason: chunk.choices?.[0]?.finish_reason };
  }
}
