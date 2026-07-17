package com.anonymous.nolate_fe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReleaseMetadataTest {
    @Test
    fun packageAndVersionAreProductionReady() {
        assertEquals("com.anonymous.nolate_fe", BuildConfig.APPLICATION_ID)
        assertEquals("1.2.0", BuildConfig.VERSION_NAME)
        assertTrue("versionCode must stay above the first production build", BuildConfig.VERSION_CODE >= 38)
    }
}
