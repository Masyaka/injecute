import * as d3 from 'd3';
import type { Tree } from '../src/utils/build-services-graph';

interface PackNode {
  id: string;
  title: string;
  depth: number;
  factoryType: string;
  isNamespaceContainer: boolean;
  namespaceServices?: string[];
  children?: PackNode[];
  value?: number;
  x?: number;
  y?: number;
  r?: number;
}

interface HierarchyPackNode extends d3.HierarchyCircularNode<PackNode> {
  data: PackNode;
}

let tooltip: d3.Selection<HTMLDivElement, unknown, HTMLElement, any>;
let namespaceIndicator: d3.Selection<HTMLDivElement, unknown, HTMLElement, any>;
let currentGraph: Tree = {};
let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
let allNodes: Map<string, HierarchyPackNode> = new Map();
let connections: Array<{ source: string; target: string }> = [];
let selectedNode: string | null = null;

function initializeTooltip() {
  if (!tooltip || tooltip.empty()) {
    tooltip = d3.select('body')
      .append('div')
      .attr('class', 'service-tooltip')
      .attr('id', 'service-tooltip')
      .style('opacity', 0);
  }
  return tooltip;
}

function initializeNamespaceIndicator() {
  if (!namespaceIndicator || namespaceIndicator.empty()) {
    namespaceIndicator = d3.select('body')
      .append('div')
      .attr('class', 'namespace-hover-indicator')
      .attr('id', 'namespace-hover-indicator')
      .text('Highlighting namespace services')
      .style('opacity', 0);
  }
  return namespaceIndicator;
}

function buildPackData(graph: Tree): PackNode {
  // Build connections for later use
  connections = [];
  Object.entries(graph).forEach(([key, entry]) => {
    if (!entry || !entry.dependencies) return;
    Object.keys(entry.dependencies).forEach((depKey) => {
      if (graph[depKey]) {
        connections.push({ source: key, target: depKey });
      }
    });
  });

  // Helper function to find the parent namespace key
  function getParentNamespace(key: string): string | null {
    const parts = key.split('.');
    if (parts.length <= 1) return null;
    return parts.slice(0, -1).join('.');
  }

  // Helper function to check if a key is a direct child of a namespace
  function isDirectChild(childKey: string, parentKey: string): boolean {
    if (!childKey.startsWith(parentKey + '.')) return false;
    const remainingPart = childKey.substring(parentKey.length + 1);
    return !remainingPart.includes('.');
  }

  // Create all nodes first
  const allNodes = new Map<string, PackNode>();
  
  Object.entries(graph).forEach(([key, entry]) => {
    if (!entry) return;

    // Check if this is a namespace container:
    // 1. Direct namespace-container type
    // 2. Has children (other keys start with this key + '.')
    const prefix = key + '.';
    const hasChildren = Object.keys(graph).some(k => k.startsWith(prefix));
    const isNamespaceContainer = entry.factoryType === 'namespace-container' || hasChildren;
    
    const namespaceServices: string[] = [];

    if (isNamespaceContainer) {
      // Find all direct children of this namespace
      Object.keys(graph).forEach((k) => {
        if (isDirectChild(k, key)) {
          namespaceServices.push(k);
        }
      });
    }

    const node: PackNode = {
      id: key,
      title: entry.title,
      depth: entry.depth,
      factoryType: entry.factoryType,
      isNamespaceContainer,
      namespaceServices: namespaceServices.length > 0 ? namespaceServices : undefined,
      value: isNamespaceContainer ? undefined : 200 + (entry.depth * 20),
      children: isNamespaceContainer ? [] : undefined,
    };

    allNodes.set(key, node);
  });

  // Build hierarchical structure by finding the deepest matching parent namespace
  const rootNodes: PackNode[] = [];
  
  allNodes.forEach((node, key) => {
    // Find the deepest namespace container parent
    let actualParent: PackNode | null = null;
    const parts = key.split('.');
    
    // Start from the most specific (deepest) potential parent
    for (let i = parts.length - 1; i > 0; i--) {
      const potentialParentKey = parts.slice(0, i).join('.');
      const potentialParent = allNodes.get(potentialParentKey);
      
      if (potentialParent && potentialParent.isNamespaceContainer) {
        actualParent = potentialParent;
        break;
      }
    }
    
    if (actualParent && actualParent.children) {
      actualParent.children.push(node);
    } else {
      rootNodes.push(node);
    }
  });

  // Separate namespace containers from regular services at root level
  const rootNamespaces = rootNodes.filter(n => n.isNamespaceContainer);
  const rootRegularServices = rootNodes.filter(n => !n.isNamespaceContainer);

  // Build final children array
  const allChildren: PackNode[] = [...rootNamespaces];

  // Pack non-namespace root services into a "Shared" pack
  if (rootRegularServices.length > 0) {
    const sharedPack: PackNode = {
      id: 'shared',
      title: 'Shared',
      depth: 0,
      factoryType: 'pack',
      isNamespaceContainer: true,
      children: rootRegularServices,
      value: undefined, // Let D3 calculate from children
    };
    allChildren.push(sharedPack);
  }

  // Create root node
  return {
    id: 'root',
    title: 'Services',
    depth: -1,
    factoryType: 'root',
    isNamespaceContainer: false,
    children: allChildren,
  };
}

