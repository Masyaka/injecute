<script setup lang="ts">
// Playground: edit a container, see its services graph, the resolution trace and console output.
// Code runs in a fresh Web Worker per run (no DOM access, terminated on timeout); results come back as
// plain data and are rendered as text, so shared links cannot run code on this page.
import { useData } from 'vitepress';
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import type { Tree } from '../../../src/utils/build-services-graph.ts';
import type { Editor } from './playground/editor.ts';
import type {
  RunError,
  RunnerMessage,
  TraceEntry,
} from './playground/protocol.ts';
import './playground/playground.css';

// request-context/ and the file-system example use relative imports and Node.js APIs, which the
// worker can't run
const examples = import.meta.glob(
  [
    '../../../examples/**/*.ts',
    '!../../../examples/request-context/**',
    '!../../../examples/custom-registration/file-system.ts',
    '!../../../examples/custom-registration/services/**',
  ],
  { query: '?raw', import: 'default' },
) as Record<string, () => Promise<string>>;
const exampleNames = Object.keys(examples)
  .map((path) => path.replace(/^.*\/examples\//, '').replace(/\.ts$/, ''))
  .sort();

const { isDark } = useData();
const editorElement = ref<HTMLElement>();
const editor = shallowRef<Editor>();
const tab = ref<'graph' | 'trace' | 'console'>('graph');
const graph = shallowRef<Tree>();
const trace = ref<TraceEntry[]>([]);
const logs = ref<string[]>([]);
const error = ref<RunError>();
const status = ref('Loading editor…');
const copied = ref('');
const selectedExample = ref('');

const docsLink = computed(() =>
  error.value?.docs?.startsWith('https://masyaka.github.io/injecute/errors/')
    ? error.value.docs
    : undefined,
);

let worker: Worker | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let renderGraph: ((tree: Tree) => void) | undefined;

async function run() {
  if (!editor.value) return;
  status.value = 'Running…';
  let code: string;
  try {
    code = await editor.value.emit();
  } catch (e) {
    error.value = {
      message: `Could not compile the code: ${e instanceof Error ? e.message : String(e)}`,
    };
    status.value = 'Error';
    return;
  }
  worker?.terminate();
  const { default: RunnerWorker } =
    await import('./playground/runner.worker.ts?worker');
  const current = (worker = new RunnerWorker());
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const fail = (message: string, label: string) => {
    clearTimeout(timeout);
    current.terminate();
    if (worker !== current) return;
    error.value = { message };
    status.value = label;
  };
  // A worker that fails to load (a network error, a stale page after a deploy) never answers.
  current.onerror = (event) => {
    event.preventDefault();
    fail(
      `The runner failed${event.message ? `: ${event.message}` : ' to load. Reload the page.'}`,
      'Error',
    );
  };
  current.onmessage = ({ data }: MessageEvent<RunnerMessage>) => {
    if (data.type === 'ready') {
      // The time limit covers the run only, not downloading the worker.
      timeout = setTimeout(
        () => fail('Stopped after 3 seconds (an endless loop?).', 'Timed out'),
        3000,
      );
      current.postMessage({ type: 'run', code });
      return;
    }
    clearTimeout(timeout);
    current.terminate();
    if (worker !== current) return;
    graph.value = data.graph;
    trace.value = data.trace;
    logs.value = data.logs;
    error.value = data.error;
    status.value = data.error
      ? 'Error'
      : `${Object.keys(data.graph ?? {}).length} services`;
    if (data.graph && renderGraph) renderGraph(data.graph);
  };
}

function scheduleRun() {
  clearTimeout(timer);
  timer = setTimeout(run, 700);
}

async function loadExample(name: string) {
  const load = examples[`../../../examples/${name}.ts`];
  if (!load || !editor.value) return;
  editor.value.setValue(await load());
  history.replaceState(
    null,
    '',
    `${location.pathname}?example=${encodeURIComponent(name)}`,
  );
}

async function share() {
  if (!editor.value) return;
  const { shareUrl } = await import('./playground/share.ts');
  const url = shareUrl(editor.value.getValue(), location);
  history.replaceState(null, '', url);
  await navigator.clipboard.writeText(url);
  flash('Link copied');
}

async function copyMarkdown() {
  if (!graph.value) return;
  const lines = [
    '| Service | Registered as | Depends on |',
    '| --- | --- | --- |',
  ];
  for (const [key, entry] of Object.entries(graph.value)) {
    const deps = Object.keys(entry?.dependencies ?? {})
      .map((d) => `\`${d}\``)
      .join(', ');
    lines.push(`| \`${key}\` | ${entry?.factoryType ?? ''} | ${deps || '—'} |`);
  }
  await navigator.clipboard.writeText(lines.join('\n'));
  flash('Markdown copied');
}

function flash(message: string) {
  copied.value = message;
  setTimeout(() => (copied.value = ''), 1500);
}

onMounted(async () => {
  const [
    { createEditor },
    { defaultCode },
    { readSharedCode },
    { renderServicesGraph },
  ] = await Promise.all([
    import('./playground/editor.ts'),
    import('./playground/default-code.ts'),
    import('./playground/share.ts'),
    import('./playground/services-graph.ts'),
  ]);
  renderGraph = renderServicesGraph;
  const exampleParam = new URLSearchParams(location.search).get('example');
  const initial = readSharedCode(location.hash) ?? defaultCode;
  editor.value = createEditor(editorElement.value!, initial, isDark.value);
  editor.value.onChange(scheduleRun);
  if (exampleParam && exampleNames.includes(exampleParam)) {
    selectedExample.value = exampleParam;
    await loadExample(exampleParam);
  } else {
    await run();
  }
});

watch(isDark, (dark) => editor.value?.setDark(dark));
watch(selectedExample, (name) => name && loadExample(name));
watch(
  tab,
  (value) => value === 'graph' && graph.value && renderGraph?.(graph.value),
);

onBeforeUnmount(() => {
  worker?.terminate();
  editor.value?.dispose();
});
</script>

<template>
  <div class="playground">
    <div class="playground-toolbar">
      <select v-model="selectedExample" aria-label="Load an example">
        <option value="">Examples…</option>
        <option v-for="name in exampleNames" :key="name" :value="name">
          {{ name }}
        </option>
      </select>
      <button type="button" @click="run">Run</button>
      <button type="button" @click="share">Share link</button>
      <button type="button" :disabled="!graph" @click="copyMarkdown">
        Copy as Markdown
      </button>
      <span class="playground-status">{{ copied || status }}</span>
    </div>
    <div class="playground-body">
      <div ref="editorElement" class="playground-editor"></div>
      <div class="playground-output">
        <div v-if="error" class="playground-error" role="alert">
          <strong v-if="error.code">{{ error.code }}</strong>
          <pre>{{ error.message }}</pre>
          <a v-if="docsLink" :href="docsLink" target="_blank" rel="noopener"
            >How to fix it</a
          >
        </div>
        <div class="playground-tabs" role="tablist">
          <button
            type="button"
            :class="{ active: tab === 'graph' }"
            @click="tab = 'graph'"
          >
            Graph
          </button>
          <button
            type="button"
            :class="{ active: tab === 'trace' }"
            @click="tab = 'trace'"
          >
            Resolution trace
          </button>
          <button
            type="button"
            :class="{ active: tab === 'console' }"
            @click="tab = 'console'"
          >
            Console ({{ logs.length }})
          </button>
        </div>
        <div
          v-show="tab === 'graph'"
          id="tree-container-svg"
          class="playground-graph"
        ></div>
        <ol v-show="tab === 'trace'" class="playground-trace">
          <li
            v-for="(entry, index) in trace"
            :key="index"
            :style="{ paddingLeft: `${entry.depth * 16}px` }"
          >
            <code>{{ entry.key }}</code>
            <span class="ms">{{ entry.ms.toFixed(2) }} ms</span>
            <span v-if="entry.error" class="failed">{{ entry.error }}</span>
          </li>
          <li v-if="trace.length === 0" class="empty">Nothing resolved yet.</li>
        </ol>
        <pre v-show="tab === 'console'" class="playground-console">{{
          logs.join('\n') || 'No output.'
        }}</pre>
      </div>
    </div>
  </div>
</template>
