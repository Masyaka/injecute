// One service per file: the file name is the key, the default export the factory.
export default function createClock() {
  return { now: () => new Date(0) };
}
