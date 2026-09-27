// Messages between the playground page and its runner worker. Everything is plain data: the page only
// renders these values as text, so code from a shared link cannot touch the page.
import type { Tree } from '../../../../src/utils/build-services-graph.ts';

export interface RunRequest {
  type: 'run';
  /** JavaScript emitted from the editor's TypeScript. */
  code: string;
}

export interface TraceEntry {
  key: string;
  depth: number;
  ms: number;
  error?: string;
}

export interface RunError {
  message: string;
  code?: string;
  docs?: string;
}

export interface RunResult {
  type: 'result';
  graph: Tree | undefined;
  trace: TraceEntry[];
  logs: string[];
  error?: RunError;
}
