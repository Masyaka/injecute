// A service that installs the platform SDK: `platform-sdk` and `platform-sdk/testing` in a real app.
import { DIContainer, lifecycle, startLifecycle } from 'injecute';
import {
  createPlatform,
  createTestPlatform,
  telemetrySink,
  type FeatureFlags,
  type PlatformPlugin,
  type Telemetry,
  type TelemetryEvent,
  type TelemetrySink,
  type Transport,
} from './platform-sdk.ts';

/** The consumer's own code depends on the SDK's interfaces, not on the SDK object. */
export class Checkout {
  constructor(
    private readonly flags: FeatureFlags,
    private readonly telemetry: Telemetry,
  ) {}

  run(): string {
    const flow = this.flags.isEnabled('one-click') ? 'one-click' : 'classic';
    this.telemetry.track('checkout.started', { flow });
    return flow;
  }
}

// #region plain
export async function main() {
  await using platform = createPlatform({
    service: 'checkout',
    apiUrl: 'https://platform.internal',
    token: process.env.PLATFORM_TOKEN ?? '',
  });
  await platform.start(); // loads the flags, starts the telemetry flush

  new Checkout(platform.flags, platform.telemetry).run();
} // stopped here: telemetry is flushed, timers are cleared
// #endregion plain

// #region plugins
/** Decorates the transport: records every request, then sends it. */
export const recordRequests =
  (log: string[]): PlatformPlugin =>
  (c) =>
    c.addSingleton(
      'transport',
      (inner): Transport => ({
        send: (method, path, body) => {
          log.push(`${method} ${path}`);
          return inner.send(method, path, body);
        },
      }),
      { dependencies: ['transport'], replace: true }, // `inner` is the previous transport
    );

/** Replaces the transport: everything goes through the company's gateway. */
export const viaGateway =
  (gateway: Transport): PlatformPlugin =>
  (c) =>
    c.addInstance('transport', gateway, { replace: true });

/** Contributes to an extension point: telemetry also goes to the consumer's analytics. */
export const analytics =
  (received: TelemetryEvent[]): PlatformPlugin =>
  (c) =>
    c.addSingleton(telemetrySink('analytics'), (): TelemetrySink => ({
      send: async (events) => {
        received.push(...events);
      },
    }));

export const createInstrumentedPlatform = (
  requests: string[],
  received: TelemetryEvent[],
) =>
  createPlatform({
    service: 'checkout',
    apiUrl: 'https://platform.internal',
    token: process.env.PLATFORM_TOKEN ?? '',
    plugins: [recordRequests(requests), analytics(received)],
  });
// #endregion plugins

// #region in-app
// In an app that uses injecute itself, the SDK is one service. Register the parts your code uses as
// keys of your app, so your services don't depend on the whole SDK.
export const createApp = () =>
  new DIContainer()
    .addInstance('config', { platformToken: process.env.PLATFORM_TOKEN ?? '' })
    .addSingleton(
      'platform',
      (config) =>
        createPlatform({
          service: 'checkout',
          apiUrl: 'https://platform.internal',
          token: config.platformToken,
        }),
      { dependencies: ['config'], dispose: (platform) => platform.stop() },
    )
    .addSingleton('flags', (platform) => platform.flags, ['platform'])
    .addSingleton('telemetry', (platform) => platform.telemetry, ['platform'])
    .addSingleton('checkout', Checkout, ['flags', 'telemetry'])
    // started with the app; stopped by dispose, after everything that depends on it
    .addSingleton(lifecycle.init('platform'), (platform) => platform.start(), [
      'platform',
    ]);
// #endregion in-app

// #region testing
/** A fake transport: answers the flags request and records what was sent. */
export class FakeTransport implements Transport {
  readonly sent: { method: string; path: string; body?: unknown }[] = [];

  constructor(private readonly flags: Record<string, boolean> = {}) {}

  async send(method: 'GET' | 'POST', path: string, body?: unknown) {
    this.sent.push({ method, path, body });
    return path === '/flags' ? this.flags : {};
  }
}

// A unit test of the consumer's code, with the real SDK and a fake transport.
export async function testCheckout() {
  const transport = new FakeTransport({ 'one-click': true });
  {
    await using platform = createTestPlatform({ transport });
    await platform.start();
    new Checkout(platform.flags, platform.telemetry).run(); // 'one-click'
  } // stop() flushes the telemetry through the fake
  return transport.sent;
}

// Plugins run in tests too: they decorate the fake transport like the real one.
export async function testPlugins() {
  const transport = new FakeTransport({ 'one-click': true });
  const requests: string[] = [];
  const received: TelemetryEvent[] = [];
  {
    await using platform = createTestPlatform(
      { transport },
      { plugins: [recordRequests(requests), analytics(received)] },
    );
    await platform.start();
    new Checkout(platform.flags, platform.telemetry).run();
  }
  return { requests, received }; // ['GET /flags', 'POST /telemetry'], [checkout.started]
}

// A test of the whole app: replace the SDK in an isolated fork.
export async function testApp() {
  const transport = new FakeTransport({ 'one-click': true });
  const app = createApp()
    .fork({ isolated: true })
    .addSingleton('platform', () => createTestPlatform({ transport }), {
      replace: true,
      dispose: (platform) => platform.stop(),
    });
  const running = await startLifecycle(app);
  const flow = app.get('checkout').run();
  await running.stop();
  return { flow, sent: transport.sent };
}
// #endregion testing
