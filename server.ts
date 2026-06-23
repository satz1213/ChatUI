import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { join } from 'path';
import { existsSync } from 'fs';

const distPath = join(process.cwd(), 'dist');
const isProd = existsSync(distPath);

console.log(`Working dir: ${process.cwd()}`);
console.log(`Dist path:   ${distPath}`);
console.log(`Dist exists: ${isProd}`);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve the built React app in production
if (isProd) {
  app.use(express.static(distPath));
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

app.post('/api/chat', async (req, res) => {
  const { messages, apiKey } = req.body as { messages: ChatMessage[]; apiKey: string };

  if (!apiKey?.trim()) {
    res.status(400).json({ error: 'API key is required' });
    return;
  }

  const client = new Anthropic({ apiKey });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = client.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      thinking: { type: 'adaptive' } as any,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as { type: string; text?: string; thinking?: string };
        if (delta.type === 'text_delta' && delta.text) {
          send({ type: 'text', text: delta.text });
        } else if (delta.type === 'thinking_delta' && delta.thinking) {
          send({ type: 'thinking', thinking: delta.thinking });
        }
      }
    }

    send({ type: 'done' });
  } catch (err) {
    send({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
  }

  res.end();
});

// SPA fallback — sends index.html for any non-API route
if (isProd) {
  app.get('*', (_req, res) => {
    res.sendFile(join(distPath, 'index.html'));
  });
}

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT} (prod=${isProd})`);
});
