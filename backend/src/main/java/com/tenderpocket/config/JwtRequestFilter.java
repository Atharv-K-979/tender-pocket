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
        String role = null;

        if (authorizationHeader != null && authorizationHeader.startsWith("Bearer ")
                && !authorizationHeader.equals("Bearer null")
                && !authorizationHeader.equals("Bearer undefined")) {
            String jwt = authorizationHeader.substring(7);
            try {
                username = jwtUtil.extractUsername(jwt);
                role = jwtUtil.extractRole(jwt);
            } catch (Exception e) {
                // Cryptographic validation failed: do NOT authenticate request and do NOT fall back to client headers
                System.out.println("[JwtRequestFilter] Invalid JWT rejected: " + e.getMessage());
                chain.doFilter(request, response);
                return;
            }
        }

        if (username != null && !username.isEmpty() && SecurityContextHolder.getContext().getAuthentication() == null) {
            String grantedRole = (role != null && !role.isEmpty()) ? role : "User";
            SimpleGrantedAuthority authority = new SimpleGrantedAuthority("ROLE_" + grantedRole.toUpperCase().replace(" ", "_"));
            UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
                    username, null, Collections.singletonList(authority));
            authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
            SecurityContextHolder.getContext().setAuthentication(authentication);
        }

        chain.doFilter(request, response);
    }
}
