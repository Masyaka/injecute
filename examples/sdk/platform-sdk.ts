// A platform SDK: the package other teams install. In a real package, the regions below are separate
// files: `index.ts` (contract, plugin API, createPlatform), `testing.ts` (createTestPlatform) and
// internal wiring.
import {
  collect,
  createTag,
  DIContainer,
  lifecycle,
  startLifecycle,
  type RunningLifecycle,
  type ServiceProvider,
  type ServiceRegistry,
} from 'injecute';

// #region contract
/** What the consumer passes to the SDK. */
export interface PlatformOptions {
  /** The consuming service, sent with every request. */
  service: string;
  apiUrl: string;
  token: string;
  logger?: Logger;
  fetch?: typeof fetch;
  /** Applied in order, after the SDK's own registrations. */
  plugins?: readonly PlatformPlugin[];
}

export interface Logger {
  warn(message: string): void;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
}

export interface FeatureFlags {
  isEnabled(flag: string): boolean;
}

export interface Telemetry {
  track(event: string, data?: Record<string, unknown>): void;
}

/** The SDK. Consumers see this interface, never the container. */
export interface Platform extends AsyncDisposable {
  readonly api: ApiClient;
  readonly flags: FeatureFlags;
  readonly telemetry: Telemetry;
  /** Loads the flags and starts background work: flag refresh, telemetry flush. */
  start(): Promise<void>;
  /** Stops background work, flushes telemetry and releases everything. Safe to call twice. */
  stop(): Promise<void>;
}
// #endregion contract

// #region plugin-api
/** Sends requests to the platform. Plugins replace or decorate it; tests replace it with a fake. */
export interface Transport {
  send(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown>;
}

export interface TelemetryEvent {
  name: string;
  data: Record<string, unknown>;
}

/** Receives every flushed batch of telemetry, next to the platform. */
export interface TelemetrySink {
  send(events: readonly TelemetryEvent[]): Promise<void>;
}

/** An extension point: plugins register sinks under it, `telemetrySink('name')`. */
export const telemetrySink = createTag('telemetrySink').of<TelemetrySink>();

/**
 * The services a plugin can depend on, replace or decorate. Their keys and types are public API of the
 * SDK, like the plugin type itself.
 */
export interface PluginServices {
  options: PlatformOptions;
  logger: Logger;
  transport: Transport;
}

/** A plugin is a module: it registers services in the SDK's container, and nothing else. */
export type PlatformPlugin = (
  registry: ServiceRegistry<PluginServices>,
) => ServiceRegistry<any, any>;

// Plugins import injecute's helpers from the SDK, so they use the SDK's copy of injecute.
export { lifecycle, optional } from 'injecute';
// #endregion plugin-api

// #region internals

class FetchTransport implements Transport {
  constructor(private readonly options: PlatformOptions) {}

  async send(method: 'GET' | 'POST', path: string, body?: unknown) {
    const { apiUrl, token, service, fetch = globalThis.fetch } = this.options;
    const response = await fetch(new URL(path, apiUrl), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-service': service,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
    return response.json();
  }
}

class PlatformApi implements ApiClient {
  constructor(private readonly transport: Transport) {}

  get<T>(path: string): Promise<T> {
    return this.transport.send('GET', path) as Promise<T>;
  }
}

class RemoteFlags implements FeatureFlags {
  #flags: Record<string, boolean> = {};

  constructor(
    private readonly transport: Transport,
    private readonly logger: Logger,
  ) {}

  isEnabled(flag: string): boolean {
    return this.#flags[flag] ?? false;
  }

  async refresh(): Promise<void> {
    try {
      this.#flags = (await this.transport.send('GET', '/flags')) as Record<
        string,
        boolean
      >;
    } catch (error) {
      this.logger.warn(`flags: keeping the last values (${String(error)})`);
    }
  }
}

class EventBuffer {
  #events: TelemetryEvent[] = [];

  constructor(
    private readonly transport: Transport,
    private readonly service: string,
    private readonly sinks: readonly TelemetrySink[],
  ) {}

  push(event: TelemetryEvent): void {
    this.#events.push(event);
  }

