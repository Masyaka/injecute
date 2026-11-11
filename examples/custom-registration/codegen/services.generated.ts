// Generated from ../services/ by generate-wiring.ts. Don't edit: run the generator.
import type { ServiceRegistry } from 'injecute';
import * as clock from '../services/clock.ts';
import * as greeter from '../services/greeter.ts';

export interface Requires {
  config: Parameters<typeof greeter.default>[0];
}

export const addServices = (registry: ServiceRegistry<Requires>) =>
  registry
    .addSingleton('clock', clock.default)
    .addSingleton('greeter', greeter.default, ['config', 'clock']);
