/**
 * API Server
 */

import express, { Request, Response } from 'express';

const app = express();

app.use(express.json());

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

export function startApiServer(port: number = 3000): void {
  app.listen(port, () => {
    console.log(`[API] Server running on port ${port}`);
  });
}
