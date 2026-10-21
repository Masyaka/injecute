import { AsyncLocalStorage } from 'node:async_hooks';
import { DIContainer } from 'injecute';
import type { RequestContext } from './app.ts';

interface Mailer {
  send(to: string): string;
}

class SmtpMailer implements Mailer {
  send(to: string) {
    return `smtp → ${to}`;
  }
}
class SesMailer implements Mailer {
  send(to: string) {
    return `ses → ${to}`;
  }
}

// #region strategy
const storage = new AsyncLocalStorage<RequestContext>();
const tenantMailers: Record<string, 'smtp' | 'ses'> = { acme: 'ses' };

const app = new DIContainer()
  .addInstance('context', { current: () => storage.getStore() })
  .addInstance('tenantMailers', tenantMailers)
  .addSingleton('smtpMailer', SmtpMailer)
  .addSingleton('sesMailer', SesMailer)
  // one singleton that picks the implementation for the current tenant on every call
  .addSingleton(
    'mailer',
    (context, tenantMailers, smtp, ses): Mailer => {
      const mailers = { smtp, ses };
      const current = () =>
        mailers[tenantMailers[context.current()?.tenantId ?? ''] ?? 'smtp'];
      return { send: (to) => current().send(to) };
    },
    ['context', 'tenantMailers', 'smtpMailer', 'sesMailer'],
  );

export const sent = ['acme', 'globex'].map((tenantId) =>
  storage.run({ traceId: tenantId, tenantId }, () =>
    app.get('mailer').send(`ops@${tenantId}.example`),
  ),
); // ["ses → ops@acme.example", "smtp → ops@globex.example"]
// #endregion strategy

export { app };
