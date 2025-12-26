import './declarations.d.ts';
import { codeToServicesGraph, setupPlayground } from './playground.ts';
import {
  renderServicesGraph,
} from './services-graph.ts';

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
const servicesTreeInputElement = document.getElementById(
  'services-tree-input',
) as HTMLInputElement | null;
if (!servicesTreeElement || !servicesTreeInputElement) {
  throw new Error(
    'Element with id "services-tree" or "services-tree-input" not found',
  );
}

servicesTreeInputElement.addEventListener('change', (e: any) => {
  const graph = JSON.parse(e.target.value);
  renderServicesGraph(graph);
});

// Function to update services graph
function updateServicesGraph() {
  if (!servicesTreeInputElement) {
    throw new Error('Missing services tree input element');
  }
  try {
    const code = playground.getCode();
    const graph = codeToServicesGraph(code);
    servicesTreeInputElement.value = JSON.stringify(graph, null, 2);
    servicesTreeInputElement.dispatchEvent(new Event('change'));
  } catch (error) {
    console.error('Error updating services graph:', error);
    servicesTreeElement!.innerHTML = `<div class="error">Failed to update services graph: ${error.message}</div>`;
  }
}

// Debounced update function
const debouncedUpdate = debounce(updateServicesGraph, 1000);

// Connect playground changes to services graph updates
playground.onCodeChange(debouncedUpdate);

setTimeout(() => {
  updateServicesGraph();
}, 1000);
