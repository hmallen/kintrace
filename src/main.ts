import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from './db.js';
import { buildServer } from './server.js';
import { createAnthropicVisionClient } from './ai/transcriber.js';

const dataDir = process.env.KINTRACE_DATA ?? join(process.cwd(), 'data');
const archiveDir = join(dataDir, 'archive');
const cacheDir = join(dataDir, 'cache');
mkdirSync(archiveDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

const db = openDb(join(dataDir, 'kintrace.db'));
const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? createAnthropicVisionClient(apiKey) : null;
if (!client) console.warn('ANTHROPIC_API_KEY not set — AI transcription disabled');

const app = buildServer({ db, archiveDir, cacheDir, client });
const port = Number(process.env.PORT ?? 3271);
app.listen({ port, host: '127.0.0.1' }).then(() => {
  console.log(`KinTrace API on http://127.0.0.1:${port}`);
});
