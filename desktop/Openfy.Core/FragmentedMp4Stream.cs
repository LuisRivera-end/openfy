using System.Buffers.Binary;
using System.Text;

namespace Openfy.Core;

/// <summary>Exposes fragmented AAC MP4 as an indexed M4A without copying or
/// transcoding media. Only sample tables are retained; audio stays in the
/// bounded HTTP range cache. This also gives MF a reliable seek index.</summary>
public sealed class FragmentedMp4Stream : Stream
{
    private record Box(long Start, int Header, long Size, string Type) { public long Data => Start + Header; public long End => Start + Size; }
    private record Chunk(long Source, int[] Sizes, uint[] Durations);
    private readonly Stream source;
    private readonly byte[] header;
    private readonly (long Virtual, long Source, long Size)[] chunks;
    private readonly long length;
    private long position;
    private readonly object gate = new();
    private FragmentedMp4Stream(Stream source, byte[] header, List<Chunk> media)
    {
        this.source = source; this.header = header;
        long next = header.Length;
        chunks = media.Select(chunk => { long size = chunk.Sizes.Sum(n => (long)n); var item = (next, chunk.Source, size); next += size; return item; }).ToArray(); length = next;
    }
    public static Stream Open(Stream source)
    {
        using var metadata = (source as HttpRangeStream)?.CreateMetadataView();
        Stream scan = metadata ?? source;
        var boxes = Boxes(scan, 0, source.Length).ToArray();
        var moovBox = boxes.FirstOrDefault(box => box.Type == "moov");
        if (moovBox == null || !boxes.Any(box => box.Type == "moof")) { source.Position = 0; return source; }
        byte[] moov = Read(scan, moovBox.Start, checked((int)moovBox.Size));
        var moovChildren = MemoryBoxes(moov, 8, moov.Length).ToArray();
        var mvex = moovChildren.FirstOrDefault(box => box.Type == "mvex");
        if (mvex == null) { source.Position = 0; return source; }
        uint defaultDuration = 0, defaultSize = 0;
        foreach (var box in MemoryBoxes(moov, (int)mvex.Data, (int)mvex.End)) if (box.Type == "trex") { defaultDuration = U32(moov, (int)box.Data + 12); defaultSize = U32(moov, (int)box.Data + 16); }
        var media = new List<Chunk>();
        foreach (var fragment in boxes.Where(box => box.Type == "moof"))
        {
            byte[] bytes = Read(scan, fragment.Start, checked((int)fragment.Size));
            foreach (var traf in MemoryBoxes(bytes, 8, bytes.Length).Where(box => box.Type == "traf"))
            {
                long baseOffset = fragment.Start, nextData = fragment.End + 8;
                uint duration = defaultDuration, size = defaultSize;
                var children = MemoryBoxes(bytes, (int)traf.Data, (int)traf.End).ToArray();
                var tfhd = children.Single(box => box.Type == "tfhd"); int at = (int)tfhd.Data;
                uint flags = U32(bytes, at) & 0xffffff; at += 8;
                if ((flags & 1) != 0) { baseOffset = checked((long)BinaryPrimitives.ReadUInt64BigEndian(bytes.AsSpan(at))); at += 8; }
                if ((flags & 2) != 0) at += 4;
                if ((flags & 8) != 0) { duration = U32(bytes, at); at += 4; }
                if ((flags & 16) != 0) { size = U32(bytes, at); }
                foreach (var run in children.Where(box => box.Type == "trun"))
                {
                    at = (int)run.Data; flags = U32(bytes, at) & 0xffffff; int count = checked((int)U32(bytes, at + 4)); at += 8;
                    if (count < 1 || count > 1_000_000) throw new IOException("Índice AAC no válido.");
                    if ((flags & 1) != 0) { nextData = baseOffset + BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(at)); at += 4; }
                    if ((flags & 4) != 0) at += 4;
                    var sizes = new int[count]; var durations = new uint[count];
                    for (int i = 0; i < count; i++)
                    {
                        durations[i] = (flags & 256) != 0 ? U32(bytes, at) : duration; if ((flags & 256) != 0) at += 4;
                        sizes[i] = checked((int)((flags & 512) != 0 ? U32(bytes, at) : size)); if ((flags & 512) != 0) at += 4;
                        if ((flags & 1024) != 0) at += 4;
                        if ((flags & 2048) != 0) at += 4;
                        if (sizes[i] <= 0 || durations[i] == 0) throw new IOException("Muestras AAC no válidas.");
                    }
                    long payload = sizes.Sum(n => (long)n);
                    if (nextData < 0 || nextData + payload > source.Length) throw new IOException("Fragmento AAC fuera del archivo.");
                    media.Add(new(nextData, sizes, durations)); nextData += payload;
                }
            }
        }
        if (media.Count == 0) throw new IOException("El contenedor AAC no contiene muestras.");
        uint[] durationsAll = media.SelectMany(chunk => chunk.Durations).ToArray();
        int[] sizesAll = media.SelectMany(chunk => chunk.Sizes).ToArray();
        byte[] stsz = FullBox("stsz", [0, (uint)sizesAll.Length, .. sizesAll.Select(n => (uint)n)]);
        var times = new List<uint>();
        foreach (uint duration in durationsAll) { if (times.Count > 0 && times[^1] == duration) times[^2]++; else { times.Add(1); times.Add(duration); } }
        byte[] stts = FullBox("stts", [(uint)(times.Count / 2), .. times]);
        var mapping = new List<uint>();
        for (int i = 0; i < media.Count; i++) if (i == 0 || media[i].Sizes.Length != media[i - 1].Sizes.Length) mapping.AddRange([(uint)i + 1, (uint)media[i].Sizes.Length, 1]);
        byte[] stsc = FullBox("stsc", [(uint)(mapping.Count / 3), .. mapping]);
        long audioBytes = sizesAll.Sum(n => (long)n);
        long[] offsets = new long[media.Count];
        var replacements = new Dictionary<string, byte[]> { ["stsz"] = stsz, ["stts"] = stts, ["stsc"] = stsc };
        var headers = Descendants(moov).Where(box => box.Type is "mvhd" or "mdhd" or "tkhd").ToArray();
        var mdhd = headers.Single(box => box.Type == "mdhd"); var mvhd = headers.Single(box => box.Type == "mvhd");
        uint mediaScale = U32(moov, (int)mdhd.Data + (moov[mdhd.Data] == 1 ? 20 : 12));
        uint movieScale = U32(moov, (int)mvhd.Data + (moov[mvhd.Data] == 1 ? 20 : 12));
        ulong ticks = durationsAll.Aggregate(0UL, (sum, duration) => sum + duration);
        foreach (var box in headers)
        {
            byte[] data = moov.AsSpan((int)box.Start, (int)box.Size).ToArray(); bool wide = data[8] == 1;
            int at = box.Type == "tkhd" ? (wide ? 36 : 28) : (wide ? 32 : 24);
            ulong existing = wide ? BinaryPrimitives.ReadUInt64BigEndian(data.AsSpan(at)) : U32(data, at);
            if (existing != 0) continue;
            ulong duration = box.Type == "mdhd" ? ticks : checked(ticks * movieScale / Math.Max(1, mediaScale));
            if (wide) BinaryPrimitives.WriteUInt64BigEndian(data.AsSpan(at), duration); else BinaryPrimitives.WriteUInt32BigEndian(data.AsSpan(at), checked((uint)duration));
            replacements[box.Type] = data;
        }
        byte[] BuildMoov() { replacements["stco"] = replacements["co64"] = OffsetBox(offsets); return Rewrite(moov, replacements); }
        byte[] rewritten = BuildMoov();
        byte[] ftyp = BoxBytes("ftyp", Encoding.ASCII.GetBytes("M4A \0\0\0\0M4A isommp42"));
        long payloadAt = ftyp.Length + rewritten.Length + 8;
        for (int i = 0; i < media.Count; i++) { offsets[i] = payloadAt; payloadAt += media[i].Sizes.Sum(n => (long)n); }
        rewritten = BuildMoov();
        using var output = new MemoryStream(); output.Write(ftyp); output.Write(rewritten);
        output.Write(UInts([checked((uint)(audioBytes + 8))])); output.Write("mdat"u8);
        source.Position = 0;
        return new FragmentedMp4Stream(source, output.ToArray(), media);
    }
    private static byte[] Rewrite(byte[] box, Dictionary<string, byte[]> replacements)
    {
        string type = Encoding.ASCII.GetString(box, 4, 4);
        if (replacements.TryGetValue(type, out var replacement)) return replacement;
        if (type is not ("moov" or "trak" or "mdia" or "minf" or "stbl")) return box;
        using var content = new MemoryStream();
        foreach (var child in MemoryBoxes(box, 8, box.Length)) if (child.Type != "mvex" && child.Type != "sidx") content.Write(Rewrite(box.AsSpan((int)child.Start, (int)child.Size).ToArray(), replacements));
        return BoxBytes(type, content.ToArray());
    }
    private static IEnumerable<Box> Descendants(byte[] moov)
    {
        IEnumerable<Box> Walk(int start, int end) { foreach (var box in MemoryBoxes(moov, start, end)) { yield return box; if (box.Type is "trak" or "mdia") foreach (var child in Walk((int)box.Data, (int)box.End)) yield return child; } }
        return Walk(8, moov.Length);
    }
    private static byte[] OffsetBox(long[] offsets)
    { using var data = new MemoryStream(); data.Write(UInts([0, (uint)offsets.Length])); foreach (long offset in offsets) { byte[] bytes = new byte[8]; BinaryPrimitives.WriteUInt64BigEndian(bytes, (ulong)offset); data.Write(bytes); } return BoxBytes("co64", data.ToArray()); }
    private static byte[] FullBox(string type, uint[] fields) => BoxBytes(type, UInts([0, .. fields]));
    private static byte[] UInts(uint[] values) { byte[] data = new byte[values.Length * 4]; for (int i = 0; i < values.Length; i++) BinaryPrimitives.WriteUInt32BigEndian(data.AsSpan(i * 4), values[i]); return data; }
    private static byte[] BoxBytes(string type, byte[] data) { using var output = new MemoryStream(); output.Write(UInts([(uint)data.Length + 8])); output.Write(Encoding.ASCII.GetBytes(type)); output.Write(data); return output.ToArray(); }
    private static uint U32(byte[] data, int at) => BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(at, 4));
    private static byte[] Read(Stream source, long at, int count) { if (count > 16 * 1024 * 1024) throw new IOException("Metadatos MP4 demasiado grandes."); source.Position = at; byte[] data = new byte[count]; source.ReadExactly(data); return data; }
    private static IEnumerable<Box> Boxes(Stream source, long start, long end)
    {
        for (long at = start; at + 8 <= end;)
        {
            byte[] bytes = Read(source, at, 8); long size = U32(bytes, 0); int header = 8;
            if (size == 1) { size = checked((long)BinaryPrimitives.ReadUInt64BigEndian(Read(source, at + 8, 8))); header = 16; }
            if (size == 0) size = end - at;
            if (size < header || size > end - at) throw new IOException("Estructura MP4 no válida.");
            yield return new(at, header, size, Encoding.ASCII.GetString(bytes, 4, 4)); at += size;
        }
    }
    private static IEnumerable<Box> MemoryBoxes(byte[] data, int start, int end)
    { using var input = new MemoryStream(data, false); foreach (var box in Boxes(input, start, end)) yield return box; }
    public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));
    public override int Read(Span<byte> buffer)
    {
        lock (gate)
        {
            int total = 0;
            while (position < length && total < buffer.Length)
            {
                int count;
                if (position < header.Length) { count = (int)Math.Min(buffer.Length - total, header.Length - position); header.AsSpan((int)position, count).CopyTo(buffer[total..]); }
                else
                {
                    int low = 0, high = chunks.Length - 1;
                    while (low < high) { int middle = (low + high + 1) / 2; if (chunks[middle].Virtual <= position) low = middle; else high = middle - 1; }
                    var chunk = chunks[low]; long within = position - chunk.Virtual;
                    count = (int)Math.Min(buffer.Length - total, chunk.Size - within); source.Position = chunk.Source + within;
                    source.ReadExactly(buffer.Slice(total, count));
                }
                position += count; total += count;
            }
            return total;
        }
    }
    public override long Seek(long offset, SeekOrigin origin) { lock (gate) { long target = origin switch { SeekOrigin.Begin => offset, SeekOrigin.Current => position + offset, _ => length + offset }; if (target < 0) throw new IOException("Posición negativa."); return position = target; } }
    public override long Position { get => position; set => Seek(value, SeekOrigin.Begin); }
    public override long Length => length; public override bool CanRead => true; public override bool CanSeek => true; public override bool CanWrite => false;
    public override void Flush() { } public override void SetLength(long value) => throw new NotSupportedException(); public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
