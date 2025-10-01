import type { Tree } from "../src/utils/build-services-graph";

function buildConnections() {
  return Array.from(document.querySelectorAll('[data-node-id]')).flatMap(
    (node: any) =>
      Object.keys(JSON.parse(node.dataset.nodeDependencies!)).map(
        (dependency) => ({
          from: node.dataset.nodeId!,
          to: dependency,
        }),
      ),
  );
}

export function renderConnections() {
  const container = document.querySelector('#tree-container-svg');
  if (!container) {
    throw new Error('Container not found');
  }
  const connections = buildConnections();
  // Generate SVG content with actual DOM positioning
  let svgLines = '';
  connections.forEach((conn, index) => {
    const fromElement = document.querySelector(`[data-node-id="${conn.from}"]`);
    const toElement = document.querySelector(`[data-node-id="${conn.to}"]`);

    if (fromElement && toElement) {
      const fromRect = fromElement.getBoundingClientRect();
      const toRect = toElement.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // Calculate relative positions within the container
      const from = {
        x: fromRect.left - containerRect.left,
        y: fromRect.top - containerRect.top + fromRect.height / 2,
      };

      const to = {
        x: toRect.right - containerRect.left,
        y: toRect.top - containerRect.top + toRect.height / 2,
      };

      const strokeColor = '#569cd6';
      const strokeWidth = 2;
      const strokeDasharray = 'none';

      // Create curved connection
      const controlX1 = from.x + (to.x - from.x) * 0.5;
      const controlX2 = from.x + (to.x - from.x) * 0.5;

      svgLines += `<path d="M ${from.x} ${from.y} C ${controlX1} ${from.y} ${controlX2} ${to.y} ${to.x} ${to.y}"
                     stroke="${strokeColor}"
                     stroke-width="${strokeWidth}"
                     stroke-dasharray="${strokeDasharray}"
                     fill="none"
                     opacity="0.7"
                     data-connection-id="conn-${index}"
                     data-from="${conn.from}"
                     data-to="${conn.to}"/>`;
    }
  });

  // Add SVG overlay if there are connections
  const svgOverlay = `<svg style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1;">
      ${svgLines}
    </svg>`;

  container.insertAdjacentHTML('afterbegin', svgOverlay);
}

