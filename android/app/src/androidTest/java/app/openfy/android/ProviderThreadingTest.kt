package app.openfy.android

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.openfy.android.provider.YouTubeRuntime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** The ViewModel calls the provider from Dispatchers.Main; JavaScript must never run on the UI thread (ANR). */
@RunWith(AndroidJUnit4::class)
class ProviderThreadingTest {
    @Test fun providerWorkDoesNotBlockTheMainThread(): Unit = runBlocking {
        val bundle = "globalThis.openfy={ search: async () => { const t=Date.now(); while(Date.now()-t<3000){} return { songs:[] }; } };"
        val runtime = YouTubeRuntime("", bundle)
        val main = Handler(Looper.getMainLooper())
        var last = SystemClock.elapsedRealtime()
        var longest = 0L
        var beating = true
        val beat = object : Runnable { override fun run() {
            val now = SystemClock.elapsedRealtime(); longest = maxOf(longest,now-last); last = now
            if(beating) main.postDelayed(this,100)
        } }
        try {
            val result = withContext(Dispatchers.Main) {
                last = SystemClock.elapsedRealtime(); main.post(beat)
                try { runtime.call("search",buildJsonObject { put("query","test"); put("kind","songs") }) }
                finally { beating = false; longest = maxOf(longest,SystemClock.elapsedRealtime()-last) }
            }
            assertEquals(0,result.getValue("songs").jsonArray.size)
            assertTrue("Main thread was blocked for $longest ms",longest<1000)
        } finally { runtime.close() }
    }
}
