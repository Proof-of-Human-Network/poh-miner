---
id: mmx_android_native_dev
version: 1.0.0
description: Android native application development and UI design guide. Covers Material Design 3, Kotlin/Compose development, project configuration, accessibility, and build troubleshooting. Read this before Android native application development.
triggers:
  - android
  - kotlin
  - jetpack compose
  - android app
---

## Context
## 1. Project Scenario Assessment

Before starting development, assess the current project state:

| Scenario | Characteristics | Approach |
|----------|-----------------|----------|
| **Empty Directory** | No files present | Full initialization required, including Gradle Wrapper |
| **Has Gradle Wrapper** | `gradlew` and `gradle/wrapper/` exist | Use `./gradlew` directly for builds |
| **Android Studio Project** | Complete project structure, may lack wrapper | Check wrapper, run `gradle wrapper` if needed |
| **Incomplete Project** | Partial files present | Check missing files, complete configuration |

**Key Principles**:
- Before writing business logic, ensure `./gradlew assembleDebug` succeeds
- If `gradle.properties` is missing, create it first and configure AndroidX

### 1.1 Required Files Checklist

```
MyApp/
├── gradle.properties          # Configure AndroidX and other settings
├── settings.gradle.kts
├── build.gradle.kts           # Root level
├── gradle/wrapper/
│   └── gradle-wrapper.properties
├── app/
│   ├── build.gradle.kts       # Module level
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/example/myapp/
│       │   └── MainActivity.kt
│       └── res/
│           ├── values/
│           │   ├── strings.xml
│           │   ├── colors.xml
│           │   └── themes.xml
│           └── mipmap-*/       # App icons
```

---

## 2. Project Configuration

### 2.1 gradle.properties

```properties
# Required configuration
android.useAndroidX=true
android.enableJetifier=true

# Build optimization
org.gradle.parallel=true
kotlin.code.style=official

# JVM memory settings (adjust based on project size)
# Small projects: 2048m, Medium: 4096m, Large: 8192m+
# org.gradle.jvmargs=-Xmx4096m -Dfile.encoding=UTF-8
```

> **Note**: If you encounter `OutOfMemoryError` during build, increase `-Xmx` value. Large projects with many dependencies may require 8GB or more.

### 2.2 Dependency Declaration Standards

```kotlin
dependencies {
    // Use BOM to manage Compose versions
    implementation(platform("androidx.compose:compose-bom:2024.02.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    
    // Activity & ViewModel
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.7.0")
}
```

### 2.3 Build Variants & Product Flavors

Product Flavors allow you to create different versions of your app (e.g., free/paid, dev/staging/prod).

**Configuration in app/build.gradle.kts**:

```kotlin
android {
    // Define flavor dimensions
    flavorDimensions += "environment"
    
    productFlavors {
        create("dev") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            
            // Different config values per flavor
            buildConfigField("String", "API_BASE_URL", "\"https://dev-api.example.com\"")
            buildConfigField("Boolean", "ENABLE_LOGGING", "true")
            
            // Different resources
            resValue("string", "app_name", "MyApp Dev")
        }
        
        create("staging") {
            dimension = "environment"
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            
            buildConfigField("String", "API_BASE_URL", "\"https://staging-api.example.com\"")
            buildConfigField("Boolean", "ENABLE_LOGGING", "true")
            resValue("string", "app_name", "MyApp Staging")
        }
        
        create("prod") {
            dimension = "environment"
            // No suffix for production
            
            buildConfigField("String", "API_BASE_URL", "\"https://api.example.com\"")
            buildConfigField("Boolean", "ENABLE_LOGGING", "false")
            resValue("string", "app_name", "MyApp")
        }
    }
    
    buildTypes {
        debug {
            isDebuggable = true
            isMinifyEnabled = false
        }
        release {
            isDebuggable = false
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}
```

**Build Variant Naming**: `{flavor}{BuildType}` → e.g., `devDebug`, `prodRelease`

**Gradle Build Commands**:

```bash
# List all available build variants
./gradlew tasks --group="build"

# Build specific variant (flavor + buildType)
./gradlew assembleDevDebug        # Dev flavor, Debug build
./gradlew assembleStagingDebug    # Staging flavor, Debug build
./gradlew assembleProdRelease     # Prod flavor, Release build

# Build all variants of a specific flavor
./gradlew assembleDev             # All Dev variants (debug + release)
./gradlew assembleProd            # All Prod variants

# Build all variants of a specific build type
./gradlew assembleDebug           # All flavors, Debug build
./gradlew assembleRelease         # All flavors, Release build

# Install specific variant to device
./gradlew installDevDebug
./gradlew installProdRelease

# Build and install in one command
./gradlew installDevDebug && adb shell am start -n com.example.myapp.dev/.MainActivity
```

**Access BuildConfig in Code**:

> **Note**: Starting from AGP 8.0, `BuildConfig` is no longer generated by default. You must explicitly enable it in your `build.gradle.kts`:
> ```kotlin
> android {
>     buildFeatures {
>         buildConfig = true
>     }
> }
> ```

```kotlin
// Use build config values in your code
val apiUrl = BuildConfig.API_BASE_URL
val isLoggingEnabled = BuildConfig.ENABLE_LOGGING

if (BuildConfig.DEBUG) {
    // Debug-only code
}
```

**Flavor-Specific Source Sets**:

```
app/src/
├── main/           # Shared code for all flavors
├── dev/            # Dev-only code and resources
│   ├── java/
│   └── res/
├── staging/        # Staging-only code and resources
├── prod/           # Prod-only code and resources
├── debug/          # Debug build type code
└── release/        # Release build type code
```

**Multiple Flavor Dimensions** (e.g., environment + tier):

```kotlin
android {
    flavorDimensions += listOf("environment", "tier")
    
    productFlavors {
        create("dev") { dimension = "environment" }
        create("prod") { dimension = "environment" }
        
        create("free") { dimension = "tier" }
        create("paid") { dimension = "tier" }
    }
}
// Results in: devFreeDebug, devPaidDebug, prodFreeRelease, etc.
```

---
---
Source: `MiniMax-AI/skills` — MIT, (c) MiniMax-AI.
Condensed for the node's prompt budget. For the untruncated skill, fetch
`skills/android-native-dev/SKILL.md` from `MiniMax-AI/skills` with the `gitmcp` MCP.
