import TwoslashFloatingVue from '@shikijs/vitepress-twoslash/client';
import '@shikijs/vitepress-twoslash/style.css';
import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import AgentLinks from './AgentLinks.vue';
import Playground from './Playground.vue';
import VersionBanner from './VersionBanner.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'layout-top': () => h(VersionBanner),
      'doc-before': () => h(AgentLinks),
    }),
  enhanceApp({ app }) {
    app.use(TwoslashFloatingVue);
    app.component('Playground', Playground);
  },
} satisfies Theme;
