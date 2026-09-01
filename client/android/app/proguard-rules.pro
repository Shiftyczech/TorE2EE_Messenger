# TorE2EE Messenger Proguard Rules

# Keep application classes
-keep class com.tore2ee.messenger.** { *; }

# React Native & JNI
-keep class com.facebook.react.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.soloader.** { *; }
-keep class com.facebook.react.bridge.JavaScriptModule { *; }
-keep class com.facebook.react.bridge.NativeModule { *; }
-keepclassmembers class * implements com.facebook.react.bridge.JavaScriptModule { *; }
-keepclassmembers class * implements com.facebook.react.bridge.NativeModule { *; }
-keepclassmembers,allowobfuscation class * {
    @com.facebook.react.uimanager.annotations.ReactProp <methods>;
}
-keepclassmembers,allowobfuscation class * {
    @com.facebook.react.uimanager.annotations.ReactPropGroup <methods>;
}

# Preserve Native C++ & JNI methods (Tor, TweetNaCl, C++ engines)
-keepclasseswithmembernames class * {
    native <methods>;
}
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# SQLCipher / SQLite native and Java layers
-keep class net.sqlcipher.** { *; }
-keep class net.sqlcipher.database.** { *; }
-keep class androidx.sqlite.db.** { *; }
-dontwarn net.sqlcipher.**

# Tor Native / SOCKS / Netty / Network
-keep class org.torproject.** { *; }
-keep class info.guardianproject.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**

# Security & Crypto libraries (TweetNaCl, Keychain, SpongyCastle/BouncyCastle)
-keep class com.oblador.keychain.** { *; }
-keep class org.bouncycastle.** { *; }
-keep class org.spongycastle.** { *; }
-dontwarn org.bouncycastle.**
-dontwarn org.spongycastle.**
