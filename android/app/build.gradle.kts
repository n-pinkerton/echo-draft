import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val privateProperties = Properties().apply {
    val propertiesFile = rootProject.file("local.properties")
    if (propertiesFile.isFile) propertiesFile.inputStream().use(::load)
}

fun privateConfig(name: String): String =
    privateProperties.getProperty(name).orEmpty().trim()

fun quotedBuildConfig(value: String): String =
    "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

val msalClientId = privateConfig("echodraft.msalClientId")
val msalTenantId = privateConfig("echodraft.msalTenantId")
val msalSignatureHash = privateConfig("echodraft.msalSignatureHash")

android {
    namespace = "com.echodraft.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.echodraft.mobile"
        minSdk = 31
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"

        buildConfigField("String", "MSAL_CLIENT_ID", quotedBuildConfig(msalClientId))
        buildConfigField("String", "MSAL_TENANT_ID", quotedBuildConfig(msalTenantId))
        buildConfigField("String", "MSAL_SIGNATURE_HASH", quotedBuildConfig(msalSignatureHash))
        manifestPlaceholders["msalSignatureHash"] = msalSignatureHash.ifBlank { "not-configured" }
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.microsoft.identity.client:msal:8.4.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260522")
}
