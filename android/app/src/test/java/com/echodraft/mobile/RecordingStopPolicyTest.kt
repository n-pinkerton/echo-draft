package com.echodraft.mobile

import org.junit.Assert.assertEquals
import org.junit.Test

class RecordingStopPolicyTest {
    @Test
    fun `successful explicit stop finalizes normally`() {
        assertEquals(
            RecordingStopDisposition.FINALIZE,
            RecordingStopPolicy.decide(
                stoppedExplicitly = true,
                limitStopRequested = false,
                validatedAfterAsyncStop = false,
            ),
        )
    }

    @Test
    fun `validated asynchronous limit stop can finalize`() {
        assertEquals(
            RecordingStopDisposition.FINALIZE,
            RecordingStopPolicy.decide(
                stoppedExplicitly = false,
                limitStopRequested = true,
                validatedAfterAsyncStop = true,
            ),
        )
    }

    @Test
    fun `invalid asynchronous limit stop is retained`() {
        assertEquals(
            RecordingStopDisposition.RETAIN_FOR_RECOVERY,
            RecordingStopPolicy.decide(
                stoppedExplicitly = false,
                limitStopRequested = true,
                validatedAfterAsyncStop = false,
            ),
        )
    }

    @Test
    fun `ordinary stop failure is discarded`() {
        assertEquals(
            RecordingStopDisposition.DISCARD,
            RecordingStopPolicy.decide(
                stoppedExplicitly = false,
                limitStopRequested = false,
                validatedAfterAsyncStop = false,
            ),
        )
    }
}
