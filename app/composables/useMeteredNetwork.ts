type Connection = EventTarget & { saveData?: boolean; type?: string }

/** Keep static artwork when the browser reports data saver or a cellular link. */
export function useMeteredNetwork() {
  const metered = ref(false)
  const connection = import.meta.client ? (navigator as Navigator & { connection?: Connection }).connection : undefined
  if (!connection) return metered
  const read = () => { metered.value = !!connection.saveData || connection.type === 'cellular' }
  read()
  connection.addEventListener?.('change', read)
  onBeforeUnmount(() => connection.removeEventListener?.('change', read))
  return metered
}
