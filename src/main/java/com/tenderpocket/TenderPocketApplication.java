package com.tenderpocket;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class TenderPocketApplication {
    public static void main(String[] args) {
        SpringApplication.run(TenderPocketApplication.class, args);
    }
}
