import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from './db.js';
import { buildServer } from './server.js';
import {
  createAnthropicVisionClient,
  createOpenAIVisionClient,
  resolveProvider,
} from './ai/providers.js';
import { createLlmVisionEngine, type TranscriptionEngine } from './ai/engine.js';

const dataDir = process.env.KINTRACE_DATA ?? join(process.cwd(), 'data');
const archiveDir = join(dataDir, 'archive');
const cacheDir = join(dataDir, 'cache');
const stagingDir = join(dataDir, 'staging');
const gedcomArchiveDir = join(dataDir, 'gedcom');
mkdirSync(archiveDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });
mkdirSync(stagingDir, { recursive: true });
mkdirSync(gedcomArchiveDir, { recursive: true });

const db = openDb(join(dataDir, 'kintrace.db'));
const choice = resolveProvider(process.env);
let engine: TranscriptionEngine | null = null;
let aiDisabledMessage: string | undefined;
if (choice.ok) {
  const client =
    choice.provider === 'openai'
      ? createOpenAIVisionClient(choice.apiKey, { model: process.env.OPENAI_VISION_MODEL })
      : createAnthropicVisionClient(choice.apiKey);
  engine = createLlmVisionEngine(client);
} else {
  aiDisabledMessage = choice.message;
  console.warn(choice.message);
}

const app = buildServer({ db, archiveDir, cacheDir, stagingDir, gedcomArchiveDir, engine, aiDisabledMessage });
const port = Number(process.env.PORT ?? 3271);
app.listen({ port, host: '127.0.0.1' }).then(() => {
  console.log(`KinTrace API on http://127.0.0.1:${port}`);
}).catch((err) => {
  console.error(`Failed to start KinTrace API on port ${port}:`, err.message ?? err);
  process.exit(1);
});
