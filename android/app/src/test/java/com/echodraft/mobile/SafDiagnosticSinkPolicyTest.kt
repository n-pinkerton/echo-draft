package com.echodraft.mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SafDiagnosticSinkPolicyTest {
    @Test
    fun `verified EchoDraft diagnostic content can be replaced without journal ownership`() {
        val contents = (
            MobileDiagnosticStore.HEADER_LINE + "\n" +
                "{\"version\":1}\n"
            ).toByteArray(Charsets.UTF_8)

        assertTrue(SafDiagnosticSink.canReplaceExisting(contents, ownsIncompleteCreation = false))
    }

    @Test
    fun `owned empty or partial creation can be recovered`() {
        val partialHeader = MobileDiagnosticStore.HEADER_LINE
            .take(20)
            .toByteArray(Charsets.UTF_8)

        assertTrue(SafDiagnosticSink.canReplaceExisting(byteArrayOf(), ownsIncompleteCreation = true))
        assertTrue(SafDiagnosticSink.canReplaceExisting(partialHeader, ownsIncompleteCreation = true))
    }

    @Test
    fun `historical URI ownership cannot authorize truncating foreign content`() {
        val foreign = "unrelated user file".toByteArray(Charsets.UTF_8)

        assertFalse(SafDiagnosticSink.canReplaceExisting(foreign, ownsIncompleteCreation = false))
        assertFalse(SafDiagnosticSink.canReplaceExisting(foreign, ownsIncompleteCreation = true))
    }
}
