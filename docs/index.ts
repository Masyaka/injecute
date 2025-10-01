import ts from 'typescript';
import DIContainer, {
  construct,
  createProxyAccessor,
  defer,
  preload,
  setCacheInstance,
  buildServicesGraph,
} from '../src/index.ts';
import './declarations.d.ts';
import { setupPlayground } from './playground.ts';
import { renderServicesGraph } from './servicesGraph.ts';
import { renderConnections, setupServiceHoverHandlers } from './services-graph.ts';

// Debounce function
function debounce(func: Function, wait: number) {
  let timeout: NodeJS.Timeout;
  return function executedFunction(...args: any[]) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Initialize playground
const playground = setupPlayground('container');

// Get services tree element
const servicesTreeElement = document.getElementById('services-tree');
if (!servicesTreeElement) {
  throw new Error('Element with id "services-tree" not found');
}

function codeToServicesGraph(code: string) {
  const compiledCode = ts
    .transpile(code, {
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
    throw new Error(
      'Declare "container" variable in playground to preview services tree',
    );
  }

  return buildServicesGraph(container);
}

// Function to update services graph
function updateServicesGraph() {
  try {
    const code = playground.getCode();
    const graph = codeToServicesGraph(code);
    const html = renderServicesGraph(graph);
    servicesTreeElement!.innerHTML = html;
    setTimeout(() => {
      renderConnections();
      setupServiceHoverHandlers(graph);
    });
  } catch (error) {
    console.error('Error updating services graph:', error);
    servicesTreeElement!.innerHTML = `<div class="error">Failed to update services graph: ${error.message}</div>`;
  }
}

// Debounced update function
const debouncedUpdate = debounce(updateServicesGraph, 1000);

// Connect playground changes to services graph updates
playground.onCodeChange(debouncedUpdate);

// Initial render
updateServicesGraph();
