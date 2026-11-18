package app.openfy.android.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal val Ink=Color(0xff09090b)
internal val Surface=Color(0xff151518)
internal val Raised=Color(0xff202024)
internal val Hairline=Color(0xff303034)
internal val TextColor=Color(0xfff4f4f5)
internal val Muted=Color(0xffa1a1aa)
internal val Green=Color(0xff1ed760)

internal object Radii {
    val tile=6.dp
    val row=8.dp
    val card=12.dp
    val feature=16.dp
    val player=18.dp
}

internal val Gutter=20.dp
internal val SectionGap=28.dp

private val openfyColors=darkColorScheme(primary=Green,onPrimary=Ink,secondary=Green,tertiary=Green,
    secondaryContainer=Color(0xff1c3528),onSecondaryContainer=Green,surfaceTint=Green,outline=Hairline,
    background=Ink,surface=Surface,onSurface=TextColor,onBackground=TextColor)

private val openfyTypography=Typography().run {
    copy(
        headlineMedium=headlineMedium.copy(fontSize=30.sp,fontWeight=FontWeight.Bold,letterSpacing=(-0.5).sp),
        titleLarge=titleLarge.copy(fontSize=22.sp,fontWeight=FontWeight.SemiBold),
        titleMedium=titleMedium.copy(fontSize=20.sp,fontWeight=FontWeight.SemiBold,lineHeight=26.sp),
        titleSmall=titleSmall.copy(fontSize=15.sp,fontWeight=FontWeight.Medium),
        bodyMedium=bodyMedium.copy(fontSize=14.sp),
        bodySmall=bodySmall.copy(fontSize=12.sp),
        labelSmall=labelSmall.copy(fontSize=11.sp)
    )
}

@Composable internal fun OpenfyTheme(content: @Composable ()->Unit) {
    MaterialTheme(colorScheme=openfyColors,typography=openfyTypography,content=content)
}
