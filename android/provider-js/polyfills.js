// The native host owns network deadlines and cancellation. Audio never enters this VM.
globalThis.window = globalThis;
globalThis.navigator = { userAgent: 'Openfy Android', platform: 'Android' };
globalThis.Intl = { DateTimeFormat: function() { return { resolvedOptions() { return { timeZone:'America/Mexico_City' }; } }; } };
globalThis.console = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
globalThis.crypto = { randomUUID: () => __uuid(), getRandomValues(array) {
  const bytes = JSON.parse(__random(array.byteLength));
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(bytes); return array;
} };
globalThis.btoa = value => __base64(value, true);
globalThis.atob = value => __base64(value, false);
globalThis.TextEncoder = class TextEncoder {
  get encoding() { return 'utf-8'; }
  encode(text = '') { return Uint8Array.from(atob(__utf8(String(text),true)), c => c.charCodeAt(0)); }
  encodeInto(text, target) { const bytes=this.encode(text); const count=Math.min(bytes.length,target.length); target.set(bytes.subarray(0,count)); return { read:count===bytes.length ? text.length : 0,written:count }; }
};
globalThis.TextDecoder = class TextDecoder {
  get encoding() { return 'utf-8'; }
  decode(data = new Uint8Array()) { const bytes=data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer,data.byteOffset,data.byteLength); return __utf8(__bytes64(Array.from(bytes)),false); }
};
class EventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== fn)); }
  dispatchEvent(event) { for (const fn of this.listeners.get(event.type) || []) fn.call(this, event); return true; }
}
globalThis.EventTarget = EventTarget;
globalThis.Event = class Event { constructor(type) { this.type = type; } };
globalThis.CustomEvent = class CustomEvent extends Event { constructor(type, options = {}) { super(type); this.detail = options.detail; } };
class AbortSignal extends EventTarget {
  constructor() { super(); this.aborted = false; }
  throwIfAborted() { if(this.aborted) throw this.reason || new Error('Cancelled'); }
  static timeout() { return new AbortSignal(); }
  static any(signals) { const result = new AbortSignal(); for(const signal of signals) {
    const update = () => { result.aborted = true; result.reason = signal.reason; result.dispatchEvent(new Event('abort')); };
    if(signal.aborted) update(); else signal.addEventListener('abort', update);
  } return result; }
}
globalThis.AbortSignal = AbortSignal;
globalThis.AbortController = class { constructor() { this.signal = new AbortSignal(); } abort(reason) { this.signal.aborted = true; this.signal.reason = reason; this.signal.dispatchEvent(new Event('abort')); } };
globalThis.Headers = class Headers {
  constructor(init = {}) { this.valuesMap = new Map(); if(init instanceof Headers) init = [...init];
    for(const [key,value] of Array.isArray(init) ? init : Object.entries(init)) this.set(key,value); }
  set(key,value) { this.valuesMap.set(String(key).toLowerCase(),String(value)); }
  get(key) { return this.valuesMap.get(String(key).toLowerCase()) ?? null; }
  has(key) { return this.valuesMap.has(String(key).toLowerCase()); }
  append(key,value) { this.set(key,this.has(key) ? this.get(key)+', '+value : value); }
  delete(key) { this.valuesMap.delete(String(key).toLowerCase()); }
  entries() { return this.valuesMap.entries(); } keys() { return this.valuesMap.keys(); } values() { return this.valuesMap.values(); }
  forEach(fn) { for(const [key,value] of this) fn(value,key,this); }
  [Symbol.iterator]() { return this.entries(); }
};
globalThis.Request = class Request {
  constructor(input, init = {}) { const prior = typeof input === 'string' || input instanceof URL ? { url:String(input) } : input;
    Object.assign(this, { method:'GET' }, prior, init); this.url = String(prior.url); this.headers = new Headers(init.headers || prior.headers); }
  clone() { return new Request(this); }
};
globalThis.Response = class Response {
  constructor(bytes, init = {}) { Object.assign(this, { status:200, statusText:'OK', url:'' },init); this.headers = new Headers(init.headers);
    this.bytes = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes || ''));
    this.body = new ReadableStream({ start: c => { c.enqueue(this.bytes); c.close(); } }); }
  get ok() { return this.status >= 200 && this.status < 300; }
  async text() { return new TextDecoder().decode(this.bytes); }
  async json() { return JSON.parse(await this.text()); }
  async arrayBuffer() { return this.bytes.buffer.slice(this.bytes.byteOffset,this.bytes.byteOffset + this.bytes.byteLength); }
  clone() { return new Response(this.bytes, this); }
};
globalThis.FormData = class FormData { append() { throw new Error('Multipart is not part of the Android provider interface'); } };
globalThis.File = class File {};
globalThis.fetch = async (input, init = {}) => {
  const request = new Request(input, init); request.signal?.throwIfAborted();
  let body = request.body;
  if(body instanceof Uint8Array) body = { base64:__bytes64(Array.from(body)) };
  else if(body instanceof ArrayBuffer) body = { base64:__bytes64(Array.from(new Uint8Array(body))) };
  const result = JSON.parse(await __http(JSON.stringify({ url:request.url, method:request.method,
    headers:Object.fromEntries(request.headers),body:body ?? null })));
  request.signal?.throwIfAborted();
  const raw = atob(result.base64); const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  return new Response(bytes, result);
};
