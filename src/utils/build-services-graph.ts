import { TAGGED_KEYS } from '../internal.ts';
import type {
  AsyncServiceProvider,
  RegistrationInfo,
  ServiceKey,
  ServiceProvider,
} from '../types.ts';

/**
 * Services by key, each with its direct dependencies; returned by {@link buildServicesGraph} and
 * rendered by the playground.
 */
export type Tree = Record<
  string,
  | {
      title: string;
      namespace: string;
      dependencies?: Tree;
      depth: number;
      factoryType: string;
    }
  | undefined
>;

const describeKind = (info: RegistrationInfo): string => {
  let kind: string = info.kind;
  for (let linked = info.linked; linked; linked = linked.linked) {
    kind += ' -> ' + linked.kind;
  }
  return kind;
};

/** The registration a namespace entry finally resolves to (its own dependencies are the linked ones). */
const finalRegistration = (info: RegistrationInfo): RegistrationInfo => {
  let current = info;
  while (current.linked) current = current.linked;
  return current;
};

function toTreeNode(
  container: ServiceProvider | AsyncServiceProvider,
  key: ServiceKey,
  tree: Tree,
  depth = 0,
): Tree[string] {
  const stringKey = String(key);
  const info = container.getRegistration(key);
  const keyParts = stringKey.split('.');
  const dependencies: Tree = {};

  for (const dependency of info ? finalRegistration(info).dependencies : []) {
    if (dependency.type === 'collect') {
      // every service under the tag, as collect() resolves them
      const list = (
        container as { [TAGGED_KEYS]?: (tag: string) => readonly ServiceKey[] }
      )[TAGGED_KEYS];
      const keys = list ? list.call(container, dependency.tag) : container.keys;
      for (const tagged of keys) {
        const k = String(tagged);
        if (!k.endsWith(`:${dependency.tag}`)) continue;
        dependencies[k] = {
          depth: depth + 1,
          namespace: k.split('.').slice(0, -1).join('.'),
          title: k,
          factoryType: 'dependency',
          dependencies: {},
        };
      }
      continue;
    }
    const isFunction = dependency.type === 'function';
    const k =
      dependency.type === 'function' ? dependency.name : String(dependency.key);
    // Dependencies of namespace services are resolved inside the namespace: find the visible key.
    for (let i = keyParts.length - 1; i >= 0; i--) {
      const namespace = keyParts.slice(0, i).join('.');
      const withNamespace = namespace ? namespace + '.' + k : k;
      if (isFunction || container.has(withNamespace)) {
        dependencies[withNamespace] = {
          depth: depth + 1,
          namespace,
          title: isFunction ? 'Function: ' + k : k,
          factoryType: isFunction ? 'function' : 'dependency',
          dependencies: {},
        };
        break;
      }
    }
  }

  const result = {
    depth,
    title: stringKey,
    namespace: keyParts.slice(0, keyParts.length - 1).join('.'),
    factoryType: info ? describeKind(info) : '',
    dependencies,
  };
  const existing = tree[stringKey];
  if (existing) {
    existing.depth = Math.max(existing.depth, depth);
    return existing;
  }
  tree[stringKey] = result;
  return result;
}

/**
 * Builds a plain object describing every service visible from `container` and its direct dependencies.
 * Used by the playground to render the services graph.
 */
export function buildServicesGraph(
  container: ServiceProvider | AsyncServiceProvider,
): Tree {
  const result: Tree = {};
  for (const key of container.keys) {
    result[String(key)] = toTreeNode(container, key, result);
  }
  return result;
}
