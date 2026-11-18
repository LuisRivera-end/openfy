<script setup lang="ts">
const startup = useStartupStore()
defineEmits<{ retry: []; revealed: [] }>()
</script>

<template>
  <Transition name="startup" @after-leave="startup.complete(); $emit('revealed')">
    <section v-if="startup.visible" class="startup-screen" :class="{ 'startup-error': startup.phase === 'error' }" aria-label="Abriendo Openfy" :aria-busy="startup.phase === 'loading'" data-testid="startup-screen">
      <img class="startup-logo" src="/icons/openfy.svg" width="80" height="80" alt="Openfy">
      <p v-if="startup.phase === 'loading'" role="status">Abriendo tu música…</p>
      <template v-else>
        <p role="alert">{{ startup.error }}</p>
        <div class="startup-actions"><button class="button primary" autofocus @click="$emit('retry')">Reintentar</button><button class="button subtle" @click="reloadNuxtApp({ force: true })">Recargar</button></div>
      </template>
    </section>
  </Transition>
</template>

<style>
.startup-screen { position: fixed; inset: 0; z-index: 10000; min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; padding: max(28px, env(safe-area-inset-top)) 28px max(28px, env(safe-area-inset-bottom)); background: #09090b; color: #f4f4f5; text-align: center; }
.startup-logo { width: 80px; height: 80px; flex-shrink: 0; animation: openfy-startup-pulse 1.4s ease-in-out infinite; }
.startup-screen p { color: #a1a1aa; font-size: 14px; line-height: 1.6; max-width: 44ch; }
.startup-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; }
.startup-error .startup-logo { animation: none; }
.startup-leave-active { transition: opacity 240ms ease-out; }
.startup-leave-to { opacity: 0; }
.startup-pending { opacity: 0; }
.startup-revealing { animation: openfy-startup-reveal 240ms ease-out; }
@keyframes openfy-startup-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
@keyframes openfy-startup-reveal { from { opacity: 0; } to { opacity: 1; } }
.reduce-motion .startup-logo { animation: none; }
.reduce-motion .startup-revealing { animation: none; }
.reduce-motion .startup-leave-active { transition: none; }
@media (prefers-reduced-motion: reduce) { .startup-logo, .startup-revealing { animation: none; } .startup-leave-active { transition: none; } }
</style>
