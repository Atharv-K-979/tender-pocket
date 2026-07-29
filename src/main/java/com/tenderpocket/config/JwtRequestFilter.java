package com.tenderpocket.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collections;

@Component
public class JwtRequestFilter extends OncePerRequestFilter {

    @Autowired
    private JwtUtil jwtUtil;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {

        final String authorizationHeader = request.getHeader("Authorization");

        String username = null;
        String jwt = null;
        String role = null;

        if (authorizationHeader != null && authorizationHeader.startsWith("Bearer ")) {
            jwt = authorizationHeader.substring(7);
            try {
                username = jwtUtil.extractUsername(jwt);
                role = jwtUtil.extractRole(jwt);
            } catch (Exception e) {
                System.out.println("JWT token parsing failed: " + e.getMessage());
            }
        }

        if (username == null) {
            String fallbackUser = request.getHeader("x-user-username");
            String fallbackRole = request.getHeader("x-user-role");
            if (fallbackUser != null && !fallbackUser.isEmpty()) {
                username = fallbackUser;
                role = (fallbackRole != null && !fallbackRole.isEmpty()) ? fallbackRole : "Admin";
            }
        }

        if (username != null && SecurityContextHolder.getContext().getAuthentication() == null) {
            String grantedRole = (role != null) ? role : "ADMIN";
            SimpleGrantedAuthority authority = new SimpleGrantedAuthority("ROLE_" + grantedRole.toUpperCase().replace(" ", "_"));
            UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
                    username, null, Collections.singletonList(authority));
            authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
            SecurityContextHolder.getContext().setAuthentication(authentication);
        }
        chain.doFilter(request, response);
    }
}
