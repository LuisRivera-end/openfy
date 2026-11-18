package app.openfy.android.ui

import kotlinx.serialization.json.*

/**
 * Cards exist only for artist and album searches. A song search answers `{ songs }`, whose items carry
 * `videoId` and no `id`; treating them as cards crashed the search list on its `id` keys.
 */
fun searchCards(kind: String, result: JsonObject): List<JsonObject> =
    if(kind !in setOf("artists","albums")) emptyList()
    else (result[kind] as? JsonArray).orEmpty().mapNotNull { item ->
        (item as? JsonObject)?.takeIf { ((it["id"] as? JsonPrimitive)?.takeUnless { id -> id is JsonNull }?.contentOrNull) != null }
    }
