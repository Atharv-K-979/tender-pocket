package com.tenderpocket.utils;

import org.springframework.http.client.SimpleClientHttpRequestFactory;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLSession;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.Collection;
import java.util.List;
import java.util.Locale;

/**
 * HTTPS to hosts whose name contains "_", such as Tender247's API host t247_api.tender247.com.
 * Java's built-in hostname check rejects every such host ("Illegal given domain name") although
 * curl, browsers and Node accept them. For these hosts only, the certificate's DNS names are matched
 * here instead; the JDK still validates the certificate chain as usual. Other hosts are untouched.
 */
public final class UnderscoreHostHttps {

    private static final int DNS_NAME = 2;

    private UnderscoreHostHttps() {}

    public static SimpleClientHttpRequestFactory requestFactory(int connectTimeoutMs, int readTimeoutMs) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory() {
            @Override
            protected void prepareConnection(HttpURLConnection connection, String httpMethod) throws IOException {
                super.prepareConnection(connection, httpMethod);
                if (connection instanceof HttpsURLConnection https && connection.getURL().getHost().contains("_")) {
                    https.setHostnameVerifier(UnderscoreHostHttps::verify);
                }
            }
        };
        factory.setConnectTimeout(connectTimeoutMs);
        factory.setReadTimeout(readTimeoutMs);
        return factory;
    }

    static boolean verify(String host, SSLSession session) {
        try {
            Certificate[] chain = session.getPeerCertificates();
            return chain.length > 0 && chain[0] instanceof X509Certificate leaf && certificateMatches(host, leaf);
        } catch (Exception e) {
            return false;
        }
    }

    static boolean certificateMatches(String host, X509Certificate certificate) throws Exception {
        Collection<List<?>> names = certificate.getSubjectAlternativeNames();
        if (names == null) return false;
        for (List<?> name : names) {
            if (name.size() >= 2 && Integer.valueOf(DNS_NAME).equals(name.get(0))
                    && dnsNameMatches(host, String.valueOf(name.get(1)))) return true;
        }
        return false;
    }

    /** RFC 6125 matching: exact name, or "*.example.com" covering exactly one leading label. */
    static boolean dnsNameMatches(String host, String certName) {
        String h = host.toLowerCase(Locale.ROOT).replaceAll("\\.$", "");
        String c = certName.toLowerCase(Locale.ROOT).replaceAll("\\.$", "");
        if (!c.startsWith("*.")) return h.equals(c);
        String suffix = c.substring(1);                       // ".example.com"
        if (suffix.indexOf('.', 1) < 0) return false;         // never a bare "*.com"
        if (!h.endsWith(suffix)) return false;
        String label = h.substring(0, h.length() - suffix.length());
        return !label.isEmpty() && !label.contains(".");
    }
}
