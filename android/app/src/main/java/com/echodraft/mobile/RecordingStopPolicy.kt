package com.echodraft.mobile

internal enum class RecordingStopDisposition {
    FINALIZE,
    RETAIN_FOR_RECOVERY,
    DISCARD,
}

internal object RecordingStopPolicy {
    fun decide(
        stoppedExplicitly: Boolean,
        limitStopRequested: Boolean,
        validatedAfterAsyncStop: Boolean,
    ): RecordingStopDisposition = when {
        stoppedExplicitly -> RecordingStopDisposition.FINALIZE
        limitStopRequested && validatedAfterAsyncStop -> RecordingStopDisposition.FINALIZE
        limitStopRequested -> RecordingStopDisposition.RETAIN_FOR_RECOVERY
        else -> RecordingStopDisposition.DISCARD
    }
}
