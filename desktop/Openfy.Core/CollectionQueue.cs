namespace Openfy.Core;

public static class CollectionQueue
{
    /// <summary>Shuffle every occurrence, including the first, without changing the source collection.</summary>
    public static T[] Mix<T>(IEnumerable<T> source, Random? random = null)
    {
        var result = source.ToArray();
        random ??= Random.Shared;
        for (int i = result.Length - 1; i > 0; i--) {
            int j = random.Next(i + 1);
            (result[i], result[j]) = (result[j], result[i]);
        }
        return result;
    }
}
