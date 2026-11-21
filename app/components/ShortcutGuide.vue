<script setup lang="ts">
import { SHORTCUT_GUIDE } from '../../shared/utils/shortcuts'
</script>

<template>
  <section class="settings-panel shortcut-guide" aria-labelledby="shortcut-guide-title">
    <h2 id="shortcut-guide-title">Atajos de teclado</h2>
    <p class="shortcut-note">Funcionan mientras Openfy está activo y no estás escribiendo.</p>
    <dl>
      <div v-for="item in SHORTCUT_GUIDE" :key="item.keys" class="shortcut-row">
        <dt>{{ item.label }}</dt>
        <dd>
          <template v-for="(group, groupIndex) in item.keys.split(' · ')" :key="group">
            <span v-if="groupIndex" class="shortcut-or">o</span>
            <span class="shortcut-keys"><template v-for="(part, partIndex) in group.split(' + ')" :key="part"><span v-if="partIndex" aria-hidden="true">+</span><kbd>{{ part }}</kbd></template></span>
          </template>
        </dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.shortcut-note { margin-top: 7px; color: #8f8f99; font-size: 12px; line-height: 1.7; }
dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 0 30px; margin-top: 10px; }
.shortcut-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--line); }
dt { font-size: 13px; }
dd { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 6px; color: #8f8f99; font-size: 11px; }
.shortcut-keys { display: inline-flex; align-items: center; gap: 4px; }
kbd { min-width: 24px; padding: 3px 7px; border: 1px solid rgb(255 255 255 / 12%); border-bottom-width: 2px; border-radius: 6px; background: rgb(255 255 255 / 6%); color: #e4e4e7; font: 600 11px/1.4 inherit; text-align: center; white-space: nowrap; }
</style>
