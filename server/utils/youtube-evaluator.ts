import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten'

/** YouTube's decipher code never receives Node APIs, networking or environment variables. */
export async function evaluateYouTubeScript(data: { output: string }, env: Record<string, string | number | boolean | null | undefined> = {}) {
  const quickJS = await getQuickJS()
  const runtime = quickJS.newRuntime()
  runtime.setMemoryLimit(32 * 1024 * 1024)
  runtime.setMaxStackSize(512 * 1024)
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 1000))
  const context = runtime.newContext()
  try {
    for (const [name, value] of Object.entries(env)) {
      const handle = value === undefined ? context.undefined : value === null ? context.null
        : typeof value === 'string' ? context.newString(value) : typeof value === 'number' ? context.newNumber(value)
          : value ? context.true : context.false
      context.setProp(context.global, name, handle)
      handle.dispose()
    }
    // The SDK supplies a function body with a top-level `return`, not a script.
    const result = context.evalCode(`(function () {\n${data.output}\n})()`, 'youtube-decipher.js')
    if (result.error) {
      result.error.dispose()
      throw new Error('No se pudo interpretar el audio de YouTube.')
    }
    try { return context.dump(result.value) as Record<string, unknown> }
    finally { result.value.dispose() }
  } finally { context.dispose(); runtime.dispose() }
}
