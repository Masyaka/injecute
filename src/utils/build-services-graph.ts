import { DIContainer, entryTypeKey } from '../container';
import { ArgumentsKey, ContainerServices, IDIContainer } from '../types';

type Tree = Record<
  string,
  | { title: string; dependencies?: Tree; depth: number; factoryType: string }
  | undefined
>;

// TODO: handle different types of factories, alias must have dependency.
// depth management, change
function toTreeNode<C extends DIContainer<any, any>>(
  this: C,
  key: ArgumentsKey,
  tree: Tree,
  depth = 0,
): Tree[string] {
  const stringKey = String(key);
  const factory = this.getFactory(key);
  const renderDependencies =
    (factory?.linkedFactory
      ? factory.linkedFactory.dependencies
      : factory?.dependencies) || [];
  let factoryType = factory?.[entryTypeKey] || '';
  if (factoryType === 'namespace-pass-through') {
    factoryType += factory?.linkedFactory?.[entryTypeKey] || '';
  }

  const result = {
    depth,
    title: stringKey,
    factoryType,
    dependencies: renderDependencies.reduce((r, d) => {
      const isFunction = typeof d === 'function';
      const k = isFunction ? d.name : String(d);
      r[k] = isFunction ? void 0 : toTreeNode.apply(this, [k, tree, depth + 1]);
      return r;
    }, {} as Tree),
  };

  tree[stringKey] ??= result;
  tree[stringKey].depth = Math.max(tree[stringKey].depth, depth);
  return result;
}

function _buildServicesGraph<C extends DIContainer<any, any>>(this: C) {
  const result: Tree = {};
  this.keys.forEach((k) => {
    const title = String(k);
    result[title] = toTreeNode.call(this, k, result);
  });
  return result;
}

export function buildServicesGraph<C extends IDIContainer<any, any>>(
  container: C,
) {
  if (!(container instanceof DIContainer)) {
    throw new Error('Only DIContainer supported');
  }
  const result = _buildServicesGraph.call(container);
  return result;
}