export function setupServiceHoverHandlers(tree: Tree) {
  const serviceNodes = document.querySelectorAll('.tree-node-svg');
  const connectionPaths = document.querySelectorAll('svg path');

  // Create tooltip element
  const tooltip = document.createElement('div');
  tooltip.className = 'service-tooltip';
  document.body.appendChild(tooltip);

  // Create namespace hover indicator
  const namespaceIndicator = document.createElement('div');
  namespaceIndicator.className = 'namespace-hover-indicator';
  namespaceIndicator.textContent = 'Highlighting namespace services';
  document.body.appendChild(namespaceIndicator);

  // Helper function to get all namespace services
  function getNamespaceServices(serviceId) {
    const namespaceServices = [];
    const service = tree[serviceId];

    // Check if this is a namespace container
    if (service && service.factoryType === 'namespace-container') {
      // Find all services that start with this namespace name + '.'
      const namespacePrefix = serviceId + '.';
      Object.keys(tree).forEach((key) => {
        if (key.startsWith(namespacePrefix)) {
          namespaceServices.push(key);
        }
      });
    }

    return namespaceServices;
  }

  // Helper function to get all dependencies recursively
  function getAllDependencies(serviceId: string, visited = new Set()) {
    if (!serviceId || visited.has(serviceId)) return [];
    visited.add(serviceId);

    const dependencies = [];
    const service = tree[serviceId];

    if (
      service &&
      service.dependencies &&
      typeof service.dependencies === 'object'
    ) {
      Object.keys(service.dependencies).forEach((depId) => {
        if (depId && tree[depId]) {
          dependencies.push(depId);
          // Recursively get dependencies of dependencies
          const subDeps = getAllDependencies(depId, new Set(visited));
          dependencies.push(...subDeps);
        }
      });
    }

    return [...new Set(dependencies)]; // Remove duplicates
  }

  // Helper function to get all services that depend on this service
  function getAllDependents(serviceId: string, visited = new Set()) {
    if (!serviceId || visited.has(serviceId)) return [];
    visited.add(serviceId);

    const dependents = [];

    Object.entries(tree).forEach(([id, service]) => {
      if (
        id !== serviceId &&
        service &&
        service.dependencies &&
        typeof service.dependencies === 'object' &&
        serviceId in service.dependencies
      ) {
        dependents.push(id);
        // Recursively get dependents of dependents
        const subDeps = getAllDependents(id, new Set(visited));
        dependents.push(...subDeps);
      }
    });

    return [...new Set(dependents)]; // Remove duplicates
  }

  serviceNodes.forEach((node) => {
    const serviceId = node.dataset.nodeId;

    if (!serviceId) return; // Skip nodes without valid IDs

    node.addEventListener('mouseenter', (event) => {
      try {
        // Check if this is a namespace container
        const namespaceServices = getNamespaceServices(serviceId);

        let relatedServices;
        if (namespaceServices.length > 0) {
          // Show namespace indicator
          namespaceIndicator.classList.add('visible');

          // For namespace containers, highlight all namespace services and their dependencies
          relatedServices = new Set([serviceId, ...namespaceServices]);

          // Also include dependencies and dependents of all namespace services
          namespaceServices.forEach((nsService) => {
            const nsDependencies = getAllDependencies(nsService);
            const nsDependents = getAllDependents(nsService);
            nsDependencies.forEach((dep) => relatedServices.add(dep));
            nsDependents.forEach((dep) => relatedServices.add(dep));
          });
        } else {
          // Regular service highlighting
          const dependencies = getAllDependencies(serviceId);
          const dependents = getAllDependents(serviceId);
          relatedServices = new Set([
            serviceId,
            ...dependencies,
            ...dependents,
          ]);
        }

        // Show tooltip with dependency information
        const service = tree[serviceId];
        let tooltipContent = `<div class="tooltip-title">${serviceId}</div>`;

        if (service) {
          tooltipContent += `<div class="tooltip-section">
            <div class="tooltip-label">Factory Type</div>
            <div>${service.factoryType || 'Unknown'}</div>
          </div>`;

          tooltipContent += `<div class="tooltip-section">
            <div class="tooltip-label">Depth Level</div>
            <div>${
              service.depth !== undefined ? service.depth : 'Unknown'
            }</div>
          </div>`;

          // Check if this is a namespace container
          if (namespaceServices.length > 0) {
            tooltipContent += `<div class="tooltip-section">
              <div class="tooltip-label">Namespace Services (${
                namespaceServices.length
              })</div>
              <div class="dependency-list">${namespaceServices
                .slice(0, 8)
                .join(', ')}${namespaceServices.length > 8 ? '...' : ''}</div>
            </div>`;
          } else {
            // For regular services, show dependencies and dependents
            const dependencies = getAllDependencies(serviceId);
            const dependents = getAllDependents(serviceId);

            if (dependencies.length > 0) {
              tooltipContent += `<div class="tooltip-section">
                <div class="tooltip-label">Dependencies (${
                  dependencies.length
                })</div>
                <div class="dependency-list">${dependencies
                  .slice(0, 8)
                  .join(', ')}${dependencies.length > 8 ? '...' : ''}</div>
              </div>`;
            }

            if (dependents.length > 0) {
              tooltipContent += `<div class="tooltip-section">
                <div class="tooltip-label">Used By (${dependents.length})</div>
                <div class="dependency-list">${dependents
                  .slice(0, 8)
                  .join(', ')}${dependents.length > 8 ? '...' : ''}</div>
              </div>`;
            }
          }

          // For namespace containers, add special indication
          if (namespaceServices.length > 0) {
            tooltipContent += `<div class="tooltip-section">
              <div class="tooltip-label">🎯 Hover Effect</div>
              <div style="color: #4CAF50; font-size: 11px;">Highlights all namespace services in <strong>green</strong></div>
            </div>`;
          }

          // Show total related services count
          tooltipContent += `<div class="tooltip-section">
            <div class="tooltip-label">Total Related Services</div>
            <div>${relatedServices.size}</div>
          </div>`;
        }

        tooltip.innerHTML = tooltipContent;

        // Position tooltip near mouse with viewport boundary checking
        const rect = node.getBoundingClientRect();
        const tooltipWidth = 250; // max-width from CSS
        const tooltipHeight = 150; // estimated height

        let left = rect.right + 10;
        let top = rect.top;

        // Check if tooltip would go off right edge of viewport
        if (left + tooltipWidth > window.innerWidth) {
          left = rect.left - tooltipWidth - 10;
        }

        // Check if tooltip would go off bottom edge of viewport
        if (top + tooltipHeight > window.innerHeight) {
          top = window.innerHeight - tooltipHeight - 10;
        }

        // Ensure tooltip doesn't go off top edge
        if (top < 10) {
          top = 10;
        }

        tooltip.style.left = `${Math.max(10, left)}px`;
        tooltip.style.top = `${top}px`;
        tooltip.classList.add('visible');
        // Highlight related nodes
        serviceNodes.forEach((n) => {
          const nodeId = n.dataset.nodeId;
          if (nodeId && relatedServices.has(nodeId)) {
            // Check if this is a namespace service being highlighted due to namespace container hover
            if (
              namespaceServices.length > 0 &&
              namespaceServices.includes(nodeId)
            ) {
              n.classList.add('namespace-service');
            } else {
              n.classList.add('highlighted');
            }
          } else {
            n.classList.add('dimmed');
          }
        });

        // Highlight related connections
        connectionPaths.forEach((path) => {
          const fromId = path.dataset.from;
          const toId = path.dataset.to;

          if (
            fromId &&
            toId &&
            relatedServices.has(fromId) &&
            relatedServices.has(toId)
          ) {
            // Check if this connection involves namespace services
            const isNamespaceConnection =
              namespaceServices.length > 0 &&
              (namespaceServices.includes(fromId) ||
                namespaceServices.includes(toId));

            if (isNamespaceConnection) {
              path.classList.add('namespace-connection');
            } else {
              path.classList.add('highlighted');
            }
          } else {
            path.classList.add('dimmed');
          }
        });
      } catch (error) {
        console.warn('Error during hover highlighting:', error);
      }
    });

    node.addEventListener('mouseleave', () => {
      try {
        // Remove all highlighting
        serviceNodes.forEach((n) => {
          n.classList.remove('highlighted', 'dimmed', 'namespace-service');
        });

        connectionPaths.forEach((path) => {
          path.classList.remove(
            'highlighted',
            'dimmed',
            'namespace-connection',
          );
        });

        // Hide tooltip
        tooltip.classList.remove('visible');

        // Hide namespace indicator
        namespaceIndicator.classList.remove('visible');
      } catch (error) {
        console.warn('Error during hover cleanup:', error);
      }
    });
  });

  // Cleanup function to remove tooltip and indicator when tree is re-rendered
  return () => {
    if (tooltip && tooltip.parentNode) {
      tooltip.parentNode.removeChild(tooltip);
    }
    if (namespaceIndicator && namespaceIndicator.parentNode) {
      namespaceIndicator.parentNode.removeChild(namespaceIndicator);
    }
  };
}
