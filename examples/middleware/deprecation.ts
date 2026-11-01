import { DIContainer } from 'injecute';

export const warnings: string[] = [];

// #region deprecation
// Keep an old key working while callers migrate to the new one.
const renamed: Record<string, string> = { mailer: 'emailSender' };

const app = new DIContainer()
  .addSingleton('emailSender', () => ({
    send: (to: string) => `sent to ${to}`,
  }))
  .use((key, next) => {
    const newKey = typeof key === 'string' ? renamed[key] : undefined;
    if (newKey === undefined) return next();
    warnings.push(`"${String(key)}" is deprecated, use "${newKey}"`);
    return next(newKey);
  });

const mailer = app.get('mailer' as never) as { send(to: string): string };
mailer.send('ada@example.com'); // works, and records a deprecation warning
// #endregion deprecation

export { app };
