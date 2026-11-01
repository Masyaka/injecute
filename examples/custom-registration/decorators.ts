import { DIContainer, type ServiceRegistry } from 'injecute';

// #region create-decorators
type Key<S> = Extract<keyof S, string>;
type Resolved<S, D extends unknown[]> = { [I in keyof D]: S[D[I] & keyof S] };
type Lifetime = 'addSingleton' | 'addTransient';
// The keys are checked by the decorators; registering them needs no types.
type UntypedRegistry = Record<
  Lifetime,
  (key: string, target: unknown, dependencies: string[]) => unknown
>;

/**
 * Standard (TC39) class decorators that register classes in a list; the returned function is a
 * module that adds them to a container with `extend()`.
 *
 * `Services` is what the decorated classes provide, `Requires` what they need from the container.
 */
export function createDecorators<
  Services extends object,
  Requires extends object = {},
>() {
  type All = Services & Requires;
  const registrations: ((registry: UntypedRegistry) => void)[] = [];

  const decorator =
    (lifetime: Lifetime) =>
    <K extends Key<Services>, const D extends Key<All>[] = []>(
      key: K,
      dependencies?: D,
    ) =>
    // The class must produce `Services[K]` from the services listed in `dependencies`.
    (
      target: new (...args: Resolved<All, D>) => Services[K],
      _context: ClassDecoratorContext,
    ) => {
      registrations.push((registry) =>
        registry[lifetime](key, target, dependencies ?? []),
      );
    };

  const addDecorated = (
    registry: ServiceRegistry<Requires>,
  ): ServiceRegistry<Requires, Services> => {
    for (const register of registrations)
      register(registry as unknown as UntypedRegistry);
    return registry as unknown as ServiceRegistry<Requires, Services>;
  };

  return Object.assign(addDecorated, {
    singleton: decorator('addSingleton'),
    transient: decorator('addTransient'),
  });
}
// #endregion create-decorators

interface Config {
  greeting: string;
}

// #region decorators
// The services the decorated classes provide, and what they need from the container.
type Services = { clock: Clock; greeter: Greeter };
type Requires = { config: Config };

const services = createDecorators<Services, Requires>();

@services.singleton('clock')
class Clock {
  now() {
    return new Date(0);
  }
}

@services.singleton('greeter', ['config', 'clock'])
class Greeter {
  constructor(
    private config: Config,
    private clock: Clock,
  ) {}

  greet(name: string) {
    return `${this.config.greeting}, ${name} (${this.clock.now().toISOString()})`;
  }
}

const app = new DIContainer()
  .addInstance('config', { greeting: 'Hello' })
  .extend(services); // DIContainer<{ config: Config } & Services>

app.get('greeter').greet('Ada'); // "Hello, Ada (1970-01-01T00:00:00.000Z)"
// #endregion decorators

// #region testing
// The decorated classes are ordinary registrations: an isolated fork replaces the clock for the test.
await using testContainer = app
  .fork({ isolated: true })
  .addInstance(
    'clock',
    { now: () => new Date('2030-01-01') },
    { replace: true },
  );

const greeting = testContainer.get('greeter').greet('Ada'); // "Hello, Ada (2030-01-01T00:00:00.000Z)"
app.get('greeter').greet('Ada'); // "Hello, Ada (1970-01-01T00:00:00.000Z)": the app is untouched
// #endregion testing

export { app, greeting, services, Clock, Greeter };
