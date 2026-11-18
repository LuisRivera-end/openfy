package app.openfy.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.activity.viewModels
import app.openfy.android.ui.OpenfyApp
import app.openfy.android.ui.OpenfyViewModel

class MainActivity : ComponentActivity() {
    private val model: OpenfyViewModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(statusBarStyle=SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),navigationBarStyle=SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        setContent { OpenfyApp(model) }
    }
    override fun onStart() { super.onStart(); (application as OpenfyApplication).let { it.sync.schedule(); it.updates.scheduleCheck() } }
}
