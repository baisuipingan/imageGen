import { Hono } from 'hono';

type Bindings = {
  BASE_URL: string;
  ASSETS: Fetcher;
};

type ImageBody = {
  prompt: string;
  model: string;
  ratio: string;
  size?: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  background: 'auto' | 'transparent';
  output_format: 'png' | 'jpeg' | 'webp';
  n: number;
  reference_image?: string;
};

type ImageItem = {
  b64_json?: string;
  url?: string;
  image_url?: string;
  image?: string;
  revised_prompt?: string;
};

type ImageResponse = {
  data?: ImageItem[];
  b64_json?: string;
  image?: string;
  images?: string[];
  url?: string;
  output?: Array<{
    type?: string;
    result?: string;
    b64_json?: string;
    url?: string;
    content?: Array<{ type?: string; image_url?: string; url?: string; b64_json?: string }>;
  }>;
  partial_image_b64?: string;
  partial_image_index?: number;
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
  const requestModel = body.model || 'gpt-image-2';
  const requestSize = resolveSize(body.ratio || '1:1');
  const requestQuality = resolveQuality(body.quality || body.size || 'auto');
  const requestPrompt = withRatioHint(body.prompt, body.ratio || '1:1');

  let upstream: Response;
  try {
    if (useEdit && body.reference_image) {
      const form = new FormData();
      const image = await dataUrlToFile(body.reference_image, 'reference.png');
      form.append('image[]', image);
      form.append('prompt', requestPrompt);
      form.append('model', requestModel);
      form.append('size', requestSize);
      form.append('quality', requestQuality);
      form.append('background', normalizeBackground(body));
      form.append('output_format', body.output_format || 'png');
      form.append('n', String(body.n || 1));
      if (isNanaModel(requestModel)) form.append('stream', 'true');

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
          prompt: requestPrompt,
          size: requestSize,
          quality: requestQuality,
          background: normalizeBackground(body),
          output_format: body.output_format || 'png',
          n: body.n || 1,
          stream: true,
          partial_images: 2,
        }),
      });
    }
  } catch (error) {
    return c.json({
      error: 'Failed to reach upstream image API',
      detail: error instanceof Error ? error.message : String(error),
    }, 502);
  }

  if (!upstream.ok) return upstreamErrorResponse(upstream, await upstream.text());
  if (isEventStream(upstream)) return streamImageEvents(upstream);

  const text = await upstream.text();

  const data = JSON.parse(text) as ImageResponse;
  const images = extractImages(data, body.output_format || 'png');
  if (!images.length) {
    return c.json({
      error: 'No image returned',
      detail: summarizeImageResponse(data),
    }, 502);
  }

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

function isNanaModel(model: string) {
  return model.startsWith('gpt-image-nana-');
}

function upstreamErrorResponse(upstream: Response, text: string) {
  return new Response(JSON.stringify({
    error: extractUpstreamError(text),
    upstream_status: upstream.status,
  }), {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isEventStream(response: Response) {
  return response.headers.get('Content-Type')?.includes('text/event-stream');
}

function streamImageEvents(upstream: Response) {
  if (!upstream.body) return Response.json({ error: 'Upstream stream is empty' }, { status: 502 });
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
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

function extractImages(data: ImageResponse, format: string) {
  const values: string[] = [];

  if (data.b64_json) values.push(asDataUrl(data.b64_json, format));
  if (data.partial_image_b64) values.push(asDataUrl(data.partial_image_b64, format));
  for (const value of data.images || []) values.push(value);
  if (data.image) values.push(data.image);
  if (data.url) values.push(data.url);

  for (const item of data.data || []) {
    if (item.b64_json) values.push(asDataUrl(item.b64_json, format));
    if (item.url) values.push(item.url);
    if (item.image_url) values.push(item.image_url);
    if (item.image) values.push(normalizeImageValue(item.image, format));
  }

  for (const item of data.output || []) {
    if (item.result) values.push(normalizeImageValue(item.result, format));
    if (item.b64_json) values.push(asDataUrl(item.b64_json, format));
    if (item.url) values.push(item.url);
    for (const content of item.content || []) {
      if (content.b64_json) values.push(asDataUrl(content.b64_json, format));
      if (content.image_url) values.push(content.image_url);
      if (content.url) values.push(content.url);
    }
  }

  return values
    .map((value) => normalizeImageValue(value, format))
    .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
}

function normalizeImageValue(value: string, format: string) {
  if (!value) return '';
  if (value.startsWith('data:image/') || value.startsWith('http://') || value.startsWith('https://')) return value;
  return asDataUrl(value, format);
}

function asDataUrl(value: string, format: string) {
  return `data:image/${format};base64,${value}`;
}

function summarizeImageResponse(data: ImageResponse) {
  return {
    top_level_keys: Object.keys(data),
    data_count: data.data?.length || 0,
    data_keys: data.data?.[0] ? Object.keys(data.data[0]) : [],
    output_count: data.output?.length || 0,
    output_keys: data.output?.[0] ? Object.keys(data.output[0]) : [],
  };
}

async function dataUrlToFile(dataUrl: string, filename: string) {
  const match = /^data:(.+?);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Invalid reference image');
  const [, mimeType, base64] = match;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new File([bytes], filename, { type: mimeType });
}

function withRatioHint(prompt: string, ratio: string) {
  if (ratio === '1:1' || ratio === 'unspecified') return prompt;
  const ratioLabels: Record<string, string> = {
    '16:9': '16:9 横版画幅',
    '4:3': '4:3 横版画幅',
    '3:4': '3:4 竖版画幅',
    '9:16': '9:16 竖版画幅',
  };
  return `${prompt}\n\n画面比例要求：${ratioLabels[ratio] || ratio}。`;
}

function resolveSize(ratio: string) {
  if (ratio === 'unspecified') return 'auto';
  if (ratio === '3:4' || ratio === '9:16') return '1024x1536';
  if (ratio === '16:9' || ratio === '4:3') return '1536x1024';
  return '1024x1024';
}

function resolveQuality(value: string) {
  const legacyMap: Record<string, string> = { '1K': 'auto', '2K': 'high', '4K': 'high' };
  const quality = legacyMap[value] || value || 'auto';
  return ['low', 'medium', 'high', 'auto'].includes(quality) ? quality : 'auto';
}
