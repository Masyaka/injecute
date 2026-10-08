// Type-level tests for the decorators example in examples/custom-registration. Checked by
// `npm run typecheck` (tsc), not executed.
import { expectTypeOf } from 'vitest';
import { DIContainer } from '../../src/index.ts';
import { createDecorators } from '../../examples/custom-registration/decorators.ts';

class Config {
  greeting = 'Hello';
}
class Clock {
  now = () => new Date(0);
}
class Greeter {
  constructor(
    readonly config: Config,
    readonly clock: Clock,
  ) {}
}

type Services = { clock: Clock; greeter: Greeter };
const services = createDecorators<Services, { config: Config }>();

// ---------------------------------------------------------------------------- valid registrations

@services.singleton('clock')
class _Clock extends Clock {}

@services.singleton('greeter', ['config', 'clock'])
class _Greeter extends Greeter {}

// a class may ignore the services it is given
@services.transient('clock', ['config'])
class _IgnoresConfig extends Clock {}

// ----------------------------------------------------------------------------------- the container

const app = new DIContainer()
  .addInstance('config', new Config())
  .extend(services);
expectTypeOf(app.get('greeter')).toEqualTypeOf<Greeter>();
expectTypeOf(app.get('clock')).toEqualTypeOf<Clock>();

// the decorated classes need `config`
// @ts-expect-error: extension requires services that are not registered
new DIContainer().extend(services);

// ---------------------------------------------------------------------------------------- errors

// @ts-expect-error: not a key of Services
@services.singleton('mailer')
class _UnknownKey extends Clock {}

// @ts-expect-error: not a key the classes can depend on
@services.singleton('clock', ['db'])
class _UnknownDependency extends Clock {}

// @ts-expect-error: Greeter's constructor needs (Config, Clock)
@services.singleton('greeter', ['clock'])
class _MissingDependency extends Greeter {}

// @ts-expect-error: (Clock, Config) is the wrong order
@services.singleton('greeter', ['clock', 'config'])
class _WrongOrder extends Greeter {}

// @ts-expect-error: a Clock is not a Greeter
@services.singleton('greeter')
class _WrongService extends Clock {}
