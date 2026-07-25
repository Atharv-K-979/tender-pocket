package com.tenderpocket.controllers;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class SpaForwardController {

    /**
     * Handles direct browser requests to /tenders/{id} and forwards them to /index.html
     * so that client-side React Routing renders the dedicated full-page Tender Detail View.
     */
    @GetMapping(value = {"/tenders/{id:[^\\.]*}", "/tenders/**"})
    public String forwardTenderDetailRoutes() {
        return "forward:/index.html";
    }
}
