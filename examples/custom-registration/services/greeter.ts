import type createClock from './clock.ts';

// Keys of the services the factory receives, in order.
export const dependencies = ['config', 'clock'];

export default function createGreeter(
  config: { greeting: string },
  clock: ReturnType<typeof createClock>,
) {
  return {
    greet: (name: string) =>
      `${config.greeting}, ${name} (${clock.now().toISOString()})`,
  };
}
