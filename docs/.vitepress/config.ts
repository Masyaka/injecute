import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformerTwoslash } from '@shikijs/vitepress-twoslash';
import { defineConfig, type DefaultTheme } from 'vitepress';
import llmstxt from 'vitepress-plugin-llms';

const src = fileURLToPath(new URL('../../src/index.ts', import.meta.url));
const apiSidebarFile = fileURLToPath(
  new URL('../api/typedoc-sidebar.json', import.meta.url),
);
const apiSidebar: DefaultTheme.SidebarItem[] = existsSync(apiSidebarFile)
  ? JSON.parse(readFileSync(apiSidebarFile, 'utf8'))
  : [];

const guide: DefaultTheme.SidebarItem[] = [
  {
    text: 'Start',
    items: [
      { text: 'Getting started', link: '/guide/getting-started' },
      { text: 'Registering services', link: '/guide/registration' },
      { text: 'Containers, forks, modules', link: '/guide/containers' },
      { text: 'Lifecycle and dispose', link: '/guide/lifecycle' },
    ],
  },
  {
    text: 'How-to',
    items: [
      { text: 'Testing', link: '/guide/testing' },
      { text: 'Middlewares and events', link: '/guide/middleware-events' },
      { text: 'Async dependencies', link: '/guide/async' },
      { text: 'TypeScript', link: '/guide/typescript' },
      { text: 'Without a build step', link: '/guide/no-build' },
      { text: 'Recipes', link: '/guide/recipes' },
    ],
  },
  {
    text: 'Concepts',
    items: [
      { text: 'Roles: provider, registry, container', link: '/concepts/roles' },
      { text: 'How resolution works', link: '/concepts/resolution' },
    ],
  },
  {
    text: 'Reference',
    items: [
      { text: 'API', link: '/api/' },
      { text: 'Errors', link: '/errors/' },
      { text: 'Migrating from 0.x', link: '/migration/0.x-to-1.0' },
      { text: 'Changelog', link: '/changelog' },
    ],
  },
];

export default defineConfig({
  title: 'injecute',
  description:
    'Type-safe, decorator-free dependency injection for TypeScript: explicit keys, full inference, forks, modules and dispose.',
  lang: 'en-US',
  base: '/injecute/',
  cleanUrls: true,
  // hand-written sections appended to the generated error pages
  srcExclude: ['errors/_details/**'],
  lastUpdated: true,
  head: [['meta', { name: 'theme-color', content: '#3c8772' }]],
  markdown: {
    codeTransformers: [
      transformerTwoslash({
        twoslashOptions: {
          compilerOptions: {
            paths: { injecute: [src] },
            allowImportingTsExtensions: true,
            noEmit: true,
            lib: [
              'lib.es2022.d.ts',
              'lib.esnext.disposable.d.ts',
              'lib.dom.d.ts',
            ],
          },
        },
      }),
    ],
  },
  vite: {
    plugins: [
      llmstxt({
        domain: 'https://masyaka.github.io',
        title: 'injecute',
        description:
          'Type-safe, decorator-free dependency injection container for TypeScript. This documents injecute 1.x.',
        details: [
          'Services are registered with explicit dependency keys: `addSingleton(key, factoryOrClass, [dependencyKeys])`.',
          'Classes are detected and constructed with `new`; use `construct(Class)` for ES5-compiled or bound classes.',
          '`fork()` creates a child container; `fork({ isolated: true })` makes overrides reach the whole graph (tests).',
          'Modules are plain functions over `ServiceRegistry<{ …what they need }>` applied with `extend()`.',
          'Errors are `InjecuteError` with a stable `code`; each code has a page under /errors/.',
        ].join('\n'),
        ignoreFiles: ['api/**'],
      }),
    ],
    server: { fs: { allow: ['../..'] } },
    optimizeDeps: { exclude: ['monaco-editor'] },
  },
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/' },
      { text: 'Playground', link: '/playground' },
      { text: 'Errors', link: '/errors/' },
      {
        text: '1.x',
        items: [
          { text: 'Migrating from 0.x', link: '/migration/0.x-to-1.0' },
          { text: 'Changelog', link: '/changelog' },
        ],
      },
    ],
    sidebar: {
      '/api/': [{ text: 'API reference', items: apiSidebar }],
      '/': guide,
    },
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Masyaka/injecute' },
    ],
    editLink: {
      pattern: 'https://github.com/Masyaka/injecute/edit/next/docs/:path',
      text: 'Edit this page on GitHub',
    },
    footer: { message: 'Released under the MIT License.' },
    outline: [2, 3],
  },
});
