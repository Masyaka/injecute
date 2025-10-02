import { Tree } from '../src/utils/build-services-graph';

function escapeHtml(text: string) {
  const div = document.createElement('div');
  div.textContent = text;
  // ?dispose div?
  return div.innerHTML;
}

type Entry = Exclude<Tree[string], undefined>;

export function renderServicesGraph(graph: Tree) {
  const services = Object.entries(graph).filter(
    ([, node]) => node !== undefined,
  ) as any as Entry[];
  const maxDepth = Math.max(...services.map(([, node]) => node?.depth || 0));

  // Group services by depth (inverted - highest depth on left)
  const servicesByDepth = new Map();
  for (let depth = maxDepth; depth >= 0; depth--) {
    servicesByDepth.set(
      depth,
      services.filter(([, node]) => node?.depth === depth),
    );
  }

  let nodesHtml = '';

  servicesByDepth.entries().forEach(([depth, services]) => {
    nodesHtml +=
      '<div style="display: flex; flex-direction: column; gap: 10px; justify-content: space-evenly">';
    services.forEach(([key, node]) => {
      const isNamespaceContainer = node.factoryType === 'namespace-container';
      const namespaceClass = isNamespaceContainer ? ' namespace-container' : '';
      nodesHtml += `
        <div
          class="tree-node-svg depth-${depth}${namespaceClass}"
          style="width: 180px; display: inline-block;"
          data-node-id=${node.title}
          data-node-dependencies=${JSON.stringify(node.dependencies)}
        >
          <div class="service-name">${escapeHtml(node.title)}</div>
          <div class="factory-type">${node.factoryType}</div>
          <div class="depth-indicator">Depth: ${depth}</div>
        </div>`;
    });
    nodesHtml += '</div>';
  });

  const output = `
    <div id="tree-container-svg" class="tree-container-svg" style="position: relative">
      <div style="position: relative; z-index: 2; padding: 10px; display: flex; flex-direction: row; gap: 50px">
        ${nodesHtml}
      </div>
    </div>
    `;

  return output;
}
