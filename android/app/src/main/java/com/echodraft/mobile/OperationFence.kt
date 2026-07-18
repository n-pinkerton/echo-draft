package com.echodraft.mobile

internal class OperationFence {
    @Volatile
    private var generation = 0L

    @Synchronized
    fun begin(): Long {
        generation += 1
        return generation
    }

    fun isCurrent(operation: Long): Boolean = generation == operation

    @Synchronized
    fun runIfCurrent(operation: Long, action: () -> Unit): Boolean {
        if (generation != operation) return false
        action()
        return true
    }

    @Synchronized
    fun invalidate() {
        generation += 1
    }
}
