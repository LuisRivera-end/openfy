using System.Collections.ObjectModel;

namespace Openfy.Core;

public static class CollectionUpdates
{
    /// <summary>Preserves containers and removes departed entries before moving survivors.</summary>
    public static void Replace<T, TKey>(ObservableCollection<T> target, IEnumerable<T> values, Func<T, TKey> key, Func<T, T, bool>? equivalent = null) where TKey : notnull
    {
        var copied = values.ToArray();
        var keys = copied.Select(key).ToHashSet();
        // Advancing a playlist removes its head once, instead of moving every
        // remaining row forward and generating thousands of layout notifications.
        for (int i = target.Count - 1; i >= 0; i--)
            if (!keys.Contains(key(target[i]))) target.RemoveAt(i);
        for (int i = 0; i < copied.Length; i++) {
            var id = key(copied[i]);
            if (i >= target.Count || !EqualityComparer<TKey>.Default.Equals(key(target[i]), id)) {
                int found = -1;
                for (int j = i + 1; j < target.Count; j++)
                    if (EqualityComparer<TKey>.Default.Equals(key(target[j]), id)) { found = j; break; }
                if (found >= 0) target.Move(found, i);
                else target.Insert(i, copied[i]);
            }
            if (!(equivalent?.Invoke(target[i], copied[i]) ?? EqualityComparer<T>.Default.Equals(target[i], copied[i]))) target[i] = copied[i];
        }
        while (target.Count > copied.Length) target.RemoveAt(target.Count - 1);
    }
}
