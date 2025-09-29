import * as monaco from 'monaco-editor';
import ts from 'typescript';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import injecuteUtils from '../lib/cjs/utils/index.d.ts?raw';
import injecuteIndex from '../lib/cjs/index.d.ts?raw';
import injecuteTypes from '../lib/cjs/types.d.ts?raw';
import injecuteContainer from '../lib/cjs/container.d.ts?raw';
import injecuteBuildServicesGraph from '../lib/cjs/utils/build-services-graph.d.ts?raw';
import {
  DIContainer,
  construct,
  defer,
  preload,
  createProxyAccessor,
  setCacheInstance,
  buildServicesGraph,
} from '../src';

const initialCode = `
  import DIContainer, { construct } from "injecute";

  interface UserMessageTransport {
    sendUserMessage(userId: number, content: string): void;
  }

  interface User {
    id: number;
    name: string;
    email: string;
  }

  class GreetService {
    constructor(private transport: UserMessageTransport) {}

    greet(user: User) {
      this.transport.sendUserMessage(user.id, \`Hello \${user.name}\`);
    }
  }

  class Mailer implements UserMessageTransport {
    sendUserMessage(userId: number, content: string): void {
      // send email
    }
  }

  class MockTransport implements UserMessageTransport {
    sendUserMessage(userId: number, content: string): void {
      console.log(userId, content);
    }
  }


  class BlogService {
    constructor(private transport: UserMessageTransport) {}

    createBlog(title: string, content: string): void {
      this.transport.sendUserMessage(1, \`New blog post: \${title}\`);
    }
  }

  class BlogRepository {
    constructor(private db: Connection) {}

    async createBlog(title: string, content: string): Promise<void> {
      // query to db
    }
  }

  type Connection = {

  }

  function addBlogServices<T extends { db: Database }>(container: IDIContainer<T>) {
    return container
    .addSingleton('blogService', construct(BlogService), ['userMessageTransport'])
    .addSingleton('blogRepository', construct(BlogRepository), ['db']);
  }

  function createContainer(cfg: { useMockMailer?: boolean } = {}) {
    return new DIContainer()
      .addSingleton('connection', () => ({}) as any)
      .addAlias('db', 'connection')
      .addSingleton('emailTransport', construct(Mailer))
      .addSingleton('mockTransport', construct(MockTransport))
      .addAlias(
        'userMessageTransport',
        cfg.useMockMailer ? 'mockTransport' : 'emailTransport',
      )
      .addSingleton('greetService', construct(GreetService), ['userMessageTransport'])
      .namespace('blog', addBlogServices);
  }

  const greetService = createContainer().get('greetService');
  greetService.greet({ id: 1, name: 'John', email: 'john@example.com' });
`;

const container = document.getElementById('container');

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker();
    }
    return new editorWorker();
  },
};
monaco.languages.register({ id: 'typescript' });
monaco.languages.typescript.typescriptDefaults.addExtraLib(
  injecuteUtils,
  'file:///node_modules/injecute/utils/index.d.ts',
);
monaco.languages.typescript.typescriptDefaults.addExtraLib(
  injecuteTypes,
  'file:///node_modules/injecute/types.d.ts',
);
monaco.languages.typescript.typescriptDefaults.addExtraLib(
  injecuteIndex,
  'file:///node_modules/injecute/index.d.ts',
);
monaco.languages.typescript.typescriptDefaults.addExtraLib(
  injecuteContainer,
  'file:///node_modules/injecute/container.d.ts',
);
monaco.languages.typescript.typescriptDefaults.addExtraLib(
  injecuteBuildServicesGraph,
  'file:///node_modules/injecute/utils/build-services-graph.d.ts',
);
monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
  target: monaco.languages.typescript.ScriptTarget.ES2020,
  moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
  module: monaco.languages.typescript.ModuleKind.ESNext,
  noEmit: true,
  esModuleInterop: true,
  strict: true,
  types: ['node'],
});

const editor = monaco.editor.create(container, {
  value: '',
  language: 'typescript',
  theme: 'vs-dark',
  automaticLayout: true,
});

