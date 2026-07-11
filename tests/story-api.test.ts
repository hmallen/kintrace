import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { buildServer } from '../src/server.js';
import type { TimelineStory } from '../shared/api.js';
import type { StoryGenerator } from '../src/ai/story.js';

const story: TimelineStory = {
  title: 'Archive story',
  sections: [{ heading: 'Beginning', paragraphs: [{ text: 'A documented fact.', sourceItemIds: [1] }] }],
};

function reviewedDb() {
  const db = openDb(':memory:');
  db.prepare(`
    INSERT INTO items (id, file_path, content_hash, media_type, title, description, status)
    VALUES (1, '/one.jpg', 'one', 'photo', 'One photo', 'A documented fact.', 'reviewed')
  `).run();
  return db;
}

function appWith(db: ReturnType<typeof openDb>, storyGenerator?: StoryGenerator | null) {
  return buildServer({
    db,
    archiveDir: '/tmp/na',
    cacheDir: '/tmp/na',
    stagingDir: '/tmp/na',
    engine: null,
    storyGenerator,
  });
}

describe('timeline story API', () => {
  it('reads state without generating and reports missing OpenAI configuration', async () => {
    const db = reviewedDb();
    const app = appWith(db, null);
    const state = await app.inject({ method: 'GET', url: '/api/timeline/story' });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toEqual(expect.objectContaining({
      story: null,
      canGenerate: false,
      unavailableReason: 'openai_not_configured',
      eligibleSourceCount: 1,
    }));
    expect((await app.inject({ method: 'POST', url: '/api/timeline/story' })).statusCode).toBe(503);
  });

  it('requires reviewed media and generates only on POST', async () => {
    const db = openDb(':memory:');
    let calls = 0;
    const generator: StoryGenerator = {
      model: 'test-model',
      async generate() { calls += 1; return story; },
    };
    const app = appWith(db, generator);
    await app.inject({ method: 'GET', url: '/api/timeline/story' });
    expect(calls).toBe(0);
    expect((await app.inject({ method: 'POST', url: '/api/timeline/story' })).statusCode).toBe(409);
  });

  it('persists successful POST results and maps failures to 502', async () => {
    const db = reviewedDb();
    const generator: StoryGenerator = { model: 'test-model', generate: async () => story };
    const app = appWith(db, generator);
    const generated = await app.inject({ method: 'POST', url: '/api/timeline/story' });
    expect(generated.statusCode).toBe(200);
    expect(generated.json().story.title).toBe('Archive story');
    expect((await app.inject({ method: 'GET', url: '/api/timeline/story' })).json().story.title)
      .toBe('Archive story');

    const failingApp = appWith(db, {
      model: 'test-model',
      generate: async () => { throw new Error('upstream unavailable'); },
    });
    expect((await failingApp.inject({ method: 'POST', url: '/api/timeline/story' })).statusCode).toBe(502);
    expect((await failingApp.inject({ method: 'GET', url: '/api/timeline/story' })).json().story.title)
      .toBe('Archive story');
  });

  it('rejects concurrent generation', async () => {
    const db = reviewedDb();
    let release!: (value: TimelineStory) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const pending = new Promise<TimelineStory>((resolve) => { release = resolve; });
    const app = appWith(db, {
      model: 'test-model',
      generate: async () => { markStarted(); return pending; },
    });
    const first = Promise.resolve(app.inject({ method: 'POST', url: '/api/timeline/story' }));
    await started;
    const second = await app.inject({ method: 'POST', url: '/api/timeline/story' });
    expect(second.statusCode).toBe(409);
    release(story);
    expect((await first).statusCode).toBe(200);
  });
});
