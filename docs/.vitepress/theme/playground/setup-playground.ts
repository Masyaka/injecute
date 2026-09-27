import * as monaco from 'monaco-editor';
import ts from 'typescript';
// Every published declaration file, so the editor types match the build.
const declarations = import.meta.glob('../../../../lib/**/*.d.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import {
  DIContainer,
  construct,
  createProxyAccessor,
  defer,
  preload,
  setCacheInstance,
  buildServicesGraph,
} from '../../../../src/index.ts';

const initialCode = `



    import { DIContainer, construct, type ServiceRegistry } from "injecute";

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
      constructor(private transport: UserMessageTransport, private repo: any) {}

      createBlog(title: string, content: string): void {
        this.transport.sendUserMessage(1, \`New blog post: \${title}\`);
        this.repo.save(title, content);
      }
    }

    class BlogRepository {
      constructor(private db: any) {}
      save(title: string, content: string): void {}
    }

    class CommentService {
      constructor(private repo: any) {}
      addComment(blogId: number, text: string): void {}
    }

    class CommentRepository {
      constructor(private db: any) {}
      save(blogId: number, text: string): void {}
    }

    type Connection = any;
    type Database = any;

    // Nested namespace example: Domain.Blog with sub-namespace Domain.Blog.Comments
    function addBlogServices(container: ServiceRegistry<{ db: Database; userMessageTransport: UserMessageTransport }>) {
      return container
        .addSingleton('blogRepository', construct(BlogRepository), ['db'])
        .addSingleton('blogService', construct(BlogService), ['userMessageTransport', 'blogRepository'])
        .namespace('Comments', (comments) => 
          comments
            .addSingleton('commentRepository', construct(CommentRepository), ['db'])
            .addSingleton('commentService', construct(CommentService), ['commentRepository'])
        );
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
        .namespace('Domain', (domain) => 
          domain.namespace('Blog', addBlogServices)
        );
    }

    const greetService = createContainer().get('greetService');
    greetService.greet({ id: 1, name: 'John', email: 'john@example.com' });
`;

export type Playground = {
  getCode: () => string;
  setCode: (code: string) => void;
  onCodeChange: (callback: () => void) => void;
};

export function setupPlayground(containerId = 'container'): Playground {
  const container = document.getElementById(containerId);

  if (!container) {
    throw new Error('Container element not found');
  }

  self.MonacoEnvironment = {
    getWorker(_, label) {
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker();
      }
      return new editorWorker();
    },
  };

  monaco.languages.register({ id: 'typescript' });
  for (const [path, source] of Object.entries(declarations)) {
    const file = path.replace(/^(\.\.\/)+lib\//, '');
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      source,
      `file:///node_modules/injecute/lib/${file}`,
    );
  }
  monaco.languages.typescript.typescriptDefaults.addExtraLib(
    JSON.stringify({ name: 'injecute', types: './lib/index.d.ts' }),
    'file:///node_modules/injecute/package.json',
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

  return {
    getCode: () => model.getValue(),
    setCode: (code: string) => model.setValue(code),
    onCodeChange: (callback: () => void) => model.onDidChangeContent(callback),
  };
}

export function codeToServicesGraph(code: string) {
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
