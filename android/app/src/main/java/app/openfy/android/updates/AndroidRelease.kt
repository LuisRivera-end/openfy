package app.openfy.android.updates

import kotlinx.serialization.Serializable
import java.net.URI
import java.io.File
import java.security.MessageDigest

@Serializable
data class AndroidRelease(val schema: Int,val applicationId: String,val version: String,val build: Long,
    val minSdk: Int,val abis: List<String>,val file: String,val bytes: Long,val sha256: String,val certificateSha256: String) {
    fun validate() {
        require(schema==1 && applicationId=="app.openfy.android") { "El manifiesto no es de Openfy Android." }
        require(build in 1..2100000000L && version.matches(Regex("[0-9]+\\.[0-9]+\\.[0-9]+"))) { "Versión inválida." }
        require(minSdk>=29 && abis.isNotEmpty() && abis.all { it in setOf("arm64-v8a","x86_64") }) { "Plataforma inválida." }
        require(file.matches(Regex("[A-Za-z0-9_.-]+\\.apk")) && bytes in 1..268435456L) { "Paquete inválido." }
        require(listOf(sha256,certificateSha256).all { it.matches(Regex("[a-fA-F0-9]{64}")) }) { "Huella inválida." }
    }
    fun compatible(currentBuild: Long,sdk: Int,deviceAbis: List<String>,certificate: String): Boolean {
        validate()
        return build>currentBuild && minSdk<=sdk && abis.any { it in deviceAbis } && certificateSha256.equals(certificate,true)
    }
    fun verify(file: File) {
        require(file.length()==bytes) { "El APK está incompleto." }
        require(digest(file)==sha256.lowercase()) { "El APK no coincide con su huella SHA-256." }
    }
    companion object {
        const val REPOSITORY="LuisRivera-end/openfy"
        const val DESCRIPTOR="openfy-android-update.json"
        fun officialAsset(url: String,file: String): Boolean = runCatching {
            val uri=URI(url)
            uri.scheme=="https" && uri.host=="github.com" && uri.port in listOf(-1,443) && uri.userInfo==null && uri.query==null && uri.fragment==null &&
                uri.rawPath.startsWith("/$REPOSITORY/releases/download/") && uri.rawPath.split('/').size==7 && uri.rawPath.endsWith("/$file")
        }.getOrDefault(false)
        fun digest(file: File): String {
            val hash=MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input -> val buffer=ByteArray(65536); while(true) { val n=input.read(buffer); if(n<0) break; hash.update(buffer,0,n) } }
            return hex(hash.digest())
        }
        fun hex(bytes: ByteArray)=bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
    }
}
