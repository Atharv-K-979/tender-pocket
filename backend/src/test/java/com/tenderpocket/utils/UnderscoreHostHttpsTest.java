package com.tenderpocket.utils;

import org.junit.jupiter.api.Test;

import javax.net.ssl.HttpsURLConnection;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URI;

import static org.junit.jupiter.api.Assertions.*;

class UnderscoreHostHttpsTest {

    @Test
    void wildcardCoversExactlyOneLabel() {
        assertTrue(UnderscoreHostHttps.dnsNameMatches("t247_api.tender247.com", "*.tender247.com"));
        assertTrue(UnderscoreHostHttps.dnsNameMatches("T247_API.Tender247.com", "*.TENDER247.COM"));
        assertFalse(UnderscoreHostHttps.dnsNameMatches("a.t247_api.tender247.com", "*.tender247.com"));
        assertFalse(UnderscoreHostHttps.dnsNameMatches("tender247.com", "*.tender247.com"));
        assertFalse(UnderscoreHostHttps.dnsNameMatches("t247_api.tender247.com.evil.com", "*.tender247.com"));
        assertFalse(UnderscoreHostHttps.dnsNameMatches("t247_api.com", "*.com"));
    }

    @Test
    void exactNamesMatchOnlyThemselves() {
        assertTrue(UnderscoreHostHttps.dnsNameMatches("t247_api.tender247.com", "t247_api.tender247.com"));
        assertFalse(UnderscoreHostHttps.dnsNameMatches("t247_api.tender247.com", "www.tender247.com"));
    }

    @Test
    void onlyUnderscoreHostsGetTheCustomCheck() throws Exception {
        var factory = UnderscoreHostHttps.requestFactory(1_000, 1_000);
        Method prepare = factory.getClass().getDeclaredMethod("prepareConnection", HttpURLConnection.class, String.class);
        prepare.setAccessible(true);

        var underscore = (HttpsURLConnection) URI.create("https://t247_api.tender247.com/x").toURL().openConnection();
        prepare.invoke(factory, underscore, "POST");
        assertNotSame(HttpsURLConnection.getDefaultHostnameVerifier(), underscore.getHostnameVerifier());

        var normal = (HttpsURLConnection) URI.create("https://www.tender247.com/x").toURL().openConnection();
        prepare.invoke(factory, normal, "POST");
        assertSame(HttpsURLConnection.getDefaultHostnameVerifier(), normal.getHostnameVerifier());
    }
}
