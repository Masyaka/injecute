import { DIContainer } from 'injecute';

interface Mailer {
  send(to: string): string;
}

// #region config-aliases
const config = { mailer: 'smtp' as 'smtp' | 'console' };

const app = new DIContainer()
  .addSingleton('smtpMailer', (): Mailer => ({ send: (to) => `smtp → ${to}` }))
  .addSingleton('consoleMailer', (): Mailer => ({
    send: (to) => `console → ${to}`,
  }))
  // choose the implementation once, at the composition root
  .addAlias(
    'mailer',
    config.mailer === 'smtp' ? 'smtpMailer' : 'consoleMailer',
  );

app.get('mailer').send('ada@example.com'); // "smtp → ada@example.com"
// #endregion config-aliases

export { app };
