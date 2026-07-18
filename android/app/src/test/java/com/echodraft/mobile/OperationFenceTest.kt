package com.echodraft.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OperationFenceTest {
    @Test
    fun `new operation invalidates an older shutdown`() {
        val fence = OperationFence()
        val first = fence.begin()
        val second = fence.begin()

        assertFalse(fence.isCurrent(first))
        assertTrue(fence.isCurrent(second))
    }

    @Test
    fun `explicit invalidation rejects late completion`() {
        val fence = OperationFence()
        val operation = fence.begin()

        fence.invalidate()

        assertFalse(fence.isCurrent(operation))
    }

    @Test
    fun `invalidated operation cannot run retirement action`() {
        val fence = OperationFence()
        val operation = fence.begin()
        var retirements = 0

        fence.invalidate()
        val authorized = fence.runIfCurrent(operation) { retirements += 1 }

        assertFalse(authorized)
        assertEquals(0, retirements)
    }
}
