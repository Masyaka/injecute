// Runs every file in examples/ (the code the docs embed) and checks what the docs say it does.
import { DIContainer } from 'injecute';
import { describe, expect, it, vi } from 'vitest';

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
      shop,
      cache,
      host,
      root,
      perRequest,
      Database,
    } = await import('../examples/containers.ts');
    expect(requestScope.get('users')).toBe(app.get('users'));
    expect(testScope.get('users').db.url).toBe('postgres://test');
    expect(app.get('users').db.url).toBe('postgres://prod');
    expect(withBilling.get('invoices').db).toBeInstanceOf(Database);
    expect(withNamespace.get('Reports.daily').kind).toBe('daily');
    expect(withNamespace.get('Reports').get('timezone')).toBe('UTC');
    expect(shop.get('Catalog.products').prices).toBeInstanceOf(Map);
    expect(shop.keys).toEqual(['dbUrl', 'db', 'Catalog', 'Catalog.products']);
    expect(() => (shop as unknown as DIContainer<any>).get(cache)).toThrow(
      expect.objectContaining({ code: 'INJECUTE_NOT_REGISTERED' }),
    );
    const shopTest = shop
      .fork({ isolated: true })
      .addInstance('dbUrl', 'postgres://test', { replace: true });
    expect(shopTest.get('Catalog.products').db.url).toBe('postgres://test');
    expect(host.get('Audit.audit').dbUrl).toBe('postgres://audit');
    expect(host.get('Audit.audit').log).toBe(host.get('logger'));
    expect(host.has('dbUrl')).toBe(false);
    expect(host.get('Audit.dbUrl')).toBe('postgres://audit');
    expect(perRequest.get('users')).toBe(root.get('users'));
    expect(perRequest.get('requestId')).toBe('req-2');
    expect(() =>
      (root as unknown as DIContainer).addInstance('flag', true),
    ).toThrow(/sealed/);
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

  it('tags', async () => {
    const { routes, response, testRoutes } =
      await import('../examples/tags.ts');
    expect(routes).toEqual(['GET /orders', 'GET /health']);
    expect(response).toBe('orders: 2');
    expect(testRoutes).toEqual(['GET /orders', 'GET /health', 'GET /debug']);
  });

  it('startup-shutdown', async () => {
    const { log, wiringInTests, failingStart, migrateThenStart } =
      await import('../examples/startup-shutdown.ts');
    expect(log).toEqual([
      'listening on 8080: /orders',
      'consumer started',
      'started: Orders.subscriptions:init, server:start, Payments.consumer:start, readiness:ready',
      'orders: order-1',
      'consumer stopped',
      'server closed',
    ]);
    expect(await wiringInTests()).toBe('Orders.subscriptions:init → /orders');
    log.length = 0;
    expect(await failingStart()).toBe(
      'Failed to create "server:start": port 8080 is in use',
    );
    expect(log).toEqual(['cache warmed', 'cache cleared']);
    expect(await migrateThenStart()).toEqual(['schema', 'jobs']);
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

  it('custom registration: file system', async () => {
    const { app } =
      await import('../examples/custom-registration/file-system.ts');
    expect(app.get('greeter').greet('Ada')).toBe(
      'Hello, Ada (1970-01-01T00:00:00.000Z)',
    );
    expect(app.get('clock')).toBe(app.get('clock'));
  });

  it('custom registration: decorators', async () => {
    const { app, greeting, services, Clock, Greeter } =
      await import('../examples/custom-registration/decorators.ts');
    expect(greeting).toBe('Hello, Ada (2030-01-01T00:00:00.000Z)');
    expect(app.get('greeter')).toBeInstanceOf(Greeter);
    expect(app.get('clock')).toBeInstanceOf(Clock);
    expect(app.get('greeter').greet('Ada')).toBe(
      'Hello, Ada (1970-01-01T00:00:00.000Z)',
    );
    // the decorators only register: each container that applies them gets its own instances
    const other = new DIContainer()
      .addInstance('config', { greeting: 'Hi' })
      .extend(services);
    expect(other.get('greeter').greet('Bo')).toBe(
      'Hi, Bo (1970-01-01T00:00:00.000Z)',
    );
    expect(other.get('clock')).not.toBe(app.get('clock'));
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
    const { app, listUsers, container, requestScope } =
      await import('../examples/typescript.ts');
    expect(listUsers(app)).toEqual([]);
    expect(app.get('users').list()).toEqual([]);
    expect(requestScope.get('users')).toBe(container.get('users'));
    expect(requestScope.get('requestId')).toBe('req-1');
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

  it('recipes: request resources', async () => {
    const { handle, log, perRequest, RequestResources } =
      await import('../examples/recipes/request-resources.ts');
    await Promise.all([handle('book', 1), handle('cup', 2)]);
    await expect(handle('pen', 0)).rejects.toThrow('at least 1');
    expect(log).toEqual([
      'tx1: insert book',
      'tx2: insert cup',
      'tx1: charge 10',
      'tx1: commit',
      'tx2: charge 20',
      'tx2: commit',
      'tx3: insert pen',
      'tx3: rollback',
    ]);

    // outside a request
    const tx = perRequest({ current: () => undefined }, () => ({
      [Symbol.dispose]() {},
    }));
    expect(() => tx.current()).toThrow(/No request context/);

    // releases in reverse, all of them, and reports the failures together
    const released: string[] = [];
    const resources = new RequestResources();
    resources.add({ [Symbol.dispose]: () => void released.push('a') });
    resources.add({
      [Symbol.asyncDispose]: async () => {
        released.push('b');
        throw new Error('b failed');
      },
    });
    resources.add({ [Symbol.dispose]: () => void released.push('c') });
    await expect(resources[Symbol.asyncDispose]()).rejects.toThrow(
      AggregateError,
    );
    expect(released).toEqual(['c', 'b', 'a']);
  });

  it('recipes: request modules', async () => {
    const { handle, log, charged, app } =
      await import('../examples/recipes/request-modules.ts');
    // the example's own test runs
    expect(charged).toEqual([20]);
    expect(log).toEqual([
      'tx1: begin on memory',
      'tx1: insert book',
      'tx1: charge 10 via stripe',
      'tx1: commit',
      'tx1: begin on postgres',
      'tx1: insert pen',
      'tx1: commit',
    ]);
    log.length = 0;
    await handle('book', 1);
    await expect(handle('pen', 0)).rejects.toThrow('at least 1');
    expect(log).toEqual([
      'tx2: begin on postgres',
      'tx2: insert book',
      'tx2: charge 10 via stripe',
      'tx2: commit',
      'tx3: begin on postgres',
      'tx3: insert pen',
      'tx3: rollback',
    ]);
    // the root has no per-request services
    expect(app.has('tx')).toBe(false);
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
  it('sdk: the platform SDK and its consumer', async () => {
    const { testCheckout, testApp, createApp } =
      await import('../examples/sdk/consumer.ts');
    const telemetry = {
      method: 'POST',
      path: '/telemetry',
      body: {
        service: 'test',
        events: [{ name: 'checkout.started', data: { flow: 'one-click' } }],
      },
    };
    expect(await testCheckout()).toEqual([
      { method: 'GET', path: '/flags', body: undefined },
      telemetry,
    ]);
    const { flow, sent } = await testApp();
    expect(flow).toBe('one-click');
    expect(sent).toEqual([
      { method: 'GET', path: '/flags', body: undefined },
      telemetry,
    ]);
    // registering the SDK starts nothing
    expect(createApp().has('platform')).toBe(true);
  });

  it('sdk: plugins', async () => {
    const { testPlugins, viaGateway, recordRequests, FakeTransport } =
      await import('../examples/sdk/consumer.ts');
    const { createTestPlatform } =
      await import('../examples/sdk/platform-sdk.ts');

    // decorate and contribute
    const { requests, received } = await testPlugins();
    expect(requests).toEqual(['GET /flags', 'POST /telemetry']);
    expect(received).toEqual([
      { name: 'checkout.started', data: { flow: 'one-click' } },
    ]);

    // replace: the gateway gets every request, and a later plugin decorates the gateway
    const fake = new FakeTransport();
    const gateway = new FakeTransport({ beta: true });
    const log: string[] = [];
    const platform = createTestPlatform(
      { transport: fake },
      { plugins: [viaGateway(gateway), recordRequests(log)] },
    );
    await platform.start();
    expect(platform.flags.isEnabled('beta')).toBe(true);
    expect(fake.sent).toEqual([]);
    expect(log).toEqual(['GET /flags']);
    await platform.stop();
  });

  it('sdk: the SDK object', async () => {
    const { createPlatform, createTestPlatform } =
      await import('../examples/sdk/platform-sdk.ts');
    const { FakeTransport } = await import('../examples/sdk/consumer.ts');

    // lazy: nothing is sent before a service is used or start() is called
    const fetch = vi.fn(async () => Response.json({ beta: true }));
    const platform = createPlatform({
      service: 'checkout',
      apiUrl: 'https://platform.test',
      token: 't',
      fetch,
    });
    expect(Object.keys(platform)).toEqual([
      'api',
      'flags',
      'telemetry',
      'start',
      'stop',
    ]);
    expect(fetch).not.toHaveBeenCalled();
    expect(await platform.api.get('/flags')).toEqual({ beta: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://platform.test/flags');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer t',
      'x-service': 'checkout',
    });

    // stop() without start() disposes; twice is fine; services are gone afterwards
    await platform.stop();
    await platform.stop();
    expect(() => platform.api).toThrow(
      expect.objectContaining({ code: 'INJECUTE_DISPOSED' }),
    );

    // a failing transport: flags keep their values and warn, stop() still works
    const warn = vi.fn();
    const failing = createTestPlatform(
      {
        transport: {
          send: async () => {
            throw new Error('offline');
          },
        },
      },
      { logger: { warn } },
    );
    await failing.start();
    expect(failing.flags.isEnabled('beta')).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('offline'));
    await failing.stop();

    // instances share nothing
    const a = createTestPlatform({ transport: new FakeTransport() });
    const b = createTestPlatform({ transport: new FakeTransport() });
    expect(a.flags).not.toBe(b.flags);
    await Promise.all([a.stop(), b.stop()]);
  });

  it('real world: context, logger, tracer and namespaces', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { responses, traces } = await import('../examples/real-world.ts');
    const lines = log.mock.calls.map(([line]) => String(line));
    log.mockRestore();
    expect(responses).toEqual(['alice: 1 × book', 'failed']);
    expect(lines).toEqual(
      expect.arrayContaining([
        'INFO  - - - [app] server started',
        'INFO  trace-1 span-3 alice [catalog] book costs 12',
        'INFO  trace-1 span-2 alice [orders] order placed',
        'ERROR trace-from-gateway span-8 bob [payments] declined 60, the limit is 50',
        'ERROR trace-from-gateway - bob [http] 500: payment declined',
      ]),
    );
    expect(traces.map((t) => t.map((l) => l.replace(/\d+ms/, 'Xms')))).toEqual([
      [
        'trace trace-1',
        '  POST /orders Xms',
        '    orders.place Xms',
        '      catalog.price Xms',
        '      payments.charge Xms',
      ],
      [
        'trace trace-from-gateway',
        '  POST /orders Xms  ✗ payment declined',
        '    orders.place Xms  ✗ payment declined',
        '      catalog.price Xms',
        '      payments.charge Xms  ✗ payment declined',
      ],
    ]);
  });
});
