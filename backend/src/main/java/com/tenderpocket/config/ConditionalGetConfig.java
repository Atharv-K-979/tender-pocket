package com.tenderpocket.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.web.filter.ShallowEtagHeaderFilter;

import java.io.InputStream;
import java.util.regex.Pattern;

/**
 * "Nothing changed" answers for the read endpoints the screens refresh in the background.
 *
 * Each successful response from these endpoints carries an ETag (a hash of its body). When the
 * browser sends that ETag back in If-None-Match and the data is still the same, the answer is
 * 304 Not Modified with no body, so an unchanged tender list or analytics result is neither
 * re-sent nor re-rendered.
 *
 * Only the listed GET endpoints are covered; downloads and every write are left untouched.
 */
@Configuration
public class ConditionalGetConfig {

    /** Tender list, one tender, its comments, executive stats, analytics, approval counts and list, users. */
    private static final Pattern REFRESHED_READS = Pattern.compile(
            "^/api/(tenders(/stats|/[^/]+(/comments)?)?|analytics|approvals/(counts|pending)|auth/users)/?$");

    @Bean
    public FilterRegistrationBean<ShallowEtagHeaderFilter> conditionalGetFilter() {
        ShallowEtagHeaderFilter filter = new ShallowEtagHeaderFilter() {
            @Override
            protected boolean shouldNotFilter(HttpServletRequest request) {
                if (!"GET".equals(request.getMethod())) {
                    return true;
                }
                String path = request.getRequestURI().substring(request.getContextPath().length());
                return !REFRESHED_READS.matcher(path).matches();
            }

            /**
             * Spring Security marks every response "Cache-Control: no-store", which normally turns the
             * ETag off. Browsers still never store these responses; the ETag is only compared by the
             * application's own requests, so it is kept for every successful GET here.
             */
            @Override
            protected boolean isEligibleForEtag(HttpServletRequest request, HttpServletResponse response,
                                                int responseStatusCode, InputStream inputStream) {
                return !response.isCommitted() && responseStatusCode >= 200 && responseStatusCode < 300;
            }
        };
        FilterRegistrationBean<ShallowEtagHeaderFilter> registration = new FilterRegistrationBean<>(filter);
        registration.addUrlPatterns("/api/*");
        // After Spring Security, so only authorised responses are hashed.
        registration.setOrder(Ordered.LOWEST_PRECEDENCE - 10);
        return registration;
    }
}
