<script setup lang="ts">
import { onMounted } from 'vue';
import './playground/playground.css';

onMounted(async () => {
  // Monaco, TypeScript and d3 load only in the browser, on this page.
  await import('./playground/legacy-entry.ts');
});
</script>

<template>
  <div class="main-container">
    <div id="container"></div>
    <div id="services-tree-container">
      <div>
        <details>
          <summary>Services Tree</summary>
          <input id="services-tree-input" />
        </details>
      </div>
      <div id="services-tree" class="loading"></div>
      <div id="tree-container-svg" class="loading"></div>
    </div>
  </div>
</template>