  async flush(): Promise<void> {
    if (this.#events.length === 0) return;
    const events = this.#events;
    this.#events = [];
    await Promise.all([
      this.transport.send('POST', '/telemetry', {
        service: this.service,
        events,
      }),
      ...this.sinks.map((sink) => sink.send(events)),
    ]);
  }
}
// #endregion internals

// #region modules
// Each feature is a module, applied as a namespace. Its symbol keys stay inside the namespace: other
// modules and the SDK object can't resolve them.
const addFlags = (
  c: ServiceRegistry<{ transport: Transport; logger: Logger }>,
) =>
  c.addSingleton('flags', RemoteFlags, ['transport', 'logger']).addSingleton(
    lifecycle.start('refresh'),
    async (flags) => {
      await flags.refresh();
      const timer = setInterval(() => void flags.refresh(), 60_000);
      return () => clearInterval(timer);
    },
    ['flags'],
  );

const buffer = Symbol('buffer'); // private to the Telemetry module

const addTelemetry = (
  c: ServiceRegistry<{
    transport: Transport;
    options: PlatformOptions;
    logger: Logger;
  }>,
) =>
  c
    .addSingleton(
      buffer,
      (transport, options, sinks) =>
        new EventBuffer(transport, options.service, sinks),
      ['transport', 'options', collect(telemetrySink)], // every plugin's sink
    )
    .addSingleton(
      'telemetry',
      (events): Telemetry => ({
        track: (name, data = {}) => events.push({ name, data }),
      }),
      [buffer],
    )
    .addSingleton(
      lifecycle.start('flush'),
      (events, logger) => {
        const timer = setInterval(() => {
          events.flush().catch((error) => logger.warn(String(error)));
        }, 10_000);
        return async () => {
          clearInterval(timer);
          await events.flush(); // the last events go out before the SDK stops
        };
      },
      [buffer, 'logger'],
    );
// #endregion modules

// #region core
// The SDK's composition root. A new container per call: two SDK instances share nothing.
function createCore(options: PlatformOptions) {
  const logger: Logger = options.logger ?? console;
  const core = new DIContainer()
    .addInstance('options', options)
    .addInstance('logger', logger)
    .addSingleton('transport', FetchTransport, ['options'])
    .addSingleton('api', PlatformApi, ['transport'])
    .namespace('Flags', addFlags)
    .namespace('Telemetry', addTelemetry);
  // Plugins come last: a replacement or decoration of `transport` reaches everything that uses it.
  for (const plugin of options.plugins ?? []) core.extend(plugin);
  return core.seal();
}
// #endregion core

// #region create
/** The services the SDK object exposes, and what it needs to start and stop. */
type Core = ServiceProvider<{
  api: ApiClient;
  'Flags.flags': FeatureFlags;
  'Telemetry.telemetry': Telemetry;
}> & { dispose(): Promise<void> };

/** Creates the SDK. Nothing runs until a service is used or `start()` is called. */
export function createPlatform(options: PlatformOptions): Platform {
  return toPlatform(createCore(options));
}

function toPlatform(core: Core): Platform {
  let running: Promise<RunningLifecycle> | undefined;
  let stopped: Promise<void> | undefined;
  const stop = () =>
    (stopped ??= (async () => {
      // a failed start already undid its hooks and disposed the container
      const run = await running?.catch(() => undefined);
      await (run ? run.stop() : running ? undefined : core.dispose());
    })());
  return {
    get api() {
      return core.get('api');
    },
    get flags() {
      return core.get('Flags.flags');
    },
    get telemetry() {
      return core.get('Telemetry.telemetry');
    },
    async start() {
      running ??= startLifecycle(core);
      await running;
    },
    stop,
    [Symbol.asyncDispose]: stop,
  };
}
// #endregion create

// #region testing
/** What a test can replace. Everything listed here is public API of the testing entry. */
export interface PlatformFakes {
  transport?: Transport;
}

/** The SDK with fakes, for consumers' tests. Ships as `platform-sdk/testing`. */
export function createTestPlatform(
  fakes: PlatformFakes = {},
  options: Partial<PlatformOptions> = {},
): Platform {
  // The fakes are the first plugin: the consumer's plugins decorate the fake transport like the real one.
  const useFakes: PlatformPlugin = (c) =>
    fakes.transport
      ? c.addInstance('transport', fakes.transport, { replace: true })
      : c;
  return createPlatform({
    service: 'test',
    apiUrl: 'http://platform.test',
    token: 'test',
    ...options,
    plugins: [useFakes, ...(options.plugins ?? [])],
  });
}
// #endregion testing
