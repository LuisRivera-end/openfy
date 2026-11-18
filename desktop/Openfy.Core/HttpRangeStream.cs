using System.Net;
using System.Net.Http.Headers;

namespace Openfy.Core;

/// <summary>Seekable compressed audio with an eight-block, 4 MiB RAM-only LRU.</summary>
public sealed class HttpRangeStream : Stream
{
    private const int BlockSize = 512 * 1024;
    private readonly HttpClient client;
    private readonly string url;
    private readonly CancellationTokenSource lifetime = new();
    private readonly Dictionary<long, byte[]> blocks = [];
    private readonly LinkedList<long> lru = [];
    private readonly object sync = new();
    private long position;
    private readonly long length;
    public HttpRangeStream(HttpClient client, string url)
    {
        this.client = client; this.url = url;
        using var request = new HttpRequestMessage(HttpMethod.Head, url);
        using var response = client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, lifetime.Token).GetAwaiter().GetResult();
        response.EnsureSuccessStatusCode();
        length = response.Content.Headers.ContentLength ?? throw new IOException("YouTube no proporcionó el tamaño del audio.");
        if (length <= 0) throw new IOException("Archivo de audio vacío.");
    }
    public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));
    public override int Read(Span<byte> buffer)
    {
        lock (sync)
        {
            int copiedTotal = 0;
            // IMFByteStream treats a short read as EOF. A cache-block boundary
            // is not the end of the file: fill the requested span across blocks.
            while (position < length && copiedTotal < buffer.Length)
            {
                long block = position / BlockSize;
                if (!blocks.TryGetValue(block, out var bytes))
                {
                    long first = block * BlockSize, last = Math.Min(length - 1, first + BlockSize - 1);
                    if (blocks.Count == 8) { blocks.Remove(lru.First!.Value); lru.RemoveFirst(); }
                    bytes = ReadRange(first, last); blocks[block] = bytes;
                }
                lru.Remove(block); lru.AddLast(block);
                int within = (int)(position % BlockSize), copied = Math.Min(buffer.Length - copiedTotal, bytes.Length - within);
                bytes.AsSpan(within, copied).CopyTo(buffer[copiedTotal..]); position += copied; copiedTotal += copied;
            }
            return copiedTotal;
        }
    }
    private byte[] ReadRange(long first, long last)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Range = new RangeHeaderValue(first, last);
        using var response = client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, lifetime.Token).GetAwaiter().GetResult();
        if (response.StatusCode != HttpStatusCode.PartialContent || response.Content.Headers.ContentRange?.From != first || response.Content.Headers.ContentRange?.To != last)
            throw new IOException("El servidor devolvió un rango de audio incompatible.");
        byte[] bytes = new byte[checked((int)(last - first + 1))];
        using var body = response.Content.ReadAsStreamAsync(lifetime.Token).GetAwaiter().GetResult();
        body.ReadExactlyAsync(bytes, lifetime.Token).AsTask().GetAwaiter().GetResult();
        return bytes;
    }
    // Index construction must skip mdat payloads, rather than populating and
    // evicting the audio cache across the whole song before playback starts.
    internal Stream CreateMetadataView() => new MetadataView(this);
    private sealed class MetadataView(HttpRangeStream owner) : Stream
    {
        private long position, page = -1; private byte[] bytes = [];
        public override int Read(byte[] data, int at, int count) => Read(data.AsSpan(at, count));
        public override int Read(Span<byte> data)
        {
            int copied = 0;
            while (copied < data.Length && position < Length) {
                long start = position / 16384 * 16384;
                if (page != start) { bytes = []; bytes = owner.ReadRange(start, Math.Min(Length - 1, start + 16383)); page = start; }
                int within = (int)(position - page), count = Math.Min(data.Length - copied, bytes.Length - within);
                bytes.AsSpan(within, count).CopyTo(data[copied..]); copied += count; position += count;
            }
            return copied;
        }
        public override long Seek(long value, SeekOrigin origin) { long next = origin switch { SeekOrigin.Begin => value, SeekOrigin.Current => position + value, _ => Length + value }; if (next < 0) throw new IOException("Posición negativa."); return position = next; }
        public override long Position { get => position; set => Seek(value, SeekOrigin.Begin); } public override long Length => owner.Length;
        public override bool CanRead => true; public override bool CanSeek => true; public override bool CanWrite => false;
        public override void Flush() { } public override void SetLength(long value) => throw new NotSupportedException(); public override void Write(byte[] data, int at, int count) => throw new NotSupportedException();
    }
    public override long Seek(long offset, SeekOrigin origin)
    {
        lock (sync) { long target = origin switch { SeekOrigin.Begin => offset, SeekOrigin.Current => position + offset, _ => length + offset }; if (target < 0) throw new IOException("Posición negativa."); return position = target; }
    }
    public void Cancel() => lifetime.Cancel();
    protected override void Dispose(bool disposing) { if (disposing) { lifetime.Cancel(); lifetime.Dispose(); } base.Dispose(disposing); }
    public override bool CanRead => true; public override bool CanSeek => true; public override bool CanWrite => false;
    public override long Length => length;
    public override long Position { get => position; set => Seek(value, SeekOrigin.Begin); }
    public override void Flush() { }
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