const uri = monaco.Uri.parse('file:///main.ts');
const model = monaco.editor.createModel('', 'typescript', uri);
model.setValue(initialCode);
editor.setModel(model);

// Services tree functionality
const servicesTreeElement = document.getElementById('services-tree');

// Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const renderDependenciesTree = async () => {
  try {
    servicesTreeElement.textContent = 'Analyzing dependencies...';
    servicesTreeElement.className = 'loading';
    const compiledCode = ts
      .transpile(model.getValue(), {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        noEmit: true,
        esModuleInterop: true,
        strict: false,
        types: ['node'],
      })
      .replace(/import.*from.*['"'];?\r?\n/g, '')
      .replace(/export\s+/g, '');

    const evalFunction = new Function(
      'DIContainer',
      'construct',
      'defer',
      'preload',
      'createProxyAccessor',
      'setCacheInstance',
      `
    ${compiledCode}

    // Return the container from createContainer function
    if (typeof createContainer === 'function') {
      return createContainer();
    }
    return container;
  `,
    );

    const container = evalFunction(
      DIContainer,
      construct,
      defer,
      preload,
      createProxyAccessor,
      setCacheInstance,
    );

    if (!container) {
      servicesTreeElement.innerHTML = `<div class="error">Declare "container" variable in playground to preview services tree</div>`;
    }

    const tree = buildServicesGraph(container);
    renderServicesTree(tree);
  } catch (error) {
    console.error('Error in renderDependenciesTree:', error);
    servicesTreeElement.innerHTML = `<div class="error">Failed to analyze dependencies: ${error.message}</div>`;
  }
};

