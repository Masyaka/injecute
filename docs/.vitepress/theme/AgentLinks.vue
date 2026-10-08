<script setup lang="ts">
// Per-page buttons for people who work with AI agents: copy the page as Markdown, or open it in an
// assistant with a prompt that points to the Markdown version of the page.
import { useData, withBase } from 'vitepress';
import { computed, ref } from 'vue';

const { page } = useData();
const copied = ref(false);

const markdownPath = computed(() =>
  withBase('/' + page.value.relativePath.replace(/\.md$/, '.md')),
);
const markdownUrl = computed(() =>
  typeof window === 'undefined'
    ? markdownPath.value
    : new URL(markdownPath.value, window.location.origin).href,
);
const prompt = computed(
  () =>
    `Read ${markdownUrl.value} (injecute 1.x documentation) and help me use it in my project.`,
);

async function copyPage() {
  const response = await fetch(markdownPath.value);
  await navigator.clipboard.writeText(await response.text());
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div v-if="page.relativePath !== 'playground.md'" class="agent-links">
    <button type="button" @click="copyPage">
      {{ copied ? 'Copied' : 'Copy page' }}
    </button>
    <a :href="markdownPath" target="_blank" rel="noopener">View as Markdown</a>
    <a
      :href="`https://claude.ai/new?q=${encodeURIComponent(prompt)}`"
      target="_blank"
      rel="noopener"
      >Open in Claude</a
    >
    <a
      :href="`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`"
      target="_blank"
      rel="noopener"
      >Open in ChatGPT</a
    >
  </div>
</template>
