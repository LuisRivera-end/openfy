plugins { alias(libs.plugins.kotlin.jvm); application }
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
java { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
sourceSets.main { java.srcDir("../app/src/main/java/app/openfy/android/provider") }
dependencies {
    implementation(libs.quickjs.jvm); implementation(libs.coroutines)
    implementation(libs.serialization); implementation(libs.okhttp)
}
application { mainClass.set("app.openfy.android.smoke.ProviderSmokeKt"); applicationDefaultJvmArgs=listOf("--enable-native-access=ALL-UNNAMED") }
tasks.named("run") { dependsOn(":app:buildProvider") }
