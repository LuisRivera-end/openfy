package app.openfy.android.updates

import android.content.pm.PackageManager

internal object ApkIdentity {
    @Suppress("DEPRECATION")
    fun read(manager: PackageManager,path: String) = manager.getPackageArchiveInfo(path,
        // Android 10 only collects archive certificates when GET_SIGNATURES is also present.
        // Still compare the current signers from SigningInfo, never the legacy signatures array.
        PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_SIGNATURES)
}
