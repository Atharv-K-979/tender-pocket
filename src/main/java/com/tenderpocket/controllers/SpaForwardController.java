package com.tenderpocket.controllers;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class SpaForwardController {

    /**
     * Intercept client-side SPA routes (such as /tenders/{id}) and forward them to /index.html
     * so that client-side React routing handles the rendering without 404 Whitelabel errors.
     */
    @GetMapping(value = {"/tenders/{id:[^\\.]*}", "/tenders/**"})
    public String forwardTenderDetailRoutes() {
        return "forward:/index.html";
    }
}
