import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import injecuteUtils from '../lib/cjs/utils/index.d.ts?raw';
import injecuteIndex from '../lib/cjs/index.d.ts?raw';
import injecuteTypes from '../lib/cjs/types.d.ts?raw';
import injecuteContainer from '../lib/cjs/container.d.ts?raw';

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

  function createContainer(cfg: { useMockMailer?: boolean } = {}) {
    return new DIContainer()
      .addSingleton('emailTransport', construct(Mailer))
      .addSingleton('mockTransport', construct(MockTransport))
      .addAlias(
        'userMessageTransport',
        cfg.useMockMailer ? 'mockTransport' : 'emailTransport',
      )
      .addSingleton('greetService', construct(GreetService), ['userMessageTransport']);
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
