import org.gradle.api.file.DirectoryProperty
import org.gradle.api.tasks.OutputDirectory

abstract class AndroidAssetsTask : Exec() {
    @get:OutputDirectory abstract val assetsDir: DirectoryProperty
}

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

android {
    namespace = "app.openfy.android"
    compileSdk = 37
    defaultConfig {
        applicationId = "app.openfy.android"
        minSdk = 29
        targetSdk = 37
        versionCode = providers.gradleProperty("openfyBuild").orElse("1").get().toInt()
        versionName = providers.gradleProperty("openfyVersion").orElse("0.5.3").get()
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }
    signingConfigs {
        create("production") {
            storeFile = System.getenv("OPENFY_ANDROID_KEYSTORE")?.let(::file)
            storePassword = System.getenv("OPENFY_ANDROID_STORE_PASSWORD")
            keyAlias = System.getenv("OPENFY_ANDROID_KEY_ALIAS") ?: "openfy"
            keyPassword = System.getenv("OPENFY_ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes {
        debug { applicationIdSuffix = ".debug"; versionNameSuffix = "-debug" }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.getByName("production")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    packaging { resources.excludes += listOf("META-INF/AL2.0", "META-INF/LGPL2.1", "META-INF/INDEX.LIST") }
    testOptions { unitTests.isReturnDefaultValues = true }
    providers.gradleProperty("openfyOutput").orNull?.let { layout.buildDirectory.set(file(it).resolve("app")) }
    sourceSets["main"].assets.directories.clear()
    sourceSets["test"].resources.directories.add("../../tests/fixtures")
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui); implementation(libs.compose.material3); implementation(libs.compose.icons)
    implementation(libs.activity); implementation(libs.lifecycle); implementation(libs.viewmodel)
    implementation(libs.room.runtime); implementation(libs.room.ktx); ksp(libs.room.compiler)
    implementation(libs.datastore); implementation(libs.work); implementation(libs.documentfile)
    implementation(libs.media3.player); implementation(libs.media3.session); implementation(libs.media3.okhttp)
    implementation(libs.media3.hls); implementation(libs.media3.ui)
    implementation(libs.okhttp); implementation(libs.coil); implementation(libs.coil.network)
    implementation(libs.palette)
    implementation(libs.quickjs); implementation(libs.coroutines); implementation(libs.serialization)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.test); androidTestImplementation(libs.test.runner)
    androidTestImplementation(libs.test.espresso)
    androidTestImplementation(platform(libs.compose.bom)); androidTestImplementation(libs.compose.test)
    debugImplementation(libs.compose.tooling); debugImplementation(libs.compose.test.manifest)
}

ksp { arg("room.schemaLocation", "$projectDir/schemas") }

val buildProvider by tasks.registering(AndroidAssetsTask::class) {
    assetsDir.set(layout.buildDirectory.dir("generated/provider-assets"))
    workingDir(rootProject.projectDir.parentFile)
    commandLine("node", "scripts/build-android-provider.mjs", layout.buildDirectory.dir("generated/provider-assets/provider").get().asFile.absolutePath)
    inputs.files(fileTree("../provider-js"),fileTree("../third-party"),fileTree("../../server/utils") { include("music-*.ts","youtube-music.ts","youtube-catalog.ts") },file("../../package-lock.json"),file("../../scripts/build-android-provider.mjs"))
}
tasks.named("preBuild") { dependsOn(buildProvider) }
val testFixtures by tasks.registering(AndroidAssetsTask::class) {
    assetsDir.set(layout.buildDirectory.dir("generated/test-assets"))
    workingDir(rootProject.projectDir.parentFile)
    commandLine("node","scripts/create-android-fixtures.mjs",layout.buildDirectory.dir("generated/test-assets").get().asFile.absolutePath)
    inputs.file("../../scripts/create-android-fixtures.mjs")
}
androidComponents.onVariants { variant ->
    variant.sources.assets?.addGeneratedSourceDirectory(buildProvider) { it.assetsDir }
    variant.androidTest?.sources?.assets?.addGeneratedSourceDirectory(testFixtures) { it.assetsDir }
}
