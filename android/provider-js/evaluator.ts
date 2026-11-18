declare const __decipher: (source: string, env: string) => Promise<string>
export async function evaluateYouTubeScript(data: { output: string }, env = {}) {
  return JSON.parse(await __decipher(data.output, JSON.stringify(env)))
}
