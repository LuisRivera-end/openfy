package app.openfy.android.provider

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.IOException

/** InputStream.readNBytes only exists on Android 13+. Keep the same bounded behavior on Android 10. */
fun InputStream.readBounded(limit: Int): ByteArray {
    val result=ByteArrayOutputStream(minOf(limit,65536))
    val buffer=ByteArray(16384)
    while(true) {
        val count=read(buffer,0,minOf(buffer.size,limit-result.size()+1))
        if(count<0) break
        if(result.size()+count>limit) throw IOException("Metadata response exceeds limit")
        result.write(buffer,0,count)
    }
    return result.toByteArray()
}
