import { construct } from './construct';
import {
  createNamedResolvers,
  createResolversTuple,
  addNamedResolvers,
} from './resolvers';
import { defer } from './defer';
import { preload } from './preload';
import { createProxyAccessor } from './proxy';

export { construct } from './construct';
export {
  createNamedResolvers,
  createResolversTuple,
  addNamedResolvers,
} from './resolvers';
export { defer } from './defer';
export { preload } from './preload';
export { createProxyAccessor } from './proxy';

export const utils = {
  preload,
  construct,
  defer,
  createProxyAccessor,
  createNamedResolvers,
  createResolversTuple,
  addNamedResolvers,
};
