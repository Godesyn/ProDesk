import type { Express } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { queues } from './queues.js';

export function mountBullBoard(app: Express, path: string) {
  const adapter = new ExpressAdapter();
  adapter.setBasePath(path);
  createBullBoard({
    queues: queues.map((q) => new BullMQAdapter(q)),
    serverAdapter: adapter,
  });
  app.use(path, adapter.getRouter());
}