function getAllDependencies(serviceId: string, visited = new Set<string>()): string[] {
  if (!serviceId || visited.has(serviceId)) return [];
  visited.add(serviceId);

  const dependencies: string[] = [];
  const service = currentGraph[serviceId];

  if (service && service.dependencies && typeof service.dependencies === 'object') {
    Object.keys(service.dependencies).forEach((depId) => {
      if (depId && currentGraph[depId]) {
        dependencies.push(depId);
        const subDeps = getAllDependencies(depId, new Set(visited));
        dependencies.push(...subDeps);
      }
    });
  }

  return [...new Set(dependencies)];
}

function getAllDependents(serviceId: string, visited = new Set<string>()): string[] {
  if (!serviceId || visited.has(serviceId)) return [];
  visited.add(serviceId);

  const dependents: string[] = [];

  Object.entries(currentGraph).forEach(([id, service]) => {
    if (
      id !== serviceId &&
      service &&
      service.dependencies &&
      typeof service.dependencies === 'object' &&
      serviceId in service.dependencies
    ) {
      dependents.push(id);
      const subDeps = getAllDependents(id, new Set(visited));
      dependents.push(...subDeps);
    }
  });

  return [...new Set(dependents)];
}

export function renderServicesGraph(graph: Tree) {
  currentGraph = graph;

  const container = d3.select('#tree-container-svg');
  container.selectAll('*').remove();

  const packData = buildPackData(graph);

  if (!packData.children || packData.children.length === 0) {
    container.html('<div style="padding: 20px; color: #858585;">No services to display</div>');
    return '';
  }

  const width = 3400;
  const height = 2400;

  // Create SVG
  const svg = container
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', [0, 0, width, height])
    .attr('style', 'max-height: 800px;');

  // Create zoom behavior
  zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 4])
    .on('zoom', (event) => {
      zoomGroup.attr('transform', event.transform.toString());
    });

  svg.call(zoomBehavior);

  const zoomGroup = svg.append('g').attr('class', 'zoom-group');

  // Create arrow markers
  const defs = zoomGroup.append('defs');

  const markerDefs = [
    { id: 'arrowhead', color: '#569cd6' },
    { id: 'arrowhead-dependency', color: '#ff6b35' },
    { id: 'arrowhead-dependent', color: '#c586c0' },
    { id: 'arrowhead-namespace', color: '#4caf50' },
  ];

  markerDefs.forEach(marker => {
    defs.append('marker')
      .attr('id', marker.id)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', marker.color);
  });

  // Create pack layout
  const pack = d3.pack<PackNode>()
    .size([width - 100, height - 100])
    .padding(10)
    .radius(d => 70);

  const root = d3.hierarchy(packData)
    .sum(d => d.value || 0)
    .sort((a, b) => (b.value || 0) - (a.value || 0));

  const packedRoot = pack(root) as HierarchyPackNode;

  // Store all nodes for lookup
  allNodes.clear();
  packedRoot.descendants().forEach(node => {
    if (node.data.id !== 'root') {
      allNodes.set(node.data.id, node as HierarchyPackNode);
    }
  });

  // Center the pack
  const centerX = width / 2;
  const centerY = height / 2;

  // Draw connections first (so they appear behind nodes)
  const linkGroup = zoomGroup.append('g').attr('class', 'links');

  const links = linkGroup
    .selectAll<SVGPathElement, { source: string; target: string }>('path')
    .data(connections)
    .join('path')
    .attr('class', 'connection-path')
    .attr('stroke', '#569cd6')
    .attr('stroke-width', 2)
    .attr('fill', 'none')
    .attr('opacity', 0.5)
    .attr('marker-end', 'url(#arrowhead)')
    .attr('d', d => {
      const sourceNode = allNodes.get(d.source);
      const targetNode = allNodes.get(d.target);

      if (!sourceNode || !targetNode) return '';

      const sx = (sourceNode.x || 0) + centerX - (packedRoot.x || 0);
      const sy = (sourceNode.y || 0) + centerY - (packedRoot.y || 0);
      const tx = (targetNode.x || 0) + centerX - (packedRoot.x || 0);
      const ty = (targetNode.y || 0) + centerY - (packedRoot.y || 0);

      // Draw straight line between nodes
      return `M${sx},${sy} L${tx},${ty}`;
    })
    .attr('data-from', d => d.source)
    .attr('data-to', d => d.target);

  // Draw pack circles first (behind everything)
  const packCirclesGroup = zoomGroup.append('g').attr('class', 'pack-circles');

  const packCircles = packCirclesGroup
    .selectAll<SVGCircleElement, HierarchyPackNode>('circle')
    .data(packedRoot.descendants().filter(d => d.data.id !== 'root' && d.data.isNamespaceContainer))
    .join('circle')
    .attr('class', 'pack-circle')
    .attr('cx', d => (d.x || 0) + centerX - (packedRoot.x || 0))
    .attr('cy', d => (d.y || 0) + centerY - (packedRoot.y || 0))
    .attr('r', d => d.r || 0)
    .attr('fill', 'none')
    .attr('stroke', d => d.data.id === 'shared' ? '#ffa500' : '#569cd6')
    .attr('stroke-width', 3)
    .attr('stroke-dasharray', '5,5')
    .attr('opacity', 0.6);

  // Add pack labels
  const packLabelsGroup = zoomGroup.append('g').attr('class', 'pack-labels');

  const packLabels = packLabelsGroup
    .selectAll<SVGTextElement, HierarchyPackNode>('text')
    .data(packedRoot.descendants().filter(d => d.data.id !== 'root' && d.data.isNamespaceContainer))
    .join('text')
    .attr('class', 'pack-label')
    .attr('x', d => (d.x || 0) + centerX - (packedRoot.x || 0))
    .attr('y', d => (d.y || 0) + centerY - (packedRoot.y || 0) - (d.r || 0) + 25)
    .attr('text-anchor', 'middle')
    .attr('fill', d => d.data.id === 'shared' ? '#ffa500' : '#569cd6')
    .attr('font-size', '18px')
    .attr('font-weight', 'bold')
    .text(d => d.data.title);

  // Draw nodes
  const nodeGroup = zoomGroup.append('g').attr('class', 'nodes');

  const nodes = nodeGroup
    .selectAll<SVGGElement, HierarchyPackNode>('g')
    .data(packedRoot.descendants().filter(d => d.data.id !== 'root' && !d.data.isNamespaceContainer))
    .join('g')
    .attr('class', 'pack-node-group')
    .attr('transform', d => {
      const x = (d.x || 0) + centerX - (packedRoot.x || 0);
      const y = (d.y || 0) + centerY - (packedRoot.y || 0);
      return `translate(${x},${y})`;
    })
    .attr('data-node-id', d => d.data.id);

  // Add rectangles for service nodes
  const rectWidth = 180;
  const rectHeight = 70;

  nodes.append('rect')
    .attr('class', 'pack-rect')
    .attr('width', rectWidth)
    .attr('height', rectHeight)
    .attr('x', -rectWidth / 2)
    .attr('y', -rectHeight / 2)
    .attr('rx', 6)
    .attr('fill', 'rgba(30, 30, 30, 0.9)')
    .attr('stroke', '#404040')
    .attr('stroke-width', 2);



  // Add text labels - service name
  nodes.append('text')
    .attr('class', 'service-name')
    .attr('y', -8)
    .attr('text-anchor', 'middle')
    .attr('fill', '#569cd6')
    .attr('font-size', '13px')
    .attr('font-weight', '500')
    .text(d => {
      const maxLength = 20;
      return d.data.title.length > maxLength
        ? d.data.title.substring(0, 18) + '..'
        : d.data.title;
    })
    .append('title')
    .text(d => d.data.title);

  // Add factory type
  nodes.append('text')
    .attr('class', 'factory-type')
    .attr('y', 8)
    .attr('text-anchor', 'middle')
    .attr('fill', '#858585')
    .attr('font-size', '11px')
    .attr('font-style', 'italic')
    .text(d => {
      const maxLength = 22;
      return d.data.factoryType.length > maxLength
        ? d.data.factoryType.substring(0, 20) + '..'
        : d.data.factoryType;
    });

  // Add depth indicator
  nodes.append('text')
    .attr('class', 'depth-indicator')
    .attr('y', 22)
    .attr('text-anchor', 'middle')
    .attr('fill', '#666666')
    .attr('font-size', '10px')
    .attr('font-style', 'italic')
    .text(d => `Depth: ${d.data.depth}`);

  // Setup click handlers
  setupClickHandlers(nodes, links);

  // Add zoom controls
  addZoomControls(container, svg, zoomBehavior);

  return '';
}

