import { DIContainer, entryTypeKey } from "../container";
import { ArgumentsKey, ContainerServices, IDIContainer } from "../types";

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
  let finalFactory = factory;
  let factoryType = finalFactory?.[entryTypeKey] || "";
  while (finalFactory?.linkedFactory) {
    finalFactory = finalFactory.linkedFactory;
    factoryType += "->" + finalFactory?.[entryTypeKey] || "";
  }
  const renderDependencies = finalFactory?.dependencies || [];

  const keyParts = stringKey.split(".");

  const result = {
    depth,
    title: stringKey,
    namespace: keyParts.slice(0, keyParts.length - 1).join("."),
    factoryType,
    dependencies: renderDependencies.reduce((r, d) => {
      const isFunction = typeof d === "function";
      const k = isFunction ? d.name : String(d);

      for (let i = keyParts.length - 1; i >= 0; i--) {
        const namespace = keyParts.slice(0, i).join(".");
        const dependencyKeyWithNamespace = namespace ? namespace + "." + k : k;
        if (this.has(dependencyKeyWithNamespace)) {
          r[dependencyKeyWithNamespace] = isFunction
            ? {
              depth: depth + 1,
              namespace,
              title: "Function: " + d.name,
              factoryType: "function",
              dependencies: {},
            }
            : {
              depth: depth + 1,
              namespace,
              title: k,
              factoryType: "d",
              dependencies: {},
            };
          break;
        }
      }

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
): Tree {
  if (!(container instanceof DIContainer)) {
    throw new Error("Only DIContainer supported");
  }
  const result = _buildServicesGraph.call(container);
  return result;
}
