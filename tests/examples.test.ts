// Runs every file in examples/ (the code the docs embed) and checks what the docs say it does.
import { describe, expect, it } from 'vitest';

describe('examples', () => {
  it('getting-started', async () => {
    const { users, UserRepository } =
      await import('../examples/getting-started.ts');
    expect(users).toBeInstanceOf(UserRepository);
    expect(users.findAll()).toEqual([
      'postgres://localhost/app: select * from users',
    ]);
  });

  it('registration', async () => {
    const { lifetimes, withDependencies, logging, decorated, legacy, Clock } =
      await import('../examples/registration.ts');
    expect(lifetimes.get('clock')).toBeInstanceOf(Clock);
    expect(lifetimes.get('clock')).toBe(lifetimes.get('clock'));
    expect(lifetimes.get('requestId')).not.toBe(lifetimes.get('requestId'));
    expect(withDependencies.get('banner')).toBe(
      'http://localhost:8080 via console since 1970-01-01T00:00:00.000Z',
    );
    expect(logging.get('logger')).toEqual({ format: 'pretty' });
    expect(decorated.get('greeting')).toBe('HELLO');
    expect(legacy.get('client').url).toBe('https://api.example.com');
  });

  it('containers', async () => {
    const {
      app,
      requestScope,
      testScope,
      withBilling,
      withNamespace,
      Database,
    } = await import('../examples/containers.ts');
    expect(requestScope.get('users')).toBe(app.get('users'));
    expect(testScope.get('users').db.url).toBe('postgres://test');
    expect(app.get('users').db.url).toBe('postgres://prod');
    expect(withBilling.get('invoices').db).toBeInstanceOf(Database);
    expect(withNamespace.get('Reports.daily').kind).toBe('daily');
    expect(withNamespace.get('Reports').get('timezone')).toBe('UTC');
  });

  it('lifecycle', async () => {
    const { log, shutdown, handleRequest } =
      await import('../examples/lifecycle.ts');
    expect(await handleRequest('r1')).toBe('r1');
    expect(log).toEqual(['end r1']);
    await shutdown();
    expect(log).toEqual([
      'end r1',
      'close mailer',
      'clear cache',
      'close pool postgres://localhost/app',
    ]);
  });

  it('middleware: tracing', async () => {
    const { lines } = await import('../examples/middleware/tracing.ts');
    expect(lines.map((l) => l.replace(/[\d.]+ms/, 'Xms'))).toEqual([
      '  config Xms',
      'db Xms',
    ]);
  });

  it('middleware: fallback', async () => {
    const { port } = await import('../examples/middleware/fallback.ts');
    expect(port).toBe('8080');
  });

  it('middleware: deprecation', async () => {
    const { warnings } = await import('../examples/middleware/deprecation.ts');
    expect(warnings).toEqual(['"mailer" is deprecated, use "emailSender"']);
  });

  it('middleware: guards', async () => {
    const { root, request } = await import('../examples/middleware/guards.ts');
    expect(request.get('request.user')).toEqual({ id: 42 });
    expect(() => root.get('request.user' as never)).toThrow(/request-scoped/);
  });

  it('middleware: test doubles', async () => {
    const { frozen, real } =
      await import('../examples/middleware/test-doubles.ts');
    expect(frozen).toBe(0);
    expect(real).toBeGreaterThan(0);
  });

  it('events', async () => {
    const { events } = await import('../examples/events.ts');
    expect(events).toEqual(['added db', 'created db']);
  });

  it('testing', async () => {
    const { app, other } = await import('../examples/testing.ts');
    expect(app.get('users').db.url).toBe('postgres://prod');
    expect(other.get('users').db.url).toBe('postgres://prod'); // reset() dropped the override
  });

  it('typescript', async () => {
    const { app, listUsers } = await import('../examples/typescript.ts');
    expect(listUsers(app)).toEqual([]);
    expect(app.get('users').list()).toEqual([]);
  });

  it('errors', async () => {
    const { resolve } = await import('../examples/errors.ts');
    expect(resolve('loger')).toBeUndefined();
    expect(resolve('service')).toHaveProperty('logger');
  });

  it('async dependencies', async () => {
    const { connect } = await import('../examples/async-dependencies.ts');
    expect((await connect()).url).toBe('postgres://localhost');
  });

  it('recipes: request scope', async () => {
    const { handle } = await import('../examples/recipes/request-scope.ts');
    expect(await handle({ headers: { 'x-user-id': '7' } })).toBe(
      'hello user 7',
    );
  });

  it('recipes: config aliases', async () => {
    const { app } = await import('../examples/recipes/config-aliases.ts');
    expect(app.get('mailer').send('ada@example.com')).toBe(
      'smtp → ada@example.com',
    );
  });
});
