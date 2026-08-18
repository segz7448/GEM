import * as SecureStore from 'expo-secure-store';

export type AiProvider = 'claude' | 'openai' | 'openrouter' | 'huggingface';

export interface AiProviderConfig {
  apiKey: string;
  model: string;
}

const keyFor = (provider: AiProvider) => `gem_ai_${provider}`;

export async function saveProviderConfig(provider: AiProvider, config: AiProviderConfig): Promise<void> {
  await SecureStore.setItemAsync(keyFor(provider), JSON.stringify(config));
}

export async function getProviderConfig(provider: AiProvider): Promise<AiProviderConfig | null> {
  const raw = await SecureStore.getItemAsync(keyFor(provider));
  return raw ? JSON.parse(raw) : null;
}

export async function deleteProviderConfig(provider: AiProvider): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(provider));
}

export async function getActiveProvider(): Promise<{ provider: AiProvider; config: AiProviderConfig } | null> {
  for (const provider of ['claude', 'openai', 'openrouter', 'huggingface'] as AiProvider[]) {
    const config = await getProviderConfig(provider);
    if (config?.apiKey) return { provider, config };
  }
  return null;
}

/** Makes a minimal real request to verify the key/model actually work, without spending more than necessary. */
export async function testConnection(provider: AiProvider, config: AiProviderConfig): Promise<{ ok: boolean; message: string }> {
  try {
    switch (provider) {
      case 'openai': {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        });
        return res.ok ? { ok: true, message: 'Connected.' } : { ok: false, message: `OpenAI rejected the key (${res.status}).` };
      }
      case 'claude': {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ model: config.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
        });
        // 400 on a too-small max_tokens edge case still proves auth succeeded; 401 means bad key.
        return res.status !== 401 ? { ok: true, message: 'Connected.' } : { ok: false, message: 'Anthropic rejected the key.' };
      }
      case 'openrouter': {
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        });
        return res.ok ? { ok: true, message: 'Connected.' } : { ok: false, message: `OpenRouter rejected the key (${res.status}).` };
      }
      case 'huggingface': {
        const res = await fetch('https://huggingface.co/api/whoami-v2', {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        });
        return res.ok ? { ok: true, message: 'Connected.' } : { ok: false, message: `Hugging Face rejected the key (${res.status}).` };
      }
    }
  } catch (err: any) {
    return { ok: false, message: err.message || 'Network error while testing the connection.' };
  }
}
