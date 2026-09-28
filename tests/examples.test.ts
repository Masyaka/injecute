// Runs every file in examples/ (the code the docs embed) and checks what the docs say it does.
import { DIContainer } from 'injecute';
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

  it('async container', async () => {
    const { users, testUsers, handler, start, shutdown, log, UserRepository } =
      await import('../examples/async-container.ts');
    expect(users).toBeInstanceOf(UserRepository);
    expect(await users.findAll()).toBe(
      'postgres://localhost/app: select * from users',
    );
    expect(testUsers.pool.url).toBe('postgres://test');
    expect(await handler()).toBe(
      'postgres://localhost/app: select * from users',
    );
    await start();
    await shutdown();
    expect(log).toEqual([
      'close pool postgres://test',
      'close pool postgres://localhost/app',
    ]);
  });

  it('recipes: request scope', async () => {
    const { placeOrder, log } =
      await import('../examples/recipes/request-scope.ts');
    await placeOrder('book', 1);
    await expect(placeOrder('pen', 0)).rejects.toThrow('at least 1');
    expect(log).toEqual([
      'tx1: insert book',
      'tx1: charge 10 via stripe',
      'tx1: commit',
      'tx2: insert pen',
      'tx2: rollback',
    ]);
  });

  it('recipes: unit of work', async () => {
    const { app, log } = await import('../examples/recipes/unit-of-work.ts');
    expect(() => app.get('checkout').placeOrder('pen', 0)).toThrow(
      'at least 1',
    );
    expect(log).toEqual([
      'tx1: insert book',
      'tx1: commit',
      'tx2: insert pen',
      'tx2: rollback',
    ]);
  });

  it('request context: host', async () => {
    const { lines } = await import('../examples/request-context/app.ts');
    const { app, handle, consume } =
      await import('../examples/request-context/server.ts');
    lines.length = 0;
    const results = await Promise.all([
      handle({ headers: { 'x-trace-id': 't1', 'x-tenant-id': 'acme' } }),
      handle({ headers: { 'x-trace-id': 't2', 'x-tenant-id': 'globex' } }),
      consume({ id: '7', tenantId: 'initech', item: 'pen' }),
    ]);
    expect(results).toEqual(['acme: book', 'globex: book', 'initech: pen']);
    expect([...lines].sort()).toEqual([
      '[job-7 initech] order placed: pen',
      '[t1 acme] order placed: book',
      '[t2 globex] order placed: book',
    ]);
    app.get('logger').info('outside a request');
    expect(lines.at(-1)).toBe('[- -] outside a request');
  });

  it('request context: the host must register the context', async () => {
    const { addOrders } = await import('../examples/request-context/app.ts');
    // @ts-expect-error `context` is not registered
    expect(() => new DIContainer().extend(addOrders).get('orders')).toThrow(
      /No service registered for "context"/,
    );
  });

  it('request context: pitfalls', async () => {
    const { fromCaptured, fromAccessor, lazy, eager } =
      await import('../examples/request-context/pitfalls.ts');
    expect(fromCaptured).toEqual(['a', 'a']);
    expect(fromAccessor).toEqual(['a', 'b']);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(lazy.get('pool').checks[0]).toBe('a');
    expect(eager.get('pool').checks[0]).toBeUndefined();
    expect(eager.get('pool').checks.length).toBeGreaterThan(0);
    await Promise.all([lazy.dispose(), eager.dispose()]);
  });

  it('request context: one instance per request', async () => {
    const { app, handle, Database } =
      await import('../examples/request-context/per-request.ts');
    const db = app.get('db');
    expect(db).toBeInstanceOf(Database);
    expect(db.queries).toBe(3); // the example's two requests
    expect(handle(['2', '2'])).toEqual(['user 2', 'user 2']);
    expect(db.queries).toBe(4);
    expect(() => app.get('profiles').name('1')).toThrow(/No request context/);
  });

  it('request context: strategy per tenant', async () => {
    const { sent } = await import('../examples/request-context/strategy.ts');
    expect(sent).toEqual([
      'ses → ops@acme.example',
      'smtp → ops@globex.example',
    ]);
  });

  it('request context: testing', async () => {
    const { lines } = await import('../examples/request-context/app.ts');
    const { placed } = await import('../examples/request-context/testing.ts');
    expect(placed).toBe('acme: book');
    expect(lines).toContain('[test-1 acme] order placed: book');
  });

  it('recipes: config aliases', async () => {
    const { app } = await import('../examples/recipes/config-aliases.ts');
    expect(app.get('mailer').send('ada@example.com')).toBe(
      'smtp → ada@example.com',
    );
  });
});
