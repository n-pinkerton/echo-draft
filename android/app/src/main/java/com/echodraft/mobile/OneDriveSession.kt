package com.echodraft.mobile

import android.app.Activity
import android.content.Context
import android.os.Looper
import com.microsoft.identity.client.AcquireTokenSilentParameters
import com.microsoft.identity.client.AuthenticationCallback
import com.microsoft.identity.client.IAuthenticationResult
import com.microsoft.identity.client.ISingleAccountPublicClientApplication
import com.microsoft.identity.client.PublicClientApplication
import com.microsoft.identity.client.SignInParameters
import com.microsoft.identity.client.exception.MsalException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class OneDriveSession private constructor(context: Context) : OneDriveAccessTokenProvider {
    private data class SignInState(
        val application: ISingleAccountPublicClientApplication,
        val hasCurrentAccount: Boolean,
    )

    interface SignInCallback {
        fun onSignedIn()
        fun onCancelled()
        fun onError(error: Throwable)
    }

    private val applicationContext = context.applicationContext
    private val configuration = lazy {
        runCatching { OneDriveAuthConfig.fromBuildConfig(applicationContext) }
    }
    private val initializationExecutor: ExecutorService = Executors.newSingleThreadExecutor { task ->
        Thread(task, "echodraft-onedrive-auth").apply { isDaemon = true }
    }
    private val applicationLock = Any()

    @Volatile
    private var publicClientApplication: ISingleAccountPublicClientApplication? = null

    fun isConfigured(): Boolean =
        configuration.value.getOrNull() != null

    fun signIn(activity: Activity, callback: SignInCallback) {
        initializationExecutor.execute {
            val signInState = try {
                prepareSignIn()
            } catch (error: OneDriveConfigurationException) {
                activity.runOnUiThread { callback.onError(error) }
                return@execute
            } catch (_: Exception) {
                activity.runOnUiThread { callback.onError(OneDriveAuthenticationException()) }
                return@execute
            }
            activity.runOnUiThread {
                signInOnUiThread(activity, signInState, callback)
            }
        }
    }

    override fun acquireAccessToken(): String {
        check(Looper.myLooper() != Looper.getMainLooper()) {
            "OneDrive token acquisition must run in the background"
        }
        return try {
            val application = requireApplication()
            val account = application.getCurrentAccount().currentAccount
                ?: throw OneDriveSignInRequiredException()
            val parameters = AcquireTokenSilentParameters.Builder()
                .withScopes(SCOPES)
                .forAccount(account)
                .fromAuthority(account.authority)
                .build()
            application.acquireTokenSilent(parameters).accessToken
                .takeIf(String::isNotBlank)
                ?: throw OneDriveAuthenticationException()
        } catch (error: InterruptedException) {
            Thread.currentThread().interrupt()
            throw OneDriveAuthenticationException()
        } catch (_: MsalException) {
            throw OneDriveAuthenticationException()
        }
    }

    private fun signInOnUiThread(
        activity: Activity,
        state: SignInState,
        callback: SignInCallback,
    ) {
        if (activity.isFinishing || activity.isDestroyed) {
            callback.onError(OneDriveAuthenticationException())
            return
        }
        val parameters = SignInParameters.builder()
            .withActivity(activity)
            .withScopes(SCOPES)
            .withCallback(object : AuthenticationCallback {
                override fun onSuccess(authenticationResult: IAuthenticationResult) {
                    activity.runOnUiThread(callback::onSignedIn)
                }

                override fun onError(exception: MsalException) {
                    activity.runOnUiThread { callback.onError(OneDriveAuthenticationException()) }
                }

                override fun onCancel() {
                    activity.runOnUiThread(callback::onCancelled)
                }
            })
            .build()
        try {
            if (state.hasCurrentAccount) {
                state.application.signInAgain(parameters)
            } else {
                state.application.signIn(parameters)
            }
        } catch (_: Exception) {
            callback.onError(OneDriveAuthenticationException())
        }
    }

    private fun prepareSignIn(): SignInState = try {
        val application = requireApplication()
        SignInState(
            application = application,
            hasCurrentAccount = application.getCurrentAccount().currentAccount != null,
        )
    } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
        throw OneDriveAuthenticationException()
    } catch (_: MsalException) {
        throw OneDriveAuthenticationException()
    }

    private fun requireApplication(): ISingleAccountPublicClientApplication {
        publicClientApplication?.let { return it }
        synchronized(applicationLock) {
            publicClientApplication?.let { return it }
            val config = configuration.value.getOrElse {
                throw OneDriveConfigurationException()
            } ?: throw OneDriveConfigurationException()
            return try {
                PublicClientApplication.createSingleAccountPublicClientApplication(
                    applicationContext,
                    config.writeMsalConfiguration(applicationContext),
                ).also { publicClientApplication = it }
            } catch (error: InterruptedException) {
                Thread.currentThread().interrupt()
                throw OneDriveAuthenticationException()
            } catch (_: Exception) {
                throw OneDriveAuthenticationException()
            }
        }
    }

    companion object {
        private val SCOPES = listOf("Files.ReadWrite.AppFolder")

        @Volatile
        private var instance: OneDriveSession? = null

        fun from(context: Context): OneDriveSession =
            instance ?: synchronized(this) {
                instance ?: OneDriveSession(context).also { instance = it }
            }
    }
}

class OneDriveConfigurationException :
    Exception("OneDrive is not configured for this private build")

class OneDriveSignInRequiredException :
    Exception("Microsoft sign-in is required")

class OneDriveAuthenticationException :
    Exception("Microsoft authentication failed")