function addZoomControls(
  container: d3.Selection<d3.BaseType, unknown, HTMLElement, any>,
  svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, any>,
  zoom: d3.ZoomBehavior<SVGSVGElement, unknown>
) {
  const controlsDiv = container
    .append('div')
    .attr('class', 'zoom-controls')
    .style('position', 'absolute')
    .style('top', '10px')
    .style('right', '10px')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('gap', '8px')
    .style('z-index', '100');

  controlsDiv.append('button')
    .attr('class', 'zoom-btn zoom-in')
    .attr('title', 'Zoom In')
    .html('➕')
    .on('click', () => {
      svg.transition().duration(300).call(zoom.scaleBy, 1.3);
    });

  controlsDiv.append('button')
    .attr('class', 'zoom-btn zoom-out')
    .attr('title', 'Zoom Out')
    .html('➖')
    .on('click', () => {
      svg.transition().duration(300).call(zoom.scaleBy, 0.7);
    });

  controlsDiv.append('button')
    .attr('class', 'zoom-btn zoom-reset')
    .attr('title', 'Reset Zoom')
    .html('⊙')
    .on('click', () => {
      svg.transition().duration(500).call(
        zoom.transform,
        d3.zoomIdentity
      );
    });
}

function setupClickHandlers(
  nodes: d3.Selection<SVGGElement, HierarchyPackNode, SVGGElement, unknown>,
  links: d3.Selection<SVGPathElement, { source: string; target: string }, SVGGElement, unknown>
) {
  const tooltipElement = initializeTooltip();
  const namespaceIndicatorElement = initializeNamespaceIndicator();

  // Clear highlights function
  const clearHighlights = () => {
    selectedNode = null;
    nodes.selectAll('rect')
      .classed('highlighted dimmed namespace-service current-node dependency-node dependent-node', false);
    nodes.classed('highlighted dimmed namespace-service current-node dependency-node dependent-node', false);

    links.classed('highlighted dimmed namespace-connection dependency-connection dependent-connection', false);
    links.attr('marker-end', 'url(#arrowhead)');

    tooltipElement
      .style('opacity', 0)
      .style('transform', 'translateY(-10px)');

    namespaceIndicatorElement
      .style('opacity', 0)
      .style('transform', 'translateX(100px)');
  };

  // Click on background to clear
  d3.select('svg').on('click', function(event) {
    if (event.target === this || event.target.tagName === 'g') {
      clearHighlights();
    }
  });

  nodes.on('click', function(event, d) {
    event.stopPropagation();

    // If clicking the same node, clear highlights
    if (selectedNode === d.data.id) {
      clearHighlights();
      return;
    }

    selectedNode = d.data.id;
    const namespaceServices = d.data.namespaceServices || [];
    let relatedServices: Set<string>;
    let dependencies: string[] = [];
    let dependents: string[] = [];

    if (namespaceServices.length > 0) {
      namespaceIndicatorElement
        .style('opacity', 1)
        .style('transform', 'translateX(0)');

      relatedServices = new Set([d.data.id, ...namespaceServices]);

      namespaceServices.forEach((nsService) => {
        const nsDependencies = getAllDependencies(nsService);
        const nsDependents = getAllDependents(nsService);
        nsDependencies.forEach((dep) => {
          relatedServices.add(dep);
          dependencies.push(dep);
        });
        nsDependents.forEach((dep) => {
          relatedServices.add(dep);
          dependents.push(dep);
        });
      });
    } else {
      dependencies = getAllDependencies(d.data.id);
      dependents = getAllDependents(d.data.id);
      relatedServices = new Set([d.data.id, ...dependencies, ...dependents]);
    }

    // Build tooltip
    let tooltipContent = `<div class="tooltip-title">${d.data.id}</div>`;
    tooltipContent += `<div class="tooltip-section">
      <div class="tooltip-label">Factory Type</div>
      <div>${d.data.factoryType || 'Unknown'}</div>
    </div>`;
    tooltipContent += `<div class="tooltip-section">
      <div class="tooltip-label">Depth Level</div>
      <div>${d.data.depth}</div>
    </div>`;

    if (namespaceServices.length > 0) {
      tooltipContent += `<div class="tooltip-section">
        <div class="tooltip-label">Namespace Services (${namespaceServices.length})</div>
        <div class="dependency-list">${namespaceServices.slice(0, 8).join(', ')}${namespaceServices.length > 8 ? '...' : ''}</div>
      </div>`;
      tooltipContent += `<div class="tooltip-section">
        <div class="tooltip-label">🎯 Click Effect</div>
        <div style="color: #4CAF50; font-size: 11px;">Highlights all namespace services in <strong>green</strong></div>
      </div>`;
    } else {
      if (dependencies.length > 0) {
        tooltipContent += `<div class="tooltip-section">
          <div class="tooltip-label">Dependencies (${dependencies.length})</div>
          <div class="dependency-list" style="color: #ff6b35;">${dependencies.slice(0, 8).join(', ')}${dependencies.length > 8 ? '...' : ''}</div>
        </div>`;
      }

      if (dependents.length > 0) {
        tooltipContent += `<div class="tooltip-section">
          <div class="tooltip-label">Used By (${dependents.length})</div>
          <div class="dependency-list" style="color: #c586c0;">${dependents.slice(0, 8).join(', ')}${dependents.length > 8 ? '...' : ''}</div>
        </div>`;
      }

      if (dependencies.length > 0 || dependents.length > 0) {
        tooltipContent += `<div class="tooltip-section">
          <div class="tooltip-label">🎨 Color Legend</div>
          <div style="font-size: 11px;">
            <span style="color: #ff6b35;">●</span> Dependencies (what this needs)<br/>
            <span style="color: #c586c0;">●</span> Dependents (what needs this)
          </div>
        </div>`;
      }
    }

    tooltipContent += `<div class="tooltip-section">
      <div class="tooltip-label">Total Related Services</div>
      <div>${relatedServices.size}</div>
    </div>`;

    tooltipElement.html(tooltipContent);

    const tooltipWidth = 250;
    const tooltipHeight = 150;
    let left = event.pageX + 10;
    let top = event.pageY - 10;

    if (left + tooltipWidth > window.innerWidth) {
      left = event.pageX - tooltipWidth - 10;
    }

    if (top + tooltipHeight > window.innerHeight) {
      top = window.innerHeight - tooltipHeight - 10;
    }

    if (top < 10) {
      top = 10;
    }

    tooltipElement
      .style('left', `${Math.max(10, left)}px`)
      .style('top', `${top}px`)
      .style('opacity', 1)
      .style('transform', 'translateY(0)');

    // Highlight nodes
    nodes.each(function(nodeData) {
      const nodeElement = d3.select(this);
      const rect = nodeElement.select('rect');

      if (relatedServices.has(nodeData.data.id)) {
        if (namespaceServices.length > 0 && namespaceServices.includes(nodeData.data.id)) {
          rect.classed('namespace-service', true);
          nodeElement.classed('namespace-service', true);
        } else if (nodeData.data.id === d.data.id) {
          rect.classed('current-node', true);
          nodeElement.classed('current-node', true);
        } else if (dependencies.includes(nodeData.data.id)) {
          rect.classed('dependency-node', true);
          nodeElement.classed('dependency-node', true);
        } else if (dependents.includes(nodeData.data.id)) {
          rect.classed('dependent-node', true);
          nodeElement.classed('dependent-node', true);
        } else {
          rect.classed('highlighted', true);
          nodeElement.classed('highlighted', true);
        }
      } else {
        rect.classed('dimmed', true);
        nodeElement.classed('dimmed', true);
      }
    });

    // Highlight links
    links.each(function(linkData) {
      const linkElement = d3.select(this);
      const sourceId = linkData.source;
      const targetId = linkData.target;

      if (relatedServices.has(sourceId) && relatedServices.has(targetId)) {
        const isNamespaceConnection = namespaceServices.length > 0 &&
          (namespaceServices.includes(sourceId) || namespaceServices.includes(targetId));

        if (isNamespaceConnection) {
          linkElement.classed('namespace-connection', true);
          linkElement.attr('marker-end', 'url(#arrowhead-namespace)');
        } else if (sourceId === d.data.id && dependencies.includes(targetId)) {
          linkElement.classed('dependency-connection', true);
          linkElement.attr('marker-end', 'url(#arrowhead-dependency)');
        } else if (dependents.includes(sourceId) && targetId === d.data.id) {
          linkElement.classed('dependent-connection', true);
          linkElement.attr('marker-end', 'url(#arrowhead-dependent)');
        } else if (dependencies.includes(sourceId) && dependencies.includes(targetId)) {
          linkElement.classed('dependency-connection', true);
          linkElement.attr('marker-end', 'url(#arrowhead-dependency)');
        } else if (dependents.includes(sourceId) && dependents.includes(targetId)) {
          linkElement.classed('dependent-connection', true);
          linkElement.attr('marker-end', 'url(#arrowhead-dependent)');
        } else {
          linkElement.classed('highlighted', true);
          linkElement.attr('marker-end', 'url(#arrowhead)');
        }
      } else {
        linkElement.classed('dimmed', true);
        linkElement.attr('marker-end', 'url(#arrowhead)');
      }
    });
  });

  // Add hover handler for tooltip only (no highlighting)
  nodes.on('mouseenter', function(event, d) {
    const namespaceServices = d.data.namespaceServices || [];
    let dependencies: string[] = [];
    let dependents: string[] = [];

    if (namespaceServices.length > 0) {
      namespaceServices.forEach((nsService) => {
        const nsDependencies = getAllDependencies(nsService);
        const nsDependents = getAllDependents(nsService);
        dependencies.push(...nsDependencies);
        dependents.push(...nsDependents);
      });
    } else {
      dependencies = getAllDependencies(d.data.id);
      dependents = getAllDependents(d.data.id);
    }

    // Build tooltip
    let tooltipContent = `<div class="tooltip-title">${d.data.id}</div>`;
    tooltipContent += `<div class="tooltip-section">
      <div class="tooltip-label">Factory Type</div>
      <div>${d.data.factoryType || 'Unknown'}</div>
    </div>`;
    tooltipContent += `<div class="tooltip-section">
      <div class="tooltip-label">Depth Level</div>
      <div>${d.data.depth}</div>
    </div>`;

    if (namespaceServices.length > 0) {
      tooltipContent += `<div class="tooltip-section">
        <div class="tooltip-label">Namespace Services (${namespaceServices.length})</div>
        <div class="dependency-list">${namespaceServices.slice(0, 8).join(', ')}${namespaceServices.length > 8 ? '...' : ''}</div>
      </div>`;
      tooltipContent += `<div class="tooltip-section">
        <div class="tooltip-label">💡 Tip</div>
        <div style="color: #4CAF50; font-size: 11px;">Click to highlight related services</div>
      </div>`;
    } else {
      if (dependencies.length > 0) {
        tooltipContent += `<div class="tooltip-section">
          <div class="tooltip-label">Dependencies (${dependencies.length})</div>
          <div class="dependency-list" style="color: #ff6b35;">${dependencies.slice(0, 8).join(', ')}${dependencies.length > 8 ? '...' : ''}</div>
        </div>`;
      }

      if (dependents.length > 0) {
        tooltipContent += `<div class="tooltip-section">
          <div class="tooltip-label">Used By (${dependents.length})</div>
          <div class="dependency-list" style="color: #c586c0;">${dependents.slice(0, 8).join(', ')}${dependents.length > 8 ? '...' : ''}</div>
        </div>`;
      }

      if (dependencies.length > 0 || dependents.length > 0) {
        tooltipContent += `<div class="tooltip-section">
          <div class="tooltip-label">💡 Tip</div>
          <div style="font-size: 11px;">Click to highlight dependencies and dependents</div>
        </div>`;
      }
    }

    const relatedCount = new Set([d.data.id, ...dependencies, ...dependents, ...namespaceServices]).size;
    tooltipContent += `<div class="tooltip-section">
      <div class="tooltip-label">Total Related Services</div>
      <div>${relatedCount}</div>
    </div>`;

    tooltipElement.html(tooltipContent);

    const tooltipWidth = 250;
    const tooltipHeight = 150;
    let left = event.pageX + 10;
    let top = event.pageY - 10;

    if (left + tooltipWidth > window.innerWidth) {
      left = event.pageX - tooltipWidth - 10;
    }

    if (top + tooltipHeight > window.innerHeight) {
      top = window.innerHeight - tooltipHeight - 10;
    }

    if (top < 10) {
      top = 10;
    }

    tooltipElement
      .style('left', `${Math.max(10, left)}px`)
      .style('top', `${top}px`)
      .style('opacity', 1)
      .style('transform', 'translateY(0)');
  })
  .on('mouseleave', function() {
    tooltipElement
      .style('opacity', 0)
      .style('transform', 'translateY(-10px)');
  });
}
