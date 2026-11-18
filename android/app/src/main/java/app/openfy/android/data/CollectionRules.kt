package app.openfy.android.data

import kotlinx.serialization.json.*

object CollectionRules {
    fun entries(value: String): List<String> = Json.parseToJsonElement(value).jsonArray.map { it.jsonPrimitive.content }
    fun encode(values: List<String>) = JsonArray(values.map(::JsonPrimitive)).toString()
    fun portable(values: List<String>) = values.filter { it.matches(Regex("youtube:[A-Za-z0-9_-]{11}")) }.distinct()
    /** Replace only portable slots. Existing local entries never cross a device boundary. */
    fun applyPortable(existing: List<String>, incoming: List<String>): List<String> {
        val portable = portable(incoming)
        val last = existing.indexOfLast { it.startsWith("youtube:") }
        if(last < 0) return existing + portable
        var index = 0
        return buildList {
            existing.forEachIndexed { position, id ->
                if(id.startsWith("youtube:")) { if(index < portable.size) add(portable[index++]) }
                else add(id)
                if(position == last) while(index < portable.size) add(portable[index++])
            }
        }
    }
}
