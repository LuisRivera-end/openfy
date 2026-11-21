<script setup lang="ts">
import type { ArtistTheme } from '../../shared/types/music'

defineProps<{ open: boolean; name: string; description: string; artwork?: string | null; theme: ArtistTheme }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <AppDialog
    class="artist-bio-dialog"
    :open="open"
    :title="`Acerca de ${name}`"
    :style="{ '--bio-deep': theme.deep, '--bio-base': theme.base }"
    @close="$emit('close')"
  >
    <div v-if="open" class="artist-bio-content">
      <div class="artist-bio-hero" :class="{ 'has-art': artwork }">
        <AlbumCover v-if="artwork" :src="artwork" :size="1024" aria-hidden="true" />
        <p aria-hidden="true">{{ name }}</p>
      </div>
      <section class="artist-bio-copy" aria-label="Biografía">
        <h3>Acerca de</h3>
        <p>{{ description }}</p>
      </section>
    </div>
  </AppDialog>
</template>

<style>
:root .artist-bio-dialog {
  width: min(540px, calc(100% - 24px));
  max-height: min(82dvh, 720px);
  padding: 0;
  overflow: auto;
  overscroll-behavior: contain;
  color: #fff;
  background: var(--bio-deep);
}
.artist-bio-dialog > header {
  position: sticky;
  top: 0;
  z-index: 1;
  justify-content: flex-end;
  height: 58px;
  padding: 8px 12px;
  margin: 0;
}
.artist-bio-dialog > header h2 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.artist-bio-dialog > header button { flex: 0 0 44px; height: 44px; color: #fff; background: var(--bio-deep); border-radius: 50%; }
.artist-bio-content { margin-top: -58px; }
.artist-bio-hero {
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: flex-end;
  min-height: 124px;
  padding: 30px 28px 12px;
  background: linear-gradient(var(--bio-base), var(--bio-deep));
}
.artist-bio-hero.has-art { min-height: clamp(210px, 56vw, 330px); }
.artist-bio-hero > .album-cover { position: absolute; inset: 0; z-index: -1; width: 100%; height: 100%; border-radius: 0; aspect-ratio: auto; background: transparent; }
.artist-bio-hero > .album-cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 29%; }
.artist-bio-hero > .album-cover svg { display: none; }
.artist-bio-hero.has-art::after { content: ''; position: absolute; inset: 0; z-index: -1; background: linear-gradient(to bottom, transparent 20%, var(--bio-deep) 100%); }
.artist-bio-hero > p { position: relative; width: 100%; isolation: isolate; font-size: clamp(29px, 6vw, 41px); font-weight: 800; line-height: 1.05; letter-spacing: -.045em; overflow-wrap: anywhere; }
.artist-bio-hero.has-art > p::before { content: ''; position: absolute; z-index: -1; inset: -42px -28px -12px; background: linear-gradient(transparent, var(--bio-deep) 42px); }
.artist-bio-copy { padding: 18px 28px 32px; }
.artist-bio-copy h3 { margin: 0 0 10px; font-size: 18px; }
.artist-bio-copy p { color: #ededf0; font-size: 15px; line-height: 1.65; white-space: pre-line; overflow-wrap: anywhere; }
.artist-bio-dialog button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

@media (max-width: 760px), (pointer: coarse) and (max-height: 500px) {
  :root .app-dialog.artist-bio-dialog { width: 100%; padding: 0 0 var(--safe-bottom, 0px); }
  .artist-bio-dialog .sheet-handle { z-index: 2; margin-inline: 0; background: var(--bio-deep); }
  .artist-bio-dialog > header { top: 23px; }
}
</style>