// Function to render services tree with proper HTML structure
function renderServicesTree(tree) {
  try {
    // Show loading state
    servicesTreeElement.textContent = 'Rendering dependency tree...';
    servicesTreeElement.className = 'loading';

    if (!tree) {
      servicesTreeElement.innerHTML =
        '<div class="error">Invalid tree data received</div>';
      return;
    }

    if (typeof tree !== 'object') {
      servicesTreeElement.innerHTML =
        '<div class="error">Tree data must be an object</div>';
      return;
    }

    const treeEntries = Object.keys(tree);
    if (treeEntries.length === 0) {
      servicesTreeElement.innerHTML =
        '<div class="loading">No services found in the container.<br><small>Make sure your container has registered services.</small></div>';
      return;
    }

    servicesTreeElement.className = '';

    // Count total services and dependencies
    const totalServices = Object.keys(tree).filter(
      (key) => tree[key] !== undefined,
    ).length;
    let totalDependencies = 0;

    Object.values(tree).forEach((node) => {
      try {
        if (
          node &&
          node.dependencies &&
          typeof node.dependencies === 'object'
        ) {
          totalDependencies += Object.keys(node.dependencies).length;
        }
      } catch (nodeError) {
        console.warn('Error processing node dependencies:', nodeError);
      }
    });

    // Helper function to escape HTML
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Get all services and find max depth
    const services = Object.entries(tree).filter(
      ([, node]) => node !== undefined,
    );
    const maxDepth = Math.max(...services.map(([, node]) => node?.depth || 0));

    // Group services by depth (inverted - highest depth on left)
    const servicesByDepth = new Map();
    for (let depth = maxDepth; depth >= 0; depth--) {
      servicesByDepth.set(
        depth,
        services.filter(([, node]) => node?.depth === depth),
      );
    }

    // Generate service nodes HTML
    let nodesHtml = '';

    servicesByDepth.entries().forEach(([depth, services]) => {
      nodesHtml +=
        '<div style="display: flex; flex-direction: column; gap: 10px; justify-content: space-evenly">';
      services.forEach(([key, node]) => {
        nodesHtml += `
          <div class="tree-node-svg depth-${depth}" style="width: 180px; display: inline-block;" data-node-id=${
          node.title
        }>
            <div class="service-name">${escapeHtml(node.title)}</div>
            <div class="factory-type">${node.factoryType}</div>
            <div class="depth-indicator">Depth: ${depth}</div>
          </div>`;
      });
      nodesHtml += '</div>';
    });

    const output = `
      <div class="tree-container-svg" style="position: relative">
        <div style="position: relative; z-index: 2; padding: 10px; display: flex; flex-direction: row; gap: 30px">
          ${nodesHtml}
        </div>
      </div>`;

    servicesTreeElement.innerHTML = output;

    setTimeout(() => {
      // Create connections based on dependencies
      const connections = services.flatMap(([_, node]) =>
        Object.keys(node.dependencies).map((dependency) => ({
          from: node.title,
          to: dependency,
        })),
      );

      // Generate SVG content with actual DOM positioning
      let svgLines = '';
      connections.forEach((conn, index) => {
        const fromElement = servicesTreeElement.querySelector(
          `[data-node-id="${conn.from}"]`,
        );
        const toElement = servicesTreeElement.querySelector(
          `[data-node-id="${conn.to}"]`,
        );

        if (fromElement && toElement) {
          const fromRect = fromElement.getBoundingClientRect();
          const toRect = toElement.getBoundingClientRect();
          const containerRect = servicesTreeElement.getBoundingClientRect();

          // Calculate relative positions within the container
          const from = {
            x: fromRect.left - containerRect.left,
            y: fromRect.top - containerRect.top + fromRect.height / 2,
          };

          const to = {
            x: toRect.right - containerRect.left,
            y: toRect.top - containerRect.top + toRect.height / 2,
          };

          const strokeColor = conn.isFunction ? '#ff9500' : '#569cd6';
          const strokeWidth = conn.isFunction ? 1 : 2;
          const strokeDasharray = conn.isFunction ? '3,3' : 'none';

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
      if (svgLines) {
        const svgOverlay = `<svg style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1;">
          ${svgLines}
        </svg>`;

        const treeContainer = servicesTreeElement.querySelector(
          '.tree-container-svg',
        );
        if (treeContainer) {
          treeContainer.insertAdjacentHTML('afterbegin', svgOverlay);

          // Add hover functionality for service nodes
          const cleanup = setupServiceHoverHandlers(tree, connections);

          // Store cleanup function for potential future use
          servicesTreeElement._hoverCleanup = cleanup;
        }
      }
    });
  } catch (error) {
    console.error('Error rendering services tree:', error);
    servicesTreeElement.innerHTML = `<div class="error">
      Failed to render dependency tree: ${error.message}
      <br><small>Check console for detailed error information</small>
    </div>`;
  }

  // Clean up any existing hover handlers
  if (servicesTreeElement._hoverCleanup) {
    servicesTreeElement._hoverCleanup();
    servicesTreeElement._hoverCleanup = null;
  }
}

// Function to setup hover handlers for service dependency highlighting
function setupServiceHoverHandlers(tree, connections) {
  const serviceNodes = servicesTreeElement.querySelectorAll('.tree-node-svg');
  const connectionPaths = servicesTreeElement.querySelectorAll('svg path');

  // Create tooltip element
  const tooltip = document.createElement('div');
  tooltip.className = 'service-tooltip';
  document.body.appendChild(tooltip);

  // Helper function to get all dependencies recursively
  function getAllDependencies(serviceId, visited = new Set()) {
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
  function getAllDependents(serviceId, visited = new Set()) {
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
        // Get all related services (dependencies and dependents)
        const dependencies = getAllDependencies(serviceId);
        const dependents = getAllDependents(serviceId);
        const relatedServices = new Set([
          serviceId,
          ...dependencies,
          ...dependents,
        ]);

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
            n.classList.add('highlighted');
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
            path.classList.add('highlighted');
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
          n.classList.remove('highlighted', 'dimmed');
        });

        connectionPaths.forEach((path) => {
          path.classList.remove('highlighted', 'dimmed');
        });

        // Hide tooltip
        tooltip.classList.remove('visible');
      } catch (error) {
        console.warn('Error during hover cleanup:', error);
      }
    });
  });

  // Cleanup function to remove tooltip when tree is re-rendered
  return () => {
    if (tooltip && tooltip.parentNode) {
      tooltip.parentNode.removeChild(tooltip);
    }
  };
}

// Debounced tree update function with 300ms delay
const debouncedTreeUpdate = debounce(renderDependenciesTree, 1000);

model.onDidChangeContent(debouncedTreeUpdate);
renderDependenciesTree();
