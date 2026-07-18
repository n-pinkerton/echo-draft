package com.echodraft.mobile

import android.content.Context
import android.net.Uri
import java.util.UUID

internal class PublicationJournal(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    fun rememberAudio(externalId: UUID, uri: Uri) {
        put(audioKey(externalId), uri)
    }

    fun rememberManifest(externalId: UUID, uri: Uri) {
        put(manifestKey(externalId), uri)
    }

    fun ownsAudio(externalId: UUID, uri: Uri): Boolean =
        preferences.getString(audioKey(externalId), null) == uri.toString()

    fun ownsManifest(externalId: UUID, uri: Uri): Boolean =
        preferences.getString(manifestKey(externalId), null) == uri.toString()

    fun clear(externalId: UUID) {
        check(
            preferences.edit()
                .remove(audioKey(externalId))
                .remove(manifestKey(externalId))
                .commit(),
        ) { "Could not retire the publication recovery journal" }
    }

    private fun put(key: String, uri: Uri) {
        check(preferences.edit().putString(key, uri.toString()).commit()) {
            "Could not save the publication recovery journal"
        }
    }

    private fun audioKey(externalId: UUID): String = "${externalId.toString().lowercase()}:audio"

    private fun manifestKey(externalId: UUID): String =
        "${externalId.toString().lowercase()}:manifest"

    companion object {
        private const val PREFERENCES_NAME = "mobile_publication_recovery"
    }
}
