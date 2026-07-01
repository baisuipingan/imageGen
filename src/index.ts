import { Hono } from 'hono';

type Bindings = {
  BASE_URL: string;
  ASSETS: Fetcher;
};

type ImageBody = {
  prompt: string;
  model: string;
  ratio: string;
  size: string;
  background: 'auto' | 'transparent';
  output_format: 'png' | 'jpeg' | 'webp';
  n: number;
  reference_image?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/health', (c) => c.json({ ok: true }));

app.post('/api/generate', async (c) => {
  const auth = c.req.header('Authorization') || '';
  const apiKey = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const body = (await c.req.json()) as ImageBody;

  if (!apiKey) return c.json({ error: 'Missing API key' }, 400);
  if (!body.prompt?.trim()) return c.json({ error: 'Prompt is required' }, 400);

  const baseUrl = c.env.BASE_URL || 'https://api.openai.com';
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const useEdit = Boolean(body.reference_image);
  const url = new URL(useEdit ? '/v1/images/edits' : '/v1/images/generations', normalizedBase);
  const requestSize = resolveSize(body.size || '1K', body.ratio || '1:1');
  const requestModel = resolveModel(body.model || 'gpt-image-2', body.size || '1K');

  let upstream: Response;
  try {
    if (useEdit && body.reference_image) {
      const form = new FormData();
      const image = await dataUrlToFile(body.reference_image, 'reference.png');
      form.append('image[]', image);
      form.append('prompt', body.prompt);
      form.append('model', requestModel);
      form.append('size', requestSize);
      form.append('background', normalizeBackground(body));
      form.append('output_format', body.output_format || 'png');
      form.append('n', String(body.n || 1));

      upstream = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } else {
      upstream = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: requestModel,
          prompt: body.prompt,
          size: requestSize,
          background: normalizeBackground(body),
          output_format: body.output_format || 'png',
          n: body.n || 1,
        }),
      });
    }
  } catch (error) {
    return c.json({
      error: 'Failed to reach upstream image API',
      detail: error instanceof Error ? error.message : String(error),
    }, 502);
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    return new Response(JSON.stringify({
      error: extractUpstreamError(text),
      upstream_status: upstream.status,
    }), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = JSON.parse(text) as { data?: Array<{ b64_json?: string; revised_prompt?: string }> };
  const images = (data.data || [])
    .map((item) => item.b64_json)
    .filter((image): image is string => Boolean(image))
    .map((image) => `data:image/${body.output_format || 'png'};base64,${image}`);
  if (!images.length) return c.json({ error: 'No image returned' }, 502);

  return c.json({ image: images[0], images });
});

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};

function normalizeBackground(body: ImageBody) {
  if (body.background === 'transparent' && body.model === 'gpt-image-2') return 'auto';
  return body.background || 'auto';
}

function resolveModel(model: string, tier: string) {
  if (model === 'gpt-image-2' && tier === '2K') return 'gpt-image-2-2k';
  return model;
}

function extractUpstreamError(text: string) {
  try {
    const data = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof data.error === 'string') return data.error;
    return data.error?.message || data.message || text;
  } catch {
    return text || 'Upstream image API failed';
  }
}

async function dataUrlToFile(dataUrl: string, filename: string) {
  const match = /^data:(.+?);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Invalid reference image');
  const [, mimeType, base64] = match;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new File([bytes], filename, { type: mimeType });
}

function resolveSize(tier: string, ratio: string) {
  const sizes: Record<string, Record<string, string>> = {
    '1K': {
      unspecified: 'auto',
      '1:1': '1024x1024',
      '16:9': '1536x864',
      '4:3': '1536x1152',
      '3:4': '1152x1536',
      '9:16': '864x1536',
    },
    '2K': {
      unspecified: 'auto',
      '1:1': '2048x2048',
      '16:9': '2048x1152',
      '4:3': '2048x1536',
      '3:4': '1536x2048',
      '9:16': '1152x2048',
    },
    '4K': {
      unspecified: 'auto',
      '1:1': '2048x2048',
      '16:9': '3840x2160',
      '4:3': '2880x2160',
      '3:4': '2160x2880',
      '9:16': '2160x3840',
    },
  };
  return sizes[tier]?.[ratio] || '1024x1024';
}
