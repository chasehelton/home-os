import type { FastifyInstance } from 'fastify';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (_req, reply) => {
    try {
      app.deps.sqlite.prepare('SELECT 1').get();
      return { status: 'ok', db: 'ok' };
    } catch (err) {
      app.log.error({ err }, 'readiness check failed');
      return reply.code(503).send({ status: 'error', db: 'error' });
    }
  });
}
