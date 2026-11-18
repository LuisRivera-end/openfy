import { test, expect } from '@playwright/test'

test('keeps the selected occurrence, queue and volume when changing motion and reopening', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByRole('checkbox', { name: 'Nuevo diseño' })).toHaveCount(0)
  const songs = ['Actual', 'Pendiente A', 'Pendiente B', 'Pendiente A'].map((title,i) => ({
    source: 'youtube', queueId: 'occurrence-' + i, song: { videoId: i === 3 ? '00000000001' : String(i).padStart(11,'0'), title, artists: ['Openfy'], album: null, artwork: null, duration: 120 },
  }))
  const tab = await page.context().newPage()
  await tab.goto('/api/status')
  await tab.evaluate(async queue => {
    const db = await new Promise<IDBDatabase>((resolve,reject) => {
      const req = indexedDB.open('openfy'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error)
    })
    const tx = db.transaction('snapshots','readwrite')
    tx.objectStore('snapshots').put({ key: 'playback', value: { version:3, queue, originalOrder: queue.map(e => e.queueId), index:0, position:11, volume:.42, repeat:'off', shuffle:false } })
    await new Promise<void>((resolve,reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) }); db.close()
  }, songs)
  // Use another tab, leaving the seeded page alive during restoration.
  await tab.goto('/settings')
  // Native iOS switch where supported (WebKit exposes it as a switch), a checkbox elsewhere.
  const preference = tab.getByRole('checkbox', {name:'Activar movimiento ambiental'}).or(tab.getByRole('switch', {name:'Activar movimiento ambiental'}))
  await expect(preference).toBeVisible()
  const audio = tab.getByTestId('audio-engine')
  await expect(audio).toHaveJSProperty('volume', .42)
  await preference.press('Space')
  await expect(tab.locator('html')).not.toHaveAttribute('data-design')
  await expect(tab.locator('html')).toHaveClass(/reduce-motion/)
  await expect(audio).toHaveJSProperty('volume', .42)
  const direct = tab.getByRole('button',{name:'Mostrar cola',exact:true})
  if (await direct.isVisible()) await direct.click()
  else { await tab.getByRole('button',{name:'Abrir reproductor ampliado'}).click(); await tab.getByRole('button',{name:'Abrir cola desde reproductor ampliado'}).click() }
  // Desktop docks the queue beside the page; phones open it as a sheet over the expanded player.
  const queue = tab.getByRole('complementary',{name:'Cola de reproducción'}).or(tab.getByRole('dialog',{name:'Cola de reproducción'}))
  await expect(queue.getByText('3 canciones pendientes')).toBeVisible()
  await expect(queue.getByRole('button',{name:'Escuchar Actual'})).toHaveCount(0)
  await expect(queue.getByRole('button',{name:'Escuchar Pendiente A'})).toHaveCount(2)
  await queue.getByRole('button',{name:'Mover Pendiente B',exact:true}).press('Alt+ArrowUp')
  await expect(queue.locator('[data-queue-id]').first()).toHaveAttribute('data-queue-id','occurrence-2')
  const grip = queue.getByRole('button',{name:'Mover Pendiente B',exact:true})
  async function dragToEnd(cancel: boolean) {
    const from = await grip.boundingBox(), last = await queue.locator('[data-queue-id]').last().boundingBox()
    expect(from).toBeTruthy(); expect(last).toBeTruthy()
    const x = from!.x + from!.width / 2
    await tab.mouse.move(x, from!.y + from!.height / 2)
    await tab.mouse.down()
    await tab.mouse.move(x, last!.y + last!.height - 2, {steps:8})
    await tab.evaluate(() => new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
    if (cancel) await tab.keyboard.press('Escape')
    await tab.mouse.up()
  }
  await dragToEnd(true)
  await expect(queue.locator('[data-queue-id]').first()).toHaveAttribute('data-queue-id','occurrence-2')
  await dragToEnd(false)
  await expect(queue.locator('[data-queue-id]').last()).toHaveAttribute('data-queue-id','occurrence-2')
  await tab.reload()
  await expect(preference).not.toBeChecked()
  await expect(audio).toHaveJSProperty('paused',true)
})
