package com.kidstudy.child

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

class EndpointStore(context: Context) {
    private val preferences =
        context.getSharedPreferences("endpoint", Context.MODE_PRIVATE)

    fun get(): String =
        normalizeBaseUrl(
            preferences.getString("base_url", BuildConfig.DEFAULT_API_BASE_URL)
                ?: BuildConfig.DEFAULT_API_BASE_URL,
        )

    fun set(value: String) {
        preferences.edit().putString("base_url", normalizeBaseUrl(value)).apply()
    }
}

class PersistentSessionCookieJar(
    context: Context,
    preferenceName: String = "session_cookie",
) : CookieJar {
    private val preferences: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        preferenceName,
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val session = cookies.lastOrNull { it.name == SESSION_COOKIE } ?: return
        preferences.edit()
            .putString("value", session.value)
            .putLong("expires_at", session.expiresAt)
            .putBoolean("secure", session.secure)
            .apply()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val value = preferences.getString("value", null) ?: return emptyList()
        val expiresAt = preferences.getLong("expires_at", 0)
        if (expiresAt <= System.currentTimeMillis()) {
            clear()
            return emptyList()
        }
        if (preferences.getBoolean("secure", false) && !url.isHttps) {
            return emptyList()
        }
        return listOf(
            Cookie.Builder()
                .name(SESSION_COOKIE)
                .value(value)
                .domain(url.host)
                .path("/")
                .expiresAt(expiresAt)
                .apply {
                    if (preferences.getBoolean("secure", false)) secure()
                }
                .httpOnly()
                .build(),
        )
    }

    fun hasSession(): Boolean =
        preferences.getString("value", null) != null &&
            preferences.getLong("expires_at", 0) > System.currentTimeMillis()

    fun clear() {
        preferences.edit().clear().apply()
    }

    private companion object {
        const val SESSION_COOKIE = "kid_study_session"
    }
}

class ApiFactory(cookieJar: PersistentSessionCookieJar) {
    private val client = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(70, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    fun create(baseUrl: String): KidStudyApi =
        Retrofit.Builder()
            .baseUrl(normalizeBaseUrl(baseUrl))
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(KidStudyApi::class.java)
}
